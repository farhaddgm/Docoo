import { describe, expect, it } from 'vitest';
import {
  analyzeDecisionMatrix,
  applyWeights,
  dominatedAlternatives,
  evaluateVetoes,
  kendallTau,
  minimalFlips,
  modelWarnings,
  rocWeights,
  seededRandom,
  smaa,
  topsis,
} from './decision-matrix.js';
import type { Criterion } from './scoring.js';

const criteria: Criterion[] = [
  { key: 'impact', label: 'Impact', weight: 50, enabled: true },
  { key: 'cost', label: 'Cost', weight: 30, enabled: true },
  { key: 'risk', label: 'Risk', weight: 20, enabled: true },
];
const alts = [
  { id: 'a', inputs: { impact: 5, cost: 2, risk: 3 } },
  { id: 'b', inputs: { impact: 3, cost: 4, risk: 4 } },
  { id: 'c', inputs: { impact: 2, cost: 2, risk: 2 } },
];

describe('rank-order-centroid weights', () => {
  it('follows the known centroid values and always adds up to 100', () => {
    expect(rocWeights(['x', 'y', 'z'])).toEqual({ x: 61, y: 28, z: 11 });
    for (let n = 1; n <= 9; n += 1) {
      const keys = Array.from({ length: n }, (_, i) => `k${i}`);
      const total = Object.values(rocWeights(keys)).reduce((s, w) => s + w, 0);
      expect(total).toBe(100);
    }
  });
  it('never gives a less important criterion more than a more important one', () => {
    const weights = rocWeights(['a', 'b', 'c', 'd', 'e']);
    const list = Object.values(weights);
    expect(list).toEqual([...list].sort((x, y) => y - x));
  });
  it('rejects an empty or repeated order', () => {
    expect(() => rocWeights([])).toThrow();
    expect(() => rocWeights(['a', 'a'])).toThrow();
  });
});

describe('what-if weights', () => {
  it('replaces enabled weights without touching the saved ones', () => {
    const next = applyWeights(criteria, { impact: 10, cost: 10, risk: 80 });
    expect(next.map((c) => c.weight)).toEqual([10, 10, 80]);
    expect(criteria.map((c) => c.weight)).toEqual([50, 30, 20]);
  });
  it('refuses weights that do not add up or that miss a criterion', () => {
    expect(() => applyWeights(criteria, { impact: 10, cost: 10, risk: 10 })).toThrow(/100/u);
    expect(() => applyWeights(criteria, { impact: 50, cost: 50 })).toThrow(/missing/u);
  });
});

describe('SMAA', () => {
  it('is reproducible for a seed and differs for another', () => {
    const one = smaa(alts, criteria, { seed: 7, iterations: 500 });
    const two = smaa(alts, criteria, { seed: 7, iterations: 500 });
    expect(one).toEqual(two);
    expect(smaa(alts, criteria, { seed: 8, iterations: 500 }).alternatives[0]?.firstShare).not.toBe(
      one.alternatives[0]?.firstShare,
    );
  });
  it('gives a dominated alternative no first rank and a dominant one all of them', () => {
    const result = smaa(alts, criteria, { seed: 3, iterations: 800 });
    const c = result.alternatives.find((x) => x.id === 'c');
    expect(c?.firstShare).toBe(0);
    const dominant = smaa(
      [
        { id: 'top', inputs: { impact: 5, cost: 5, risk: 5 } },
        { id: 'low', inputs: { impact: 1, cost: 1, risk: 1 } },
      ],
      criteria,
      { seed: 1, iterations: 300, scoreSpread: 0.5 },
    );
    expect(dominant.leaderId).toBe('top');
    expect(dominant.leaderShare).toBe(1);
    expect(dominant.verdict).toBe('confident');
  });
  it('shares at every rank add up to one for each alternative and each rank', () => {
    const result = smaa(alts, criteria, { seed: 5, iterations: 600, scoreSpread: 1 });
    for (const alt of result.alternatives) {
      expect(alt.rankShares.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    }
    for (let rank = 0; rank < alts.length; rank += 1) {
      const column = result.alternatives.reduce((s, a) => s + (a.rankShares[rank] ?? 0), 0);
      expect(column).toBeCloseTo(1, 9);
    }
  });
  it('with fixed weights and exact scores it reproduces the official ranking', () => {
    const result = smaa(alts, criteria, { mode: 'fixed', seed: 1, iterations: 50 });
    expect(result.leaderId).toBe('a');
    expect(result.leaderShare).toBe(1);
  });
  it('an ordinal order narrows the possible weights', () => {
    const impactFirst = smaa(alts, criteria, {
      mode: 'ordinal',
      weightOrder: ['impact', 'cost', 'risk'],
      seed: 2,
      iterations: 1500,
    });
    const free = smaa(alts, criteria, { mode: 'free', seed: 2, iterations: 1500 });
    const a = (r: typeof free) => r.alternatives.find((x) => x.id === 'a')?.firstShare ?? 0;
    expect(a(impactFirst)).toBeGreaterThan(a(free));
    expect(() => smaa(alts, criteria, { mode: 'ordinal', weightOrder: ['impact'] })).toThrow();
  });
  it('does not call a mirror-image race confident', () => {
    const tied = smaa(
      [
        { id: 'p', inputs: { impact: 5, cost: 1, risk: 3 } },
        { id: 'q', inputs: { impact: 1, cost: 5, risk: 3 } },
      ],
      criteria,
      { seed: 9, iterations: 2000 },
    );
    // Mirror-image alternatives win about half of the weightings each, so nobody is confident.
    expect(tied.leaderShare).toBeGreaterThan(0.4);
    expect(tied.leaderShare).toBeLessThan(0.6);
    expect(tied.verdict).not.toBe('confident');
  });
  it('keeps the seeded generator in the open interval', () => {
    const random = seededRandom(1);
    for (let i = 0; i < 1000; i += 1) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('dominance, vetoes and flips', () => {
  it('finds dominated alternatives and who dominates them', () => {
    expect(dominatedAlternatives(alts, criteria)).toEqual([{ id: 'c', dominatedBy: ['a', 'b'] }]);
  });
  it('sets aside an alternative below a must-have minimum', () => {
    expect(evaluateVetoes(alts, { cost: 3 })).toEqual([
      { id: 'a', failed: [{ criterionKey: 'cost', raw: 2, minimum: 3 }] },
      { id: 'c', failed: [{ criterionKey: 'cost', raw: 2, minimum: 3 }] },
    ]);
    expect(evaluateVetoes(alts, { cost: 1 })).toEqual([]);
  });
  it('finds the smallest single change that makes an alternative the winner', () => {
    const flips = minimalFlips(alts, criteria);
    // `a` is the sole winner already, so it has no flip; `b` needs one more point of impact (the
    // heavier criterion wins a tie in size) and `c` cannot win with any single change.
    expect(flips.find((f) => f.id === 'a')).toBeUndefined();
    expect(flips.find((f) => f.id === 'b')?.change).toEqual({
      criterionKey: 'impact',
      from: 3,
      to: 4,
    });
    expect(flips.find((f) => f.id === 'c')?.change).toBeNull();
  });
});

describe('cross-check', () => {
  it('TOPSIS ranks the dominant alternative first and Kendall tau is 1 for equal orders', () => {
    const rows = topsis(alts, criteria);
    expect(rows.at(-1)?.id).toBe('c');
    expect(
      kendallTau(
        [
          { id: 'x', rank: 1 },
          { id: 'y', rank: 2 },
        ],
        [
          { id: 'x', rank: 1 },
          { id: 'y', rank: 2 },
        ],
      ),
    ).toBe(1);
    expect(
      kendallTau(
        [
          { id: 'x', rank: 1 },
          { id: 'y', rank: 2 },
        ],
        [
          { id: 'x', rank: 2 },
          { id: 'y', rank: 1 },
        ],
      ),
    ).toBe(-1);
  });
});

describe('model warnings', () => {
  it('flags a dominating weight, too many criteria, flat and redundant criteria', () => {
    const many: Criterion[] = Array.from({ length: 8 }, (_, i) => ({
      key: `k${i}`,
      label: `K${i}`,
      weight: i === 0 ? 51 : 7,
      enabled: true,
    }));
    const codes = modelWarnings(
      [
        { id: 'a', inputs: { k0: 1, k1: 1, k2: 3 } },
        { id: 'b', inputs: { k0: 2, k1: 2, k2: 3 } },
        { id: 'c', inputs: { k0: 3, k1: 3, k2: 3 } },
        { id: 'd', inputs: { k0: 4, k1: 4, k2: 3 } },
      ],
      many,
    ).map((w) => w.code);
    expect(codes).toContain('weight_concentrated');
    expect(codes).toContain('too_many_criteria');
    expect(codes).toContain('non_discriminating');
    expect(codes).toContain('redundant_criteria');
  });
});

describe('analyzeDecisionMatrix', () => {
  it('leaves the official ranking alone and ranks by the what-if weights', () => {
    const matrix = analyzeDecisionMatrix(alts, criteria, {
      weights: { impact: 10, cost: 80, risk: 10 },
      seed: 4,
      iterations: 300,
    });
    expect(matrix.officialRanking[0]?.id).toBe('a');
    expect(matrix.ranking[0]?.id).toBe('b');
    expect(matrix.policy).toBe('decision-matrix-v1');
    expect(criteria.map((c) => c.weight)).toEqual([50, 30, 20]);
  });
  it('drops vetoed alternatives from the analysis but reports them', () => {
    const matrix = analyzeDecisionMatrix(alts, criteria, {
      minimums: { cost: 3 },
      seed: 1,
      iterations: 100,
    });
    expect(matrix.vetoed.map((v) => v.id)).toEqual(['a', 'c']);
    expect(matrix.ranking.map((r) => r.id)).toEqual(['b']);
    expect(matrix.smaa).toBeNull();
  });
  it('refuses fewer than two or duplicated alternatives', () => {
    expect(() => analyzeDecisionMatrix([alts[0]!], criteria)).toThrow();
    expect(() => analyzeDecisionMatrix([alts[0]!, alts[0]!], criteria)).toThrow();
  });
});
