import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, password, setCookieOf, type Harness } from './support/harness.js';

let h: Harness;

async function authEvents(userId: string): Promise<string[]> {
  const result = await h.admin.query<{ action: string }>(
    'select action from auth_events where actor_id = $1 order by occurred_at, id',
    [userId],
  );
  return result.rows.map((row) => row.action);
}

describe.skipIf(!adminUrl)('auth integration (TC-AUTH-*)', () => {
  beforeAll(async () => {
    h = await createHarness('auth');
  }, 30_000);

  afterAll(async () => {
    await h?.close();
  });

  it('logs in, reads /me and logs out with audited events', async () => {
    const session = await h.login(h.emails.a);
    const me = await h.request('GET', '/v1/me', { cookie: session });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ user: { email: string } }>().user.email).toBe(h.emails.a);

    const logout = await h.request('POST', '/v1/auth/logout', { cookie: session });
    expect(logout.statusCode).toBe(204);
    expect((await h.request('GET', '/v1/me', { cookie: session })).statusCode).toBe(401);
    expect(await authEvents(h.ids.userA)).toEqual(
      expect.arrayContaining(['login.succeeded', 'logout.succeeded']),
    );
  });

  it('locks the account progressively after repeated failures and audits the lockout', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await h.request('POST', '/v1/auth/login', {
        payload: { identifier: h.emails.b, password: 'wrong-password-123' },
      });
      expect(failed.statusCode).toBe(401);
    }
    // The correct password is refused with the same generic error while locked.
    const locked = await h.request('POST', '/v1/auth/login', {
      payload: { identifier: h.emails.b, password },
    });
    expect(locked.statusCode).toBe(401);
    expect(locked.json<{ code: string }>().code).toBe('AUTH_INVALID_CREDENTIALS');

    const user = await h.admin.query<{ failed_login_count: number; locked_seconds: number }>(
      `select failed_login_count, extract(epoch from locked_until - now())::int as locked_seconds
         from users where id = $1`,
      [h.ids.userB],
    );
    expect(user.rows[0]?.failed_login_count).toBe(5);
    expect(user.rows[0]?.locked_seconds).toBeGreaterThan(800);
    expect(await authEvents(h.ids.userB)).toContain('login.locked');

    await h.admin.query(
      "update users set locked_until = now() - interval '1 second' where id = $1",
      [h.ids.userB],
    );
    const afterLock = await h.request('POST', '/v1/auth/login', {
      payload: { identifier: h.emails.b, password },
    });
    expect(afterLock.statusCode).toBe(200);
    const reset = await h.admin.query<{ failed_login_count: number; locked_until: Date | null }>(
      'select failed_login_count, locked_until from users where id = $1',
      [h.ids.userB],
    );
    expect(reset.rows[0]).toEqual({ failed_login_count: 0, locked_until: null });
  });

  it('changes the password, revokes every session and rotates the current one', async () => {
    const first = await h.login(h.emails.a);
    const second = await h.login(h.emails.a);

    const wrongCurrent = await h.request('POST', '/v1/me/password', {
      cookie: first,
      payload: { currentPassword: 'not-the-password', newPassword: 'another-strong-pass-1' },
    });
    expect(wrongCurrent.statusCode).toBe(400);
    expect(wrongCurrent.json<{ code: string }>().code).toBe('AUTH_CURRENT_PASSWORD_INVALID');

    const weak = await h.request('POST', '/v1/me/password', {
      cookie: first,
      payload: { currentPassword: password, newPassword: 'short' },
    });
    expect(weak.json<{ code: string }>().code).toBe('AUTH_PASSWORD_POLICY');

    const crossOrigin = await h.request('POST', '/v1/me/password', {
      cookie: first,
      origin: 'https://attacker.invalid',
      payload: { currentPassword: password, newPassword: 'another-strong-pass-1' },
    });
    expect(crossOrigin.statusCode).toBe(403);

    const changed = await h.request('POST', '/v1/me/password', {
      cookie: first,
      payload: { currentPassword: password, newPassword: 'another-strong-pass-1' },
    });
    expect(changed.statusCode).toBe(204);
    const rotated = setCookieOf(changed);
    expect(rotated).not.toBe(first);

    expect((await h.request('GET', '/v1/me', { cookie: first })).statusCode).toBe(401);
    expect((await h.request('GET', '/v1/me', { cookie: second })).statusCode).toBe(401);
    expect((await h.request('GET', '/v1/me', { cookie: rotated })).statusCode).toBe(200);
    await expect(h.login(h.emails.a)).rejects.toThrow();
    await h.login(h.emails.a, 'another-strong-pass-1');
    expect(await authEvents(h.ids.userA)).toEqual(
      expect.arrayContaining(['password.changed', 'sessions.revoked']),
    );
  });

  it('resets a password with a single-use token and revokes all sessions', async () => {
    const before = await h.login(h.emails.a, 'another-strong-pass-1');

    const unknown = await h.request('POST', '/v1/auth/password/reset-request', {
      payload: { identifier: `missing-${h.suffix}@example.test` },
    });
    const known = await h.request('POST', '/v1/auth/password/reset-request', {
      payload: { identifier: h.emails.a },
    });
    // Same generic answer whether or not the account exists.
    expect(unknown.statusCode).toBe(202);
    expect(known.statusCode).toBe(202);
    expect(unknown.body).toBe(known.body);
    expect(h.delivery.messages.at(-1)?.email).toBe(h.emails.a);
    const token = h.delivery.lastToken();
    expect(token.length).toBeGreaterThan(30);

    const stored = await h.admin.query<{ token_digest: string }>(
      'select token_digest from password_reset_tokens where user_id = $1',
      [h.ids.userA],
    );
    expect(stored.rows.map((row) => row.token_digest)).not.toContain(token);

    const reset = await h.request('POST', '/v1/auth/password/reset', {
      payload: { token, newPassword: 'reset-strong-password-2' },
    });
    expect(reset.statusCode).toBe(204);
    const reused = await h.request('POST', '/v1/auth/password/reset', {
      payload: { token, newPassword: 'reset-strong-password-3' },
    });
    expect(reused.statusCode).toBe(400);
    expect(reused.json<{ code: string }>().code).toBe('AUTH_RESET_TOKEN_INVALID');

    expect((await h.request('GET', '/v1/me', { cookie: before })).statusCode).toBe(401);
    await h.login(h.emails.a, 'reset-strong-password-2');
    expect(await authEvents(h.ids.userA)).toEqual(
      expect.arrayContaining(['password.reset_requested', 'password.reset_completed']),
    );
  });

  it('rejects expired and superseded reset tokens', async () => {
    await h.request('POST', '/v1/auth/password/reset-request', {
      payload: { identifier: h.emails.a },
    });
    const superseded = h.delivery.lastToken();
    await h.request('POST', '/v1/auth/password/reset-request', {
      payload: { identifier: h.emails.a },
    });
    const latest = h.delivery.lastToken();
    const old = await h.request('POST', '/v1/auth/password/reset', {
      payload: { token: superseded, newPassword: 'superseded-password-4' },
    });
    expect(old.statusCode).toBe(400);

    await h.admin.query(
      `update password_reset_tokens set expires_at = now() - interval '1 second'
        where user_id = $1 and consumed_at is null`,
      [h.ids.userA],
    );
    const expired = await h.request('POST', '/v1/auth/password/reset', {
      payload: { token: latest, newPassword: 'expired-password-5' },
    });
    expect(expired.statusCode).toBe(400);
  });

  it('revokes every session with DELETE /me/sessions', async () => {
    const one = await h.login(h.emails.a, 'reset-strong-password-2');
    const two = await h.login(h.emails.a, 'reset-strong-password-2');
    const revoked = await h.request('DELETE', '/v1/me/sessions', { cookie: one });
    expect(revoked.statusCode).toBe(204);
    expect((await h.request('GET', '/v1/me', { cookie: one })).statusCode).toBe(401);
    expect((await h.request('GET', '/v1/me', { cookie: two })).statusCode).toBe(401);
    const open = await h.admin.query<{ count: string }>(
      'select count(*) from sessions where user_id = $1 and revoked_at is null',
      [h.ids.userA],
    );
    expect(open.rows[0]?.count).toBe('0');
  });
});
