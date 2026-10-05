import { describe, expect, it } from 'vitest';

import { safeHref } from './[projectId]/business-content';
import { businessMessages, joinList, sectionTitle } from './business-messages';

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('business messages', () => {
  it('has the same keys in both languages', () => {
    expect(keysOf(businessMessages('fa')).sort()).toEqual(keysOf(businessMessages('en')).sort());
  });

  it('names the 15 profile sections in both languages', () => {
    for (const locale of ['fa', 'en'] as const) {
      expect(Object.keys(businessMessages(locale).profile.sections)).toHaveLength(15);
    }
  });

  it('shows a section key the page does not know as it is', () => {
    expect(sectionTitle('en', 'FUTURE_SECTION')).toBe('FUTURE_SECTION');
    expect(sectionTitle('en', 'OVERVIEW')).toBe('Overview');
  });

  it('joins names with the separator of the language', () => {
    expect(joinList('en', ['a', 'b'])).toBe('a, b');
    expect(joinList('fa', ['a', 'b'])).toBe('a، b');
  });
});

describe('safeHref', () => {
  it('links web addresses only', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('http://example.com')).toBe('http://example.com');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('not a link')).toBeNull();
    expect(safeHref('')).toBeNull();
  });
});
