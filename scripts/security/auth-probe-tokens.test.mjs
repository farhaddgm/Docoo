import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { tamperSessionToken } from './auth-probe-tokens.mjs';

test('SEC-002: the tampering probe changes a valid token whose penultimate character is A', () => {
  const token = `${'A'.repeat(41)}AE`;
  const changed = tamperSessionToken(token);
  assert.notEqual(changed, token);
  assert.equal(changed.length, token.length);
  assert.match(changed, /^[A-Za-z0-9_-]{43}$/u);
});

test('SEC-002: every canonical 32-byte token ending produces a different stored digest', () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const digest = (value) =>
    createHmac('sha256', 'synthetic-probe-regression-only').update(value).digest('hex');
  for (const penultimate of alphabet)
    for (const final of 'AEIMQUYcgkosw048') {
      const token = `${'A'.repeat(41)}${penultimate}${final}`;
      assert.equal(Buffer.from(token, 'base64url').toString('base64url'), token);
      assert.notEqual(digest(tamperSessionToken(token)), digest(token));
    }
});
