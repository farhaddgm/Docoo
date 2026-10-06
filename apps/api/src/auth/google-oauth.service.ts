import { Inject, Injectable } from '@nestjs/common';
import type { Environment } from '@docoo/config';
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';
import { API_CONFIG } from '../tokens.js';

export const googleErrors = [
  'not_configured',
  'cancelled',
  'expired',
  'not_gmail',
  'not_allowed',
  'inactive',
  'failed',
] as const;
export class GoogleAuthError extends Error {
  constructor(readonly code: (typeof googleErrors)[number]) {
    super(code);
  }
}
export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  hostedDomain?: string;
  name?: string;
}
interface Flow {
  state: string;
  verifier: string;
  nonce: string;
  redirectTo: string;
  expires: number;
}
export function safeRedirectPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\r\n]/.test(value)
  )
    return '/fa';
  return value;
}
@Injectable()
export class GoogleOAuthService {
  private keys: Map<string, KeyObject> = new Map();
  private keysExpireAt = 0;
  readonly flowMaxAgeSeconds = 600;
  constructor(@Inject(API_CONFIG) private readonly config: Environment) {}
  get enabled() {
    return !!(
      this.config.GOOGLE_CLIENT_ID &&
      this.config.GOOGLE_CLIENT_SECRET &&
      this.config.GOOGLE_REDIRECT_URI
    );
  }
  private signature(value: string) {
    return createHmac('sha256', this.config.SESSION_PEPPER)
      .update(`google-oauth:${value}`)
      .digest('base64url');
  }
  start(redirectTo: unknown): { url: string; flowToken: string } {
    if (!this.enabled) throw new GoogleAuthError('not_configured');
    const flow: Flow = {
      state: randomBytes(24).toString('base64url'),
      verifier: randomBytes(48).toString('base64url'),
      nonce: randomBytes(24).toString('base64url'),
      redirectTo: safeRedirectPath(redirectTo),
      expires: Date.now() + 600_000,
    };
    const body = Buffer.from(JSON.stringify(flow)).toString('base64url');
    const query = new URLSearchParams({
      client_id: this.config.GOOGLE_CLIENT_ID,
      redirect_uri: this.config.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`,
      flowToken: `${body}.${this.signature(body)}`,
    };
  }
  async finish(
    query: { code?: string; state?: string; error?: string },
    token: string | undefined,
  ) {
    if (!this.enabled) throw new GoogleAuthError('not_configured');
    if (query.error) throw new GoogleAuthError('cancelled');
    let flow: Flow;
    try {
      const [body, signature, extra] = (token ?? '').split('.');
      if (!body || !signature || extra) throw new Error();
      const expected = Buffer.from(this.signature(body));
      const actual = Buffer.from(signature);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new Error();
      flow = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Flow;
      if (flow.expires <= Date.now() || !query.code || query.state !== flow.state)
        throw new Error();
    } catch {
      throw new GoogleAuthError('expired');
    }
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: query.code,
          client_id: this.config.GOOGLE_CLIENT_ID,
          client_secret: this.config.GOOGLE_CLIENT_SECRET,
          redirect_uri: this.config.GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code',
          code_verifier: flow.verifier,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.json()) as { id_token?: string };
      if (!response.ok || !body.id_token) throw new Error();
      const parts = body.id_token.split('.');
      if (parts.length !== 3) throw new Error();
      const [h, p, s] = parts as [string, string, string];
      const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as {
        alg: string;
        kid: string;
      };
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
      if (Date.now() >= this.keysExpireAt || !this.keys.has(header.kid)) {
        const keysResponse = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
          signal: AbortSignal.timeout(10_000),
        });
        if (!keysResponse.ok) throw new Error();
        const jwks = (await keysResponse.json()) as { keys: (JsonWebKey & { kid: string })[] };
        this.keys = new Map(
          jwks.keys.map((key) => [key.kid, createPublicKey({ key, format: 'jwk' })]),
        );
        this.keysExpireAt = Date.now() + 3_600_000;
      }
      const key = this.keys.get(header.kid);
      if (
        header.alg !== 'RS256' ||
        !key ||
        !verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url')) ||
        !['accounts.google.com', 'https://accounts.google.com'].includes(String(claims['iss'])) ||
        claims['aud'] !== this.config.GOOGLE_CLIENT_ID ||
        typeof claims['exp'] !== 'number' ||
        claims['exp'] < Date.now() / 1000 - 60 ||
        claims['nonce'] !== flow.nonce ||
        typeof claims['sub'] !== 'string' ||
        typeof claims['email'] !== 'string'
      )
        throw new Error();
      const identity: GoogleIdentity = {
        sub: claims['sub'],
        email: claims['email'].toLowerCase(),
        emailVerified: claims['email_verified'] === true || claims['email_verified'] === 'true',
        ...(typeof claims['hd'] === 'string' ? { hostedDomain: claims['hd'] } : {}),
        ...(typeof claims['name'] === 'string' ? { name: claims['name'] } : {}),
      };
      return { identity, redirectTo: safeRedirectPath(flow.redirectTo) };
    } catch {
      throw new GoogleAuthError('failed');
    }
  }
}
