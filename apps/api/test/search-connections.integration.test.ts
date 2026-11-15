import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

const EXA_KEY = 'exa-test-key-version-one-123456';
const EXA_KEY_2 = 'exa-test-key-version-two-789012';
const TAVILY_KEY = 'tvly-test-key-abcdef-654321';

let h: Harness;
let cookie: string;
let server: Server;
let base: string;
/** What the stand-in service saw: the path and the credential it was given. */
const seen: { path: string; credential: string; query: string }[] = [];
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

interface Connection {
  id: string;
  provider: string;
  status: string;
  version: number;
  lastError: string | null;
  costPerQueryUsd: number | null;
  secret: { version: number; fingerprint: string; configured: boolean } | null;
}

describe.skipIf(!adminUrl)('independent web search connections (ADR-0059)', () => {
  beforeAll(async () => {
    // A stand-in for both services: Exa reads the key from x-api-key, Tavily from a bearer token.
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString()));
      request.on('end', () => {
        const credential = String(
          request.headers['x-api-key'] ?? request.headers.authorization ?? '',
        );
        const parsed = JSON.parse(body || '{}') as { query?: string };
        seen.push({ path: request.url ?? '', credential, query: parsed.query ?? '' });
        const good = [EXA_KEY, EXA_KEY_2, `Bearer ${TAVILY_KEY}`].includes(credential);
        if (!good) {
          response.writeHead(401, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'invalid key' }));
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ results: [{ url: 'https://example.org/a', title: 'A', text: 'a' }] }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    h = await createHarness('searchconn');
    cookie = await h.login(h.emails.a);
  }, 30_000);

  afterAll(async () => {
    await h?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('keeps the search services apart from the connections that answer prompts', async () => {
    const created = await h.request('POST', api('/provider-connections'), {
      cookie,
      payload: { provider: 'exa', name: 'Exa', baseUrl: base, secret: EXA_KEY },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.body).not.toContain(EXA_KEY);
    const connection = created.json<{ connection: Connection }>().connection;
    // Without a price entered, the public price of the service is used.
    expect(connection).toMatchObject({
      provider: 'exa',
      status: 'configured',
      costPerQueryUsd: 0.007,
      secret: { version: 1, configured: true },
    });

    const models = await h.request('GET', api('/provider-connections'), { cookie });
    expect(models.json<{ items: Connection[] }>().items.map((item) => item.provider)).not.toContain(
      'exa',
    );
    const search = await h.request('GET', api('/search-connections'), { cookie });
    expect(search.json<{ items: Connection[] }>().items.map((item) => item.id)).toContain(
      connection.id,
    );
    expect(search.body).not.toContain(EXA_KEY);
  });

  it('a service needs a key, and a price per query belongs to a service only', async () => {
    const missing = await h.request('POST', api('/provider-connections'), {
      cookie,
      payload: { provider: 'tavily', name: 'No key' },
    });
    expect(missing.json<{ code: string }>().code).toBe('PROVIDER_SECRET_REQUIRED');

    const model = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'openai', name: 'Model', baseUrl: base, secret: EXA_KEY_2 },
      })
    ).json<{ connection: Connection }>().connection;
    const priced = await h.request('PATCH', api(`/provider-connections/${model.id}`), {
      cookie,
      headers: { 'if-match': `"${model.version}"` },
      payload: { costPerQueryUsd: 0.01 },
    });
    expect(priced.statusCode).toBe(400);
  });

  it('the health check sends one real query with the right credential, and a bad key is invalid', async () => {
    const exa = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'exa', name: 'Exa health', baseUrl: base, secret: EXA_KEY },
      })
    ).json<{ connection: Connection }>().connection;
    seen.length = 0;
    const healthy = await h.request('POST', api(`/provider-connections/${exa.id}/health-check`), {
      cookie,
    });
    expect(healthy.json<{ connection: Connection }>().connection).toMatchObject({
      status: 'healthy',
      lastError: null,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ path: '/search', credential: EXA_KEY });

    const tavily = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'tavily', name: 'Tavily health', baseUrl: base, secret: TAVILY_KEY },
      })
    ).json<{ connection: Connection }>().connection;
    expect(tavily.costPerQueryUsd).toBe(0.008);
    seen.length = 0;
    await h.request('POST', api(`/provider-connections/${tavily.id}/health-check`), { cookie });
    expect(seen[0]?.credential).toBe(`Bearer ${TAVILY_KEY}`);

    const wrong = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'exa', name: 'Exa wrong', baseUrl: base, secret: 'wrong-key-1234567' },
      })
    ).json<{ connection: Connection }>().connection;
    const invalid = await h.request('POST', api(`/provider-connections/${wrong.id}/health-check`), {
      cookie,
    });
    expect(invalid.json<{ connection: Connection }>().connection).toMatchObject({
      status: 'invalid',
      lastError: 'search_unauthorized',
    });
    expect(invalid.body).not.toContain('wrong-key-1234567');
  });

  it('rotation adds a version, the new key is the one used, and the price can be changed', async () => {
    const exa = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'exa', name: 'Exa rotating', baseUrl: base, secret: EXA_KEY },
      })
    ).json<{ connection: Connection }>().connection;
    const rotated = await h.request('POST', api(`/provider-connections/${exa.id}/rotate-secret`), {
      cookie,
      payload: { secret: EXA_KEY_2, reason: 'Quarterly rotation' },
    });
    expect(rotated.statusCode, rotated.body).toBe(200);
    expect(rotated.body).not.toContain(EXA_KEY_2);
    seen.length = 0;
    await h.request('POST', api(`/provider-connections/${exa.id}/health-check`), { cookie });
    expect(seen[0]?.credential).toBe(EXA_KEY_2);

    const current = (
      await h.request('GET', api(`/provider-connections/${exa.id}`), { cookie })
    ).json<{
      connection: Connection;
    }>().connection;
    const priced = await h.request('PATCH', api(`/provider-connections/${exa.id}`), {
      cookie,
      headers: { 'if-match': `"${current.version}"` },
      payload: { costPerQueryUsd: 0.012 },
    });
    expect(priced.statusCode, priced.body).toBe(200);
    expect(priced.json<{ connection: Connection }>().connection.costPerQueryUsd).toBe(0.012);
  });

  it('a search service has no models and takes no model self-check', async () => {
    const exa = (
      await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'exa', name: 'Exa models', baseUrl: base, secret: EXA_KEY },
      })
    ).json<{ connection: Connection }>().connection;
    const models = await h.request('POST', api(`/provider-connections/${exa.id}/models/refresh`), {
      cookie,
    });
    expect(models.statusCode).toBe(400);
    expect(models.json<{ code: string }>().code).toBe('PROVIDER_NOT_MODEL');
  });
});
