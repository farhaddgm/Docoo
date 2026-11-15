import { describe, expect, it } from 'vitest';

import { checkSearchQuery, SEARCH_QUERY_LIMITS } from './search-query-guard.js';

const reason = (query: string) => {
  const result = checkSearchQuery(query);
  return result.ok ? null : result.reason;
};

describe('a query that may leave the system', () => {
  it.each([
    'build versus buy decision framework for logistics software',
    'قیمت‌گذاری نرم‌افزار سازمانی در بازار ایران ۱۴۰۳',
    'SaaS churn benchmark 2019-2024 B2B',
    'market growth 12.5 14.3 15.8 percent per year',
    'ISO 27001 certification cost for 200 employees',
    'GDPR Article 28 processor obligations',
  ])('passes: %s', (query) => {
    expect(checkSearchQuery(query)).toEqual({ ok: true, query });
  });

  it('collapses whitespace and caps the length', () => {
    const result = checkSearchQuery(`  what   is   ${'x'.repeat(600)}  `);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query.length).toBe(SEARCH_QUERY_LIMITS.max);
      expect(result.query.startsWith('what is ')).toBe(true);
    }
  });
});

describe('a query that must not leave the system', () => {
  it.each([
    ['too_short', 'ab'],
    ['email', 'contact for pricing: ali.rezaei@acme-corp.com about the tender'],
    ['email', 'ایمیل مدیر manager@شرکت.com را بررسی کن'],
    ['phone_or_id_number', 'call 0912 345 6789 about supplier'],
    ['phone_or_id_number', 'شماره ۰۹۱۲۳۴۵۶۷۸۹ مدیر فروش'],
    ['phone_or_id_number', 'national id 0012345678 of the owner'],
    ['phone_or_id_number', '+98 21 8888 1234 office'],
    ['card_number', 'card 4539 1488 0343 6467 was charged'],
    ['internal_address', 'why does http://localhost:8080/admin fail'],
    ['internal_address', 'status of crm.corp and 10.0.4.17 servers'],
    ['internal_address', 'host 192.168.1.20 backup'],
    ['internal_address', 'wiki.internal outage'],
    ['secret_like', 'key sk-proj-AbCdEf1234567890XyZ failed'],
    ['secret_like', 'token: abc123def456 rotation'],
    ['secret_like', 'user 3f2b8c1e-9a4d-4e7f-b1a2-5c6d7e8f9a0b churn'],
    ['secret_like', 'the value Zx9fQ2kLm8Rt4Vb7Nc1Pw6Yh3Jd5Sa0 appears'],
  ] as const)('refuses as %s: %s', (expected, query) => {
    expect(reason(query)).toBe(expected);
  });

  it('never repeats the refused text in its answer', () => {
    const secret = 'ali.rezaei@acme-corp.com';
    expect(JSON.stringify(checkSearchQuery(`price ${secret}`))).not.toContain('acme');
  });
});
