import {
  createAdapter,
  decryptSecret,
  FakeAdapter,
  estimateCostUsd,
  ProviderError,
  sanitizeError,
  type MasterKey,
  type ModelProviderAdapter,
  type NormalizedModelRequest,
  type NormalizedModelResponse,
  type PriceSnapshot,
  type ProviderKind,
} from '@docoo/providers';
import type { Pool, PoolClient } from 'pg';

import { inWorkspace } from './db.js';
import { fakeAnalystResponder } from './fake-analyst.js';

export interface InvocationScope {
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly stageRunId: string | null;
  readonly attemptId: string | null;
  readonly purpose: string;
  readonly retryNo: number;
}

interface ConnectionRow {
  id: string;
  provider: ProviderKind;
  base_url: string | null;
  status: string;
  disabled_at: string | null;
  current_secret_version: number;
}

interface SecretRow {
  ciphertext: string;
  iv: string;
  tag: string;
  wrapped_key: string;
  wrap_iv: string;
  wrap_tag: string;
  key_id: string;
  fingerprint: string;
}

/** Builds an adapter; tests replace this to script provider behaviour. */
export type AdapterFactory = (
  kind: ProviderKind,
  options: { apiKey: string; baseUrl?: string | undefined },
) => ModelProviderAdapter;

/**
 * Production adapters. The deterministic `fake` provider (never allowed in production) also
 * plays the analyst, so a stack without provider keys can run a project end to end.
 */
export const defaultAdapters: AdapterFactory = (kind, options) => {
  if (kind !== 'fake') return createAdapter(kind, options);
  const adapter = new FakeAdapter();
  adapter.responder = fakeAnalystResponder;
  return adapter;
};

/**
 * Resolves a connection, decrypts its current secret only in memory, calls the provider
 * and records every invocation with usage, latency, finish reason and estimated cost
 * (AI-002, AI-005). The model id always comes from configuration or the request.
 */
export class ProviderRuntime {
  constructor(
    private readonly pool: Pool,
    private readonly masterKey: MasterKey | null,
    private readonly adapters: AdapterFactory = defaultAdapters,
  ) {}

  async adapterFor(
    client: PoolClient,
    connectionId: string,
  ): Promise<{ adapter: ModelProviderAdapter; connection: ConnectionRow }> {
    const connection = (
      await client.query<ConnectionRow>(
        `select id, provider, base_url, status, disabled_at, current_secret_version
           from provider_connections where id = $1`,
        [connectionId],
      )
    ).rows[0];
    if (!connection || connection.disabled_at)
      throw new ProviderError('permanent', 'ai_connection_unavailable');
    if (connection.provider === 'fake')
      return { adapter: this.adapters('fake', { apiKey: 'fake' }), connection };
    if (!this.masterKey) throw new ProviderError('permanent', 'secret_master_key_missing');
    const secret = (
      await client.query<SecretRow>(
        `select ciphertext, iv, tag, wrapped_key, wrap_iv, wrap_tag, key_id, fingerprint
           from provider_secrets where connection_id = $1 and secret_version = $2`,
        [connection.id, connection.current_secret_version],
      )
    ).rows[0];
    if (!secret) throw new ProviderError('auth', 'ai_secret_missing');
    const apiKey = decryptSecret(
      {
        ciphertext: secret.ciphertext,
        iv: secret.iv,
        tag: secret.tag,
        wrappedKey: secret.wrapped_key,
        wrapIv: secret.wrap_iv,
        wrapTag: secret.wrap_tag,
        keyId: secret.key_id,
        fingerprint: secret.fingerprint,
      },
      this.masterKey,
      secretContext(connection.id, connection.current_secret_version),
    );
    return {
      adapter: this.adapters(connection.provider, {
        apiKey,
        baseUrl: connection.base_url ?? undefined,
      }),
      connection,
    };
  }

  async invoke(
    scope: InvocationScope,
    connectionId: string,
    request: NormalizedModelRequest,
  ): Promise<{ response: NormalizedModelResponse; invocationId: string; costUsd: number | null }> {
    const { adapter, connection } = await inWorkspace(
      this.pool,
      { workspaceId: scope.workspaceId },
      (client) => this.adapterFor(client, connectionId),
    );
    try {
      const response = await adapter.invoke(request);
      return await inWorkspace(this.pool, { workspaceId: scope.workspaceId }, async (client) => {
        const price = await this.price(client, connection.provider, response.model, request.model);
        const costUsd = estimateCostUsd(response.usage, price?.snapshot ?? null);
        const invocationId = await this.record(client, scope, connection, request.model, {
          status: 'succeeded',
          response,
          costUsd,
          priceId: price?.id ?? null,
          errorCode: null,
        });
        return { response, invocationId, costUsd };
      });
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? error
          : new ProviderError(
              'transient',
              sanitizeError(error instanceof Error ? error.message : 'provider_error'),
            );
      await inWorkspace(this.pool, { workspaceId: scope.workspaceId }, (client) =>
        this.record(client, scope, connection, request.model, {
          status: providerError.retryable ? 'transient_failed' : 'permanent_failed',
          response: null,
          costUsd: null,
          priceId: null,
          errorCode: providerError.code,
        }),
      );
      throw providerError;
    }
  }

  private async price(
    client: PoolClient,
    provider: ProviderKind,
    servedModel: string,
    requestedModel: string,
  ): Promise<{ id: string; snapshot: PriceSnapshot } | null> {
    const row = (
      await client.query<{
        id: string;
        input_per_million: number;
        output_per_million: number;
        cached_input_per_million: number | null;
        reasoning_per_million: number | null;
        effective_from: Date;
      }>(
        `select id, input_per_million, output_per_million, cached_input_per_million, reasoning_per_million, effective_from
           from model_prices
          where provider = $1 and model = any($2::text[]) and effective_from <= now()
          order by effective_from desc, created_at desc limit 1`,
        [provider, [servedModel, requestedModel]],
      )
    ).rows[0];
    if (!row) return null;
    return {
      id: row.id,
      snapshot: {
        currency: 'USD',
        inputPerMillion: row.input_per_million,
        outputPerMillion: row.output_per_million,
        cachedInputPerMillion: row.cached_input_per_million ?? undefined,
        reasoningPerMillion: row.reasoning_per_million ?? undefined,
        effectiveFrom: row.effective_from.toISOString(),
      },
    };
  }

  private async record(
    client: PoolClient,
    scope: InvocationScope,
    connection: ConnectionRow,
    requestedModel: string,
    result: {
      status: 'succeeded' | 'transient_failed' | 'permanent_failed';
      response: NormalizedModelResponse | null;
      costUsd: number | null;
      priceId: string | null;
      errorCode: string | null;
    },
  ): Promise<string> {
    const response = result.response;
    const inserted = await client.query<{ id: string }>(
      `insert into model_invocations (workspace_id, connection_id, project_id, stage_run_id, attempt_id, provider, model,
                                      purpose, status, input_tokens, output_tokens, reasoning_tokens, cached_input_tokens,
                                      latency_ms, finish_reason, raw_finish_reason, cost_usd, price_id, provider_request_id,
                                      error_code, retry_no)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       returning id`,
      [
        scope.workspaceId,
        connection.id,
        scope.projectId,
        scope.stageRunId,
        scope.attemptId,
        connection.provider,
        response?.model ?? requestedModel,
        scope.purpose,
        result.status,
        response?.usage.inputTokens ?? 0,
        response?.usage.outputTokens ?? 0,
        response?.usage.reasoningTokens ?? null,
        response?.usage.cachedInputTokens ?? null,
        response?.latencyMs ?? null,
        response?.finishReason ?? null,
        response?.rawFinishReason ?? null,
        result.costUsd,
        result.priceId,
        response?.providerRequestId ?? null,
        result.errorCode,
        scope.retryNo,
      ],
    );
    return inserted.rows[0]!.id;
  }
}

/** AAD binding a ciphertext to its connection and version. */
export function secretContext(connectionId: string, version: number): string {
  return `provider-secret:${connectionId}:${version}`;
}
