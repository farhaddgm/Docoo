import { randomBytes, randomUUID } from 'node:crypto';

import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WorkspaceRequestContext } from '../src/common/request-context.js';
import { WorkspaceDatabase } from '../src/common/workspace-database.js';
import { MonitorService } from '../src/monitor/monitor.service.js';
import { MonitorShareService } from '../src/monitor/monitor-share.service.js';
import { adminUrl } from './support/harness.js';

/**
 * Share links against a real database: what is stored, the password and the room left, the end of
 * a link (expiry, revoking), the monitor settings still applying, and one workspace never reaching
 * the links of another.
 */
describe.skipIf(!adminUrl)('monitor share links (real database)', () => {
  const roleName = `docoo_shr_${randomBytes(6).toString('hex')}`;
  const rolePassword = randomBytes(18).toString('hex');
  const suffix = randomBytes(4).toString('hex');
  const ids = { workspace: randomUUID(), other: randomUUID(), owner: randomUUID() };
  const PASSWORD = 'correct horse battery';
  let admin: Client;
  let pool: Pool;
  let shares: MonitorShareService;
  let enabled = true;
  let watermark: string | undefined;

  const context = (workspaceId = ids.workspace): WorkspaceRequestContext => ({
    workspaceId,
    actorId: ids.owner,
    correlationId: randomUUID(),
  });
  const input = (over: Record<string, unknown> = {}) => ({
    kind: 'viewer' as const,
    password: PASSWORD,
    expiresAt: null,
    maxSessions: 2,
    label: '',
    ...over,
  });
  const make = (over: Record<string, unknown> = {}) => shares.create(context(), input(over));
  const open = async (token: string, ip = `ip-${randomUUID()}`) =>
    (await shares.unlock(token, PASSWORD, ip)).sessionToken;
  const status = async (promise: Promise<unknown>) =>
    promise.then(
      () => 200,
      (error: { getStatus?: () => number }) => error.getStatus?.() ?? 500,
    );
  const code = async (promise: Promise<unknown>) =>
    promise.then(
      () => '',
      (error: { getResponse?: () => { code?: string } }) => error.getResponse?.().code ?? '',
    );

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(
      `create role ${roleName} login inherit nosuperuser nobypassrls nocreatedb nocreaterole password '${rolePassword}'`,
    );
    await admin.query(`grant docoo_app to ${roleName}`);
    const runtime = new URL(adminUrl!);
    runtime.username = roleName;
    runtime.password = rolePassword;
    pool = new Pool({ connectionString: runtime.toString(), max: 4 });

    for (const [id, code] of [
      [ids.workspace, `shr-${suffix}`],
      [ids.other, `sho-${suffix}`],
    ] as const) {
      await admin.query(`insert into workspaces (id, code, name) values ($1, $2, 'Share test')`, [
        id,
        code,
      ]);
    }
    await admin.query(
      `insert into users (id, email, password_hash, display_name) values ($1, $2, 'x', 'Owner')`,
      [ids.owner, `${ids.owner}@shr-${suffix}.example.test`],
    );
    await admin.query(`insert into memberships (workspace_id, user_id) values ($1, $2)`, [
      ids.workspace,
      ids.owner,
    ]);

    const config = {
      resolve: () =>
        Promise.resolve({
          values: {
            'monitor.disclosure_accepted': true,
            'monitor.viewer.enabled': enabled,
            'monitor.voice.enabled': enabled,
            ...(watermark ? { 'monitor.watermark': watermark } : {}),
          },
        }),
    };
    const database = new WorkspaceDatabase(pool);
    const monitor = new MonitorService(database, config as never);
    shares = new MonitorShareService(
      pool,
      {
        SESSION_PEPPER: 'integration-pepper-integration-pepper',
        NODE_ENV: 'test',
        PASSWORD_ARGON2_MEMORY_KIB: 8,
        PASSWORD_ARGON2_ITERATIONS: 1,
        PASSWORD_ARGON2_PARALLELISM: 1,
      } as never,
      database,
      monitor,
    );
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`delete from monitor_share_links where workspace_id = any($1)`, [
        [ids.workspace, ids.other],
      ]);
      await admin.query(`delete from memberships where workspace_id = $1`, [ids.workspace]);
      await admin.query(`drop owned by ${roleName}`).catch(() => undefined);
      await admin.query(`drop role if exists ${roleName}`).catch(() => undefined);
      await admin.end();
    }
  });

  it('keeps only digests and a hash, never the address or the password', async () => {
    const made = await make({ label: 'Room 2' });
    const row = (await admin.query(`select * from monitor_share_links where id = $1`, [made.id]))
      .rows[0];
    expect(JSON.stringify(row)).not.toContain(made.token);
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    expect(row.password_hash).toMatch(/^\$argon2/u);
    expect(row.token_digest).toMatch(/^[0-9a-f]{64}$/u);

    const listed = await shares.list(context());
    expect(listed.find((link) => link.id === made.id)).toMatchObject({
      label: 'Room 2',
      status: 'active',
      activeSessions: 0,
    });
    expect(JSON.stringify(listed)).not.toContain(made.token);
  });

  it('needs the right password and a session before it shows anything', async () => {
    const { token } = await make();
    expect(await shares.info(token)).toEqual({ kind: 'viewer' });
    expect(await code(shares.unlock(token, 'wrong password', 'ip-a'))).toBe(
      'MONITOR_SHARE_WRONG_PASSWORD',
    );
    expect(await code(shares.view(token, undefined))).toBe('MONITOR_SHARE_LOCKED');
    expect(await code(shares.view(token, 'not-a-session'))).toBe('MONITOR_SHARE_LOCKED');

    const session = await open(token);
    const answer = await shares.view(token, session);
    expect(answer.kind).toBe('viewer');
    expect(answer.look.workspaceName).toBe('Share test');
    // A session of one link opens nothing of another.
    const second = await make();
    expect(await code(shares.view(second.token, session))).toBe('MONITOR_SHARE_LOCKED');
  });

  it('sends the workspace name only when the faint mark is to show it', async () => {
    const { token } = await make();
    const session = await open(token);
    watermark = 'none';
    try {
      const hidden = await shares.view(token, session);
      expect(hidden.look.workspaceName).toBe('');
      expect(JSON.stringify(hidden)).not.toContain('Share test');
    } finally {
      watermark = undefined;
    }
    expect((await shares.view(token, session)).look.workspaceName).toBe('Share test');
  });

  it('serves a voice link through the voice monitor', async () => {
    const { token } = await make({ kind: 'voice' });
    const answer = await shares.view(token, await open(token));
    expect(answer.kind).toBe('voice');
  });

  it('lets only the allowed number of screens watch, and frees a place when one leaves', async () => {
    const { token, id } = await make({ maxSessions: 1 });
    const first = await open(token);
    expect(await code(shares.unlock(token, PASSWORD, 'ip-b'))).toBe('MONITOR_SHARE_FULL');

    // The first screen goes quiet; its place is free after the presence window.
    await admin.query(
      `update monitor_share_sessions set last_seen_at = now() - interval '2 minutes' where link_id = $1`,
      [id],
    );
    const second = await open(token);
    // The one that was away has lost its place to the second one.
    expect(await code(shares.view(token, first))).toBe('MONITOR_SHARE_FULL');
    expect((await shares.view(token, second)).kind).toBe('viewer');
    const listed = await shares.list(context());
    expect(listed.find((link) => link.id === id)?.activeSessions).toBe(1);
  });

  it('lets two racing visitors take only the last place', async () => {
    const { token } = await make({ maxSessions: 1 });
    const results = await Promise.all(
      [1, 2, 3].map((n) => status(shares.unlock(token, PASSWORD, `ip-race-${n}`))),
    );
    expect(results.filter((value) => value === 200)).toHaveLength(1);
    expect(results.filter((value) => value === 409)).toHaveLength(2);
  });

  it('stops at the expiry and when the owner revokes the link', async () => {
    const expiring = await make();
    const session = await open(expiring.token);
    await admin.query(
      `update monitor_share_links set expires_at = now() - interval '1 second' where id = $1`,
      [expiring.id],
    );
    expect(await status(shares.info(expiring.token))).toBe(410);
    expect(await status(shares.view(expiring.token, session))).toBe(410);
    expect(await status(shares.unlock(expiring.token, PASSWORD, 'ip-c'))).toBe(410);
    expect((await shares.list(context())).find((l) => l.id === expiring.id)?.status).toBe(
      'expired',
    );

    const revoked = await make();
    const watching = await open(revoked.token);
    await shares.revoke(context(), revoked.id);
    expect(await status(shares.view(revoked.token, watching))).toBe(410);
    expect((await shares.list(context())).find((l) => l.id === revoked.id)?.status).toBe('revoked');
    const left = await admin.query(`select 1 from monitor_share_sessions where link_id = $1`, [
      revoked.id,
    ]);
    expect(left.rowCount).toBe(0);
    expect(await status(shares.revoke(context(), revoked.id))).toBe(404);
  });

  it('answers 404 for an address that does not exist', async () => {
    expect(await status(shares.info('A'.repeat(43)))).toBe(404);
  });

  it('never lets one workspace see or end the links of another', async () => {
    const mine = await make();
    expect(await status(shares.revoke(context(ids.other), mine.id))).toBe(404);
    expect((await shares.list(context(ids.other))).some((link) => link.id === mine.id)).toBe(false);
    const stillActive = await shares.list(context());
    expect(stillActive.find((link) => link.id === mine.id)?.status).toBe('active');
  });

  it('shows nothing while the monitor itself is switched off', async () => {
    const { token } = await make();
    const session = await open(token);
    enabled = false;
    try {
      expect(await code(shares.view(token, session))).toBe('MONITOR_OFF');
    } finally {
      enabled = true;
    }
  });
});
