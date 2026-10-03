/** System rubric v1 (docs/03-ai/05-evaluation-and-quality.md §2). Weights sum to 100. */
export interface RubricCriterion {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  /** Stage a failing criterion goes back to by default (§4). */
  readonly targetStage: 'analysis' | 'research' | 'ideation' | 'documentation' | 'evaluation';
}

export interface Rubric {
  readonly criteria: readonly RubricCriterion[];
  readonly passThreshold: number;
  /** Criteria that must each reach this score regardless of the overall. */
  readonly minimums: Readonly<Record<string, number>>;
}

export const SYSTEM_RUBRIC: Rubric = {
  criteria: [
    {
      key: 'problem_fit',
      label: 'Fit with the approved problem',
      weight: 20,
      targetStage: 'analysis',
    },
    {
      key: 'requirement_coverage',
      label: 'Requirement coverage',
      weight: 15,
      targetStage: 'analysis',
    },
    { key: 'evidence', label: 'Evidence quality and links', weight: 15, targetStage: 'research' },
    {
      key: 'domain_fit',
      label: 'Fit with the domain and business',
      weight: 15,
      targetStage: 'ideation',
    },
    { key: 'feasibility', label: 'Feasibility', weight: 10, targetStage: 'ideation' },
    { key: 'risk', label: 'Risk and limitation analysis', weight: 10, targetStage: 'ideation' },
    {
      key: 'consistency',
      label: 'Consistency, no contradictions',
      weight: 5,
      targetStage: 'documentation',
    },
    { key: 'clarity', label: 'Clarity and structure', weight: 5, targetStage: 'documentation' },
    {
      key: 'format_compliance',
      label: 'Template, length and language compliance',
      weight: 5,
      targetStage: 'documentation',
    },
  ],
  passThreshold: 80,
  minimums: { evidence: 60, domain_fit: 60 },
};

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface DimensionScore {
  readonly criterion: string;
  readonly score: number;
  readonly evidence: string;
}

export interface Finding {
  readonly severity: Severity;
  readonly criterion: string;
  readonly evidence: string;
  readonly location: string;
  readonly targetStage: RubricCriterion['targetStage'];
}

export type EvaluationStatus =
  'passed' | 'failed_quality' | 'failed_compliance' | 'needs_human_decision' | 'technical_error';

export function rubricProblem(rubric: Rubric): string | null {
  const total = rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (total !== 100) return `rubric weights must add up to 100 (now ${total})`;
  if (rubric.passThreshold < 0 || rubric.passThreshold > 100) return 'pass threshold must be 0-100';
  for (const key of Object.keys(rubric.minimums)) {
    if (!rubric.criteria.some((criterion) => criterion.key === key))
      return `minimum for unknown criterion ${key}`;
  }
  return null;
}

/**
 * Combines judge scores with deterministic checks. Format compliance is never taken from
 * the judge: it comes from the length/schema/citation validator. Every dimension keeps its
 * evidence; failures become findings with severity and a target stage.
 */
export function decideEvaluation(
  rubric: Rubric,
  judged: readonly DimensionScore[],
  judgeFindings: readonly Finding[],
  compliance: {
    readonly ok: boolean;
    readonly problems: readonly string[];
    readonly location: string;
  },
): { status: EvaluationStatus; overall: number; scores: DimensionScore[]; findings: Finding[] } {
  const scores: DimensionScore[] = rubric.criteria.map((criterion) => {
    if (criterion.key === 'format_compliance') {
      return {
        criterion: criterion.key,
        score: compliance.ok ? 100 : 0,
        evidence: compliance.ok
          ? 'Length, schema and citations validated.'
          : compliance.problems.join('; '),
      };
    }
    const found = judged.find((item) => item.criterion === criterion.key);
    return {
      criterion: criterion.key,
      score: Math.max(0, Math.min(100, Math.round(found?.score ?? 0))),
      evidence: found?.evidence?.trim() || 'No evidence given by the evaluator.',
    };
  });
  const overall =
    Math.round(
      rubric.criteria.reduce(
        (sum, criterion, index) => sum + (scores[index]!.score * criterion.weight) / 100,
        0,
      ) * 100,
    ) / 100;
  const findings: Finding[] = [...judgeFindings];
  if (!compliance.ok) {
    findings.push({
      severity: 'high',
      criterion: 'format_compliance',
      evidence: compliance.problems.join('; '),
      location: compliance.location,
      targetStage: 'documentation',
    });
  }
  for (const [key, minimum] of Object.entries(rubric.minimums)) {
    const score = scores.find((item) => item.criterion === key)!;
    if (score.score < minimum && !findings.some((finding) => finding.criterion === key)) {
      const criterion = rubric.criteria.find((item) => item.key === key)!;
      findings.push({
        severity: 'high',
        criterion: key,
        evidence: `${criterion.label} scored ${score.score}, below the minimum ${minimum}. ${score.evidence}`,
        location: 'document',
        targetStage: criterion.targetStage,
      });
    }
  }
  let status: EvaluationStatus;
  if (!compliance.ok) status = 'failed_compliance';
  else if (
    findings.some((finding) => finding.severity === 'critical' || finding.severity === 'high')
  )
    status = 'failed_quality';
  else if (overall < rubric.passThreshold) status = 'failed_quality';
  else status = 'passed';
  return { status, overall, scores, findings };
}
