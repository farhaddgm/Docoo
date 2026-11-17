/** Pure helpers for the decision matrix panel (NXT-002): what the server returns and how it is read. */

export interface MatrixCriterion {
  key: string;
  label: string;
  weight: number;
  enabled: boolean;
}

export interface MatrixSmaaAlternative {
  id: string;
  rankShares: number[];
  firstShare: number;
  expectedRank: number;
}

export interface DecisionMatrixResult {
  setId: string;
  criteriaVersionId: string | null;
  matrix: {
    criteria: MatrixCriterion[];
    officialRanking: { id: string; total: number; rank: number }[];
    ranking: { id: string; total: number; rank: number }[];
    vetoed: { id: string; failed: { criterionKey: string; raw: number; minimum: number }[] }[];
    dominated: { id: string; dominatedBy: string[] }[];
    smaa: {
      mode: 'free' | 'ordinal' | 'fixed';
      iterations: number;
      seed: number;
      scoreSpread: number;
      alternatives: MatrixSmaaAlternative[];
      leaderId: string | null;
      leaderShare: number;
      runnerUpShare: number;
      verdict: 'confident' | 'leaning' | 'open';
    } | null;
    crossCheck: {
      topsis: { id: string; closeness: number; rank: number }[];
      tau: number;
      sameWinner: boolean;
    };
    flips: {
      id: string;
      change: { criterionKey: string; from: number; to: number } | null;
    }[];
    warnings: { code: string; criterionKeys: string[] }[];
  };
}

/** Moves one criterion a place up (-1) or down (+1) in the order of importance. */
export function moveKey(order: readonly string[], key: string, by: -1 | 1): string[] {
  const index = order.indexOf(key);
  const target = index + by;
  if (index === -1 || target < 0 || target >= order.length) return [...order];
  const next = [...order];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as string);
  return next;
}

/** The order the panel starts from: the enabled criteria, heaviest first, ties by key. */
export function initialOrder(criteria: readonly MatrixCriterion[]): string[] {
  return criteria
    .filter((c) => c.enabled)
    .sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((c) => c.key);
}

/** The share of samples as a whole percent, never rounded up to 100 or down to 0 by rounding alone. */
export function sharePercent(share: number): number {
  if (share >= 1) return 100;
  if (share <= 0) return 0;
  return Math.min(99, Math.max(1, Math.round(share * 100)));
}

/** How far the two methods agree, in words the panel can choose a sentence for. */
export function agreementLevel(tau: number, sameWinner: boolean): 'agree' | 'differ' | 'split' {
  if (!sameWinner) return 'split';
  return tau >= 0.6 ? 'agree' : 'differ';
}
