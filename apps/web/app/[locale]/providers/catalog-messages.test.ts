import { describe, expect, it } from 'vitest';

import { catalogMessages } from './catalog-messages';

/** The same keys in both languages, recursively, and every placeholder the code fills. */
function shape(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return typeof value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => [key, shape(item)]),
  );
}
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/gu)].map((m) => m[1]).sort();

describe('catalog price messages', () => {
  const fa = catalogMessages('fa');
  const en = catalogMessages('en');

  it('has the same keys in Persian and English', () => {
    expect(shape(fa)).toEqual(shape(en));
  });

  it('uses the same placeholders in both languages', () => {
    for (const key of ['info', 'retiring', 'cachedOf', 'reasoningOf', 'save', 'saved'] as const) {
      expect(placeholders(fa[key]), key).toEqual(placeholders(en[key]));
      expect(placeholders(fa[key]).length, key).toBeGreaterThan(0);
    }
  });

  it('explains every error code the price endpoints answer with', () => {
    for (const text of [fa, en]) {
      expect(Object.keys(text.errors).sort()).toEqual([
        'PRICE_CATALOG_CHANGED',
        'PRICE_CATALOG_NO_MATCH',
        'PRICE_CATALOG_UNAVAILABLE',
      ]);
      expect(Object.keys(text.statuses).sort()).toEqual([
        'changed',
        'new',
        'none',
        'same',
        'unusable',
      ]);
      expect(Object.keys(text.reasons).sort()).toEqual(['no_price', 'zero_price']);
    }
  });
});
