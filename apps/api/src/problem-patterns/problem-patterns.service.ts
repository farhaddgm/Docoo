import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  patternAiRequestSchema,
  patternCreateSchema,
  patternDraftUpdateSchema,
  patternPublishSchema,
  patternRevisionSchema,
  problemPatternDefinitionSchema,
  type ProblemPatternDefinition,
} from '@docoo/contracts';
import { setDatabaseRequestContext } from '@docoo/database';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { z } from 'zod';
import { DATABASE_POOL } from '../tokens.js';
import { PatternAiProvider } from './pattern-ai.provider.js';

export interface PatternContext {
  workspaceId: string;
  actorId: string;
  correlationId: string;
}
export interface PatternRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  status: string;
  revision: number;
  definition: ProblemPatternDefinition;
  creation_hash: string;
}
export interface RunRow extends QueryResultRow {
  id: string;
  pattern_id: string;
  kind: 'chat' | 'test';
  revision: number;
  definition_hash: string;
  request_hash: string;
  content: string;
  status: 'pending' | 'complete' | 'failed';
  result: unknown;
  error_code: string | null;
  created_at: Date;
}

/** Stable across JSONB key ordering and client property ordering. */
export function patternHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    if (item !== null && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(item) ?? 'null';
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}

@Injectable()
export class ProblemPatternsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(PatternAiProvider) private readonly ai: PatternAiProvider,
  ) {}

  list(context: PatternContext) {
    return this.tx(context, async (client) => {
      const rows = await client.query<Record<string, unknown>>(
        `select id, pattern_key, status, revision, definition->>'title' as title, updated_at,
        (select max(version) from problem_pattern_versions v where v.pattern_id = p.id and v.workspace_id = p.workspace_id) as latest_version
        from problem_patterns p where workspace_id = $1 order by updated_at desc, id desc limit 100`,
        [context.workspaceId],
      );
      return { patterns: rows.rows };
    });
  }

  listPublished(context: PatternContext) {
    return this.tx(context, async (client) => {
      const rows = await client.query<Record<string, unknown>>(
        `select v.id as "versionId", v.pattern_id as "patternId",
                v.definition->>'key' as key, v.version, v.revision,
                v.published_at as "publishedAt", v.definition
           from problem_pattern_versions v
          where v.workspace_id = $1 and app.problem_pattern_is_selectable(v.pattern_id,v.workspace_id) 
          order by v.definition->>'key', v.version desc`,
        [context.workspaceId],
      );
      return { items: rows.rows };
    });
  }

  create(context: PatternContext, raw: unknown) {
    const input = this.parse(patternCreateSchema, raw);
    return this.tx(context, async (client) => {
      await this.keyLock(client, context, input.idempotencyKey);
      const hash = patternHash(input.definition);
      const prior = await client.query<PatternRow>(
        'select * from problem_patterns where workspace_id=$1 and created_by=$2 and creation_key=$3',
        [context.workspaceId, context.actorId, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].creation_hash !== hash)
          throw new ConflictException({ code: 'PATTERN_IDEMPOTENCY_CONFLICT' });
        return prior.rows[0];
      }
      const duplicate = await client.query<Record<string, unknown>>(
        'select id from problem_patterns where workspace_id=$1 and pattern_key=$2',
        [context.workspaceId, input.definition.key],
      );
      if (duplicate.rowCount) throw new ConflictException({ code: 'PATTERN_KEY_EXISTS' });
      const result = await client.query<PatternRow>(
        `insert into problem_patterns(workspace_id,pattern_key,definition,created_by,creation_key,creation_hash)
        values($1,$2,$3::jsonb,$4,$5,$6) returning *`,
        [
          context.workspaceId,
          input.definition.key,
          JSON.stringify(input.definition),
          context.actorId,
          input.idempotencyKey,
          hash,
        ],
      );
      const row = result.rows[0]!;
      await this.audit(client, context, row.id, 'draft_created', { revision: 1 });
      return row;
    });
  }

  get(context: PatternContext, id: string, before: string | null = null) {
    return this.tx(context, async (client) => {
      const pattern = await this.read(client, context, id);
      const runs = await client.query<RunRow>(
        `select id,kind,revision,content,status,result,error_code,created_at from problem_pattern_ai_runs where workspace_id=$1 and pattern_id=$2
          and ($3::uuid is null or (created_at,id) < (select created_at,id from problem_pattern_ai_runs where id=$3 and workspace_id=$1 and pattern_id=$2))
          order by created_at desc,id desc limit 50`,
        [context.workspaceId, id, before],
      );
      const versions = await client.query<Record<string, unknown>>(
        `select id,version,revision,published_at,published_by,test_run_id from problem_pattern_versions where workspace_id=$1 and pattern_id=$2 order by version desc limit 100`,
        [context.workspaceId, id],
      );
      return {
        pattern,
        runs: runs.rows.toReversed(),
        versions: versions.rows,
        nextRunCursor: runs.rows.length === 50 ? runs.rows.at(-1)!.id : null,
      };
    });
  }

  getVersion(context: PatternContext, id: string, versionId: string) {
    return this.tx(context, async (client) => {
      await this.read(client, context, id);
      const result = await client.query<Record<string, unknown>>(
        'select * from problem_pattern_versions where workspace_id=$1 and pattern_id=$2 and id=$3',
        [context.workspaceId, id, versionId],
      );
      if (!result.rows[0]) throw new NotFoundException({ code: 'PATTERN_VERSION_NOT_FOUND' });
      return result.rows[0];
    });
  }

  update(context: PatternContext, id: string, raw: unknown) {
    const input = this.parse(patternDraftUpdateSchema, raw);
    return this.tx(context, async (client) => {
      const row = await this.read(client, context, id, true);
      this.editable(row, input.expectedRevision);
      const result = await client.query<PatternRow>(
        `update problem_patterns set definition=$3::jsonb, pattern_key=$4, revision=revision+1,updated_at=clock_timestamp() where workspace_id=$1 and id=$2 returning *`,
        [context.workspaceId, id, JSON.stringify(input.definition), input.definition.key],
      );
      await this.audit(client, context, id, 'draft_updated', { revision: row.revision + 1 });
      return result.rows[0]!;
    });
  }

  archive(context: PatternContext, id: string, raw: unknown) {
    const input = this.parse(patternRevisionSchema, raw);
    return this.tx(context, async (client) => {
      const row = await this.read(client, context, id, true);
      if (row.revision !== input.expectedRevision)
        throw new ConflictException({ code: 'PATTERN_REVISION_CONFLICT' });
      if (row.status !== 'archived') {
        await client.query<Record<string, unknown>>(
          "update problem_patterns set status='archived',updated_at=clock_timestamp() where workspace_id=$1 and id=$2",
          [context.workspaceId, id],
        );
        await this.audit(client, context, id, 'archived', { revision: row.revision });
      }
      return { id, status: 'archived' };
    });
  }

  publish(context: PatternContext, id: string, raw: unknown) {
    const input = this.parse(patternPublishSchema, raw);
    const hash = patternHash({ id, ...input });
    return this.tx(context, async (client) => {
      await this.keyLock(client, context, input.idempotencyKey);
      const prior = await client.query<Record<string, unknown>>(
        'select * from problem_pattern_versions where workspace_id=$1 and published_by=$2 and idempotency_key=$3',
        [context.workspaceId, context.actorId, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0]['request_hash'] !== hash)
          throw new ConflictException({ code: 'PATTERN_IDEMPOTENCY_CONFLICT' });
        return prior.rows[0];
      }
      const row = await this.read(client, context, id, true);
      this.editable(row, input.expectedRevision);
      const test = await client.query<RunRow>(
        "select * from problem_pattern_ai_runs where workspace_id=$1 and pattern_id=$2 and id=$3 and kind='test' and status='complete'",
        [context.workspaceId, id, input.testRunId],
      );
      if (
        !test.rows[0] ||
        test.rows[0].revision !== row.revision ||
        test.rows[0].definition_hash !== patternHash(row.definition)
      ) {
        throw new ConflictException({ code: 'PATTERN_CURRENT_TEST_REQUIRED' });
      }
      const existing = await client.query<Record<string, unknown>>(
        'select id from problem_pattern_versions where workspace_id=$1 and pattern_id=$2 and revision=$3',
        [context.workspaceId, id, row.revision],
      );
      if (existing.rowCount)
        throw new ConflictException({ code: 'PATTERN_REVISION_ALREADY_PUBLISHED' });
      const result = await client.query<Record<string, unknown>>(
        `insert into problem_pattern_versions(pattern_id,workspace_id,version,revision,definition,test_run_id,published_by,idempotency_key,request_hash)
        select $1,$2,coalesce(max(version),0)+1,$3,$4::jsonb,$5,$6,$7,$8 from problem_pattern_versions where pattern_id=$1 and workspace_id=$2 returning *`,
        [
          id,
          context.workspaceId,
          row.revision,
          JSON.stringify(row.definition),
          input.testRunId,
          context.actorId,
          input.idempotencyKey,
          hash,
        ],
      );
      await client.query<Record<string, unknown>>(
        "update problem_patterns set status='published',updated_at=clock_timestamp() where workspace_id=$1 and id=$2",
        [context.workspaceId, id],
      );
      await this.audit(client, context, id, 'version_published', {
        revision: row.revision,
        version: result.rows[0]!['version'],
      });
      return result.rows[0]!;
    });
  }

  async run(
    context: PatternContext,
    id: string,
    kind: 'chat' | 'test',
    raw: unknown,
    signal: AbortSignal,
  ) {
    const input = this.parse(patternAiRequestSchema, raw);
    const requestHash = patternHash({ id, kind, ...input });
    const prepared = await this.tx(context, async (client) => {
      await this.keyLock(client, context, input.idempotencyKey);
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        `pattern-rate:${context.workspaceId}:${context.actorId}`,
      ]);
      const row = await this.read(client, context, id, true);
      const prior = await client.query<RunRow>(
        'select * from problem_pattern_ai_runs where workspace_id=$1 and actor_id=$2 and idempotency_key=$3',
        [context.workspaceId, context.actorId, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash)
          throw new ConflictException({ code: 'PATTERN_IDEMPOTENCY_CONFLICT' });
        if (
          prior.rows[0].status === 'pending' &&
          Date.now() - prior.rows[0].created_at.getTime() > 180_000
        ) {
          await client.query<Record<string, unknown>>(
            "update problem_pattern_ai_runs set status='failed',error_code='PATTERN_AI_INTERRUPTED',completed_at=clock_timestamp() where id=$1 and workspace_id=$2 and status='pending'",
            [prior.rows[0].id, context.workspaceId],
          );
          return {
            run: {
              ...prior.rows[0],
              status: 'failed' as const,
              error_code: 'PATTERN_AI_INTERRUPTED',
            },
            row,
            fresh: false,
          };
        }
        return { run: prior.rows[0], row, fresh: false };
      }
      this.editable(row, input.expectedRevision);

      const active = await client.query<Record<string, unknown>>(
        "select id from problem_pattern_ai_runs where workspace_id=$1 and pattern_id=$2 and status='pending' and created_at > clock_timestamp() - interval '3 minutes' limit 1",
        [context.workspaceId, id],
      );
      if (active.rowCount) throw new ConflictException({ code: 'PATTERN_AI_BUSY' });
      const recent = await client.query<Record<string, unknown>>(
        "select count(*)::int as count from problem_pattern_ai_runs where workspace_id=$1 and actor_id=$2 and created_at > clock_timestamp() - interval '1 hour'",
        [context.workspaceId, context.actorId],
      );
      if (Number(recent.rows[0]?.['count']) >= 30)
        throw new ConflictException({ code: 'PATTERN_AI_RATE_LIMITED' });
      const result = await client.query<RunRow>(
        `insert into problem_pattern_ai_runs(pattern_id,workspace_id,actor_id,kind,revision,definition_hash,idempotency_key,request_hash,content,provider_consent)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,true) returning *`,
        [
          id,
          context.workspaceId,
          context.actorId,
          kind,
          row.revision,
          patternHash(row.definition),
          input.idempotencyKey,
          requestHash,
          input.content,
        ],
      );
      await this.audit(client, context, id, `${kind}_started`, {
        revision: row.revision,
        runId: result.rows[0]!.id,
      });
      return { run: result.rows[0]!, row, fresh: true };
    });
    if (!prepared.fresh) return prepared.run;
    try {
      const history =
        kind === 'chat'
          ? await this.tx(context, async (client) => {
              const historyRows = await client.query<RunRow>(
                "select content,result from problem_pattern_ai_runs where workspace_id=$1 and pattern_id=$2 and actor_id=$3 and kind='chat' and status='complete' order by created_at desc,id desc limit 6",
                [context.workspaceId, id, context.actorId],
              );
              // Bound history by whole messages; never silently truncate a proposed definition.
              const bounded: { content: string; result: unknown }[] = [];
              let size = 0;
              for (const item of historyRows.rows) {
                const next = { content: item.content, result: item.result };
                size += JSON.stringify(next).length;
                if (size > 24_000) break;
                bounded.unshift(next);
              }
              return bounded;
            })
          : [];
      const definition = problemPatternDefinitionSchema.parse(prepared.row.definition);
      const result = await this.ai.complete({
        mode: kind,
        definition,
        content: input.content,
        history,
        context,
        signal,
      });
      if (signal.aborted) throw new Error('cancelled');
      if (result.definition && result.definition.key !== definition.key)
        throw new Error('key_changed');
      return await this.tx(context, async (client) => {
        const updated = await client.query<RunRow>(
          "update problem_pattern_ai_runs set status='complete',result=$3::jsonb,completed_at=clock_timestamp() where id=$1 and workspace_id=$2 and status='pending' returning *",
          [prepared.run.id, context.workspaceId, JSON.stringify(result)],
        );
        if (!updated.rows[0]) throw new ConflictException({ code: 'PATTERN_AI_RUN_EXPIRED' });
        await this.audit(client, context, id, `${kind}_completed`, {
          revision: prepared.row.revision,
          runId: prepared.run.id,
        });
        return updated.rows[0];
      });
    } catch {
      await this.tx(context, async (client) => {
        await client.query<Record<string, unknown>>(
          "update problem_pattern_ai_runs set status='failed',error_code=$3,completed_at=clock_timestamp() where id=$1 and workspace_id=$2 and status='pending'",
          [
            prepared.run.id,
            context.workspaceId,
            signal.aborted ? 'PATTERN_AI_CANCELLED' : 'PATTERN_AI_FAILED',
          ],
        );
        await this.audit(client, context, id, `${kind}_failed`, {
          revision: prepared.row.revision,
          runId: prepared.run.id,
        });
      });
      throw new ServiceUnavailableException({
        code: signal.aborted ? 'PATTERN_AI_CANCELLED' : 'PATTERN_AI_FAILED',
        runId: prepared.run.id,
      });
    }
  }

  private parse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      throw new UnprocessableEntityException({
        code: 'PATTERN_INVALID_INPUT',
        issues: parsed.error.issues,
      });
    return parsed.data;
  }
  private editable(row: PatternRow, revision: number) {
    if (row.status === 'archived') throw new ConflictException({ code: 'PATTERN_ARCHIVED' });
    if (row.revision !== revision)
      throw new ConflictException({ code: 'PATTERN_REVISION_CONFLICT' });
  }
  private async read(client: PoolClient, context: PatternContext, id: string, lock = false) {
    const result = await client.query<PatternRow>(
      `select * from problem_patterns where workspace_id=$1 and id=$2${lock ? ' for update' : ''}`,
      [context.workspaceId, id],
    );
    if (!result.rows[0]) throw new NotFoundException({ code: 'PATTERN_NOT_FOUND' });
    return result.rows[0];
  }
  private async keyLock(client: PoolClient, context: PatternContext, key: string) {
    await client.query<Record<string, unknown>>(
      'select pg_advisory_xact_lock(hashtextextended($1,0))',
      [`pattern:${context.workspaceId}:${context.actorId}:${key}`],
    );
  }
  private async audit(
    client: PoolClient,
    context: PatternContext,
    id: string,
    action: string,
    after: unknown,
  ) {
    await client.query<Record<string, unknown>>(
      `insert into audit_events(workspace_id,actor_id,action,target_type,target_id,"after",correlation_id) values($1,$2,$3,'problem_pattern',$4,$5::jsonb,$6)`,
      [
        context.workspaceId,
        context.actorId,
        `problem_pattern.${action}`,
        id,
        JSON.stringify(after),
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          context.correlationId,
        )
          ? context.correlationId
          : randomUUID(),
      ],
    );
  }
  private async tx<T>(context: PatternContext, operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query<Record<string, unknown>>('begin');
      await setDatabaseRequestContext(client, context);
      const result = await operation(client);
      await client.query<Record<string, unknown>>('commit');
      return result;
    } catch (error) {
      await client.query<Record<string, unknown>>('rollback').catch(() => undefined);
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new ConflictException({
          code:
            'constraint' in error &&
            error.constraint === 'problem_patterns_workspace_pattern_key_uq'
              ? 'PATTERN_KEY_EXISTS'
              : 'PATTERN_DUPLICATE',
        });
      throw error;
    } finally {
      client.release();
    }
  }
}
