import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, rewrapSecret, masterKeyFromEnv } from './secrets.js';
describe('master-key rotation', () => {
  it('retains old-record readability, rewrites only envelopes and survives retiring the old key', () => {
    const old = { id: 'old', key: Buffer.alloc(32, 1) };
    const current = {
      id: 'current',
      key: Buffer.alloc(32, 2),
      previous: new Map([['old', old.key]]),
    };
    const original = encryptSecret('private-test-key', old, 'connection:1');
    expect(decryptSecret(original, current, 'connection:1')).toBe('private-test-key');
    const rotated = rewrapSecret(original, current, 'connection:1');
    expect(rotated.ciphertext).toBe(original.ciphertext);
    expect(rotated.keyId).toBe('current');
    expect(decryptSecret(rotated, { id: current.id, key: current.key }, 'connection:1')).toBe(
      'private-test-key',
    );
    expect(() => decryptSecret(rotated, current, 'different-connection')).toThrow();
    expect(() =>
      decryptSecret(original, { id: current.id, key: current.key }, 'connection:1'),
    ).toThrow();
  });
  it('rejects malformed historical keys', () => {
    expect(() =>
      masterKeyFromEnv({
        SECRET_MASTER_KEY: Buffer.alloc(32).toString('base64'),
        SECRET_PREVIOUS_MASTER_KEYS: '{"old":"bad"}',
      }),
    ).toThrow();
  });
});
