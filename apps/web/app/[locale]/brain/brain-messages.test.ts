import { describe, expect, it } from 'vitest';

import { brainMessages, fill } from './brain-messages';

const keys = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
    : [prefix];
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]);

describe('Brain page messages', () => {
  it('Persian and English have the same keys', () => {
    expect(keys(brainMessages('en')).sort()).toEqual(keys(brainMessages('fa')).sort());
  });

  it('every sentence uses the same placeholders in both languages', () => {
    const fa = brainMessages('fa').kinds;
    const en = brainMessages('en').kinds;
    for (const kind of Object.keys(fa)) {
      expect(placeholders(en[kind]!.body).sort(), kind).toEqual(
        placeholders(fa[kind]!.body).sort(),
      );
      expect(placeholders(en[kind]!.title).sort(), kind).toEqual(
        placeholders(fa[kind]!.title).sort(),
      );
    }
  });

  it('names every action kind the API can propose', () => {
    for (const locale of ['fa', 'en'] as const) {
      const words = brainMessages(locale);
      for (const kind of [
        'open_knowledge',
        'open_conflicts',
        'open_project',
        'open_costs',
        'open_providers',
        'open_agent',
        'audit_knowledge',
        'request_revision',
        'pause_project',
      ]) {
        expect(words.actions[kind], `${locale} ${kind}`).toBeTruthy();
      }
      for (const kind of ['audit_knowledge', 'request_revision', 'pause_project'])
        expect(words.confirmText[kind]).toBeTruthy();
    }
  });

  it('fills placeholders', () => {
    expect(fill('{n} of {m}', { n: 1, m: 'x' })).toBe('1 of x');
  });
});
