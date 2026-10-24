import { describe, expect, it } from 'vitest';
import { higherScoredLeftOut, rebalanceWeights, stabilityVerdict } from './criteria-weights';

const criteria = [
  { key: 'impact', label: 'Impact', weight: 50, enabled: true },
  { key: 'cost', label: 'Cost', weight: 30, enabled: true },
  { key: 'time', label: 'Time', weight: 20, enabled: true },
  { key: 'risk', label: 'Risk', weight: 40, enabled: false },
];
const sum = (list: typeof criteria) =>
  list.filter((c) => c.enabled).reduce((n, c) => n + c.weight, 0);

describe('rebalanceWeights', () => {
  it('keeps the other enabled weights in proportion and the total at 100', () => {
    const next = rebalanceWeights(criteria, 'impact', 70);
    expect(next.map((c) => c.weight)).toEqual([70, 18, 12, 40]);
    for (let weight = 0; weight <= 100; weight += 1)
      expect(sum(rebalanceWeights(criteria, 'cost', weight))).toBe(100);
  });
  it('gives equal shares when the others are all zero and ignores disabled criteria', () => {
    const zero = criteria.map((c) =>
      c.key === 'impact' ? { ...c, weight: 100 } : { ...c, weight: c.enabled ? 0 : 9 },
    );
    const next = rebalanceWeights(zero, 'impact', 40);
    expect(next.map((c) => c.weight)).toEqual([40, 30, 30, 9]);
  });
  it('does not change anything for a disabled or unknown criterion, and does not mutate', () => {
    expect(rebalanceWeights(criteria, 'risk', 10)).toEqual(criteria);
    expect(criteria[0]?.weight).toBe(50);
  });
});

describe('stabilityVerdict', () => {
  const base = { criterionKey: 'impact', holdsFrom: 0, holdsTo: 100 };
  it('is stable, fragile or a tie', () => {
    expect(
      stabilityVerdict({ baselineWinnerIds: ['a'], criteria: [{ ...base, stable: true }] }),
    ).toEqual({ kind: 'stable', winnerId: 'a' });
    expect(
      stabilityVerdict({
        baselineWinnerIds: ['a'],
        criteria: [{ criterionKey: 'cost', stable: false, holdsFrom: 0, holdsTo: 39 }],
      }),
    ).toEqual({
      kind: 'fragile',
      winnerId: 'a',
      flips: [{ criterionKey: 'cost', from: 0, to: 39 }],
    });
    expect(stabilityVerdict({ baselineWinnerIds: ['a', 'b'], criteria: [] }).kind).toBe('tie');
  });
});

describe('higherScoredLeftOut', () => {
  const items = [
    { id: 'a', title: 'A', total: 80 },
    { id: 'b', title: 'B', total: 70 },
    { id: 'c', title: 'C', total: 60 },
  ];
  it('lists unchosen solutions that beat every chosen one', () => {
    expect(higherScoredLeftOut(items, ['b']).map((s) => s.id)).toEqual(['a']);
    expect(higherScoredLeftOut(items, ['a'])).toEqual([]);
    expect(higherScoredLeftOut(items, [])).toEqual([]);
  });
});
