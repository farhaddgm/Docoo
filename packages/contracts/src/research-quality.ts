import {
  presetOf,
  researchValuesOf,
  RESEARCH_PRESET_IDS,
  type ResearchPresetId,
} from './research-presets.js';

/**
 * How each research mode has actually fared in a workspace (ADR-0052): from the research stages it
 * completed, grouped by the mode its settings amounted to, how many questions got answered, how
 * many citations verified, how many findings were solid, and what that cost. Pure: the API fetches
 * the small parts of each stored output and this turns them into the report. Measured from the
 * workspace's own work, so nothing is invented and nothing is compared before there is enough of it.
 */

export type ResearchMode = ResearchPresetId | 'custom';

/** A mode needs this many completed researches before its numbers are shown as an experience. */
export const MIN_QUALITY_RUNS = 3;

/** One completed research stage, as the API reads it. */
export interface ResearchRunRow {
  /** The settings the run started with (its configuration snapshot). */
  readonly resolved: Readonly<Record<string, unknown>> | null;
  /** Total cost of every model call of the stage, in dollars; null or 0 when unpriced. */
  readonly costUsd: number | null;
  /** Seconds the successful attempt took. */
  readonly seconds: number | null;
  /** The few parts of the stored output the report reads. */
  readonly quality: unknown;
}

interface RunFacts {
  readonly mode: ResearchMode;
  readonly costUsd: number | null;
  readonly seconds: number | null;
  /** Present only for an output that has a summary (ADR-0038). */
  readonly findings: number | null;
  readonly solid: number | null;
  readonly questionsTotal: number;
  readonly questionsAnswered: number;
  readonly citations: number;
  readonly verified: number;
  readonly unanswerable: number;
  readonly conflicts: number;
  readonly rounds: number;
}

const obj = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

function factsOf(row: ResearchRunRow): RunFacts {
  const quality = obj(row.quality) ?? {};
  const summary = obj(quality['summary']);
  const verification = obj(quality['verification']);
  const web = obj(quality['web']);
  const questions = obj(summary?.['questions']);
  const gaps = Array.isArray(web?.['gaps']) ? web['gaps'] : [];
  return {
    mode: presetOf(researchValuesOf(row.resolved ?? {})),
    costUsd: row.costUsd !== null && row.costUsd > 0 ? row.costUsd : null,
    seconds: row.seconds !== null && row.seconds > 0 ? row.seconds : null,
    findings: summary ? count(summary['findings']) : null,
    solid: summary ? count(summary['solid']) : null,
    questionsTotal: count(questions?.['total']),
    questionsAnswered: count(questions?.['answered']),
    citations: count(verification?.['citations']),
    verified: count(verification?.['verified']),
    unanswerable: gaps.filter((gap) => obj(gap)?.['unanswerable'] === true).length,
    conflicts: count(quality['conflicts']),
    rounds: Math.max(1, count(web?.['rounds'])),
  };
}

export interface ModeQuality {
  readonly mode: ResearchMode;
  readonly runs: number;
  /** Share of findings that were solid (0..1); null when no run had a summary. */
  readonly solidShare: number | null;
  /** Share of citations that verified; null when no citation was made. */
  readonly verifiedShare: number | null;
  /** Share of planned questions that were answered; null when no run had a plan. */
  readonly answeredShare: number | null;
  readonly unanswerablePerRun: number;
  readonly conflictsPerRun: number;
  readonly roundsPerRun: number;
  /** Over the runs that have a price; null when none has. */
  readonly avgCostUsd: number | null;
  readonly avgSeconds: number | null;
  /** Dollars per solid finding, over priced runs; null when none had a solid finding. */
  readonly costPerSolidUsd: number | null;
}

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);
const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);
const MODE_ORDER: readonly ResearchMode[] = [...RESEARCH_PRESET_IDS, 'custom'];

/**
 * The report: one entry per mode that has runs, in the fixed order of the modes. Shares are the
 * ratio of totals (a big run counts for more than a small one), not the mean of per-run ratios.
 */
export function aggregateModes(rows: readonly ResearchRunRow[]): ModeQuality[] {
  const facts = rows.map(factsOf);
  return MODE_ORDER.flatMap((mode) => {
    const runs = facts.filter((item) => item.mode === mode);
    if (runs.length === 0) return [];
    const withSummary = runs.filter((item) => item.findings !== null);
    const priced = runs.filter((item) => item.costUsd !== null);
    const timed = runs.filter((item) => item.seconds !== null);
    const pricedWithSolid = priced.filter((item) => item.solid !== null);
    const solidTotal = sum(pricedWithSolid.map((item) => item.solid ?? 0));
    return [
      {
        mode,
        runs: runs.length,
        solidShare: ratio(
          sum(withSummary.map((item) => item.solid ?? 0)),
          sum(withSummary.map((item) => item.findings ?? 0)),
        ),
        verifiedShare: ratio(
          sum(runs.map((item) => item.verified)),
          sum(runs.map((item) => item.citations)),
        ),
        answeredShare: ratio(
          sum(runs.map((item) => item.questionsAnswered)),
          sum(runs.map((item) => item.questionsTotal)),
        ),
        unanswerablePerRun: sum(runs.map((item) => item.unanswerable)) / runs.length,
        conflictsPerRun: sum(runs.map((item) => item.conflicts)) / runs.length,
        roundsPerRun: sum(runs.map((item) => item.rounds)) / runs.length,
        avgCostUsd:
          priced.length > 0 ? sum(priced.map((item) => item.costUsd ?? 0)) / priced.length : null,
        avgSeconds:
          timed.length > 0 ? sum(timed.map((item) => item.seconds ?? 0)) / timed.length : null,
        costPerSolidUsd:
          solidTotal > 0
            ? sum(pricedWithSolid.map((item) => item.costUsd ?? 0)) / solidTotal
            : null,
      },
    ];
  });
}
