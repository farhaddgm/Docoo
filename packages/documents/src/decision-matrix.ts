import { criteriaProblem, scoreSolution, type Criterion } from './scoring.js';
import { rankAlternatives, type ScoredAlternative } from './sensitivity.js';

/**
 * Decision matrix (NXT-002): the exploratory layer over the official weighted score. Nothing here
 * changes a saved score or weight; every function is pure and deterministic (SMAA uses a seeded
 * generator), so a scenario can be reproduced and audited from its inputs alone.
 *
 * Every criterion is scored 1–5 with "higher is better" (the same convention as `scoreSolution`).
 */

export const DECISION_MATRIX_POLICY = 'decision-matrix-v1' as const;
export const SMAA_DEFAULT_ITERATIONS = 4000;
export const SMAA_MAX_ITERATIONS = 20000;
export const SMAA_MAX_SPREAD = 2;
/** Heuristic bands for reading the first-rank share; they describe the sampling, not a probability of success. */
export const CONFIDENT_SHARE = 0.8;
export const LEANING_SHARE = 0.5;
/** More criteria than this make the weights hard to reason about. */
export const MAX_SENSIBLE_CRITERIA = 7;
/** A single weight at or above this share dominates the score. */
export const CONCENTRATED_WEIGHT = 50;
/** Two criteria that move together this closely probably measure the same thing. */
export const REDUNDANT_CORRELATION = 0.9;

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const EPS = 1e-9;

function clampRaw(value: number | undefined): number {
  return Math.max(1, Math.min(5, Math.round(value ?? 1)));
}

/** Largest-remainder rounding of non-negative shares to whole percents that add up to 100. */
function toPercents(shares: readonly number[]): number[] {
  const total = shares.reduce((n, s) => n + s, 0);
  const exact = shares.map((s) => (total > 0 ? (s / total) * 100 : 100 / shares.length));
  const floors = exact.map(Math.floor);
  let remaining = 100 - floors.reduce((n, f) => n + f, 0);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    // Equal remainders go to the more important (earlier) criterion, so the result never depends on luck.
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (remaining-- <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
  }
  return floors;
}

/**
 * Rank-order-centroid weights (Barron and Barrett, 1996): the manager only puts the criteria in
 * order of importance and the weights follow, which people do far more reliably than typing numbers.
 * `orderedKeys` goes from the most to the least important.
 */
export function rocWeights(orderedKeys: readonly string[]): Record<string, number> {
  const n = orderedKeys.length;
  if (n === 0) throw new Error('Order at least one criterion.');
  if (new Set(orderedKeys).size !== n) throw new Error('Each criterion may appear once.');
  const shares = orderedKeys.map((_, i) => {
    let sum = 0;
    for (let k = i + 1; k <= n; k += 1) sum += 1 / k;
    return sum / n;
  });
  const percents = toPercents(shares);
  return Object.fromEntries(orderedKeys.map((key, i) => [key, percents[i] ?? 0]));
}

/** The criteria with the given whole-percent weights for the enabled ones; disabled ones are untouched. */
export function applyWeights(
  criteria: readonly Criterion[],
  weights: Readonly<Record<string, number>>,
): Criterion[] {
  const next = criteria.map((c) =>
    c.enabled && weights[c.key] !== undefined
      ? { ...c, weight: weights[c.key] as number }
      : { ...c },
  );
  const enabled = criteria.filter((c) => c.enabled);
  const missing = enabled.filter((c) => weights[c.key] === undefined);
  if (missing.length > 0)
    throw new Error(`Weights are missing for ${missing.map((c) => c.key).join(', ')}.`);
  const problem = criteriaProblem(next);
  if (problem) throw new Error(problem);
  return next;
}

/** Small, fast, seedable generator (mulberry32); the same seed always gives the same sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type WeightMode =
  /** No weight information: every weighting is equally possible. */
  | 'free'
  /** Only the order of importance is known (the manager's ranking). */
  | 'ordinal'
  /** The weights are the stated ones; only the scores are uncertain. */
  | 'fixed';

export interface SmaaOptions {
  readonly mode?: WeightMode;
  /** Criteria from most to least important; required for `ordinal`. */
  readonly weightOrder?: readonly string[];
  /** How far each 1–5 score may be off, in score points (0 means the scores are exact). */
  readonly scoreSpread?: number;
  readonly iterations?: number;
  readonly seed?: number;
}

export interface SmaaAlternative {
  readonly id: string;
  /** Share of samples at each rank; index 0 is the first rank. */
  readonly rankShares: number[];
  readonly firstShare: number;
  readonly expectedRank: number;
  /** Average weights over the samples where it won; null when it never won. */
  readonly centralWeights: Record<string, number> | null;
}

export interface SmaaResult {
  readonly mode: WeightMode;
  readonly iterations: number;
  readonly seed: number;
  readonly scoreSpread: number;
  readonly alternatives: SmaaAlternative[];
  readonly leaderId: string | null;
  readonly leaderShare: number;
  readonly runnerUpShare: number;
  readonly verdict: 'confident' | 'leaning' | 'open';
}

function sampleWeights(
  keys: readonly string[],
  mode: WeightMode,
  order: readonly string[],
  fixed: Readonly<Record<string, number>>,
  random: () => number,
): Record<string, number> {
  if (mode === 'fixed') return fixed;
  // Uniform on the simplex: normalised exponentials.
  const draws = keys.map(() => -Math.log(1 - random()));
  const total = draws.reduce((n, d) => n + d, 0);
  const shares = draws.map((d) => d / total);
  if (mode === 'ordinal') {
    const sorted = [...shares].sort((a, b) => b - a);
    return Object.fromEntries(order.map((key, i) => [key, sorted[i] ?? 0]));
  }
  return Object.fromEntries(keys.map((key, i) => [key, shares[i] ?? 0]));
}

/**
 * Stochastic multicriteria acceptability analysis (Lahdelma and Salminen, 2001). It samples the
 * weights the manager did not fix and the scores nobody can know exactly, ranks the alternatives
 * every time, and reports how often each one lands on each rank. The shares are shares of the
 * sampling under the stated assumptions, not the probability that a solution will succeed.
 */
export function smaa(
  alternatives: readonly ScoredAlternative[],
  criteria: readonly Criterion[],
  options: SmaaOptions = {},
): SmaaResult {
  const enabled = criteria.filter((c) => c.enabled);
  if (enabled.length === 0) throw new Error('At least one criterion must be enabled.');
  if (alternatives.length < 2) throw new Error('Provide at least two alternatives.');
  const mode = options.mode ?? 'free';
  const scoreSpread = Math.min(SMAA_MAX_SPREAD, Math.max(0, options.scoreSpread ?? 0));
  const iterations = Math.min(
    SMAA_MAX_ITERATIONS,
    Math.max(1, Math.floor(options.iterations ?? SMAA_DEFAULT_ITERATIONS)),
  );
  const seed = Math.floor(options.seed ?? 1) >>> 0;
  const keys = enabled.map((c) => c.key);
  const order = options.weightOrder ?? [];
  if (mode === 'ordinal') {
    if (order.length !== keys.length || !keys.every((k) => order.includes(k)))
      throw new Error('Order every enabled criterion for an ordinal analysis.');
  }
  const total = enabled.reduce((n, c) => n + c.weight, 0) || 1;
  const fixed = Object.fromEntries(enabled.map((c) => [c.key, c.weight / total]));
  const raws = alternatives.map((a) => keys.map((k) => clampRaw(a.inputs[k])));
  const n = alternatives.length;
  const random = seededRandom(seed);

  const rankCounts = alternatives.map(() => new Array<number>(n).fill(0));
  const winnerWeights = alternatives.map(() => new Array<number>(keys.length).fill(0));
  const wins = new Array<number>(n).fill(0);
  const totals = new Array<number>(n).fill(0);

  for (let it = 0; it < iterations; it += 1) {
    const w = sampleWeights(keys, mode, order, fixed, random);
    for (let a = 0; a < n; a += 1) {
      let sum = 0;
      for (let c = 0; c < keys.length; c += 1) {
        const base = raws[a]?.[c] ?? 1;
        const noisy =
          scoreSpread === 0
            ? base
            : Math.max(1, Math.min(5, base + (random() * 2 - 1) * scoreSpread));
        sum += (w[keys[c] as string] ?? 0) * (noisy / 5) * 100;
      }
      totals[a] = sum;
    }
    for (let a = 0; a < n; a += 1) {
      // Competition ranking: equal totals share the better rank.
      let better = 0;
      for (let b = 0; b < n; b += 1) if ((totals[b] ?? 0) > (totals[a] ?? 0) + EPS) better += 1;
      const counts = rankCounts[a];
      if (counts) counts[better] = (counts[better] ?? 0) + 1;
      if (better === 0) {
        wins[a] = (wins[a] ?? 0) + 1;
        const acc = winnerWeights[a];
        if (acc)
          for (let c = 0; c < keys.length; c += 1)
            acc[c] = (acc[c] ?? 0) + (w[keys[c] as string] ?? 0);
      }
    }
  }

  const result: SmaaAlternative[] = alternatives.map((alt, a) => {
    const shares = (rankCounts[a] ?? []).map((count) => count / iterations);
    const expectedRank = shares.reduce((sum, share, i) => sum + share * (i + 1), 0);
    const won = wins[a] ?? 0;
    return {
      id: alt.id,
      rankShares: shares,
      firstShare: shares[0] ?? 0,
      expectedRank,
      centralWeights:
        won === 0
          ? null
          : Object.fromEntries(keys.map((k, c) => [k, (winnerWeights[a]?.[c] ?? 0) / won])),
    };
  });
  const ordered = [...result].sort((x, y) => y.firstShare - x.firstShare || byKey(x.id, y.id));
  const leader = ordered[0];
  const leaderShare = leader?.firstShare ?? 0;
  const runnerUpShare = ordered[1]?.firstShare ?? 0;
  return {
    mode,
    iterations,
    seed,
    scoreSpread,
    alternatives: result,
    leaderId: leader?.id ?? null,
    leaderShare,
    runnerUpShare,
    verdict:
      leaderShare >= CONFIDENT_SHARE
        ? 'confident'
        : leaderShare >= LEANING_SHARE
          ? 'leaning'
          : 'open',
  };
}

export interface Domination {
  readonly id: string;
  /** The alternatives that are at least as good on every criterion and better on one. */
  readonly dominatedBy: string[];
}

/** Pareto dominance over the enabled criteria: a dominated alternative can never be the best choice. */
export function dominatedAlternatives(
  alternatives: readonly ScoredAlternative[],
  criteria: readonly Criterion[],
): Domination[] {
  const keys = criteria.filter((c) => c.enabled).map((c) => c.key);
  const raw = (alt: ScoredAlternative) => keys.map((k) => clampRaw(alt.inputs[k]));
  const out: Domination[] = [];
  for (const b of alternatives) {
    const rb = raw(b);
    const by = alternatives
      .filter((a) => a.id !== b.id)
      .filter((a) => {
        const ra = raw(a);
        return ra.every((v, i) => v >= (rb[i] ?? 1)) && ra.some((v, i) => v > (rb[i] ?? 1));
      })
      .map((a) => a.id)
      .sort(byKey);
    if (by.length > 0) out.push({ id: b.id, dominatedBy: by });
  }
  return out;
}

export interface Veto {
  readonly id: string;
  readonly failed: { criterionKey: string; raw: number; minimum: number }[];
}

/**
 * Must-have thresholds: a minimum 1–5 score per criterion. The weighted sum lets a strength cover a
 * weakness; a veto does not, so a solution below a minimum is set aside whatever else it scores.
 */
export function evaluateVetoes(
  alternatives: readonly ScoredAlternative[],
  minimums: Readonly<Record<string, number>>,
): Veto[] {
  const out: Veto[] = [];
  for (const alt of alternatives) {
    const failed = Object.entries(minimums)
      .filter(([, minimum]) => minimum >= 2)
      .map(([criterionKey, minimum]) => ({
        criterionKey,
        raw: clampRaw(alt.inputs[criterionKey]),
        minimum: Math.min(5, Math.round(minimum)),
      }))
      .filter((item) => item.raw < item.minimum)
      .sort((a, b) => byKey(a.criterionKey, b.criterionKey));
    if (failed.length > 0) out.push({ id: alt.id, failed });
  }
  return out;
}

export interface TopsisRow {
  readonly id: string;
  readonly closeness: number;
  readonly rank: number;
}

/**
 * TOPSIS (Hwang and Yoon, 1981) as a second opinion: closeness to the best imaginary solution and
 * distance from the worst one. If it picks a different winner than the weighted sum, the choice
 * depends on the method and the manager should be told.
 */
export function topsis(
  alternatives: readonly ScoredAlternative[],
  criteria: readonly Criterion[],
): TopsisRow[] {
  const enabled = criteria.filter((c) => c.enabled);
  const totalWeight = enabled.reduce((n, c) => n + c.weight, 0) || 1;
  const matrix = alternatives.map((a) => enabled.map((c) => clampRaw(a.inputs[c.key])));
  const norms = enabled.map(
    (_, c) => Math.sqrt(matrix.reduce((n, row) => n + (row[c] ?? 0) ** 2, 0)) || 1,
  );
  const v = matrix.map((row) =>
    row.map((x, c) => (x / (norms[c] ?? 1)) * ((enabled[c]?.weight ?? 0) / totalWeight)),
  );
  const best = enabled.map((_, c) => Math.max(...v.map((row) => row[c] ?? 0)));
  const worst = enabled.map((_, c) => Math.min(...v.map((row) => row[c] ?? 0)));
  const rows = alternatives.map((alt, a) => {
    const row = v[a] ?? [];
    const dPlus = Math.sqrt(row.reduce((n, x, c) => n + (x - (best[c] ?? 0)) ** 2, 0));
    const dMinus = Math.sqrt(row.reduce((n, x, c) => n + (x - (worst[c] ?? 0)) ** 2, 0));
    const closeness = dPlus + dMinus < EPS ? 0.5 : dMinus / (dPlus + dMinus);
    return { id: alt.id, closeness: Math.round(closeness * 1e6) / 1e6 };
  });
  const sorted = [...rows].sort((x, y) => y.closeness - x.closeness || byKey(x.id, y.id));
  let rank = 0;
  return sorted.map((row, i) => {
    if (i === 0 || row.closeness !== sorted[i - 1]?.closeness) rank = i + 1;
    return { ...row, rank };
  });
}

/** Kendall's tau-b between two rankings of the same ids: 1 same order, -1 reversed, 0 unrelated. */
export function kendallTau(
  a: readonly { id: string; rank: number }[],
  b: readonly { id: string; rank: number }[],
): number {
  const rankB = new Map(b.map((x) => [x.id, x.rank]));
  const items = a.filter((x) => rankB.has(x.id));
  let concordant = 0;
  let discordant = 0;
  let tiesA = 0;
  let tiesB = 0;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const da = (items[i]?.rank ?? 0) - (items[j]?.rank ?? 0);
      const db = (rankB.get(items[i]?.id ?? '') ?? 0) - (rankB.get(items[j]?.id ?? '') ?? 0);
      if (da === 0 && db === 0) continue;
      if (da === 0) tiesA += 1;
      else if (db === 0) tiesB += 1;
      else if (da * db > 0) concordant += 1;
      else discordant += 1;
    }
  }
  const denominator = Math.sqrt(
    (concordant + discordant + tiesA) * (concordant + discordant + tiesB),
  );
  return denominator === 0 ? 1 : (concordant - discordant) / denominator;
}

export interface Flip {
  readonly id: string;
  /** The smallest single-score improvement that would make this alternative the only winner; null when none can. */
  readonly change: { criterionKey: string; from: number; to: number } | null;
}

/** For every alternative that is not the sole winner: the smallest one-criterion score change that would win. */
export function minimalFlips(
  alternatives: readonly ScoredAlternative[],
  criteria: readonly Criterion[],
): Flip[] {
  const ranking = rankAlternatives(alternatives, criteria);
  const winners = ranking.filter((r) => r.rank === 1).map((r) => r.id);
  const enabled = criteria.filter((c) => c.enabled);
  const out: Flip[] = [];
  for (const alt of alternatives) {
    if (winners.length === 1 && winners[0] === alt.id) continue;
    let best: { criterionKey: string; from: number; to: number; weight: number } | null = null;
    for (const c of enabled) {
      const from = clampRaw(alt.inputs[c.key]);
      for (let to = from + 1; to <= 5; to += 1) {
        const trial = alternatives.map((x) =>
          x.id === alt.id ? { ...x, inputs: { ...x.inputs, [c.key]: to } } : x,
        );
        const ranks = rankAlternatives(trial, criteria);
        const me = ranks.find((r) => r.id === alt.id);
        const topCount = ranks.filter((r) => r.rank === 1).length;
        if (me?.rank === 1 && topCount === 1) {
          const size = to - from;
          const bestSize = best ? best.to - best.from : Infinity;
          if (size < bestSize || (size === bestSize && c.weight > (best?.weight ?? -1))) {
            best = { criterionKey: c.key, from, to, weight: c.weight };
          }
          break;
        }
      }
    }
    out.push({
      id: alt.id,
      change: best ? { criterionKey: best.criterionKey, from: best.from, to: best.to } : null,
    });
  }
  return out;
}

export type ModelWarningCode =
  'weight_concentrated' | 'too_many_criteria' | 'redundant_criteria' | 'non_discriminating';

export interface ModelWarning {
  readonly code: ModelWarningCode;
  readonly criterionKeys: string[];
}

function correlation(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (x[i] ?? 0) - mx;
    const dy = (y[i] ?? 0) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx < EPS || syy < EPS ? null : sxy / Math.sqrt(sxx * syy);
}

/** Problems with the model itself, found before the manager leans on its ranking. */
export function modelWarnings(
  alternatives: readonly ScoredAlternative[],
  criteria: readonly Criterion[],
): ModelWarning[] {
  const enabled = criteria.filter((c) => c.enabled);
  const out: ModelWarning[] = [];
  const heavy = enabled.filter((c) => c.weight >= CONCENTRATED_WEIGHT).map((c) => c.key);
  if (heavy.length > 0 && enabled.length > 1)
    out.push({ code: 'weight_concentrated', criterionKeys: heavy });
  if (enabled.length > MAX_SENSIBLE_CRITERIA)
    out.push({ code: 'too_many_criteria', criterionKeys: enabled.map((c) => c.key).sort(byKey) });
  const columns = enabled.map((c) => alternatives.map((a) => clampRaw(a.inputs[c.key])));
  const flat = enabled
    .filter((_, i) => new Set(columns[i]).size === 1)
    .map((c) => c.key)
    .sort(byKey);
  if (alternatives.length >= 2 && flat.length > 0)
    out.push({ code: 'non_discriminating', criterionKeys: flat });
  if (alternatives.length >= 4) {
    for (let i = 0; i < enabled.length; i += 1) {
      for (let j = i + 1; j < enabled.length; j += 1) {
        const r = correlation(columns[i] ?? [], columns[j] ?? []);
        if (r !== null && Math.abs(r) >= REDUNDANT_CORRELATION) {
          out.push({
            code: 'redundant_criteria',
            criterionKeys: [enabled[i]?.key ?? '', enabled[j]?.key ?? ''].sort(byKey),
          });
        }
      }
    }
  }
  return out;
}

export interface DecisionMatrixOptions extends SmaaOptions {
  /** A what-if weighting (whole percents for every enabled criterion); the saved weights stay as they are. */
  readonly weights?: Readonly<Record<string, number>>;
  /** Must-have minimum 1–5 score per criterion. */
  readonly minimums?: Readonly<Record<string, number>>;
}

export interface DecisionMatrix {
  readonly policy: typeof DECISION_MATRIX_POLICY;
  /** The criteria the ranking used (the what-if weights when given). */
  readonly criteria: Criterion[];
  readonly officialRanking: { id: string; total: number; rank: number }[];
  readonly ranking: { id: string; total: number; rank: number }[];
  readonly vetoed: Veto[];
  readonly dominated: Domination[];
  /** Null when fewer than two alternatives pass the vetoes. */
  readonly smaa: SmaaResult | null;
  readonly crossCheck: {
    readonly topsis: TopsisRow[];
    readonly tau: number;
    readonly sameWinner: boolean;
  };
  readonly flips: Flip[];
  readonly warnings: ModelWarning[];
}

/** One call that gives the whole decision matrix for a solution set. */
export function analyzeDecisionMatrix(
  alternatives: readonly ScoredAlternative[],
  criteria: readonly Criterion[],
  options: DecisionMatrixOptions = {},
): DecisionMatrix {
  if (
    alternatives.length < 2 ||
    alternatives.length > 20 ||
    new Set(alternatives.map((a) => a.id)).size !== alternatives.length
  )
    throw new Error('Provide 2–20 distinct alternatives.');
  const used = options.weights
    ? applyWeights(criteria, options.weights)
    : criteria.map((c) => ({ ...c }));
  const officialRanking = rankAlternatives(alternatives, criteria);
  const vetoed = evaluateVetoes(alternatives, options.minimums ?? {});
  const vetoedIds = new Set(vetoed.map((v) => v.id));
  const eligible = alternatives.filter((a) => !vetoedIds.has(a.id));
  const ranking = rankAlternatives(eligible.length > 0 ? eligible : alternatives, used);
  const topsisRows = topsis(eligible.length > 0 ? eligible : alternatives, used);
  const weighted = ranking.map(({ id, rank }) => ({ id, rank }));
  const tau = kendallTau(weighted, topsisRows);
  const winner = ranking.filter((r) => r.rank === 1).map((r) => r.id);
  const topsisWinner = topsisRows.filter((r) => r.rank === 1).map((r) => r.id);
  return {
    policy: DECISION_MATRIX_POLICY,
    criteria: used,
    officialRanking,
    ranking,
    vetoed,
    dominated: dominatedAlternatives(eligible.length > 0 ? eligible : alternatives, used),
    smaa:
      eligible.length >= 2
        ? smaa(eligible, used, {
            ...(options.mode ? { mode: options.mode } : {}),
            ...(options.weightOrder ? { weightOrder: options.weightOrder } : {}),
            ...(options.scoreSpread !== undefined ? { scoreSpread: options.scoreSpread } : {}),
            ...(options.iterations !== undefined ? { iterations: options.iterations } : {}),
            ...(options.seed !== undefined ? { seed: options.seed } : {}),
          })
        : null,
    crossCheck: {
      topsis: topsisRows,
      tau,
      sameWinner:
        winner.length === topsisWinner.length && winner.every((id) => topsisWinner.includes(id)),
    },
    flips: eligible.length >= 2 ? minimalFlips(eligible, used) : [],
    warnings: modelWarnings(alternatives, used),
  };
}

/** Totals for display, using the same rounding as the official score. */
export function totalsFor(
  alternatives: readonly ScoredAlternative[],
  criteria: readonly Criterion[],
): Record<string, number> {
  return Object.fromEntries(
    alternatives.map((a) => [a.id, scoreSolution(a.inputs, criteria).total]),
  );
}
