import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnvironment } from '@docoo/config';
import { GoogleOAuthService, safeRedirectPath } from '../src/auth/google-oauth.service.js';
const config = parseEnvironment({
  SESSION_PEPPER: 'google-auth-unit-test-pepper-32-characters',
  GOOGLE_CLIENT_ID: 'docoo-test-client',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/auth/google/callback',
});
afterEach(() => vi.unstubAllGlobals());
function fixture(claimChanges: Record<string, unknown> = {}) {
  const service = new GoogleOAuthService(config);
  const flow = service.start('/en/projects');
  const url = new URL(flow.url);
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const p = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: config.GOOGLE_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: url.searchParams.get('nonce'),
      sub: 'google-user-id',
      email: 'approved@gmail.com',
      email_verified: true,
      ...claimChanges,
    }),
  ).toString('base64url');
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${h}.${p}`),
    createPrivateKey(pair.privateKey.export({ format: 'pem', type: 'pkcs8' })),
  ).toString('base64url');
  const fetch = vi.fn((input: string, options?: RequestInit) => {
    expect(options?.signal).toBeDefined();
    return Promise.resolve(
      input.includes('/token')
        ? new Response(JSON.stringify({ id_token: `${h}.${p}.${signature}` }), { status: 200 })
        : new Response(
            JSON.stringify({
              keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'test-key' }],
            }),
            { status: 200 },
          ),
    );
  });
  vi.stubGlobal('fetch', fetch);
  return { service, flow, url, fetch };
}
describe('Google OIDC', () => {
  it('requests only identity scopes and PKCE, verifies the signed identity and returns an internal redirect', async () => {
    const f = fixture();
    expect(f.url.searchParams.get('scope')).toBe('openid email profile');
    expect(f.url.searchParams.get('prompt')).toBe('select_account');
    expect(f.url.searchParams.get('code_challenge_method')).toBe('S256');
    const result = await f.service.finish(
      { code: 'authorization-code', state: f.url.searchParams.get('state')! },
      f.flow.flowToken,
    );
    expect(result).toMatchObject({
      identity: { sub: 'google-user-id', email: 'approved@gmail.com', emailVerified: true },
      redirectTo: '/en/projects',
    });
    const exchange = f.fetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(exchange.get('code_verifier')).toBeTruthy();
  });
  it.each([
    { aud: 'another-client' },
    { iss: 'https://attacker.invalid' },
    { nonce: 'wrong-nonce' },
    { exp: 1 },
  ])('rejects incorrect identity claims: %j', async (changes) => {
    const f = fixture(changes);
    await expect(
      f.service.finish({ code: 'code', state: f.url.searchParams.get('state')! }, f.flow.flowToken),
    ).rejects.toMatchObject({ code: 'failed' });
  });
  it('rejects a tampered flow cookie and mismatched state before exchanging any code', async () => {
    const f = fixture();
    await expect(
      f.service.finish({ code: 'code', state: 'wrong' }, f.flow.flowToken),
    ).rejects.toMatchObject({ code: 'expired' });
    await expect(
      f.service.finish(
        { code: 'code', state: f.url.searchParams.get('state')! },
        `${f.flow.flowToken}x`,
      ),
    ).rejects.toMatchObject({ code: 'expired' });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('rejects an expired flow cookie and cancelled Google consent', async () => {
    const f = fixture();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601000);
    await expect(
      f.service.finish({ code: 'code', state: f.url.searchParams.get('state')! }, f.flow.flowToken),
    ).rejects.toMatchObject({ code: 'expired' });
    vi.restoreAllMocks();
    await expect(f.service.finish({ error: 'access_denied' }, undefined)).rejects.toMatchObject({
      code: 'cancelled',
    });
  });
  it('does not start Google sign-in with incomplete configuration', () =>
    expect(() =>
      new GoogleOAuthService(
        parseEnvironment({ SESSION_PEPPER: 'oauth-unconfigured-pepper-32-characters' }),
      ).start('/fa'),
    ).toThrow('not_configured'));
  it.each([
    'https://attacker.invalid',
    '//attacker.invalid',
    '/\\attacker.invalid',
    '/fa\r\nLocation:evil',
  ])('blocks an external redirect: %s', (value) => expect(safeRedirectPath(value)).toBe('/fa'));
});
