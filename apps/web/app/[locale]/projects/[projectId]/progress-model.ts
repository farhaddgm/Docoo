/**
 * What a running stage tells the administrator about itself (ADR-0049): the steps it reported,
 * boiled down to a phase, the counts so far and the questions still open. Pure, so the page only
 * has to word it.
 */

export interface ProgressStep {
  readonly kind: string;
  readonly data: Record<string, unknown>;
  readonly createdAt?: string;
}

export type ProgressPhase =
  'starting' | 'searching' | 'checking' | 'judging' | 'reading' | 'writing';

export interface SideCount {
  readonly searches: number;
  readonly pages: number;
}

export interface ProgressSummary {
  readonly phase: ProgressPhase;
  readonly round: number;
  readonly maxRounds: number;
  /** Counts per search model; a single model has only `primary`. */
  readonly sides: Readonly<Record<string, SideCount>>;
  /** Questions with no answer yet, or null when the gap finder has not reported (or never runs). */
  readonly open: readonly string[] | null;
}

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const side = (data: Record<string, unknown>): string =>
  typeof data['side'] === 'string' && data['side'] !== '' ? data['side'] : 'primary';

export function summarizeProgress(steps: readonly ProgressStep[]): ProgressSummary | null {
  if (steps.length === 0) return null;
  let round = 0;
  let maxRounds = 1;
  const sides: Record<string, SideCount> = {};
  const openBySide: Record<string, string[]> = {};
  for (const step of steps) {
    if (step.kind === 'start') maxRounds = Math.max(1, num(step.data['maxRounds'], 1));
    if (step.kind === 'round') {
      round = Math.max(round, num(step.data['round']));
      sides[side(step.data)] = {
        searches: num(step.data['searches']),
        pages: num(step.data['pages']),
      };
    }
    if (step.kind === 'gaps') {
      openBySide[side(step.data)] = Array.isArray(step.data['open'])
        ? step.data['open'].filter((id): id is string => typeof id === 'string')
        : [];
    }
  }
  const last = steps[steps.length - 1]!.kind;
  const phase: ProgressPhase =
    last === 'writing'
      ? 'writing'
      : last === 'judge'
        ? 'judging'
        : last === 'reading'
          ? 'reading'
          : last === 'gaps'
            ? 'checking'
            : last === 'round'
              ? 'searching'
              : 'starting';
  // With two models a question is open only while neither has answered it.
  const reported = Object.values(openBySide);
  const open =
    reported.length === 0
      ? null
      : reported.length === 1
        ? reported[0]!
        : reported[0]!.filter((id) => reported.every((list) => list.includes(id)));
  return { phase, round, maxRounds, sides, open };
}
