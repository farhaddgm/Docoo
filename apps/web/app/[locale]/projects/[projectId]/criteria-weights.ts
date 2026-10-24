export interface WeightedCriterion {
  key: string;
  label: string;
  weight: number;
  enabled: boolean;
}

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sets one enabled criterion to `weight` and shares the rest over the other enabled criteria in
 * proportion to what they had (equal shares when they were all zero), in whole percents that add
 * up to 100. Disabled criteria are left as they are. Equal remainders go to the lower key, so the
 * result never depends on the order of the list.
 */
export function rebalanceWeights<T extends WeightedCriterion>(
  criteria: readonly T[],
  key: string,
  weight: number,
): T[] {
  const target = Math.min(100, Math.max(0, Math.round(weight)));
  const others = criteria.filter((c) => c.enabled && c.key !== key);
  if (!criteria.some((c) => c.enabled && c.key === key)) return criteria.map((c) => ({ ...c }));
  if (others.length === 0)
    return criteria.map((c) => (c.key === key ? { ...c, weight: 100 } : { ...c }));
  const total = others.reduce((n, c) => n + c.weight, 0);
  const denominator = total || others.length;
  const shares = others.map((c) => {
    const numerator = (100 - target) * (total ? c.weight : 1);
    return {
      key: c.key,
      weight: Math.floor(numerator / denominator),
      rest: numerator % denominator,
    };
  });
  let remaining = 100 - target - shares.reduce((n, c) => n + c.weight, 0);
  for (const share of [...shares].sort((a, b) => b.rest - a.rest || byKey(a.key, b.key))) {
    if (remaining-- > 0) share.weight += 1;
  }
  const next = new Map(shares.map((s) => [s.key, s.weight]));
  return criteria.map((c) => ({
    ...c,
    weight: c.key === key ? target : (next.get(c.key) ?? c.weight),
  }));
}

export interface StabilityResult {
  baselineWinnerIds: string[];
  criteria: {
    criterionKey: string;
    stable: boolean;
    holdsFrom: number | null;
    holdsTo: number | null;
  }[];
}

export type StabilityVerdict =
  | { kind: 'tie'; winnerIds: string[] }
  | { kind: 'stable'; winnerId: string }
  | {
      kind: 'fragile';
      winnerId: string;
      /** Criteria whose weight can flip the winner, and the range where it still wins. */
      flips: { criterionKey: string; from: number | null; to: number | null }[];
    };

/** Turns the sweep over all criteria into one verdict a person can read. */
export function stabilityVerdict(result: StabilityResult): StabilityVerdict {
  const [winnerId] = result.baselineWinnerIds;
  if (result.baselineWinnerIds.length !== 1 || winnerId === undefined)
    return { kind: 'tie', winnerIds: result.baselineWinnerIds };
  const flips = result.criteria
    .filter((c) => !c.stable)
    .map((c) => ({ criterionKey: c.criterionKey, from: c.holdsFrom, to: c.holdsTo }));
  return flips.length === 0 ? { kind: 'stable', winnerId } : { kind: 'fragile', winnerId, flips };
}

export interface RankedSolution {
  id: string;
  title: string;
  total: number;
}

/**
 * Solutions that score higher than the best-scoring chosen one but were left out. Chosen ones
 * may be anything; only an unchosen solution beating every chosen one's best score is a surprise
 * worth asking a reason for.
 */
export function higherScoredLeftOut(
  items: readonly RankedSolution[],
  chosenIds: readonly string[],
): RankedSolution[] {
  const chosen = items.filter((s) => chosenIds.includes(s.id));
  if (chosen.length === 0) return [];
  const best = Math.max(...chosen.map((s) => s.total));
  return items.filter((s) => !chosenIds.includes(s.id) && s.total > best);
}
