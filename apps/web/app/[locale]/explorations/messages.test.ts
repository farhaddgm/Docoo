import { describe, expect, it } from 'vitest';

import { explorationMessages, fill } from './messages';

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('exploration messages', () => {
  it('has the same keys in both languages', () => {
    expect(keysOf(explorationMessages('fa')).sort()).toEqual(
      keysOf(explorationMessages('en')).sort(),
    );
  });

  it('explains every error the API can answer with', () => {
    for (const locale of ['fa', 'en'] as const) {
      const errors = explorationMessages(locale).errors;
      for (const code of [
        'AI_NOT_CONFIGURED',
        'EXPLORATION_NOT_FOUND',
        'EXPLORATION_ARCHIVED',
        'EXPLORATION_VERSION_CONFLICT',
        'EXPLORATION_MESSAGE_LIMIT',
        'EXPLORATION_CANDIDATE_LIMIT',
        'EXPLORATION_CANDIDATE_DUPLICATE',
        'EXPLORATION_CANDIDATE_VERSION_CONFLICT',
        'EXPLORATION_PROPOSAL_FAILED',
        'AUTH_AI_LIMIT_REACHED',
      ]) {
        expect(errors[code], `${locale} ${code}`).toBeTruthy();
      }
    }
  });

  it('fills placeholders and leaves none behind', () => {
    expect(fill(explorationMessages('en').messageCount, { used: '3', max: '40' })).toBe(
      '3 of 40 messages',
    );
    expect(fill('{a} {b}', { a: 'x' })).toBe('x ');
  });
});
