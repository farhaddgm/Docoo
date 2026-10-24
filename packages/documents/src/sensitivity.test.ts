import { describe, expect, it } from 'vitest';
import { analyzeStability, analyzeWeightSensitivity, sensitivityWeights } from './sensitivity.js';
import { criteriaProblem, type Criterion } from './scoring.js';

const criteria: Criterion[] = [
  { key: 'impact', label: 'Impact', weight: 70, enabled: true },
  { key: 'cost', label: 'Cost', weight: 30, enabled: true },
];
const alternatives = [
  { id: 'a', inputs: { impact: 5, cost: 1 } },
  { id: 'b', inputs: { impact: 1, cost: 5 } },
];

describe('weight sensitivity', () => {
  it('reverses ranks, exposes ties and exact discrete winner boundaries', () => {
    const result = analyzeWeightSensitivity(alternatives, criteria, 'impact', 0);
    expect(result.baseline.map((r) => r.id)).toEqual(['a', 'b']);
    expect(result.preview.ranking.map((r) => r.id)).toEqual(['b', 'a']);
    expect(result.intervals).toEqual([
      { from: 0, to: 49, winnerIds: ['b'] },
      { from: 50, to: 50, winnerIds: ['a', 'b'] },
      { from: 51, to: 100, winnerIds: ['a'] },
    ]);
    expect(
      analyzeWeightSensitivity(alternatives, criteria, 'impact', 50).preview.ranking.map(
        (r) => r.rank,
      ),
    ).toEqual([1, 1]);
    expect(
      analyzeWeightSensitivity(alternatives, criteria, 'impact', 100).preview.ranking[0]?.total,
    ).toBe(100);
    expect(criteria[0]?.weight).toBe(70);
  });

  it('preserves total 100 across all boundaries, including zero other weights', () => {
    const input = [
      { key: 'impact', label: 'Impact', weight: 100, enabled: true },
      { key: 'cost', label: 'Cost', weight: 0, enabled: true },
      { key: 'time', label: 'Time', weight: 0, enabled: true },
      { key: 'risk', label: 'Risk', weight: 55, enabled: false },
    ];
    for (let weight = 0; weight <= 100; weight += 1) {
      const result = sensitivityWeights(input, 'impact', weight);
      expect(criteriaProblem(result)).toBeNull();
      expect(result.find((c) => c.key === 'risk')?.weight).toBe(55);
    }
    expect(
      sensitivityWeights(input, 'impact', 1)
        .filter((c) => c.enabled)
        .map((c) => c.weight),
    ).toEqual([1, 50, 49]);
    expect(
      sensitivityWeights([...input].reverse(), 'impact', 1).find((c) => c.key === 'cost')?.weight,
    ).toBe(50);
  });

  it('maintains proportions and rejects disabled, malformed and infeasible inputs', () => {
    const extra = [...criteria, { key: 'risk', label: 'Risk', weight: 0, enabled: false }];
    expect(sensitivityWeights(extra, 'cost', 25).map((c) => c.weight)).toEqual([75, 25, 0]);
    for (const weight of [-1, 101, 1.5, NaN])
      expect(() => sensitivityWeights(criteria, 'impact', weight)).toThrow();
    expect(() => sensitivityWeights(extra, 'risk', 20)).toThrow();
    expect(() => sensitivityWeights([{ ...criteria[0]!, weight: 50 }], 'impact', 50)).toThrow();
    const one = [{ ...criteria[0]!, weight: 100 }];
    expect(analyzeWeightSensitivity(alternatives, one, 'impact', 100).intervals).toEqual([
      { from: 100, to: 100, winnerIds: ['a'] },
    ]);
    expect(() => sensitivityWeights(one, 'impact', 0)).toThrow();
    expect(() =>
      analyzeWeightSensitivity([alternatives[0]!, alternatives[0]!], criteria, 'impact', 50),
    ).toThrow();
  });
});

describe('stability across all criteria', () => {
  it('reports where the baseline winner stops winning, per criterion', () => {
    const result = analyzeStability(alternatives, criteria);
    expect(result.baselineWinnerIds).toEqual(['a']);
    const impact = result.criteria.find((c) => c.criterionKey === 'impact')!;
    expect(impact).toMatchObject({ stable: false, holdsFrom: 51, holdsTo: 100 });
  });

  it('is stable when one alternative dominates on every criterion', () => {
    const dominant = [
      { id: 'a', inputs: { impact: 5, cost: 5 } },
      { id: 'b', inputs: { impact: 1, cost: 1 } },
    ];
    const result = analyzeStability(dominant, criteria);
    expect(result.criteria.every((c) => c.stable)).toBe(true);
  });
});
