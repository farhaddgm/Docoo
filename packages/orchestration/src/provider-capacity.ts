import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { ProviderError } from '@docoo/providers';
import { logCorrelation } from '@docoo/observability';

import { inWorkspace } from './db.js';

export interface ProviderCapacityOptions {
  /** Test runners and Temporal activities can stop a queued call without invoking a model. */
  readonly cancellationSignal?: (() => AbortSignal | undefined) | undefined;
  readonly queueTimeoutMs?: number | undefined;
}

/** DB transactions only attempt admission; waits and provider HTTP never hold a PG client. */
export async function acquireProviderCapacity(
  pool: Pool,
  workspaceId: string,
  connectionId: string,
  httpTimeoutMs: number,
  options: ProviderCapacityOptions = {},
): Promise<() => Promise<void>> {
  const signal = options.cancellationSignal?.();
  const deadline = performance.now() + (options.queueTimeoutMs ?? 60_000);
  const leaseId = randomUUID();
  while (true) {
    signal?.throwIfAborted();
    const acquired = await inWorkspace(pool, { workspaceId }, async (client) => {
      // try-lock avoids parking PG clients behind other admission transactions.
      const lock = await client.query<{ acquired: boolean }>(
        'select pg_try_advisory_xact_lock(hashtextextended($1::text,0)) as acquired',
        ['provider-capacity/' + workspaceId + '/' + connectionId],
      );
      if (!lock.rows[0]!.acquired) return false;
      const connection = (
        await client.query<{ max_concurrent_invocations: number; disabled_at: unknown }>(
          'select max_concurrent_invocations,disabled_at from provider_connections where workspace_id=$1 and id=$2',
          [workspaceId, connectionId],
        )
      ).rows[0];
      if (!connection || connection.disabled_at)
        throw new ProviderError('permanent', 'ai_connection_unavailable');
      await client.query(
        'delete from provider_invocation_leases where workspace_id=$1 and connection_id=$2 and expires_at<=now()',
        [workspaceId, connectionId],
      );
      const active = (
        await client.query<{ count: number }>(
          'select count(*)::int as count from provider_invocation_leases where workspace_id=$1 and connection_id=$2',
          [workspaceId, connectionId],
        )
      ).rows[0]!.count;
      if (active >= connection.max_concurrent_invocations) return false;
      await client.query(
        'insert into provider_invocation_leases(id,workspace_id,connection_id,expires_at) values($1,$2,$3,now()+make_interval(secs=>$4::double precision))',
        [leaseId, workspaceId, connectionId, (httpTimeoutMs + 60_000) / 1000],
      );
      return true;
    });
    if (acquired) break;
    if (performance.now() >= deadline)
      throw new ProviderError('rate_limited', 'provider_capacity_timeout', null, 1);
    try {
      await delay(
        Math.min(100 + Math.random() * 100, Math.max(1, deadline - performance.now())),
        undefined,
        { signal },
      );
    } catch (error) {
      // Preserve the caller's cancellation reason instead of a timer's AbortError wrapper.
      signal?.throwIfAborted();
      throw error;
    }
  }
  return async () => {
    // A failed cleanup must never turn an already charged, recorded success into a retry.
    // Crashed processes also recover through the bounded lease expiry.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await inWorkspace(pool, { workspaceId }, (client) =>
          client.query(
            'delete from provider_invocation_leases where id=$1 and workspace_id=$2 and connection_id=$3',
            [leaseId, workspaceId, connectionId],
          ),
        );
        return;
      } catch {
        if (attempt < 2) await delay(50);
      }
    }
    logCorrelation('provider.capacity.release.failed', { service: 'provider-runtime' });
  };
}
