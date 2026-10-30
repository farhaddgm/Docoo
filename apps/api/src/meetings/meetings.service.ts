import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  emptyMeetingState,
  meetingRequestSchema,
  meetingStateSchema,
  meetingUpdateSchema,
  resolveProblemPatternSnapshot,
  supportsMeetingPreparation,
  type MeetingState,
} from '@docoo/contracts';
import { setDatabaseRequestContext } from '@docoo/database';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { DATABASE_POOL } from '../tokens.js';
import { patternHash, type PatternContext } from '../problem-patterns/problem-patterns.service.js';
import { MeetingProvider } from './meeting.provider.js';

export interface MeetingRevision {
  revision: number;
  state: MeetingState;
}
export interface MeetingRun {
  id: string;
  revision: number;
  status: string;
  request_hash: string;
  created_at: Date;
  result: unknown;
  content: string;
  mode: string;
}
@Injectable()
export class MeetingsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(MeetingProvider) private readonly ai: MeetingProvider,
  ) {}
  get(context: PatternContext, projectId: string, before: string | null = null) {
    return this.tx(context, async (client) => {
      const pattern = await this.project(client, context, projectId, false);
      const state = await this.current(client, context, projectId);
      const runs = await client.query<MeetingRun>(
        `select id,revision,mode,difficulty,content,status,result,error_code,created_at from project_meeting_runs where workspace_id=$1 and project_id=$2
        and ($3::uuid is null or (created_at,id)<(select created_at,id from project_meeting_runs where id=$3 and workspace_id=$1 and project_id=$2)) order by created_at desc,id desc limit 50`,
        [context.workspaceId, projectId, before],
      );
      return {
        ...state,
        patternVersion: pattern.version,
        runs: runs.rows.toReversed(),
        nextCursor: runs.rows.length === 50 ? runs.rows.at(-1)!.id : null,
      };
    });
  }
  save(context: PatternContext, projectId: string, raw: unknown) {
    const input = this.parse(meetingUpdateSchema, raw);
    return this.tx(context, async (client) => {
      await this.project(client, context, projectId, true);
      await this.lock(client, `meeting:${context.workspaceId}:${projectId}`);
      const current = await this.current(client, context, projectId);
      if (current.revision !== input.expectedRevision)
        throw new ConflictException({ code: 'MEETING_REVISION_CONFLICT' });
      const revision = current.revision + 1;
      await client.query(
        `insert into project_meeting_revisions(project_id,workspace_id,revision,state,created_by) values($1,$2,$3,$4::jsonb,$5)`,
        [projectId, context.workspaceId, revision, JSON.stringify(input.state), context.actorId],
      );
      await this.audit(client, context, projectId, 'saved', {
        revision,
        practice: input.state.practice,
        occurred: input.state.reflection.occurred,
      });
      return { revision, state: input.state };
    });
  }
  async run(context: PatternContext, projectId: string, raw: unknown, signal: AbortSignal) {
    const input = this.parse(meetingRequestSchema, raw);
    const hash = patternHash({ projectId, ...input });
    const prepared = await this.tx(context, async (client) => {
      const pattern = await this.project(client, context, projectId, true);
      await this.lock(
        client,
        `meeting-key:${context.workspaceId}:${context.actorId}:${input.idempotencyKey}`,
      );
      await this.lock(client, `meeting-rate:${context.workspaceId}:${context.actorId}`);
      await this.lock(client, `meeting:${context.workspaceId}:${projectId}`);
      const prior = await client.query<MeetingRun>(
        'select * from project_meeting_runs where workspace_id=$1 and actor_id=$2 and idempotency_key=$3',
        [context.workspaceId, context.actorId, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== hash)
          throw new ConflictException({ code: 'MEETING_IDEMPOTENCY_CONFLICT' });
        if (
          prior.rows[0].status === 'pending' &&
          Date.now() - prior.rows[0].created_at.getTime() > 180000
        ) {
          await client.query(
            "update project_meeting_runs set status='failed',error_code='MEETING_INTERRUPTED',completed_at=clock_timestamp() where id=$1 and workspace_id=$2 and status='pending'",
            [prior.rows[0].id, context.workspaceId],
          );
          return {
            fresh: false,
            run: { ...prior.rows[0], status: 'failed' },
            pattern,
            state: emptyMeetingState(),
          };
        }
        return { fresh: false, run: prior.rows[0], pattern, state: emptyMeetingState() };
      }
      const current = await this.current(client, context, projectId);
      if (current.revision !== input.expectedRevision)
        throw new ConflictException({ code: 'MEETING_REVISION_CONFLICT' });
      if (input.mode === 'rehearse' && current.state.practice !== 'practicing')
        throw new ConflictException({ code: 'MEETING_PRACTICE_NOT_STARTED' });

      const active = await client.query<{ id: string }>(
        "select id from project_meeting_runs where workspace_id=$1 and project_id=$2 and status='pending' and created_at>clock_timestamp()-interval '3 minutes' limit 1",
        [context.workspaceId, projectId],
      );
      if (active.rowCount) throw new ConflictException({ code: 'MEETING_AI_BUSY' });
      const count = await client.query<{ count: number }>(
        "select count(*)::int as count from project_meeting_runs where workspace_id=$1 and actor_id=$2 and created_at>clock_timestamp()-interval '1 hour'",
        [context.workspaceId, context.actorId],
      );
      if ((count.rows[0]?.count ?? 0) >= 30)
        throw new ConflictException({ code: 'MEETING_RATE_LIMITED' });
      const result = await client.query<MeetingRun>(
        `insert into project_meeting_runs(project_id,workspace_id,revision,actor_id,mode,difficulty,content,provider_consent,idempotency_key,request_hash) values($1,$2,$3,$4,$5,$6,$7,true,$8,$9) returning *`,
        [
          projectId,
          context.workspaceId,
          current.revision,
          context.actorId,
          input.mode,
          input.difficulty,
          input.content,
          input.idempotencyKey,
          hash,
        ],
      );
      await this.audit(client, context, projectId, 'request_started', {
        revision: current.revision,
        runId: result.rows[0]!.id,
        mode: input.mode,
      });
      return { fresh: true, run: result.rows[0]!, pattern, state: current.state };
    });
    if (!prepared.fresh) return prepared.run;
    try {
      const history = await this.tx(context, async (client) => {
        const rows = await client.query<{ content: string; result: unknown }>(
          "select content,result from project_meeting_runs where workspace_id=$1 and project_id=$2 and actor_id=$3 and mode=$4 and status='complete' order by created_at desc,id desc limit 6",
          [context.workspaceId, projectId, context.actorId, input.mode],
        );
        const bounded: unknown[] = [];
        let size = 0;
        for (const row of rows.rows) {
          size += JSON.stringify(row).length;
          if (size > 24000) break;
          bounded.unshift(row);
        }
        return bounded;
      });
      const response = await this.ai.complete({
        mode: input.mode,
        difficulty: input.difficulty,
        content: input.content,
        state: prepared.state,
        pattern: prepared.pattern.definition,
        history,
        context,
        projectId,
        signal,
      });
      signal.throwIfAborted();
      return await this.tx(context, async (client) => {
        await this.project(client, context, projectId, true);
        const result = await client.query<MeetingRun>(
          "update project_meeting_runs set status='complete',result=$3::jsonb,completed_at=clock_timestamp() where id=$1 and workspace_id=$2 and status='pending' returning *",
          [prepared.run.id, context.workspaceId, JSON.stringify(response)],
        );
        if (!result.rows[0]) throw new ConflictException({ code: 'MEETING_REQUEST_EXPIRED' });
        await this.audit(client, context, projectId, 'request_completed', {
          runId: prepared.run.id,
          revision: input.expectedRevision,
          mode: input.mode,
        });
        return result.rows[0];
      });
    } catch {
      await this.tx(context, async (client) => {
        await client.query(
          "update project_meeting_runs set status='failed',error_code=$3,completed_at=clock_timestamp() where id=$1 and workspace_id=$2 and status='pending'",
          [
            prepared.run.id,
            context.workspaceId,
            signal.aborted ? 'MEETING_CANCELLED' : 'MEETING_AI_FAILED',
          ],
        );
        await this.audit(client, context, projectId, 'request_failed', { runId: prepared.run.id });
      });
      throw new ServiceUnavailableException({
        code: signal.aborted ? 'MEETING_CANCELLED' : 'MEETING_AI_FAILED',
      });
    }
  }
  private async project(
    client: PoolClient,
    context: PatternContext,
    projectId: string,
    edit: boolean,
  ) {
    const result = await client.query<{ status: string; problem_pattern_snapshot: unknown }>(
      `select status,problem_pattern_snapshot from projects where workspace_id=$1 and id=$2 and status<>'deleted' and app.resource_access('project',workspace_id,id) is not null${edit ? ' for update' : ''}`,
      [context.workspaceId, projectId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: 'MEETING_NOT_FOUND' });
    const pattern = resolveProblemPatternSnapshot(
      row.problem_pattern_snapshot,
      context.workspaceId,
    );
    if (!pattern || !supportsMeetingPreparation(pattern.definition))
      throw new NotFoundException({ code: 'MEETING_PATTERN_REQUIRED' });
    if (edit) {
      const access = await client.query<{ access: string }>(
        "select app.resource_access('project',$1,$2) as access",
        [context.workspaceId, projectId],
      );
      if (access.rows[0]?.access !== 'EDIT' || row.status === 'archived')
        throw new ConflictException({ code: 'MEETING_READ_ONLY' });
    }
    return pattern;
  }
  private async current(
    client: PoolClient,
    context: PatternContext,
    projectId: string,
  ): Promise<MeetingRevision> {
    const result = await client.query<MeetingRevision>(
      'select revision,state from project_meeting_revisions where workspace_id=$1 and project_id=$2 order by revision desc limit 1',
      [context.workspaceId, projectId],
    );
    const row = result.rows[0];
    return row
      ? { revision: row.revision, state: meetingStateSchema.parse(row.state) }
      : { revision: 0, state: emptyMeetingState() };
  }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new UnprocessableEntityException({
        code: 'MEETING_INVALID_INPUT',
        issues: result.error.issues,
      });
    return result.data;
  }
  private async lock(client: PoolClient, key: string) {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  }
  private async audit(
    client: PoolClient,
    context: PatternContext,
    projectId: string,
    action: string,
    after: unknown,
  ) {
    await client.query(
      `insert into audit_events(workspace_id,actor_id,action,target_type,target_id,project_id,"after",correlation_id) values($1,$2,$3,'project',$4,$4,$5::jsonb,$6)`,
      [
        context.workspaceId,
        context.actorId,
        `project.meeting.${action}`,
        projectId,
        JSON.stringify(after),
        randomUUID(),
      ],
    );
  }
  private async tx<T>(context: PatternContext, work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await setDatabaseRequestContext(client, context);
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
