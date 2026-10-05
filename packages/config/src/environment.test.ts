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

  it('keeps sign-in at ten a minute unless a test run asks for more, and never below three', () => {
    const base = { SESSION_PEPPER: 'a-development-only-pepper-with-32-characters' };
    expect(parseEnvironment(base).AUTH_RATE_LIMIT_PER_MINUTE).toBe(10);
    expect(
      parseEnvironment({ ...base, AUTH_RATE_LIMIT_PER_MINUTE: '1000' }).AUTH_RATE_LIMIT_PER_MINUTE,
    ).toBe(1000);
    expect(() => parseEnvironment({ ...base, AUTH_RATE_LIMIT_PER_MINUTE: '2' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('takes the price catalog address only as https, and an empty value means the default', () => {
    const base = { SESSION_PEPPER: 'a-development-only-pepper-with-32-characters' };
    expect(parseEnvironment(base).MODEL_PRICE_CATALOG_URL).toBeUndefined();
    expect(parseEnvironment({ ...base, MODEL_PRICE_CATALOG_URL: '' }).MODEL_PRICE_CATALOG_URL).toBe(
      undefined,
    );
    expect(
      parseEnvironment({ ...base, MODEL_PRICE_CATALOG_URL: 'https://prices.example/c.json' })
        .MODEL_PRICE_CATALOG_URL,
    ).toBe('https://prices.example/c.json');
    expect(
      parseEnvironment({ ...base, MODEL_PRICE_CATALOG_URL: 'http://127.0.0.1:4010/c.json' })
        .MODEL_PRICE_CATALOG_URL,
    ).toBe('http://127.0.0.1:4010/c.json');
    for (const url of ['http://prices.example/c.json', 'http://localhost.evil.example/c.json']) {
      expect(() => parseEnvironment({ ...base, MODEL_PRICE_CATALOG_URL: url })).toThrow(
        'Invalid environment configuration',
      );
    }
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
