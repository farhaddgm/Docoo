import 'reflect-metadata';
import cookie from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { GoogleOAuthService, GoogleAuthError } from '../src/auth/google-oauth.service.js';
import { DATABASE_POOL } from '../src/tokens.js';

const adminUrl = process.env['DATABASE_TEST_ADMIN_URL'];
const password = 'integration-account-password';
const origin = 'http://localhost:3000';
const suffix = randomUUID().slice(0, 8);
const runtimeRole = `docoo_google_${suffix}`;
const runtimePassword = randomUUID().replaceAll('-', '');
const ownerEmail = `docoo.owner.${suffix}@gmail.com`;
let admin: Pool, runtime: Pool, app: NestFastifyApplication, auth: AuthService;
let ownerCookie: string, workspaceId: string, viewerId: string, viewerCookie: string;
const projectId = randomUUID(),
  topicId = randomUUID(),
  hiddenProjectId = randomUUID(),
  sourceId = randomUUID();
const headers = (value: string) => ({ cookie: value, origin, 'sec-fetch-site': 'same-origin' });
const googleIdentity = (email: string) => ({ sub: `google-${email}`, email, emailVerified: true });

describe.skipIf(!adminUrl)('Google accounts on the deployed database schema', () => {
  beforeAll(async () => {
    if (new URL(adminUrl!).pathname !== '/docoo_ci')
      throw new Error('A disposable docoo_ci database is required.');
    process.env['NODE_ENV'] = 'test';
    process.env['SESSION_PEPPER'] = 'docoo-google-integration-private-test-pepper';
    process.env['OWNER_EMAIL'] = ownerEmail;
    process.env['GOOGLE_CLIENT_ID'] = 'integration-client';
    process.env['GOOGLE_CLIENT_SECRET'] = 'integration-secret';
    process.env['GOOGLE_REDIRECT_URI'] = origin + '/api/auth/google/callback';
    process.env['SECRET_MASTER_KEY'] = Buffer.alloc(32, 7).toString('base64');
    process.env['ARTIFACT_SIGNING_KEY'] = 'integration-artifact-signing-key-32';
    admin = new Pool({ connectionString: adminUrl });
    const parsed = new URL(adminUrl!);
    await admin.query(
      `create role ${runtimeRole} login password '${runtimePassword}' in role docoo_app`,
    );
    parsed.username = runtimeRole;
    parsed.password = runtimePassword;
    runtime = new Pool({ connectionString: parsed.toString() });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(runtime)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie);
    app.setGlobalPrefix('v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    auth = app.get(AuthService);
    const owner = await auth.loginWithGoogle(googleIdentity(ownerEmail), {
      correlationId: randomUUID(),
    });
    ownerCookie = 'docoo_session=' + owner.token;
    workspaceId = owner.workspaces[0]!.id;
    await admin.query(
      "insert into projects(id,workspace_id,code,title,initial_problem,created_by) values($1,$2,$3,'Visible project','Problem',$4),($5,$2,$6,'Hidden project','Problem',$4)",
      [projectId, workspaceId, 'acl-' + suffix, owner.user.id, hiddenProjectId, 'hidden-' + suffix],
    );
    await admin.query(
      'insert into topics(id,workspace_id,code,title,created_by) values($1,$2,$3,$5,$4)',
      [topicId, workspaceId, 'acl-' + suffix, owner.user.id, 'Visible topic ' + suffix],
    );
    await admin.query(
      "insert into source_assets(id,workspace_id,kind,title,scope_type,scope_id,created_by) values($1,$2,'text','Private source','project',$3,$4)",
      [sourceId, workspaceId, projectId, owner.user.id],
    );
  }, 30000);
  afterAll(async () => {
    await app?.close();
    if (admin) await admin.query(`drop role if exists ${runtimeRole}`);
    await admin?.end();
  });

  it('bootstraps a Google-only owner and exposes management routes', async () => {
    const session = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: headers(ownerCookie),
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user).toMatchObject({
      role: 'super_admin',
      isOwner: true,
      loginMethod: 'GOOGLE',
      hasPassword: false,
    });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/admin/users', headers: headers(ownerCookie) }))
        .statusCode,
    ).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/providers' })).json()).toEqual({
      google: true,
    });
  });
  it('rejects unapproved, unverified and organizational accounts', async () => {
    await expect(
      auth.loginWithGoogle(googleIdentity(`unknown.${suffix}@gmail.com`), {
        correlationId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(GoogleAuthError);
    await expect(
      auth.loginWithGoogle(
        { ...googleIdentity(ownerEmail), emailVerified: false },
        { correlationId: randomUUID() },
      ),
    ).rejects.toBeInstanceOf(GoogleAuthError);
    await expect(
      auth.loginWithGoogle(
        { ...googleIdentity(ownerEmail), hostedDomain: 'example.com' },
        { correlationId: randomUUID() },
      ),
    ).rejects.toBeInstanceOf(GoogleAuthError);
  });
  it('lets only the owner approve a Gmail account', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/v1/owner/google-access',
      headers: headers(ownerCookie),
      payload: {
        email: `docoo.viewer.${suffix}@gmail.com`,
        displayName: 'Test viewer',
        role: 'viewer',
        loginMethod: 'GOOGLE',
        workspaceIds: [workspaceId],
      },
    });
    expect(result.statusCode).toBe(201);
    viewerId = result.json<{ id: string }>().id;
    const session = await auth.loginWithGoogle(
      googleIdentity(result.json<{ email: string }>().email),
      { correlationId: randomUUID() },
    );
    viewerCookie = 'docoo_session=' + session.token;
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/owner/google-access',
          headers: headers(viewerCookie),
        })
      ).statusCode,
    ).toBe(403);
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: headers(ownerCookie),
      payload: { identifier: result.json<{ email: string }>().email, password },
    });
    expect(login.statusCode).toBe(401);
  });
  it('applies independent VIEW grants to projects and topics, including direct URLs and SQL', async () => {
    const grant = (kind: string, id: string, access: string | null) =>
      app.inject({
        method: 'PUT',
        url: `/v1/owner/users/${viewerId}/access/${kind}/${id}`,
        headers: headers(ownerCookie),
        payload: { workspaceId, access },
      });
    expect((await grant('project', projectId, 'VIEW')).statusCode).toBe(200);
    const project = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${workspaceId}/projects/${projectId}`,
      headers: headers(viewerCookie),
    });
    expect(project.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/workspaces/${workspaceId}/projects/${projectId}/business`,
          headers: headers(viewerCookie),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/workspaces/${workspaceId}/contenter-businesses`,
          headers: headers(viewerCookie),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/workspaces/${workspaceId}/projects/${hiddenProjectId}`,
          headers: headers(viewerCookie),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/workspaces/${workspaceId}/topics/${topicId}`,
          headers: headers(viewerCookie),
        })
      ).statusCode,
    ).toBe(404);
    expect((await grant('topic', topicId, 'VIEW')).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/workspaces/${workspaceId}/topics/${topicId}`,
          headers: headers(viewerCookie),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/workspaces/${workspaceId}/projects/${projectId}`,
          headers: headers(viewerCookie),
          payload: { title: 'Unauthorized change' },
        })
      ).statusCode,
    ).toBe(403);
    const db = await runtime.connect();
    try {
      await db.query('begin');
      await db.query(
        "select set_config('app.workspace_id',$1,true),set_config('app.actor_id',$2,true)",
        [workspaceId, viewerId],
      );
      expect(
        (await db.query<{ id: string }>('select id from projects')).rows.map((row) => row.id),
      ).toEqual([projectId]);
      expect(
        (await db.query<{ id: string }>('select id from source_assets')).rows.map((row) => row.id),
      ).toEqual([sourceId]);
      expect(
        (await db.query("update projects set title='No' where id=$1", [projectId])).rowCount,
      ).toBe(0);
      await db.query('rollback');
    } finally {
      db.release();
    }
  });
  it('allows EDIT for an explicitly granted project while retaining viewer creation limits', async () => {
    const grant = await app.inject({
      method: 'PUT',
      url: `/v1/owner/users/${viewerId}/access/project/${projectId}`,
      headers: headers(ownerCookie),
      payload: { workspaceId, access: 'EDIT' },
    });
    expect(grant.statusCode).toBe(200);
    const update = await app.inject({
      method: 'PATCH',
      url: `/v1/workspaces/${workspaceId}/projects/${projectId}`,
      headers: { ...headers(viewerCookie), 'if-match': '"1"' },
      payload: { title: 'Permitted change' },
    });
    expect(update.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/workspaces/${workspaceId}/topics`,
          headers: headers(viewerCookie),
          payload: { code: 'viewer-created', title: 'Forbidden' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/workspaces/${workspaceId}/projects/${projectId}`,
          headers: headers(viewerCookie),
          payload: { expectedVersion: 2 },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('permits knowledge creation only in EDIT scopes and hides it after the grant is removed', async () => {
    const payload = {
      title: 'Granted knowledge',
      sourceType: 'admin_provided',
      content: 'Allowed project knowledge',
      scopes: [{ type: 'project', id: projectId }],
    };
    const created = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/knowledge`,
      headers: headers(viewerCookie),
      payload,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ knowledge: { id: string } }>().knowledge.id;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/workspaces/${workspaceId}/knowledge`,
          headers: headers(viewerCookie),
          payload: {
            ...payload,
            scopes: [
              { type: 'project', id: projectId },
              { type: 'project', id: hiddenProjectId },
            ],
          },
        })
      ).statusCode,
    ).toBe(403);
    const grantUrl = `/v1/owner/users/${viewerId}/access/project/${projectId}`;
    await app.inject({
      method: 'PUT',
      url: grantUrl,
      headers: headers(ownerCookie),
      payload: { workspaceId, access: null },
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/workspaces/${workspaceId}/knowledge/${id}`,
          headers: headers(viewerCookie),
        })
      ).statusCode,
    ).toBe(404);
    await app.inject({
      method: 'PUT',
      url: grantUrl,
      headers: headers(ownerCookie),
      payload: { workspaceId, access: 'EDIT' },
    });
  });
  it('keeps PASSWORD and BOTH login usable and protects the owner', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/users',
      headers: headers(ownerCookie),
      payload: {
        email: `docoo.editor.${suffix}@gmail.com`,
        displayName: 'Test editor',
        role: 'editor',
        loginMethod: 'BOTH',
        password,
        workspaceIds: [workspaceId],
      },
    });
    expect(created.statusCode).toBe(201);
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: headers(ownerCookie),
      payload: { identifier: created.json<{ email: string }>().email, password },
    });
    expect(login.statusCode).toBe(200);
    await expect(
      auth.loginWithGoogle(googleIdentity(created.json<{ email: string }>().email), {
        correlationId: randomUUID(),
      }),
    ).resolves.toMatchObject({ user: { role: 'editor', loginMethod: 'BOTH' } });
    const owner = (
      await app.inject({ method: 'GET', url: '/v1/auth/session', headers: headers(ownerCookie) })
    ).json().user;
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/admin/users/${owner.id}`,
          headers: headers(ownerCookie),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/admin/users/${owner.id}`,
          headers: headers(ownerCookie),
          payload: { isActive: false },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('finishes a Google callback with a secure session and clears the temporary cookie', async () => {
    const provider = app.get(GoogleOAuthService);
    vi.spyOn(provider, 'finish').mockResolvedValueOnce({
      identity: googleIdentity(ownerEmail),
      redirectTo: '/fa',
    });
    const callback = await app.inject({
      method: 'GET',
      url: '/v1/auth/google/callback?code=opaque-test-code&state=opaque-test-state',
      headers: { cookie: 'docoo_goauth=opaque-flow-cookie' },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(origin + '/fa');
    const cookies = String(callback.headers['set-cookie']);
    expect(cookies).toContain('docoo_goauth=;');
    expect(cookies).toContain('docoo_session=');
    expect(cookies).toContain('HttpOnly');
  });
  it('revokes existing sessions immediately when Google permission is removed', async () => {
    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/owner/google-access/${viewerId}`,
      headers: headers(ownerCookie),
    });
    expect(removed.statusCode).toBe(204);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/auth/session', headers: headers(viewerCookie) }))
        .statusCode,
    ).toBe(401);
    await expect(
      auth.loginWithGoogle(googleIdentity(`docoo.viewer.${suffix}@gmail.com`), {
        correlationId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(GoogleAuthError);
  });
  it('allows editors to create their own resources, honors creator downgrades, and preserves history on account deletion', async () => {
    const email = `creator.${suffix}@gmail.com`;
    const created = await app.inject({
      method: 'POST',
      url: '/v1/owner/google-access',
      headers: headers(ownerCookie),
      payload: {
        email,
        displayName: 'Resource creator',
        role: 'editor',
        loginMethod: 'GOOGLE',
        workspaceIds: [workspaceId],
      },
    });
    expect(created.statusCode).toBe(201);
    const creatorId = created.json<{ id: string }>().id;
    const creator = await auth.loginWithGoogle(googleIdentity(email), {
      correlationId: randomUUID(),
    });
    const creatorCookie = 'docoo_session=' + creator.token;
    const topic = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/topics`,
      headers: headers(creatorCookie),
      payload: {
        code: 'own-' + suffix,
        title: 'Creator topic ' + suffix,
        description: '',
        language: 'fa',
      },
    });
    expect(topic.statusCode, topic.body).toBe(201);
    const project = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/projects`,
      headers: headers(creatorCookie),
      payload: {
        code: 'creator-' + suffix,
        title: 'Creator project ' + suffix,
        initialProblem: 'Creator problem',
      },
    });
    expect(project.statusCode, project.body).toBe(201);

    const ownTopic = topic.json<{ topic: { id: string } }>().topic.id;
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/v1/owner/users/${creatorId}/access/topic/${ownTopic}`,
          headers: headers(ownerCookie),
          payload: { workspaceId, access: null },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/v1/owner/users/${creatorId}/access/topic/${ownTopic}`,
          headers: headers(ownerCookie),
          payload: { workspaceId, access: 'VIEW' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/workspaces/${workspaceId}/topics/${ownTopic}`,
          headers: headers(creatorCookie),
          payload: { title: 'Cannot change' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/admin/users/${creatorId}`,
          headers: headers(ownerCookie),
        })
      ).statusCode,
    ).toBe(204);
    expect((await admin.query('select 1 from topics where id=$1', [ownTopic])).rowCount).toBe(1);
    expect(
      (await admin.query('select 1 from audit_events where actor_id=$1', [creatorId])).rowCount,
    ).toBeGreaterThan(0);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/auth/session',
          headers: headers(creatorCookie),
        })
      ).statusCode,
    ).toBe(401);
  });
});
