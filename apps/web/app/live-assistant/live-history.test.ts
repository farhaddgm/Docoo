import { describe, expect, it } from 'vitest';

import { isCostSummary } from './live-history';

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
