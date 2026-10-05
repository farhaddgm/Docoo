import { createHash } from 'node:crypto';

import { HttpException, Inject, Injectable } from '@nestjs/common';
import { ProviderRuntime, secretContext } from '@docoo/orchestration';
import {
  checkCostLimit,
  encryptSecret,
  FALLBACK_PRICE,
  sanitizeError,
  type MasterKey,
  type ProviderKind,
} from '@docoo/providers';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import { badRequest, conflict, notFound, preconditionFailed } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';
import { canonicalJson } from '../config/setting-value.js';

export const SECRET_MASTER_KEY = Symbol('SECRET_MASTER_KEY');
export const PROVIDER_RUNTIME = Symbol('PROVIDER_RUNTIME');

interface ConnectionRow extends QueryResultRow {
  id: string;
  provider: ProviderKind;
  name: string;
  base_url: string | null;
  status: string;
  last_checked_at: string | null;
  last_latency_ms: number | null;
  last_error: string | null;
  current_secret_version: number;
  store_content: boolean;
  version: number;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
  fingerprint: string | null;
}

const connectionColumns = `c.id, c.provider, c.name, c.base_url, c.status, ${isoColumn('c.last_checked_at', 'last_checked_at')},
  c.last_latency_ms, c.last_error, c.current_secret_version, c.store_content, c.version,
  ${isoColumn('c.disabled_at', 'disabled_at')}, ${isoColumn('c.created_at', 'created_at')}, ${isoColumn('c.updated_at', 'updated_at')},
  (select fingerprint from provider_secrets s where s.connection_id = c.id and s.secret_version = c.current_secret_version) as fingerprint`;

function unavailable(code: string, detail: string): HttpException {
  return new HttpException({ status: 503, title: 'Service Unavailable', code, detail }, 503);
}

/**
 * Provider connections (AI-001..005). Secrets are write-only: they are encrypted on arrival
 * and never returned, logged or audited; responses carry only a short fingerprint.
 */
@Injectable()
export class ProvidersService {
  constructor(
    private readonly database: WorkspaceDatabase,
    @Inject(SECRET_MASTER_KEY) private readonly masterKey: MasterKey | null,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
    private readonly config: ConfigService,
  ) {}

  async list(context: WorkspaceRequestContext) {
    return this.database.run(context, async (client) => {
      const result = await client.query<ConnectionRow>(
        `select ${connectionColumns} from provider_connections c order by c.created_at, c.id`,
      );
      return result.rows.map((row) => this.toConnection(row));
    });
  }

  async get(context: WorkspaceRequestContext, id: string) {
    return this.database.run(context, async (client) =>
      this.toConnection(await this.load(client, id)),
    );
  }

  async create(
    context: WorkspaceRequestContext,
    input: {
      provider: ProviderKind;
      name: string;
      baseUrl?: string | undefined;
      secret?: string | undefined;
      storeContent: boolean;
    },
  ) {
    if (input.provider !== 'fake' && !input.secret) {
      throw badRequest('PROVIDER_SECRET_REQUIRED', 'A secret is required for this provider.');
    }
    if (input.provider === 'fake' && process.env['NODE_ENV'] === 'production') {
      throw badRequest(
        'PROVIDER_INVALID_REQUEST',
        'The fake provider is not available in production.',
      );
    }
    const master = input.secret ? this.requireMasterKey() : null;
    return this.database.run(context, async (client) => {
      let row: ConnectionRow;
      try {
        const inserted = await client.query<{ id: string }>(
          `insert into provider_connections (workspace_id, provider, name, base_url, status, store_content, created_by)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [
            context.workspaceId,
            input.provider,
            input.name,
            input.baseUrl ?? null,
            input.provider === 'fake' || input.secret ? 'configured' : 'unconfigured',
            input.storeContent,
            context.actorId,
          ],
        );
        row = await this.load(client, inserted.rows[0]!.id);
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw conflict('PROVIDER_NAME_TAKEN', 'A connection with this name already exists.');
        }
        throw error;
      }
      if (input.secret && master)
        await this.storeSecret(client, context, row.id, 1, input.secret, master);
      await writeAudit(client, context, {
        action: 'provider.create',
        targetType: 'provider_connection',
        targetId: row.id,
        securityRelevant: true,
        after: {
          provider: input.provider,
          name: input.name,
          baseUrl: input.baseUrl ?? null,
          secretSet: Boolean(input.secret),
          storeContent: input.storeContent,
        },
      });
      return this.toConnection(await this.load(client, row.id));
    });
  }

  async update(
    context: WorkspaceRequestContext,
    id: string,
    expectedVersion: number,
    input: {
      name?: string | undefined;
      baseUrl?: string | null | undefined;
      storeContent?: boolean | undefined;
    },
  ) {
    return this.database.run(context, async (client) => {
      const current = await this.load(client, id, true);
      if (current.version !== expectedVersion) {
        throw preconditionFailed(
          'PROVIDER_VERSION_CONFLICT',
          'The connection changed; reload it and try again.',
        );
      }
      await client.query<Record<string, unknown>>(
        `update provider_connections set name = coalesce($2, name), base_url = case when $3 then $4 else base_url end,
                store_content = coalesce($5, store_content), version = version + 1
          where id = $1`,
        [
          id,
          input.name ?? null,
          input.baseUrl !== undefined,
          input.baseUrl ?? null,
          input.storeContent ?? null,
        ],
      );
      await writeAudit(client, context, {
        action: 'provider.update',
        targetType: 'provider_connection',
        targetId: id,
        securityRelevant: true,
        before: {
          name: current.name,
          baseUrl: current.base_url,
          storeContent: current.store_content,
        },
        after: {
          name: input.name ?? current.name,
          baseUrl: input.baseUrl === undefined ? current.base_url : input.baseUrl,
          storeContent: input.storeContent ?? current.store_content,
        },
      });
      return this.toConnection(await this.load(client, id));
    });
  }

  /** Rotation adds a secret version; the previous value is never returned or restorable. */
  async rotateSecret(
    context: WorkspaceRequestContext,
    id: string,
    input: { secret: string; reason: string },
  ) {
    const master = this.requireMasterKey();
    return this.database.run(context, async (client) => {
      const current = await this.load(client, id, true);
      if (current.provider === 'fake')
        throw badRequest('PROVIDER_INVALID_REQUEST', 'The fake provider has no secret.');
      const next = current.current_secret_version + 1;
      await this.storeSecret(client, context, id, next, input.secret, master);
      await client.query<Record<string, unknown>>(
        `update provider_connections set status = 'configured', last_error = null, version = version + 1 where id = $1`,
        [id],
      );
      await writeAudit(client, context, {
        action: 'provider.rotate_secret',
        targetType: 'provider_connection',
        targetId: id,
        reason: input.reason,
        severity: 'warning',
        securityRelevant: true,
        after: { secretVersion: next },
      });
      return this.toConnection(await this.load(client, id));
    });
  }

  async disable(context: WorkspaceRequestContext, id: string, reason: string) {
    return this.database.run(context, async (client) => {
      await this.load(client, id, true);
      await client.query<Record<string, unknown>>(
        `update provider_connections set disabled_at = coalesce(disabled_at, now()), version = version + 1 where id = $1`,
        [id],
      );
      await writeAudit(client, context, {
        action: 'provider.disable',
        targetType: 'provider_connection',
        targetId: id,
        reason,
        severity: 'warning',
        securityRelevant: true,
      });
      return this.toConnection(await this.load(client, id));
    });
  }

  /** Health check without customer data; the error shown is sanitised (AI-004, FR-AI-005). */
  async healthCheck(context: WorkspaceRequestContext, id: string) {
    const adapter = await this.database.run(context, async (client) => {
      const connection = await this.load(client, id);
      if (connection.disabled_at)
        throw conflict('PROVIDER_DISABLED', 'The connection is disabled.');
      await client.query(`update provider_connections set status = 'checking' where id = $1`, [id]);
      return this.runtime
        .adapterFor(client, id)
        .catch((error: unknown) => (error instanceof Error ? error : new Error('adapter_failed')));
    });
    const health =
      adapter instanceof Error
        ? {
            status: 'invalid' as const,
            checkedAt: new Date().toISOString(),
            latencyMs: null,
            error: sanitizeError(adapter.message),
          }
        : await adapter.adapter.healthCheck();
    return this.database.run(context, async (client) => {
      await client.query<Record<string, unknown>>(
        `update provider_connections set status = $2, last_checked_at = $3, last_latency_ms = $4, last_error = $5 where id = $1`,
        [
          id,
          health.status,
          health.checkedAt,
          health.latencyMs,
          health.error ? sanitizeError(health.error) : null,
        ],
      );
      await writeAudit(client, context, {
        action: 'provider.health_check',
        targetType: 'provider_connection',
        targetId: id,
        severity: health.status === 'healthy' ? 'info' : 'warning',
        after: { status: health.status, latencyMs: health.latencyMs, error: health.error },
      });
      return this.toConnection(await this.load(client, id));
    });
  }

  /** AI-003: the live model list is stored as a dated snapshot; nothing is hard-coded. */
  async refreshModels(context: WorkspaceRequestContext, id: string) {
    const adapter = await this.database.run(context, async (client) => {
      await this.load(client, id);
      return this.runtime.adapterFor(client, id);
    });
    let models;
    try {
      models = await adapter.adapter.listModels();
    } catch (error) {
      throw unavailable(
        'PROVIDER_CATALOG_UNAVAILABLE',
        sanitizeError(error instanceof Error ? error.message : 'catalog failed'),
      );
    }
    models.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const hash = createHash('sha256').update(canonicalJson(models)).digest('hex');
    return this.database.run(context, async (client) => {
      const snapshot = (
        await client.query<{ id: string; created_at: string }>(
          `insert into model_catalog_snapshots (workspace_id, connection_id, models, model_count, hash, created_by)
           values ($1, $2, $3::jsonb, $4, $5, $6) returning id, ${isoColumn('created_at', 'created_at')}`,
          [context.workspaceId, id, JSON.stringify(models), models.length, hash, context.actorId],
        )
      ).rows[0]!;
      await writeAudit(client, context, {
        action: 'provider.models_refreshed',
        targetType: 'provider_connection',
        targetId: id,
        after: { snapshotId: snapshot.id, modelCount: models.length, hash },
      });
      return { snapshotId: snapshot.id, createdAt: snapshot.created_at, hash, models };
    });
  }

  async models(context: WorkspaceRequestContext, id: string) {
    return this.database.run(context, async (client) => {
      await this.load(client, id);
      const row = (
        await client.query<{ id: string; models: unknown[]; hash: string; created_at: string }>(
          `select id, models, hash, ${isoColumn('created_at', 'created_at')} from model_catalog_snapshots
            where connection_id = $1 order by created_at desc, id desc limit 1`,
          [id],
        )
      ).rows[0];
      return row
        ? { snapshotId: row.id, createdAt: row.created_at, hash: row.hash, models: row.models }
        : null;
    });
  }

  async listPrices(context: WorkspaceRequestContext) {
    return this.database.run(
      context,
      async (client) =>
        (
          await client.query<Record<string, unknown>>(
            `select id, provider, model, input_per_million as "inputPerMillion", output_per_million as "outputPerMillion",
                  cached_input_per_million as "cachedInputPerMillion", reasoning_per_million as "reasoningPerMillion",
                  ${isoColumn('effective_from', '"effectiveFrom"')}, ${isoColumn('created_at', '"createdAt"')}
             from model_prices order by provider, model, effective_from desc`,
          )
        ).rows,
    );
  }

  /**
   * Whether the workspace's default model has a price. Without one, calls are estimated with the
   * deliberately high fallback, so the cost ceiling stays on but over-counts.
   */
  async priceStatus(context: WorkspaceRequestContext) {
    return this.database.run(context, async (client) => {
      const effective = await this.config.resolve(
        client,
        context,
        'workspace',
        context.workspaceId,
      );
      const connectionId = effective.values['ai.connection_id'];
      const model = effective.values['ai.model'];
      const fallback = {
        inputPerMillion: FALLBACK_PRICE.inputPerMillion,
        outputPerMillion: FALLBACK_PRICE.outputPerMillion,
      };
      if (
        typeof connectionId !== 'string' ||
        typeof model !== 'string' ||
        !connectionId ||
        !model
      ) {
        return { fallback, defaultModel: null };
      }
      const connection = (
        await client.query<{ provider: ProviderKind }>(
          `select provider from provider_connections where id = $1`,
          [connectionId],
        )
      ).rows[0];
      if (!connection) return { fallback, defaultModel: null };
      const priced = await client.query(
        `select 1 from model_prices where provider = $1 and model = $2 and effective_from <= now() limit 1`,
        [connection.provider, model],
      );
      return {
        fallback,
        defaultModel: {
          provider: connection.provider,
          model,
          priced: (priced.rowCount ?? 0) > 0,
        },
      };
    });
  }

  async addPrice(
    context: WorkspaceRequestContext,
    input: {
      provider: ProviderKind;
      model: string;
      inputPerMillion: number;
      outputPerMillion: number;
      cachedInputPerMillion?: number | undefined;
      reasoningPerMillion?: number | undefined;
      effectiveFrom: string;
    },
  ) {
    return this.database.run(context, async (client) => {
      const row = (
        await client.query<{ id: string }>(
          `insert into model_prices (workspace_id, provider, model, input_per_million, output_per_million,
                                     cached_input_per_million, reasoning_per_million, effective_from, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [
            context.workspaceId,
            input.provider,
            input.model,
            input.inputPerMillion,
            input.outputPerMillion,
            input.cachedInputPerMillion ?? null,
            input.reasoningPerMillion ?? null,
            input.effectiveFrom,
            context.actorId,
          ],
        )
      ).rows[0]!;
      await writeAudit(client, context, {
        action: 'provider.price_added',
        targetType: 'model_price',
        targetId: row.id,
        after: { ...input },
      });
      return { id: row.id, ...input };
    });
  }

  async invocations(
    context: WorkspaceRequestContext,
    input: { projectId?: string | undefined; limit: number },
  ) {
    return this.database.run(
      context,
      async (client) =>
        (
          await client.query<Record<string, unknown>>(
            `select id, connection_id as "connectionId", project_id as "projectId", stage_run_id as "stageRunId",
                  attempt_id as "attemptId", provider, model, purpose, status, input_tokens as "inputTokens",
                  output_tokens as "outputTokens", reasoning_tokens as "reasoningTokens",
                  cached_input_tokens as "cachedInputTokens", latency_ms as "latencyMs", finish_reason as "finishReason",
                  raw_finish_reason as "rawFinishReason", cost_usd as "costUsd", (price_id is not null) as "priced",
                  provider_request_id as "providerRequestId",
                  error_code as "errorCode", retry_no as "retryNo", ${isoColumn('created_at', '"createdAt"')}
             from model_invocations
            where ($1::uuid is null or project_id = $1)
            order by created_at desc, id desc limit $2`,
            [input.projectId ?? null, input.limit],
          )
        ).rows,
    );
  }

  /** AI-005 and REP-004: usage and estimated cost per project and stage against the ceiling. */
  async projectUsage(
    context: WorkspaceRequestContext,
    projectId: string,
    range: { from?: string | undefined; to?: string | undefined },
  ) {
    return this.database.run(context, async (client) => {
      const project = await client.query<{ resolved: Record<string, unknown> | null }>(
        `select s.resolved from projects p left join config_snapshots s on s.id = p.config_snapshot_id
          where p.id = $1 and p.deleted_at is null`,
        [projectId],
      );
      if (!project.rowCount) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');
      const filter = `i.project_id = $1 and ($2::timestamptz is null or i.created_at >= $2) and ($3::timestamptz is null or i.created_at < $3)`;
      const params = [projectId, range.from ?? null, range.to ?? null];
      const totals = (
        await client.query<{
          invocations: number;
          input_tokens: number;
          output_tokens: number;
          reasoning_tokens: number;
          cost_usd: number;
          unpriced: number;
          failures: number;
          avg_latency_ms: number | null;
        }>(
          `select count(*)::int as invocations, coalesce(sum(input_tokens), 0)::int as input_tokens,
                  coalesce(sum(output_tokens), 0)::int as output_tokens, coalesce(sum(reasoning_tokens), 0)::int as reasoning_tokens,
                  coalesce(sum(cost_usd), 0)::real as cost_usd,
                  count(*) filter (where status = 'succeeded' and price_id is null)::int as unpriced,
                  count(*) filter (where status <> 'succeeded')::int as failures,
                  round(avg(latency_ms))::int as avg_latency_ms
             from model_invocations i where ${filter}`,
          params,
        )
      ).rows[0]!;
      const byStage = (
        await client.query<Record<string, unknown>>(
          `select coalesce(s.stage::text, 'other') as stage, count(*)::int as invocations,
                  coalesce(sum(i.input_tokens), 0)::int as "inputTokens", coalesce(sum(i.output_tokens), 0)::int as "outputTokens",
                  coalesce(sum(i.cost_usd), 0)::real as "costUsd", round(avg(i.latency_ms))::int as "avgLatencyMs"
             from model_invocations i left join stage_runs s on s.id = i.stage_run_id
            where ${filter}
            group by 1 order by min(i.created_at)`,
          params,
        )
      ).rows;
      const limit = Number(project.rows[0]?.resolved?.['ai.max_cost_usd_per_run'] ?? 20);
      return {
        projectId,
        from: range.from ?? null,
        to: range.to ?? null,
        totals: {
          invocations: totals.invocations,
          inputTokens: totals.input_tokens,
          outputTokens: totals.output_tokens,
          reasoningTokens: totals.reasoning_tokens,
          costUsd: Math.round(totals.cost_usd * 1_000_000) / 1_000_000,
          // Calls estimated with the high fallback because no price was entered for their model.
          unpricedInvocations: totals.unpriced,
          failures: totals.failures,
          avgLatencyMs: totals.avg_latency_ms,
        },
        byStage,
        costLimit: checkCostLimit(totals.cost_usd, limit),
        estimate: true,
      };
    });
  }

  private requireMasterKey(): MasterKey {
    if (!this.masterKey) {
      throw unavailable(
        'PROVIDER_SECRET_STORE_UNAVAILABLE',
        'SECRET_MASTER_KEY is not configured.',
      );
    }
    return this.masterKey;
  }

  private async storeSecret(
    client: PoolClient,
    context: WorkspaceRequestContext,
    connectionId: string,
    version: number,
    secret: string,
    master: MasterKey,
  ): Promise<void> {
    const sealed = encryptSecret(secret, master, secretContext(connectionId, version));
    await client.query<Record<string, unknown>>(
      `insert into provider_secrets (workspace_id, connection_id, secret_version, ciphertext, iv, tag, wrapped_key, wrap_iv,
                                     wrap_tag, key_id, fingerprint, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        context.workspaceId,
        connectionId,
        version,
        sealed.ciphertext,
        sealed.iv,
        sealed.tag,
        sealed.wrappedKey,
        sealed.wrapIv,
        sealed.wrapTag,
        sealed.keyId,
        sealed.fingerprint,
        context.actorId,
      ],
    );
    await client.query<Record<string, unknown>>(
      `update provider_connections set current_secret_version = $2 where id = $1`,
      [connectionId, version],
    );
  }

  private async load(client: PoolClient, id: string, forUpdate = false): Promise<ConnectionRow> {
    const row = (
      await client.query<ConnectionRow>(
        `select ${connectionColumns} from provider_connections c where c.id = $1 ${forUpdate ? 'for update' : ''}`,
        [id],
      )
    ).rows[0];
    if (!row) throw notFound('PROVIDER_NOT_FOUND', 'The provider connection was not found.');
    return row;
  }

  private toConnection(row: ConnectionRow) {
    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      baseUrl: row.base_url,
      status: row.disabled_at ? 'disabled' : row.status,
      lastCheckedAt: row.last_checked_at,
      lastLatencyMs: row.last_latency_ms,
      lastError: row.last_error,
      secret:
        row.provider === 'fake'
          ? null
          : {
              version: row.current_secret_version,
              fingerprint: row.fingerprint,
              configured: row.current_secret_version > 0,
            },
      storeContent: row.store_content,
      fallback: false,
      version: row.version,
      disabledAt: row.disabled_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
