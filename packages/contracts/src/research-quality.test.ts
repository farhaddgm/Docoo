import { describe, expect, it } from 'vitest';

import { aggregateModes, MIN_QUALITY_RUNS, type ResearchRunRow } from './research-quality.js';
import { RESEARCH_PRESETS } from './research-presets.js';

const run = (
  mode: keyof typeof RESEARCH_PRESETS | 'custom',
  over: Partial<ResearchRunRow> & { quality?: Record<string, unknown> } = {},
): ResearchRunRow => ({
  resolved: mode === 'custom' ? { 'research.web_max_searches': 7 } : { ...RESEARCH_PRESETS[mode] },
  costUsd: 1,
  seconds: 60,
  quality: {
    summary: { findings: 10, solid: 6, questions: { total: 4, answered: 3 } },
    verification: { citations: 20, verified: 15 },
    web: { rounds: 1 },
    conflicts: 1,
  },
  ...over,
});

describe('aggregateModes (ADR-0052)', () => {
  it('groups runs by the mode their own settings amounted to, in the fixed order', () => {
    const result = aggregateModes([
      run('deep'),
      run('quick'),
      run('custom'),
      run('deep'),
      run('standard'),
    ]);
    expect(result.map((item) => [item.mode, item.runs])).toEqual([
      ['quick', 1],
      ['standard', 1],
      ['deep', 2],
      ['custom', 1],
    ]);
    expect(MIN_QUALITY_RUNS).toBe(3);
  });

  it('counts a run with no recorded settings as the standard mode', () => {
    expect(aggregateModes([{ ...run('standard'), resolved: null }])[0]).toMatchObject({
      mode: 'standard',
      runs: 1,
    });
  });

  it('weights shares by totals, not by the mean of per-run ratios', () => {
    const big = run('standard', {
      quality: {
        summary: { findings: 90, solid: 90, questions: { total: 10, answered: 10 } },
        verification: { citations: 100, verified: 100 },
      },
    });
    const small = run('standard', {
      quality: {
        summary: { findings: 10, solid: 0, questions: { total: 10, answered: 0 } },
        verification: { citations: 100, verified: 0 },
      },
    });
    const [standard] = aggregateModes([big, small]);
    expect(standard!.solidShare).toBeCloseTo(0.9);
    expect(standard!.answeredShare).toBeCloseTo(0.5);
    expect(standard!.verifiedShare).toBeCloseTo(0.5);
  });

  it('averages cost and time over the runs that have them, and prices a solid finding', () => {
    const [deep] = aggregateModes([
      run('deep', { costUsd: 2, seconds: 100 }),
      run('deep', { costUsd: 4, seconds: 200 }),
      run('deep', { costUsd: null, seconds: null }),
    ]);
    expect(deep!.avgCostUsd).toBeCloseTo(3);
    expect(deep!.avgSeconds).toBeCloseTo(150);
    // Priced runs: 2 + 4 dollars over 6 + 6 solid findings.
    expect(deep!.costPerSolidUsd).toBeCloseTo(0.5);
  });

  it('leaves a number out (null) instead of inventing it', () => {
    const unpriced = aggregateModes([run('quick', { costUsd: 0, seconds: 0 })])[0]!;
    expect(unpriced.avgCostUsd).toBeNull();
    expect(unpriced.avgSeconds).toBeNull();
    expect(unpriced.costPerSolidUsd).toBeNull();
    const empty = aggregateModes([run('quick', { quality: {} })])[0]!;
    expect(empty).toMatchObject({
      solidShare: null,
      verifiedShare: null,
      answeredShare: null,
      unanswerablePerRun: 0,
    });
    const noSolid = aggregateModes([
      run('quick', { quality: { summary: { findings: 5, solid: 0 } } }),
    ])[0]!;
    expect(noSolid.costPerSolidUsd).toBeNull();
  });

  it('does not mix an old output without a summary into the solid share', () => {
    const [standard] = aggregateModes([
      run('standard'),
      run('standard', { quality: { verification: { citations: 4, verified: 4 } } }),
    ]);
    expect(standard!.solidShare).toBeCloseTo(0.6);
    expect(standard!.runs).toBe(2);
    expect(standard!.verifiedShare).toBeCloseTo(19 / 24);
  });

  it('counts unanswerable questions, conflicts and rounds per run', () => {
    const [deep] = aggregateModes([
      run('deep', {
        quality: {
          summary: { findings: 1, solid: 1 },
          web: {
            rounds: 3,
            gaps: [
              { id: 'Q1', unanswerable: true },
              { id: 'Q2', unanswerable: false },
            ],
          },
          conflicts: 4,
        },
      }),
      run('deep', { quality: { web: { rounds: 1 }, conflicts: 0 } }),
    ]);
    expect(deep!.unanswerablePerRun).toBeCloseTo(0.5);
    expect(deep!.conflictsPerRun).toBeCloseTo(2);
    expect(deep!.roundsPerRun).toBeCloseTo(2);
  });

  it('survives malformed parts and an empty list', () => {
    expect(aggregateModes([])).toEqual([]);
    const odd = aggregateModes([
      { resolved: null, costUsd: Number.NaN, seconds: -5, quality: 'nope' },
      { resolved: null, costUsd: null, seconds: null, quality: { summary: 3, web: { gaps: 'x' } } },
    ]);
    expect(odd).toHaveLength(1);
    expect(odd[0]).toMatchObject({ runs: 2, avgCostUsd: null, solidShare: null });
  });
});
