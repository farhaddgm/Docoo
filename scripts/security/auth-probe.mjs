// Scripted penetration test of the authentication path (SEC-002), run against a started API
// with its production middleware (helmet, CORS, rate limits). Exits non-zero on any finding.
import assert from 'node:assert/strict';

const api = (process.env.DAST_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/u, '');
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const email = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password-1';
// Each request claims a different client address to show that spoofing it gains nothing.
let client = 10;
const nextClient = () => `198.51.100.${(client += 1)}`;

async function call(
  path,
  { method = 'GET', body, cookie, from = origin, ip = nextClient(), headers = {} } = {},
) {
  const response = await fetch(`${api}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(from
        ? { origin: from, 'sec-fetch-site': from === origin ? 'same-origin' : 'cross-site' }
        : {}),
      ...(cookie ? { cookie } : {}),
      'x-forwarded-for': ip,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, headers: response.headers, text, json };
}

const results = [];
async function check(name, run) {
  try {
    await run();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const login = (identifier, secret, extra = {}) =>
  call('/v1/auth/login', { method: 'POST', body: { identifier, password: secret }, ...extra });

await check('no user enumeration: unknown user and wrong password look the same', async () => {
  const unknown = await login(`nobody-${Date.now()}@example.test`, 'wrong-password-123');
  const wrong = await login(email, 'wrong-password-123');
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, unknown.status);
  assert.deepEqual(wrong.json, unknown.json);
});

await check('no user enumeration: reset request answers the same for unknown users', async () => {
  const known = await call('/v1/auth/password/reset-request', { method: 'POST', body: { email } });
  const unknown = await call('/v1/auth/password/reset-request', {
    method: 'POST',
    body: { email: `nobody-${Date.now()}@example.test` },
  });
  assert.equal(known.status, unknown.status);
  assert.equal(known.text, unknown.text);
});

let session = '';
await check('session cookie is HttpOnly, SameSite and scoped to the site', async () => {
  const response = await login(email, password);
  assert.equal(response.status, 200, response.text);
  const cookie = response.headers.get('set-cookie') ?? '';
  assert.match(cookie, /HttpOnly/iu);
  assert.match(cookie, /SameSite=(Lax|Strict)/iu);
  assert.match(cookie, /Path=\//iu);
  assert.doesNotMatch(cookie, /Domain=/iu);
  session = cookie.split(';')[0];
  assert.ok(session.length > 20);
  assert.ok(!JSON.stringify(response.json).includes(session.split('=')[1]), 'token echoed in body');
});

await check('session fixation: a planted cookie is never adopted', async () => {
  const planted = `${session.split('=')[0]}=attacker-chosen-value`;
  const response = await login(email, password, { cookie: planted });
  assert.equal(response.status, 200);
  const issued = (response.headers.get('set-cookie') ?? '').split(';')[0];
  assert.notEqual(issued, planted);
  assert.equal((await call('/v1/me', { cookie: planted })).status, 401);
});

await check('tampered and truncated session tokens are rejected', async () => {
  const [name, value] = session.split('=');
  const flipped = `${name}=${value.slice(0, -2)}${value.endsWith('A') ? 'B' : 'A'}${value.slice(-1)}`;
  assert.equal((await call('/v1/me', { cookie: flipped })).status, 401);
  assert.equal((await call('/v1/me', { cookie: `${name}=${value.slice(0, 10)}` })).status, 401);
  assert.equal((await call('/v1/me', { cookie: session })).status, 200);
});

await check('cross-origin state changes are refused (CSRF)', async () => {
  const response = await call('/v1/auth/logout', {
    method: 'POST',
    cookie: session,
    from: 'https://evil.example',
  });
  assert.equal(response.status, 403);
  assert.equal((await call('/v1/me', { cookie: session })).status, 200);
});

await check('CORS does not allow foreign origins with credentials', async () => {
  const response = await call('/v1/me', {
    cookie: session,
    from: 'https://evil.example',
    method: 'OPTIONS',
    headers: { 'access-control-request-method': 'GET' },
  });
  const allowed = response.headers.get('access-control-allow-origin');
  assert.ok(allowed !== 'https://evil.example' && allowed !== '*', `allowed origin ${allowed}`);
});

await check('injection-shaped identifiers fail closed without server errors', async () => {
  for (const identifier of [
    "' or 1=1 --",
    'admin@example.test\u0000',
    '{"$ne":null}',
    'a'.repeat(5000),
  ]) {
    const response = await login(identifier, "' or '1'='1");
    assert.ok(
      [400, 401].includes(response.status),
      `${response.status} for ${identifier.slice(0, 20)}`,
    );
  }
});

await check('security headers are set on API responses', async () => {
  const response = await call('/v1/health/live');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(
    response.headers.get('x-frame-options') || response.headers.get('content-security-policy'),
  );
  assert.equal(response.headers.get('x-powered-by'), null);
});

await check('errors do not leak stack traces or SQL', async () => {
  const response = await call('/v1/workspaces/not-a-uuid/projects', { cookie: session });
  assert.ok(response.status >= 400 && response.status < 500);
  assert.doesNotMatch(response.text, /at .*\.js:\d+|select |postgres|stack/iu);
});

await check('logout revokes the session server-side', async () => {
  const fresh = (await login(email, password)).headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.ok(fresh.includes('='), 'no session issued');
  assert.equal((await call('/v1/me', { cookie: fresh })).status, 200);
  assert.equal((await call('/v1/auth/logout', { method: 'POST', cookie: fresh })).status, 204);
  assert.equal((await call('/v1/me', { cookie: fresh })).status, 401);
});

await check(
  'brute force on login is rate limited and X-Forwarded-For cannot bypass it',
  async () => {
    // Every attempt claims a new client address; the limit must still hold because the API
    // does not trust a client-supplied X-Forwarded-For.
    const statuses = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push((await login(`brute-${attempt}@example.test`, 'wrong-password-123')).status);
    }
    const limited = statuses.findIndex((status) => status === 429 || status === 403);
    assert.ok(limited >= 0, `never limited: ${statuses.join(',')}`);
    assert.ok(
      statuses.slice(limited).every((status) => status === 429 || status === 403),
      statuses.join(','),
    );
    assert.ok(statuses.filter((status) => status === 401).length <= 10, statuses.join(','));
  },
);

for (const result of results) {
  console.log(
    `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.ok ? '' : `\n      ${result.error}`}`,
  );
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} auth-path checks passed.`);
process.exit(failed === 0 ? 0 : 1);
