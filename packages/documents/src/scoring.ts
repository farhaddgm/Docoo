/** Solution count limits (FR-SOL-001). */
export const SOLUTION_COUNT = { min: 2, max: 20, default: 5 } as const;

export interface Criterion {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  readonly enabled: boolean;
}

/** Default weighted criteria; projects may enable/disable and reweight them (FR-SOL-003). */
export const DEFAULT_CRITERIA: readonly Criterion[] = [
  { key: 'impact', label: 'Impact on the problem', weight: 25, enabled: true },
  { key: 'feasibility', label: 'Feasibility', weight: 20, enabled: true },
  { key: 'evidence', label: 'Strength of evidence', weight: 15, enabled: true },
  { key: 'cost', label: 'Cost and resources', weight: 15, enabled: true },
  { key: 'risk', label: 'Risk', weight: 15, enabled: true },
  { key: 'time', label: 'Time to value', weight: 10, enabled: true },
];

export function criteriaProblem(criteria: readonly Criterion[]): string | null {
  const keys = new Set<string>();
  for (const criterion of criteria) {
    if (!/^[a-z][a-z0-9_]{1,40}$/u.test(criterion.key))
      return `invalid criterion key ${criterion.key}`;
    if (keys.has(criterion.key)) return `duplicate criterion ${criterion.key}`;
    keys.add(criterion.key);
    if (!Number.isInteger(criterion.weight) || criterion.weight < 0 || criterion.weight > 100) {
      return `weight of ${criterion.key} must be a whole number from 0 to 100`;
    }
  }
  const enabled = criteria.filter((criterion) => criterion.enabled);
  if (enabled.length === 0) return 'at least one criterion must be enabled';
  const total = enabled.reduce((sum, criterion) => sum + criterion.weight, 0);
  return total === 100 ? null : `enabled weights must add up to 100 (now ${total})`;
}

export interface CriterionScore {
  readonly key: string;
  readonly label: string;
  readonly raw: number;
  readonly max: number;
  readonly weight: number;
  readonly weighted: number;
  readonly explanation: string;
}

export interface SolutionScore {
  readonly criteria: CriterionScore[];
  readonly total: number;
  readonly formula: string;
}

/** Raw 1–5 inputs, weighted contribution and a readable calculation per criterion (FR-SOL-004). */
export function scoreSolution(
  inputs: Readonly<Record<string, number>>,
  criteria: readonly Criterion[],
): SolutionScore {
  const enabled = criteria.filter((criterion) => criterion.enabled);
  const scores = enabled.map((criterion) => {
    const raw = Math.max(1, Math.min(5, Math.round(inputs[criterion.key] ?? 1)));
    const weighted = Math.round((raw / 5) * criterion.weight * 100) / 100;
    return {
      key: criterion.key,
      label: criterion.label,
      raw,
      max: 5,
      weight: criterion.weight,
      weighted,
      explanation: `${raw}/5 × ${criterion.weight} = ${weighted.toFixed(2)}`,
    };
  });
  const total = Math.round(scores.reduce((sum, score) => sum + score.weighted, 0) * 100) / 100;
  return { criteria: scores, total, formula: 'Σ (raw / 5 × weight), weights sum to 100' };
}
