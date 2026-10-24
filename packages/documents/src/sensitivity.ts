import { criteriaProblem, scoreSolution, type Criterion } from './scoring.js';

const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface ScoredAlternative {
  readonly id: string;
  readonly inputs: Readonly<Record<string, number>>;
}

export function rankAlternatives(
  alternatives: readonly ScoredAlternative[],
  criteria: readonly Criterion[],
) {
  const sorted = alternatives
    .map((item) => ({ id: item.id, total: scoreSolution(item.inputs, criteria).total }))
    .sort((a, b) => b.total - a.total || compareKeys(a.id, b.id));
  let rank = 0;
  return sorted.map((item, index) => {
    if (index === 0 || item.total !== sorted[index - 1]?.total) rank = index + 1;
    return { ...item, rank };
  });
}

/** Integer percentage weights; distribute the remainder by largest remainders.
 * Other enabled weights keep their proportions, or equal shares when all are zero.
 * Equal remainders are resolved by criterion key, never the incoming array order.
 */
export function sensitivityWeights(
  criteria: readonly Criterion[],
  key: string,
  weight: number,
): Criterion[] {
  const problem = criteriaProblem(criteria);
  if (problem) throw new Error(problem);
  const chosen = criteria.find((c) => c.key === key && c.enabled);
  if (!chosen || !Number.isInteger(weight) || weight < 0 || weight > 100)
    throw new Error('Choose an enabled criterion and a whole percentage from 0 to 100.');
  const others = criteria.filter((c) => c.enabled && c.key !== key);
  if (others.length === 0) {
    if (weight !== 100) throw new Error('The only enabled criterion must retain weight 100.');
    return criteria.map((c) => ({ ...c }));
  }
  const total = others.reduce((n, c) => n + c.weight, 0);
  const denominator = total || others.length;
  const allocated = others.map((c) => {
    const numerator = (100 - weight) * (total ? c.weight : 1);
    return {
      key: c.key,
      weight: Math.floor(numerator / denominator),
      remainder: numerator % denominator,
    };
  });
  let remaining = 100 - weight - allocated.reduce((n, c) => n + c.weight, 0);
  allocated.sort((a, b) => b.remainder - a.remainder || compareKeys(a.key, b.key));
  for (const c of allocated) if (remaining-- > 0) c.weight += 1;
  const byKey = new Map(allocated.map((c) => [c.key, c.weight]));
  return criteria.map((c) => ({
    ...c,
    weight: c.key === key ? weight : (byKey.get(c.key) ?? c.weight),
  }));
}

/** Deterministic what-if preview. It never mutates the saved criteria or score inputs.
 * Intervals cover every feasible integer percentage, and expose joint winners.
 * No continuous threshold or probability is inferred between percentage steps.
 */
export function analyzeWeightSensitivity(
  alternatives: readonly ScoredAlternative[],
  criteria: readonly Criterion[],
  key: string,
  weight: number,
) {
  if (
    alternatives.length < 2 ||
    alternatives.length > 20 ||
    new Set(alternatives.map((a) => a.id)).size !== alternatives.length
  )
    throw new Error('Provide 2–20 distinct alternatives.');
  const weights = sensitivityWeights(criteria, key, weight);
  const ranking = rankAlternatives(alternatives, weights);
  const intervals: { from: number; to: number; winnerIds: string[] }[] = [];
  const start = criteria.filter((c) => c.enabled).length === 1 ? 100 : 0;
  for (let point = start; point <= 100; point += 1) {
    const ranks = rankAlternatives(alternatives, sensitivityWeights(criteria, key, point));
    const winnerIds = ranks.filter((r) => r.rank === 1).map((r) => r.id);
    const last = intervals.at(-1);
    if (last && JSON.stringify(last.winnerIds) === JSON.stringify(winnerIds)) last.to = point;
    else intervals.push({ from: point, to: point, winnerIds });
  }
  return {
    policy: 'integer-percent-largest-remainder-v1' as const,
    criterionKey: key,
    baseline: rankAlternatives(alternatives, criteria),
    preview: { weight, criteria: weights, ranking },
    intervals,
  };
}

export interface CriterionStability {
  readonly criterionKey: string;
  readonly intervals: { from: number; to: number; winnerIds: string[] }[];
  /** True when the baseline winner(s) stay the sole winner across every whole-percent weight. */
  readonly stable: boolean;
  /** Lowest and highest whole-percent weight at which the baseline winner is still the sole winner. */
  readonly holdsFrom: number | null;
  readonly holdsTo: number | null;
}

/** Runs the weight sweep for every enabled criterion at once, so no one tries them one by one. */
export function analyzeStability(
  alternatives: readonly ScoredAlternative[],
  criteria: readonly Criterion[],
): { baselineWinnerIds: string[]; criteria: CriterionStability[] } {
  const baselineWinnerIds = rankAlternatives(alternatives, criteria)
    .filter((r) => r.rank === 1)
    .map((r) => r.id);
  const soleWinner = baselineWinnerIds.length === 1 ? baselineWinnerIds[0] : undefined;
  const result = criteria
    .filter((c) => c.enabled)
    .map((c) => {
      const { intervals } = analyzeWeightSensitivity(alternatives, criteria, c.key, c.weight);
      const holding = intervals.filter(
        (i) => i.winnerIds.length === 1 && i.winnerIds[0] === soleWinner,
      );
      return {
        criterionKey: c.key,
        intervals,
        stable: soleWinner !== undefined && intervals.length === 1 && holding.length === 1,
        holdsFrom: holding.length ? Math.min(...holding.map((i) => i.from)) : null,
        holdsTo: holding.length ? Math.max(...holding.map((i) => i.to)) : null,
      };
    });
  return { baselineWinnerIds, criteria: result };
}
