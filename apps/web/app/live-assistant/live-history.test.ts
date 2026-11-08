import { describe, expect, it } from 'vitest';

import { groupSessions, isCostSummary } from './live-history';

const period = { costUsd: 1, typedCostUsd: 0, tokens: 10, sessions: 1 };

describe('the cost summary the history screen accepts', () => {
  it('takes a whole summary', () => {
    expect(isCostSummary({ day: period, week: period, month: period, dailyCapUsd: 20 })).toBe(true);
  });

  it('ignores anything else, so a stand-in or broken answer never breaks the page', () => {
    for (const value of [
      null,
      undefined,
      'x',
      [],
      {},
      { items: [], data: [] },
      { day: period, week: period, dailyCapUsd: 20 },
      { day: period, week: period, month: { ...period, sessions: 'many' }, dailyCapUsd: 20 },
      { day: period, week: period, month: period },
    ]) {
      expect(isCostSummary(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('the age groups of the conversation list', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const hoursAgo = (h: number) => ({ startedAt: new Date(now - h * 3_600_000).toISOString() });

  it('puts each conversation under its age and leaves empty groups out', () => {
    const groups = groupSessions([hoursAgo(1), hoursAgo(23), hoursAgo(25), hoursAgo(24 * 40)], now);
    expect(groups.map((group) => [group.key, group.sessions.length])).toEqual([
      ['day', 2],
      ['week', 1],
      ['older', 1],
    ]);
  });

  it('draws the lines at 24 hours, 7 days and 30 days', () => {
    const keys = [hoursAgo(24 * 7 - 1), hoursAgo(24 * 7), hoursAgo(24 * 30 - 1), hoursAgo(24 * 30)];
    expect(groupSessions(keys, now).map((group) => group.key)).toEqual(['week', 'month', 'older']);
  });

  it('keeps the order it was given inside a group', () => {
    const [a, b] = [hoursAgo(1), hoursAgo(2)];
    expect(groupSessions([a, b], now)[0]?.sessions).toEqual([a, b]);
  });

  it('is empty for no conversations', () => {
    expect(groupSessions([], now)).toEqual([]);
  });
});
