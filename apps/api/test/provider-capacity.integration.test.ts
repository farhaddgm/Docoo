import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProviderRuntime } from '@docoo/orchestration';
import {
  ProviderError,
  type NormalizedModelRequest,
  type NormalizedModelResponse,
} from '@docoo/providers';

import { DATABASE_POOL } from '../src/tokens.js';
import { adminUrl, createHarness, type Harness } from './support/harness.js';

let h: Harness;
let cookieA: string;
let cookieB: string;
let pools: [Pool, Pool];
interface Connection {
  id: string;
  version: number;
  maxConcurrentInvocations: number;
}

async function connection(limit: number, workspace = h.ids.workspaceA, cookie = cookieA) {
  const response = await h.request('POST', `/v1/workspaces/${workspace}/provider-connections`, {
    cookie,
    payload: {
      provider: 'fake',
      name: 'Capacity ' + randomUUID(),
      maxConcurrentInvocations: limit,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ connection: Connection }>().connection;
}
const scope = () => ({
  workspaceId: h.ids.workspaceA,
  projectId: null,
  stageRunId: null,
  attemptId: null,
  purpose: 'capacity_regression',
  retryNo: 0,
});
const request: NormalizedModelRequest = {
  model: 'fake-capacity',
  messages: [{ role: 'user', content: 'Synthetic capacity fixture only.' }],
};
function runtime(
  pool: Pool,
  invoke: (request: NormalizedModelRequest) => Promise<NormalizedModelResponse>,
  options: { queueTimeoutMs?: number; cancellationSignal?: () => AbortSignal } = {},
) {
  return new ProviderRuntime(
    pool,
    null,
    () => ({
      kind: 'fake',
      invoke,
      listModels: () => h.fake.listModels(),
      healthCheck: () => h.fake.healthCheck(),
    }),
    options,
  );
}
async function asWorkspace(pool: Pool, workspace: string, sql: string, values: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.workspace_id',$1,true)", [workspace]);
    const result = await client.query(sql, values);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
async function ledgerCount(id: string) {
  return (
    await h.admin.query<{ count: number }>(
      'select count(*)::int as count from model_invocations where connection_id=$1',
      [id],
    )
  ).rows[0]!.count;
}

describe.skipIf(!adminUrl)('provider capacity across independent restricted worker pools', () => {
  beforeAll(async () => {
    h = await createHarness('capacity');
    cookieA = await h.login(h.emails.a);
    cookieB = await h.login(h.emails.b);
    const options = h.app.get<Pool>(DATABASE_POOL).options;
    pools = [new Pool({ ...options, max: 1 }), new Pool({ ...options, max: 1 })];
  }, 30_000);
  afterAll(async () => {
    await Promise.all(pools?.map((pool) => pool.end()) ?? []);
    await h?.close();
  });

  it('25 actual fake-provider calls share the connection limit and retain all ledger records', async () => {
    const item = await connection(2);
    let active = 0;
    let peak = 0;
    let dispatches = 0;
    const invoke = async (input: NormalizedModelRequest) => {
      active++;
      dispatches++;
      peak = Math.max(peak, active);
      try {
        await delay(80);
        return await h.fake.invoke(input);
      } finally {
        active--;
      }
    };
    const workers = pools.map((pool) => runtime(pool, invoke));
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        workers[index % 2]!.invoke(scope(), item.id, request),
      ),
    );
    expect(dispatches).toBe(25);
    expect(peak).toBe(2);
    expect(new Set(results.map((row) => row.invocationId)).size).toBe(25);
    expect(await ledgerCount(item.id)).toBe(25);
    const leases = await h.admin.query(
      'select id from provider_invocation_leases where connection_id=$1',
      [item.id],
    );
    expect(leases.rowCount).toBe(0);
    console.info(
      JSON.stringify({
        test: 'provider-capacity',
        actualFakeCalls: 25,
        independentPools: 2,
        configuredLimit: 2,
        observedMaximum: peak,
        elapsedMs: performance.now() - started,
        ledgerRows: 25,
        agentWorkflowLoad: false,
      }),
    );
  }, 30_000);

  it('queued cancellation and timeout leave PG clients usable and create no fictitious invocation', async () => {
    const item = await connection(1);
    let resolveEntered!: () => void;
    let releaseHttp!: () => void;
    const entered = new Promise<void>((resolve) => {
      resolveEntered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseHttp = resolve;
    });
    const first = runtime(pools[0], async (input) => {
      resolveEntered();
      await gate;
      return h.fake.invoke(input);
    });
    const running = first.invoke(scope(), item.id, request);
    let queued: Promise<unknown> | undefined;
    try {
      await entered;
      const controller = new AbortController();
      const cancellation = new Error('Synthetic queued cancellation');
      const waiting = runtime(
        pools[1],
        () => {
          throw new Error('A queued call must not reach the provider');
        },
        { cancellationSignal: () => controller.signal },
      );
      queued = waiting.invoke(scope(), item.id, request);
      const rejected = expect(queued).rejects.toBe(cancellation);
      await delay(30);
      // A single-client pool cannot answer this if admission parks its client while waiting.
      const reads = await Promise.race([
        Promise.all(pools.map((pool) => pool.query('select 1 as ready'))),
        delay(2000).then(() => {
          throw new Error('Queued provider call held the sole PG client');
        }),
      ]);
      for (const read of reads) expect(read.rows[0]).toMatchObject({ ready: 1 });
      controller.abort(cancellation);
      await rejected;
      const timed = runtime(
        pools[1],
        () => {
          throw new Error('Local capacity timeout must not invoke a provider');
        },
        { queueTimeoutMs: 10 },
      );
      await expect(timed.invoke(scope(), item.id, request)).rejects.toMatchObject({
        code: 'provider_capacity_timeout',
      });
      expect(await ledgerCount(item.id)).toBe(0);
    } finally {
      releaseHttp();
      await running;
      await queued?.catch(() => undefined);
    }
    expect(await ledgerCount(item.id)).toBe(1);
  }, 15_000);

  it('cancellation while admission commits releases its lease without dispatch or an invented ledger row', async () => {
    const item = await connection(1);
    const controller = new AbortController();
    const reason = new Error('Synthetic cancellation at admission commit');
    const cancel = () => controller.abort(reason);
    pools[1].once('release', cancel);
    let dispatches = 0;
    try {
      const provider = runtime(
        pools[1],
        (input) => {
          dispatches++;
          return h.fake.invoke(input);
        },
        { cancellationSignal: () => controller.signal },
      );
      await expect(provider.invoke(scope(), item.id, request)).rejects.toBe(reason);
      expect(dispatches).toBe(0);
      expect(await ledgerCount(item.id)).toBe(0);
      expect(
        (
          await h.admin.query('select id from provider_invocation_leases where connection_id=$1', [
            item.id,
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      pools[1].off('release', cancel);
    }
  });

  it('does not retry a recorded success when lease cleanup fails, and never logs the database error content', async () => {
    const item = await connection(1);
    const name = 'capacity_release_' + h.suffix;
    expect(name).toMatch(/^capacity_release_[a-f0-9]+$/u);
    expect(item.id).toMatch(/^[a-f0-9-]{36}$/u);
    const output: string[] = [];
    let dispatches = 0;
    await h.admin.query(
      `create function ${name}() returns trigger language plpgsql as $$ begin raise exception 'PRIVATE_RELEASE_DATABASE_CANARY'; end $$`,
    );
    await h.admin.query(
      `create trigger ${name} before delete on provider_invocation_leases for each row when (old.connection_id='${item.id}'::uuid) execute function ${name}()`,
    );
    const writer = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      const provider = runtime(pools[0], async (input) => {
        dispatches++;
        return h.fake.invoke(input);
      });
      const result = await provider.invoke(scope(), item.id, request);
      expect(result.invocationId).toBeTruthy();
      expect(dispatches).toBe(1);
      expect(await ledgerCount(item.id)).toBe(1);
      expect(
        (
          await h.admin.query('select id from provider_invocation_leases where connection_id=$1', [
            item.id,
          ])
        ).rowCount,
      ).toBe(1);
      expect(output.join('')).toContain('provider.capacity.release.failed');
      expect(output.join('')).not.toContain('PRIVATE_RELEASE_DATABASE_CANARY');
    } finally {
      writer.mockRestore();
      await h.admin.query(`drop trigger ${name} on provider_invocation_leases`);
      await h.admin.query(`drop function ${name}()`);
      await h.admin.query('delete from provider_invocation_leases where connection_id=$1', [
        item.id,
      ]);
    }
  });

  it('recovers expired leases and releases capacity after an actual provider failure', async () => {
    const item = await connection(1);
    await h.admin.query(
      "insert into provider_invocation_leases(workspace_id,connection_id,created_at,expires_at) values($1,$2,now()-interval '10 seconds',now()-interval '1 second')",
      [h.ids.workspaceA, item.id],
    );
    const broken = runtime(pools[0], () =>
      Promise.reject(new ProviderError('permanent', 'synthetic_provider_failure')),
    );
    await expect(broken.invoke(scope(), item.id, request)).rejects.toMatchObject({
      code: 'synthetic_provider_failure',
    });
    await runtime(pools[1], (input) => h.fake.invoke(input)).invoke(scope(), item.id, request);
    const ledger = await h.admin.query<{ status: string }>(
      'select status from model_invocations where connection_id=$1 order by created_at',
      [item.id],
    );
    expect(ledger.rows.map((row) => row.status)).toEqual(['permanent_failed', 'succeeded']);
    expect(
      (
        await h.admin.query('select id from provider_invocation_leases where connection_id=$1', [
          item.id,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it('enforces range, optimistic updates, tenant RLS and composite ownership before admission', async () => {
    const item = await connection(1);
    const foreign = await connection(2, h.ids.workspaceB, cookieB);
    const path = `/v1/workspaces/${h.ids.workspaceA}/provider-connections/${item.id}`;
    for (const maxConcurrentInvocations of [0, 101, 1.5, '4']) {
      expect(
        (
          await h.request('PATCH', path, {
            cookie: cookieA,
            headers: { 'if-match': '"1"' },
            payload: { maxConcurrentInvocations },
          })
        ).statusCode,
      ).toBe(400);
    }
    const saved = await h.request('PATCH', path, {
      cookie: cookieA,
      headers: { 'if-match': '"1"' },
      payload: { maxConcurrentInvocations: 3 },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<{ connection: Connection }>().connection).toMatchObject({
      maxConcurrentInvocations: 3,
      version: 2,
    });
    expect(
      (
        await h.request('PATCH', path, {
          cookie: cookieA,
          headers: { 'if-match': '"1"' },
          payload: { maxConcurrentInvocations: 9 },
        })
      ).statusCode,
    ).toBe(412);
    const denied = await h.request('PATCH', path, {
      cookie: cookieB,
      headers: { 'if-match': '"2"' },
      payload: { maxConcurrentInvocations: 9 },
    });
    expect([403, 404]).toContain(denied.statusCode);
    const insert =
      "insert into provider_invocation_leases(workspace_id,connection_id,expires_at) values($1,$2,now()+interval '1 minute')";
    await expect(
      asWorkspace(pools[0], h.ids.workspaceA, insert, [h.ids.workspaceB, foreign.id]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asWorkspace(pools[0], h.ids.workspaceA, insert, [h.ids.workspaceA, foreign.id]),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      runtime(pools[0], (input) => h.fake.invoke(input)).invoke(scope(), foreign.id, request),
    ).rejects.toMatchObject({ code: 'ai_connection_unavailable' });
    expect(await ledgerCount(foreign.id)).toBe(0);
    const audit = await h.admin.query<{ after: { maxConcurrentInvocations: number } }>(
      "select after from audit_events where action='provider.update' and target_id=$1 order by occurred_at desc limit 1",
      [item.id],
    );
    expect(audit.rows[0]!.after.maxConcurrentInvocations).toBe(3);
  });
});
