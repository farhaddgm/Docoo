import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './environment.js';

describe('environment configuration', () => {
  it('parses a complete minimal environment', () => {
    const config = parseEnvironment({
      SESSION_PEPPER: 'a-development-only-pepper-with-32-characters',
    });

    expect(config.API_PORT).toBe(4000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.PASSWORD_ARGON2_MEMORY_KIB).toBe(19_456);
    expect(config.PASSWORD_ARGON2_ITERATIONS).toBe(2);
    expect(config.PASSWORD_ARGON2_PARALLELISM).toBe(1);
  });

  it('rejects a short session pepper', () => {
    expect(() => parseEnvironment({ SESSION_PEPPER: 'short' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('rejects Argon2 settings below the minimum profile', () => {
    expect(() =>
      parseEnvironment({
        SESSION_PEPPER: 'a-development-only-pepper-with-32-characters',
        PASSWORD_ARGON2_MEMORY_KIB: '1024',
      }),
    ).toThrow('Invalid environment configuration');
  });
});
