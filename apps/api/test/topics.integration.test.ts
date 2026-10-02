import 'reflect-metadata';

import { hash } from '@node-rs/argon2';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomBytes, randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool, Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DATABASE_POOL } from '../src/tokens.js';

const adminUrl = process.env['DATABASE_TEST_ADMIN_URL'];
const webOrigin = 'http://localhost:3000';
const testPepper = 'docoo-topic-integration-pepper-at-least-32-chars';
const password = 'topic-integration-password';
const suffix = randomBytes(6).toString('hex');
const roleName = `docoo_topics_${suffix}`;
const rolePassword = randomBytes(24).toString('hex');
const ids = {
  userA: randomUUID(),
  userB: randomUUID(),
  workspaceA: randomUUID(),
  workspaceB: randomUUID(),
};

interface TopicResponse {
  readonly id: string;
  readonly workspaceId: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly language: string;
}

interface TopicPageResponse {
  readonly items: TopicResponse[];
  readonly nextCursor: string | null;
}

let admin: Client;
let runtimePool: Pool;
let app: NestFastifyApplication;
let roleCreated = false;
let cookieA: string;
let cookieB: string;

function urlFor(workspaceId: string, suffix = ''): string {
  return `/v1/workspaces/${workspaceId}/topics${suffix}`;
}

function requestHeaders(sessionCookie: string, origin = webOrigin) {
  return {
    cookie: sessionCookie,
    origin,
    'sec-fetch-site': 'same-origin',
  };
}

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { origin: webOrigin, 'sec-fetch-site': 'same-origin' },
    payload: { identifier: email, password },
  });
  expect(response.statusCode).toBe(200);
  const setCookie = response.headers['set-cookie'];
  expect(typeof setCookie).toBe('string');
  return String(setCookie).split(';')[0] ?? '';
}

async function createTopic(
  workspaceId: string,
  sessionCookie: string,
  code: string,
  title: string,
) {
  return app.inject({
    method: 'POST',
    url: urlFor(workspaceId),
    headers: requestHeaders(sessionCookie),
    payload: { code, title },
  });
}

describe.skipIf(!adminUrl)('topics HTTP integration on disposable PostgreSQL 18', () => {
  beforeAll(async () => {
    const parsed = new URL(adminUrl!);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      parsed.pathname !== '/docoo_ci'
    ) {
      throw new Error(
        'Topic integration requires a disposable PostgreSQL database named docoo_ci.',
      );
    }

    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    const database = await admin.query<{ server_version: number; is_superuser: boolean }>(
      `select current_setting('server_version_num')::int as server_version, rolsuper as is_superuser
         from pg_roles where rolname = current_user`,
    );
    const server = database.rows[0];
    if (
      !server ||
      server.server_version < 180000 ||
      server.server_version >= 190000 ||
      !server.is_superuser
    ) {
      throw new Error('Topic integration requires a PostgreSQL 18 test superuser.');
    }

    const roleSql = await admin.query<{ sql: string }>(
      "select format('CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text, $2::text) as sql",
      [roleName, rolePassword],
    );
    await admin.query(roleSql.rows[0]!.sql);
    roleCreated = true;
    await admin.query(`grant docoo_app to ${roleName}`);

    const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    await admin.query(
      `insert into users (id, email, password_hash, display_name)
       values ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [
        ids.userA,
        `topics-a-${suffix}@example.test`,
        passwordHash,
        'Topic Admin A',
        ids.userB,
        `topics-b-${suffix}@example.test`,
        passwordHash,
        'Topic Admin B',
      ],
    );
    await admin.query(`insert into workspaces (id, code, name) values ($1, $2, $3), ($4, $5, $6)`, [
      ids.workspaceA,
      `topics-a-${suffix}`,
      'Topics A',
      ids.workspaceB,
      `topics-b-${suffix}`,
      'Topics B',
    ]);
    await admin.query(`insert into memberships (workspace_id, user_id) values ($1, $2), ($3, $4)`, [
      ids.workspaceA,
      ids.userA,
      ids.workspaceB,
      ids.userB,
    ]);

    const runtimeUrl = new URL(adminUrl!);
    runtimeUrl.username = roleName;
    runtimeUrl.password = rolePassword;
    runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 4 });
    process.env['NODE_ENV'] = 'test';
    process.env['SESSION_PEPPER'] = testPepper;
    process.env['WEB_ORIGIN'] = webOrigin;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(runtimePool)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    await app.register(cookie, { secret: testPepper });
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRoute', (routeOptions) => {
        const methods = Array.isArray(routeOptions.method)
          ? routeOptions.method
          : [routeOptions.method];
        if (routeOptions.url.endsWith('/auth/login') && methods.includes('POST')) {
          routeOptions.config = {
            ...routeOptions.config,
            rateLimit: { max: 10, timeWindow: '1 minute' },
          };
        }
      });
    await app.register(rateLimit, {
      max: 120,
      timeWindow: '1 minute',
      ban: 3,
      errorResponseBuilder: (_request, context) =>
        new HttpException(
          {
            status: context.statusCode,
            title: context.ban ? 'Forbidden' : 'Too Many Requests',
            code: 'AUTH_RATE_LIMITED',
            detail: 'Please wait before trying again.',
          },
          context.statusCode,
        ),
    });
    app.setGlobalPrefix('v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    cookieA = await login(`topics-a-${suffix}@example.test`);
    cookieB = await login(`topics-b-${suffix}@example.test`);
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    else if (runtimePool) await runtimePool.end();
    if (admin) {
      if (roleCreated) await admin.query(`drop role ${roleName}`);
      await admin.end();
    }
  });

  it('rejects missing sessions, foreign workspaces, malformed IDs, and cross-origin writes', async () => {
    const anonymous = await app.inject({ method: 'GET', url: urlFor(ids.workspaceA) });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json<{ code: string }>().code).toBe('AUTH_SESSION_INVALID');

    const foreign = await app.inject({
      method: 'GET',
      url: urlFor(ids.workspaceB),
      headers: requestHeaders(cookieA),
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json<{ code: string }>().code).toBe('AUTH_WORKSPACE_NOT_FOUND');

    const malformed = await app.inject({
      method: 'GET',
      url: urlFor('not-a-uuid'),
      headers: requestHeaders(cookieA),
    });
    expect(malformed.statusCode).toBe(400);

    const crossOrigin = await app.inject({
      method: 'POST',
      url: urlFor(ids.workspaceA),
      headers: requestHeaders(cookieA, 'https://attacker.invalid'),
      payload: { code: 'blocked', title: 'Blocked' },
    });
    expect(crossOrigin.statusCode).toBe(403);
    expect(crossOrigin.json<{ code: string }>().code).toBe('AUTH_CROSS_ORIGIN_REQUEST');
  });

  it('validates allowlisted input before inserting, including workspace spoofing', async () => {
    const malformed = await app.inject({
      method: 'POST',
      url: urlFor(ids.workspaceA),
      headers: requestHeaders(cookieA),
      payload: { code: 'invalid code!', title: 'Invalid' },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json<{ code: string }>().code).toBe('TOPIC_INVALID_REQUEST');

    const spoofed = await app.inject({
      method: 'POST',
      url: urlFor(ids.workspaceA),
      headers: requestHeaders(cookieA),
      payload: { code: 'spoofed', title: 'Spoofed', workspaceId: ids.workspaceB },
    });
    expect(spoofed.statusCode).toBe(400);
    expect(spoofed.json<{ code: string }>().code).toBe('TOPIC_INVALID_REQUEST');
  });

  it('creates topics only inside the authorized workspace and records redacted audit events', async () => {
    const createdA = await createTopic(ids.workspaceA, cookieA, 'shared-code', 'Shared title');
    expect(createdA.statusCode).toBe(201);
    const topicA = createdA.json<{ topic: TopicResponse }>().topic;
    expect(topicA).toMatchObject({
      workspaceId: ids.workspaceA,
      code: 'shared-code',
      title: 'Shared title',
      description: '',
      language: 'fa',
    });

    const createdB = await createTopic(ids.workspaceB, cookieB, 'shared-code', 'Shared title');
    expect(createdB.statusCode).toBe(201);
    const topicB = createdB.json<{ topic: TopicResponse }>().topic;
    expect(topicB.workspaceId).toBe(ids.workspaceB);
    expect(topicB.id).not.toBe(topicA.id);

    const listA = await app.inject({
      method: 'GET',
      url: urlFor(ids.workspaceA),
      headers: requestHeaders(cookieA),
    });
    expect(listA.statusCode).toBe(200);
    expect(listA.json<TopicPageResponse>().items.map((topic) => topic.id)).toEqual([topicA.id]);

    const listB = await app.inject({
      method: 'GET',
      url: urlFor(ids.workspaceB),
      headers: requestHeaders(cookieB),
    });
    expect(listB.statusCode).toBe(200);
    expect(listB.json<TopicPageResponse>().items.map((topic) => topic.id)).toEqual([topicB.id]);

    const audit = await admin.query<{
      workspace_id: string;
      actor_id: string;
      action: string;
      target_id: string;
      after: Record<string, unknown>;
      correlation_id: string;
    }>(
      `select workspace_id, actor_id, action, target_id, after, correlation_id
         from audit_events where target_id = any($1::uuid[]) order by target_id`,
      [[topicA.id, topicB.id]],
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspace_id: ids.workspaceA,
          actor_id: ids.userA,
          action: 'topic.create',
          target_id: topicA.id,
        }),
        expect.objectContaining({
          workspace_id: ids.workspaceB,
          actor_id: ids.userB,
          action: 'topic.create',
          target_id: topicB.id,
        }),
      ]),
    );
    for (const event of audit.rows) {
      expect(event.after).toMatchObject({
        code: 'shared-code',
        title: { redacted: true, length: 'Shared title'.length },
        description: { redacted: true, length: 0 },
        language: 'fa',
        version: 1,
      });
      expect(JSON.stringify(event.after)).not.toContain('Shared title');
      expect(event.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('returns a sanitized conflict for case-insensitive duplicate code or title', async () => {
    const duplicateCode = await createTopic(
      ids.workspaceA,
      cookieA,
      'SHARED-CODE',
      'Different title',
    );
    expect(duplicateCode.statusCode).toBe(409);
    expect(duplicateCode.json<{ code: string }>().code).toBe('TOPIC_ALREADY_EXISTS');

    const duplicateTitle = await createTopic(
      ids.workspaceA,
      cookieA,
      'different-code',
      'SHARED TITLE',
    );
    expect(duplicateTitle.statusCode).toBe(409);
    expect(duplicateTitle.json<{ code: string }>().code).toBe('TOPIC_ALREADY_EXISTS');
  });

  it('paginates without duplicates, binds cursors to a workspace, and excludes archived/deleted topics', async () => {
    const created = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await createTopic(ids.workspaceA, cookieA, `page-${index}`, `Page ${index}`);
      expect(response.statusCode).toBe(201);
      created.push(response.json<{ topic: TopicResponse }>().topic);
    }
    await admin.query('update topics set archived_at = now() where id = $1', [created[2]!.id]);
    await admin.query('update topics set deleted_at = now() where id = $1', [created[3]!.id]);

    const first = await app.inject({
      method: 'GET',
      url: urlFor(ids.workspaceA, '?limit=2'),
      headers: requestHeaders(cookieA),
    });
    expect(first.statusCode).toBe(200);
    const firstPage = first.json<TopicPageResponse>();
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTruthy();

    const second = await app.inject({
      method: 'GET',
      url: urlFor(ids.workspaceA, `?limit=2&cursor=${firstPage.nextCursor}`),
      headers: requestHeaders(cookieA),
    });
    expect(second.statusCode).toBe(200);
    const secondPage = second.json<TopicPageResponse>();
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    const allIds = [...firstPage.items, ...secondPage.items].map((topic) => topic.id);
    expect(new Set(allIds).size).toBe(3);
    expect(allIds).not.toContain(created[2]!.id);
    expect(allIds).not.toContain(created[3]!.id);

    const foreignCursor = await app.inject({
      method: 'GET',
      url: urlFor(ids.workspaceB, `?limit=2&cursor=${firstPage.nextCursor}`),
      headers: requestHeaders(cookieB),
    });
    expect(foreignCursor.statusCode).toBe(400);
    expect(foreignCursor.json<{ code: string }>().code).toBe('TOPIC_CURSOR_INVALID');

    const invalidCursor = await app.inject({
      method: 'GET',
      url: urlFor(ids.workspaceA, '?cursor=invalid'),
      headers: requestHeaders(cookieA),
    });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidCursor.json<{ code: string }>().code).toBe('TOPIC_CURSOR_INVALID');

    const unexpectedQuery = await app.inject({
      method: 'GET',
      url: urlFor(ids.workspaceA, '?workspaceId=other'),
      headers: requestHeaders(cookieA),
    });
    expect(unexpectedQuery.statusCode).toBe(400);
    expect(unexpectedQuery.json<{ code: string }>().code).toBe('TOPIC_INVALID_REQUEST');
  });

  it('returns an authenticated session with only its memberships and stores a token digest', async () => {
    const session = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: cookieA },
    });
    expect(session.statusCode).toBe(200);
    expect(session.headers['cache-control']).toBe('no-store');
    const payload = session.json<{
      user: { id: string; role: string };
      workspaces: { id: string; role: string }[];
    }>();
    expect(payload.user).toMatchObject({ id: ids.userA, role: 'super_admin' });
    expect(payload.workspaces).toEqual([
      expect.objectContaining({ id: ids.workspaceA, role: 'super_admin' }),
    ]);

    const storedSession = await admin.query<{ token_digest: string }>(
      'select token_digest from sessions where user_id = $1 order by created_at desc limit 1',
      [ids.userA],
    );
    expect(storedSession.rows).toHaveLength(1);
    expect(storedSession.rows[0]!.token_digest).not.toBe(cookieA.split('=')[1]);
  });

  it('records a redacted failed login, rejects cross-origin logout, and revokes the cookie', async () => {
    const badLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: webOrigin, 'sec-fetch-site': 'same-origin' },
      payload: { identifier: `topics-a-${suffix}@example.test`, password: 'wrong-password' },
    });
    expect(badLogin.statusCode).toBe(401);
    expect(badLogin.json<{ code: string }>().code).toBe('AUTH_INVALID_CREDENTIALS');
    const failedAudit = await admin.query<{ identifier_digest: string }>(
      "select identifier_digest from auth_events where actor_id = $1 and action = 'login.failed'",
      [ids.userA],
    );
    expect(failedAudit.rows).toHaveLength(1);
    expect(failedAudit.rows[0]!.identifier_digest).not.toContain(`topics-a-${suffix}@example.test`);

    const crossOrigin = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: requestHeaders(cookieA, 'https://attacker.invalid'),
    });
    expect(crossOrigin.statusCode).toBe(403);

    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: requestHeaders(cookieA),
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers['cache-control']).toBe('no-store');

    const invalidSession = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: cookieA },
    });
    expect(invalidSession.statusCode).toBe(401);
    expect(invalidSession.json<{ code: string }>().code).toBe('AUTH_SESSION_INVALID');

    const invalidWorkspace = await app.inject({
      method: 'GET',
      url: urlFor(ids.workspaceA),
      headers: requestHeaders(cookieA),
    });
    expect(invalidWorkspace.statusCode).toBe(401);

    const successfulAudit = await admin.query<{ actor_id: string }>(
      "select actor_id from auth_events where actor_id = $1 and action = 'logout.succeeded'",
      [ids.userA],
    );
    expect(successfulAudit.rows).toHaveLength(1);
  });

  it('limits repeated password guesses on the login route', async () => {
    const statuses: number[] = [];
    let limitedCode: string | undefined;
    let retryAfter: string | undefined;
    for (let index = 0; index < 12; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { origin: webOrigin, 'sec-fetch-site': 'same-origin' },
        payload: { identifier: `topics-a-${suffix}@example.test`, password: 'wrong-password' },
      });
      statuses.push(response.statusCode);
      if (response.statusCode === 429) {
        limitedCode = response.json<{ code: string }>().code;
        retryAfter = response.headers['retry-after']?.toString();
        break;
      }
    }
    expect(statuses).toContain(429);
    expect(limitedCode).toBe('AUTH_RATE_LIMITED');
    expect(retryAfter).toBeTruthy();
  });
});
