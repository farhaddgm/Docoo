import { projectHealth, type Health, type WorkflowFacts } from './project-health';

/**
 * The health of decisions, not only of the work that leads to them (NXT-006). Everything here is
 * derived from facts the API already gives; nothing is guessed and every verdict carries its reason.
 * The quality score follows the six elements of decision quality (Spetzler, Winter and Meyer):
 * frame, alternatives, information, values, reasoning and commitment.
 */
export const QUALITY_AXES = [
  'frame',
  'alternatives',
  'information',
  'values',
  'reasoning',
  'commitment',
] as const;
export type QualityAxis = (typeof QUALITY_AXES)[number];
/** 0 missing, 1 partly there, 2 done. */
export type AxisLevel = 0 | 1 | 2;

export type StabilityKind = 'stable' | 'fragile' | 'tie' | null;

export interface DecisionFacts {
  project: {
    id: string;
    code: string;
    title: string;
    status: string;
    pauseReason?: string | null;
    updatedAt: string;
  };
  workflow: WorkflowFacts | null;
  solutionCount: number;
  decided: boolean;
  lastDecisionAt: string | null;
  /** How firmly the ranking holds when the weights move; null when it could not be asked. */
  stability: StabilityKind;
}

export type Attention = 'urgent' | 'soon' | 'ok' | 'done';

export type AttentionReason =
  'blocked' | 'waiting_long' | 'waiting' | 'undecided_long' | 'undecided' | 'weak_axis' | 'idle';

export interface DecisionRow {
  id: string;
  code: string;
  title: string;
  health: Health;
  ageDays: number;
  attention: Attention;
  reasons: AttentionReason[];
  quality: { axes: Record<QualityAxis, AxisLevel>; score: number; weakest: QualityAxis | null };
}

export interface Thresholds {
  /** Days of waiting after which a decision deserves a look. */
  warnDays: number;
  /** Days after which it is urgent. */
  staleDays: number;
  /** `history` when learned from this workspace's own waiting times, `default` before enough exist. */
  source: 'history' | 'default';
}

export const DEFAULT_WARN_DAYS = 7;
export const DEFAULT_STALE_DAYS = 21;
/** Fewer waiting decisions than this are too few to learn a normal waiting time from. */
export const MIN_HISTORY = 5;
const DAY_MS = 86_400_000;

export function daysBetween(from: string, now: Date): number {
  const ms = now.getTime() - new Date(from).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / DAY_MS)) : 0;
}

/** Nearest-rank percentile (0–100) of a list of numbers; null for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

/**
 * What counts as a long wait, learned from how long this workspace's own decisions usually wait
 * (the 85th percentile; Vacanti). Until there are enough of them, fixed defaults are used and said so.
 */
export function learnThresholds(waitingAges: readonly number[]): Thresholds {
  if (waitingAges.length < MIN_HISTORY) {
    return { warnDays: DEFAULT_WARN_DAYS, staleDays: DEFAULT_STALE_DAYS, source: 'default' };
  }
  const p85 = percentile(waitingAges, 85) ?? DEFAULT_WARN_DAYS;
  const warnDays = Math.max(3, p85);
  return { warnDays, staleDays: Math.max(warnDays * 2, 7), source: 'history' };
}

function stageStatus(workflow: WorkflowFacts | null, stage: string): string | null {
  return workflow?.stages.find((s) => s.stage === stage)?.status ?? null;
}

const level = (status: string | null): AxisLevel =>
  status === 'completed' ? 2 : status === null || status === 'pending' ? 0 : 1;

export function decisionQuality(facts: DecisionFacts): DecisionRow['quality'] {
  const { workflow } = facts;
  const completed = facts.project.status === 'completed';
  const axes: Record<QualityAxis, AxisLevel> = {
    frame: completed ? 2 : level(stageStatus(workflow, 'analysis')),
    information: completed ? 2 : level(stageStatus(workflow, 'research')),
    alternatives: facts.solutionCount >= 3 ? 2 : facts.solutionCount === 2 ? 1 : 0,
    // The weights state the values; a ranking that holds when they move rests on values that matter less.
    values: facts.stability === 'stable' ? 2 : facts.stability === null ? 0 : 1,
    reasoning: completed
      ? 2
      : (Math.min(
          level(stageStatus(workflow, 'documentation')),
          level(stageStatus(workflow, 'evaluation')),
        ) as AxisLevel),
    commitment: facts.decided ? 2 : facts.solutionCount > 0 ? 1 : 0,
  };
  const total = QUALITY_AXES.reduce((n, axis) => n + axes[axis], 0);
  const lowest = Math.min(...QUALITY_AXES.map((axis) => axes[axis]));
  return {
    axes,
    score: Math.round((total / (QUALITY_AXES.length * 2)) * 100),
    weakest: QUALITY_AXES.find((axis) => axes[axis] === lowest && lowest < 2) ?? null,
  };
}

const rank: Record<Attention, number> = { urgent: 0, soon: 1, ok: 2, done: 3 };

export function assessDecision(
  facts: DecisionFacts,
  thresholds: Thresholds,
  now: Date,
): DecisionRow {
  const health = projectHealth(facts.project as never, facts.workflow);
  const lastTouch =
    facts.lastDecisionAt && facts.lastDecisionAt > facts.project.updatedAt
      ? facts.lastDecisionAt
      : facts.project.updatedAt;
  const ageDays = daysBetween(lastTouch, now);
  const quality = decisionQuality(facts);
  const reasons: AttentionReason[] = [];
  let attention: Attention = 'ok';
  const raise = (to: Attention, reason: AttentionReason) => {
    if (rank[to] < rank[attention]) attention = to;
    reasons.push(reason);
  };

  if (health.level === 'done') {
    return {
      id: facts.project.id,
      code: facts.project.code,
      title: facts.project.title,
      health,
      ageDays,
      attention: 'done',
      reasons,
      quality,
    };
  }
  if (health.level === 'blocked') raise('urgent', 'blocked');
  if (health.level === 'waiting') {
    if (ageDays >= thresholds.staleDays) raise('urgent', 'waiting_long');
    else if (ageDays >= thresholds.warnDays) raise('soon', 'waiting_long');
    else raise('ok', 'waiting');
  }
  if (health.level === 'idle') reasons.push('idle');
  if (!facts.decided && facts.solutionCount > 0 && health.level !== 'idle') {
    if (ageDays >= thresholds.staleDays) raise('urgent', 'undecided_long');
    else if (ageDays >= thresholds.warnDays) raise('soon', 'undecided_long');
    else raise('ok', 'undecided');
  }
  if (quality.weakest !== null && facts.solutionCount > 0 && quality.axes[quality.weakest] === 0) {
    raise('soon', 'weak_axis');
  }
  return {
    id: facts.project.id,
    code: facts.project.code,
    title: facts.project.title,
    health,
    ageDays,
    attention,
    reasons: [...new Set(reasons)],
    quality,
  };
}

/** The whole portfolio: thresholds learned from the waiting ones, then every decision assessed and ordered. */
export function assessPortfolio(
  facts: readonly DecisionFacts[],
  now: Date,
): { thresholds: Thresholds; rows: DecisionRow[] } {
  const waitingAges = facts
    .filter((f) => projectHealth(f.project as never, f.workflow).level === 'waiting')
    .map((f) => daysBetween(f.project.updatedAt, now));
  const thresholds = learnThresholds(waitingAges);
  const rows = facts
    .map((f) => assessDecision(f, thresholds, now))
    .sort(
      (a, b) =>
        rank[a.attention] - rank[b.attention] ||
        b.ageDays - a.ageDays ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    );
  return { thresholds, rows };
}
