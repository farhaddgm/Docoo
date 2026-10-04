import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, uploadOrigin } from './content-security-policy';

describe('content security policy', () => {
  it('is same-origin only without a files host', () => {
    const policy = contentSecurityPolicy({});
    expect(policy).toContain("connect-src 'self';");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it('lets pages call the files host, and only its origin', () => {
    const policy = contentSecurityPolicy({
      S3_PUBLIC_ENDPOINT: 'https://files.example.test/bucket',
    });
    expect(policy).toContain("connect-src 'self' https://files.example.test;");
    // Nothing else is opened up.
    expect(policy).toContain("script-src 'self' 'unsafe-inline';");
    expect(policy).toContain("img-src 'self' data: blob:;");
    expect(policy).not.toContain('bucket');
  });

  it('keeps the port of a local object store', () => {
    expect(uploadOrigin('http://localhost:8333')).toBe('http://localhost:8333');
  });

  it('ignores anything that is not an http(s) origin', () => {
    for (const value of [
      undefined,
      '',
      'not a url',
      'javascript:alert(1)',
      'ftp://files.example.test',
      'data:text/html,x',
    ]) {
      expect(uploadOrigin(value), String(value)).toBeNull();
      expect(contentSecurityPolicy({ S3_PUBLIC_ENDPOINT: value })).toContain("connect-src 'self';");
    }
  });
});
