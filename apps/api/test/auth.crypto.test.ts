import { describe, expect, it } from 'vitest';

import { createSessionToken, digestSecret } from '../src/auth/auth.crypto.js';

describe('auth cryptography helpers', () => {
  it('creates opaque session tokens with sufficient random material', () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it('uses a keyed digest so the raw token is not stored in the database', () => {
    const token = createSessionToken();
    const digest = digestSecret(token, 'a-development-only-pepper-with-32-characters');

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toBe(token);
    expect(digestSecret(token, 'a-different-pepper-with-32-characters')).not.toBe(digest);
  });
});
