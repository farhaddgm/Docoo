import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

const SECRET_V1 = 'sk-test-provider-secret-version-one-123456';
const SECRET_V2 = 'sk-test-provider-secret-version-two-789012';

let h: Harness;
let cookie: string;
let server: Server;
let base: string;
const seenKeys: string[] = [];
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

interface Connection {
  id: string;
  provider: string;
  status: string;
  version: number;
  lastError: string | null;
  secret: { version: number; fingerprint: string; configured: boolean } | null;
  fallback: boolean;
}

describe.skipIf(!adminUrl)('provider connections (AI-001, AI-003, AI-004)', () => {
  beforeAll(async () => {
    // Minimal OpenAI-shaped endpoint: valid only with the current key.
    server = createServer((request, response) => {
      const auth = String(request.headers.authorization ?? '');
      seenKeys.push(auth.replace('Bearer ', ''));
      if (auth !== `Bearer ${SECRET_V2}` && auth !== `Bearer ${SECRET_V1}`) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${auth}` } }));
        return;
      }
      if (request.method === 'POST' && request.url?.endsWith('/responses')) {
        // A refusal that names its reason (and, carelessly, the key) as real providers do.
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            error: {
              message: `Unsupported value: max_output_tokens is too large for this model. (${auth})`,
            },
          }),
        );
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      // The embedding model must not be offered: it cannot answer a structured text request.
      response.end(
        JSON.stringify({
          data: [{ id: 'gpt-b' }, { id: 'text-embedding-3-small' }, { id: 'gpt-a' }],
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    h = await createHarness('providers');
    cookie = await h.login(h.emails.a);
  }, 30_000);

  afterAll(async () => {
    await h?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('AI-001: the secret is encrypted, write-only and never in responses, rows or audit', async () => {
    const created = await h.request('POST', api('/provider-connections'), {
      cookie,
      payload: { provider: 'openai', name: 'OpenAI main', baseUrl: base, secret: SECRET_V1 },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.body).not.toContain(SECRET_V1);
    const connection = created.json<{ connection: Connection }>().connection;
    expect(connection).toMatchObject({
      provider: 'openai',
      status: 'configured',
      fallback: false,
      secret: { version: 1, configured: true },
    });
    expect(connection.secret!.fingerprint).toMatch(/^[0-9a-f]{12}$/u);

    const read = await h.request('GET', api(`/provider-connections/${connection.id}`), { cookie });
    const list = await h.request('GET', api('/provider-connections'), { cookie });
    for (const body of [read.body, list.body]) expect(body).not.toContain(SECRET_V1);

    const stored = await h.admin.query<{ row: string }>(
      'select row_to_json(s)::text as row from provider_secrets s where connection_id = $1',
      [connection.id],
    );
    expect(stored.rows[0]!.row).not.toContain(SECRET_V1);
    const audit = await h.admin.query<{ row: string }>(
      `select row_to_json(a)::text as row from audit_events a where target_id = $1`,
      [connection.id],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    for (const row of audit.rows) expect(row.row).not.toContain(SECRET_V1);

    const missing = await h.request('POST', api('/provider-connections'), {
      cookie,
      payload: { provider: 'anthropic', name: 'No key' },
    });
    expect(missing.json<{ code: string }>().code).toBe('PROVIDER_SECRET_REQUIRED');
  });

  it('AI-001/004: health check works, rotation adds a version and the old secret is gone for good', async () => {
    const connection = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'openai', name: 'Rotating', baseUrl: base, secret: SECRET_V1 },
      })
    ).json<{ connection: Connection }>().connection;
    const healthy = await h.request(
      'POST',
      api(`/provider-connections/${connection.id}/health-check`),
      { cookie },
    );
    expect(healthy.json<{ connection: Connection }>().connection).toMatchObject({
      status: 'healthy',
      lastError: null,
    });

    const rotated = await h.request(
      'POST',
      api(`/provider-connections/${connection.id}/rotate-secret`),
      {
        cookie,
        payload: { secret: SECRET_V2, reason: 'Quarterly rotation' },
      },
    );
    expect(rotated.statusCode, rotated.body).toBe(200);
    const after = rotated.json<{ connection: Connection }>().connection;
    expect(after.secret).toMatchObject({ version: 2 });
    expect(after.secret!.fingerprint).not.toBe(connection.secret!.fingerprint);
    expect(rotated.body).not.toContain(SECRET_V2);
    seenKeys.length = 0;
    await h.request('POST', api(`/provider-connections/${connection.id}/health-check`), { cookie });
    expect(seenKeys).toEqual([SECRET_V2]);

    const rotationAudit = await h.admin.query<{ severity: string; security_relevant: boolean }>(
      `select severity, security_relevant from audit_events where target_id = $1 and action = 'provider.rotate_secret'`,
      [connection.id],
    );
    expect(rotationAudit.rows).toEqual([{ severity: 'warning', security_relevant: true }]);
    // Secret versions are append-only; there is no API to read or restore an earlier one.
    await expect(
      h.admin.query('update provider_secrets set ciphertext = $1 where connection_id = $2', [
        'x',
        connection.id,
      ]),
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('AI-004: a bad key reports invalid with a sanitised error', async () => {
    const connection = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: {
          provider: 'openai',
          name: 'Wrong key',
          baseUrl: base,
          secret: 'sk-wrong-key-abcdefghijklmnop',
        },
      })
    ).json<{ connection: Connection }>().connection;
    const checked = await h.request(
      'POST',
      api(`/provider-connections/${connection.id}/health-check`),
      { cookie },
    );
    const body = checked.json<{ connection: Connection }>().connection;
    expect(body).toMatchObject({ status: 'invalid', lastError: 'openai_unauthorized' });
    expect(checked.body).not.toContain('sk-wrong-key');
  });

  it('AI-003: the live catalog is refreshed into a dated snapshot', async () => {
    const connection = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'openai', name: 'Catalog', baseUrl: base, secret: SECRET_V2 },
      })
    ).json<{ connection: Connection }>().connection;
    const empty = await h.request('GET', api(`/provider-connections/${connection.id}/models`), {
      cookie,
    });
    expect(empty.json<{ catalog: null }>().catalog).toBeNull();
    const refreshed = await h.request(
      'POST',
      api(`/provider-connections/${connection.id}/models/refresh`),
      { cookie },
    );
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    const catalog = refreshed.json<{
      catalog: { snapshotId: string; hash: string; models: { id: string }[] };
    }>().catalog;
    expect(catalog.models.map((model) => model.id)).toEqual(['gpt-a', 'gpt-b']);
    const latest = await h.request('GET', api(`/provider-connections/${connection.id}/models`), {
      cookie,
    });
    expect(latest.json<{ catalog: { snapshotId: string } }>().catalog.snapshotId).toBe(
      catalog.snapshotId,
    );
  });

  it('AI-005: the price of the default model is reported, and without one the estimate stays high', async () => {
    const before = await h.request('GET', api('/model-prices'), { cookie });
    const first = before.json<{
      items: unknown[];
      fallback: { inputPerMillion: number; outputPerMillion: number };
      defaultModel: { priced: boolean } | null;
    }>();
    expect(first.fallback).toEqual({ inputPerMillion: 10, outputPerMillion: 40 });
    expect(first.defaultModel).toBeNull(); // no default connection and model chosen yet

    const connection = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'openai', name: 'Priced', baseUrl: base, secret: SECRET_V2 },
      })
    ).json<{ connection: Connection }>().connection;
    for (const [key, value] of [
      ['ai.connection_id', connection.id],
      ['ai.model', 'gpt-priced'],
    ] as const) {
      const set = await h.request('PUT', api('/settings/assignments'), {
        cookie,
        payload: {
          key,
          scopeType: 'workspace',
          scopeId: h.ids.workspaceA,
          value,
          reason: 'default model for the price test',
        },
      });
      expect(set.statusCode, set.body).toBe(200);
    }
    const unpriced = await h.request('GET', api('/model-prices'), { cookie });
    expect(unpriced.json<{ defaultModel: unknown }>().defaultModel).toEqual({
      provider: 'openai',
      model: 'gpt-priced',
      priced: false,
    });

    const added = await h.request('POST', api('/model-prices'), {
      cookie,
      payload: {
        provider: 'openai',
        model: 'gpt-priced',
        inputPerMillion: 1.25,
        outputPerMillion: 10,
        effectiveFrom: '2026-01-01T00:00:00Z',
      },
    });
    expect(added.statusCode, added.body).toBe(201);
    const priced = await h.request('GET', api('/model-prices'), { cookie });
    expect(priced.json<{ defaultModel: unknown }>().defaultModel).toMatchObject({ priced: true });
  });

  it('AI-005: the self-check tries every kind of call and records each as a model call', async () => {
    const fake = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'fake', name: 'Offline self-check' },
      })
    ).json<{ connection: Connection }>().connection;
    const steps = (
      await h.request('GET', api(`/provider-connections/${fake.id}/self-check`), { cookie })
    ).json<{ steps: string[] }>().steps;
    expect(steps).toHaveLength(9);
    for (const step of steps) {
      const response = await h.request('POST', api(`/provider-connections/${fake.id}/self-check`), {
        cookie,
        payload: { model: 'fake-standard', step },
      });
      expect(response.statusCode, response.body).toBe(200);
      const { result } = response.json<{
        result: {
          step: string;
          status: string;
          problem: string | null;
          priced: boolean;
          costUsd: number | null;
        };
      }>();
      expect(result, JSON.stringify(result)).toMatchObject({
        step,
        status: 'passed',
        priced: false,
      });
      expect(result.costUsd).toBeGreaterThan(0); // estimated, never free
    }
    const calls = await h.request('GET', api('/model-invocations?limit=200'), { cookie });
    const purposes = calls
      .json<{ items: { purpose: string; projectId: string | null }[] }>()
      .items.filter((item) => item.purpose.startsWith('selfcheck:'));
    expect(purposes.map((item) => item.purpose).sort()).toEqual(
      steps.map((step) => `selfcheck:${step}`).sort(),
    );

    const unknown = await h.request('POST', api(`/provider-connections/${fake.id}/self-check`), {
      cookie,
      payload: { model: 'fake-standard', step: 'not_a_step' },
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('AI-005: a refused self-check call reports the provider’s reason without the key', async () => {
    const connection = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'openai', name: 'Refusing', baseUrl: base, secret: SECRET_V2 },
      })
    ).json<{ connection: Connection }>().connection;
    const response = await h.request(
      'POST',
      api(`/provider-connections/${connection.id}/self-check`),
      { cookie, payload: { model: 'gpt-test', step: 'stage_research' } },
    );
    expect(response.statusCode, response.body).toBe(200);
    const { result } = response.json<{
      result: { status: string; errorCode: string; errorKind: string; errorDetail: string };
    }>();
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'openai_bad_request_400',
      errorKind: 'invalid_request',
    });
    expect(result.errorDetail).toContain('max_output_tokens is too large');
    expect(result.errorDetail).not.toContain(SECRET_V2);
    // The failed call is kept with the same reason, so the costs and usage pages can show it.
    const calls = await h.request('GET', api('/model-invocations?limit=200'), { cookie });
    const failed = calls
      .json<{ items: { purpose: string; status: string; errorDetail: string | null }[] }>()
      .items.find(
        (item) => item.purpose === 'selfcheck:stage_research' && item.status !== 'succeeded',
      );
    expect(failed?.errorDetail).toContain('max_output_tokens is too large');
  });

  it('edits need If-Match, connections can be disabled, and other workspaces see nothing', async () => {
    const connection = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'fake', name: 'Editable' },
      })
    ).json<{ connection: Connection }>().connection;
    const noMatch = await h.request('PATCH', api(`/provider-connections/${connection.id}`), {
      cookie,
      payload: { name: 'x' },
    });
    expect(noMatch.statusCode).toBe(428);
    const edited = await h.request('PATCH', api(`/provider-connections/${connection.id}`), {
      cookie,
      headers: { 'if-match': `"${connection.version}"` },
      payload: { name: 'Edited', storeContent: false },
    });
    expect(edited.statusCode).toBe(200);
    const disabled = await h.request(
      'POST',
      api(`/provider-connections/${connection.id}/disable`),
      { cookie, payload: { reason: 'No longer used' } },
    );
    expect(disabled.json<{ connection: Connection }>().connection.status).toBe('disabled');
    const cookieB = await h.login(h.emails.b);
    const foreign = await h.request(
      'GET',
      `/v1/workspaces/${h.ids.workspaceB}/provider-connections/${connection.id}`,
      { cookie: cookieB },
    );
    expect(foreign.statusCode).toBe(404);
  });
});
