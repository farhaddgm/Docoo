/**
 * Brain performance rules (REP-002, FR-BRN-001..005). Each rule names the charter clause it
 * checks (docs/03-ai/02-agent-charters.md, charter version below), reports a deviation only
 * with evidence, and turns it into a recommendation. Rules never change any state.
 */
export const CHARTER_VERSION = 'charter-v1';

export const STAGE_ROLE = {
  analysis: 'analyst',
  research: 'researcher',
  ideation: 'ideator',
  documentation: 'documenter',
  evaluation: 'evaluator',
} as const;

export type Role = (typeof STAGE_ROLE)[keyof typeof STAGE_ROLE] | 'brain';
export type Severity = 'low' | 'medium' | 'high';

export interface Evidence {
  readonly type: string;
  readonly id: string;
}

export interface Deviation {
  readonly rule: string;
  readonly clause: string;
  readonly role: Role;
  readonly severity: Severity;
  readonly count: number;
  readonly detail: string;
  readonly evidence: readonly Evidence[];
}

export interface Recommendation {
  readonly rule: string;
  readonly target: 'charter' | 'rubric' | 'source_policy' | 'provider' | 'stage_prompt';
  readonly action: string;
  readonly evidence: readonly Evidence[];
}

/** Evidence lists are capped so a report stays readable; `count` keeps the full number. */
export const EVIDENCE_LIMIT = 20;

export interface RuleInput {
  /** Attempts whose output did not match the schema, per stage. */
  readonly incompleteAttempts: readonly { stage: string; id: string }[];
  /** Rejected stage outputs, per stage, with the total reviewed outputs. */
  readonly rejections: readonly { stage: string; id: string }[];
  readonly reviewedOutputs: Readonly<Record<string, number>>;
  /** Stages that ran out of attempts or were passed by an administrator decision. */
  readonly exhaustedStages: readonly { stage: string; id: string; passedByDecision: boolean }[];
  /** Evaluation findings, with their target stage. */
  readonly findings: readonly {
    id: string;
    targetStage: string;
    severity: string;
    evidence: string;
    location: string;
  }[];
  /** Documents that were submitted outside their length level. */
  readonly nonCompliantDocuments: readonly { id: string }[];
  /** Evaluations accepted with an exception. */
  readonly exceptions: readonly { id: string }[];
  /** Open high-severity knowledge conflicts. */
  readonly openConflicts: readonly { id: string }[];
  /** Human overrides of Brain knowledge audits. */
  readonly overrides: readonly { id: string }[];
  /** Model invocations that failed permanently. */
  readonly failedInvocations: readonly { id: string; provider: string }[];
}

function evidence(type: string, rows: readonly { id: string }[]): Evidence[] {
  return rows.slice(0, EVIDENCE_LIMIT).map((row) => ({ type, id: row.id }));
}

function groupBy<T extends { stage: string }>(rows: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.stage, [...(groups.get(row.stage) ?? []), row]);
  return groups;
}

function roleOf(stage: string): Role {
  return STAGE_ROLE[stage as keyof typeof STAGE_ROLE] ?? 'brain';
}

/** Applies every rule; output order is stable so equal inputs give equal reports. */
export function evaluateRules(input: RuleInput): {
  deviations: Deviation[];
  recommendations: Recommendation[];
} {
  const deviations: Deviation[] = [];
  const recommendations: Recommendation[] = [];
  const add = (deviation: Deviation, recommendation: Omit<Recommendation, 'rule' | 'evidence'>) => {
    deviations.push(deviation);
    recommendations.push({ ...recommendation, rule: deviation.rule, evidence: deviation.evidence });
  };

  for (const [stage, rows] of [...groupBy(input.incompleteAttempts)].sort()) {
    add(
      {
        rule: 'schema_compliance',
        clause: 'common.7',
        role: roleOf(stage),
        severity: rows.length >= 3 ? 'high' : 'medium',
        count: rows.length,
        detail: `${rows.length} ${stage} attempt(s) returned output that did not match the stage schema.`,
        evidence: evidence('stage_attempt', rows),
      },
      {
        target: 'stage_prompt',
        action: `Tighten the ${stage} output instructions and schema examples; review the listed attempts.`,
      },
    );
  }

  for (const [stage, rows] of [...groupBy(input.rejections)].sort()) {
    const reviewed = Math.max(input.reviewedOutputs[stage] ?? rows.length, rows.length);
    const rate = rows.length / reviewed;
    if (rate < 0.3 && rows.length < 3) continue;
    add(
      {
        rule: 'feedback_rejections',
        clause: 'common.10',
        role: roleOf(stage),
        severity: rate >= 0.5 ? 'high' : 'medium',
        count: rows.length,
        detail: `${rows.length} of ${reviewed} reviewed ${stage} output(s) were rejected (${Math.round(rate * 100)}%).`,
        evidence: evidence('stage_review', rows),
      },
      {
        target: 'charter',
        action: `Review the ${roleOf(stage)} duties against the rejection comments and update the charter or prompt.`,
      },
    );
  }

  for (const [stage, rows] of [...groupBy(input.exhaustedStages)].sort()) {
    const passed = rows.filter((row) => row.passedByDecision).length;
    add(
      {
        rule: 'attempt_limit',
        clause: 'workflow.attempt_limit',
        role: roleOf(stage),
        severity: 'medium',
        count: rows.length,
        detail: `${rows.length} ${stage} stage run(s) used every attempt; ${passed} continued only by an administrator decision.`,
        evidence: evidence('stage_run', rows),
      },
      {
        target: 'stage_prompt',
        action: `Analyse why ${stage} needs many attempts before raising the attempt limit.`,
      },
    );
  }

  const unsupported = input.findings.filter(
    (finding) => !finding.evidence.trim() || !finding.location.trim(),
  );
  if (unsupported.length > 0) {
    add(
      {
        rule: 'finding_evidence',
        clause: 'evaluator.principles.1',
        role: 'evaluator',
        severity: 'high',
        count: unsupported.length,
        detail: `${unsupported.length} evaluation finding(s) have no evidence or location.`,
        evidence: evidence('evaluation_finding', unsupported),
      },
      {
        target: 'rubric',
        action:
          'Require evidence and location in the evaluator output schema; re-run the affected evaluations.',
      },
    );
  }

  const serious = input.findings.filter((finding) =>
    ['critical', 'high'].includes(finding.severity),
  );
  for (const [stage, rows] of [
    ...groupBy(serious.map((finding) => ({ ...finding, stage: finding.targetStage }))),
  ].sort()) {
    add(
      {
        rule: 'quality_findings',
        clause: 'evaluation.target_stage',
        role: roleOf(stage),
        severity: 'high',
        count: rows.length,
        detail: `${rows.length} high or critical finding(s) were sent back to ${stage}.`,
        evidence: evidence('evaluation_finding', rows),
      },
      {
        target: 'charter',
        action: `Compare the ${roleOf(stage)} output with its principles for the listed findings.`,
      },
    );
  }

  if (input.nonCompliantDocuments.length > 0) {
    add(
      {
        rule: 'length_level',
        clause: 'documenter.principles.1',
        role: 'documenter',
        severity: 'medium',
        count: input.nonCompliantDocuments.length,
        detail: `${input.nonCompliantDocuments.length} document(s) were outside their length level at submission.`,
        evidence: evidence('document', input.nonCompliantDocuments),
      },
      {
        target: 'stage_prompt',
        action: 'Allocate the length budget per section before drafting (documenter duty 2).',
      },
    );
  }

  if (input.exceptions.length > 0) {
    add(
      {
        rule: 'accepted_exceptions',
        clause: 'evaluation.exception',
        role: 'evaluator',
        severity: 'low',
        count: input.exceptions.length,
        detail: `${input.exceptions.length} failed evaluation(s) were accepted with an exception.`,
        evidence: evidence('evaluation', input.exceptions),
      },
      {
        target: 'rubric',
        action: 'Check whether the rubric thresholds match what administrators accept in practice.',
      },
    );
  }

  if (input.openConflicts.length > 0) {
    add(
      {
        rule: 'open_conflicts',
        clause: 'common.5',
        role: 'researcher',
        severity: 'high',
        count: input.openConflicts.length,
        detail: `${input.openConflicts.length} high-severity knowledge conflict(s) are still open.`,
        evidence: evidence('knowledge_conflict', input.openConflicts),
      },
      {
        target: 'source_policy',
        action:
          'Resolve the conflicts or mark the weaker sources; conflicted knowledge stays flagged in retrieval.',
      },
    );
  }

  if (input.overrides.length > 0) {
    add(
      {
        rule: 'audit_overrides',
        clause: 'brain.principles.3',
        role: 'brain',
        severity: input.overrides.length >= 3 ? 'medium' : 'low',
        count: input.overrides.length,
        detail: `${input.overrides.length} Brain knowledge audit(s) were overridden by an administrator.`,
        evidence: evidence('audit_override', input.overrides),
      },
      {
        target: 'rubric',
        action: 'Review the knowledge audit rubric where administrators disagree with Brain.',
      },
    );
  }

  const byProvider = new Map<string, { id: string }[]>();
  for (const row of input.failedInvocations)
    byProvider.set(row.provider, [...(byProvider.get(row.provider) ?? []), row]);
  for (const [provider, rows] of [...byProvider].sort()) {
    add(
      {
        rule: 'provider_failures',
        clause: 'brain.performance.2',
        role: 'brain',
        severity: rows.length >= 5 ? 'high' : 'low',
        count: rows.length,
        detail: `${rows.length} ${provider} invocation(s) failed permanently.`,
        evidence: evidence('model_invocation', rows),
      },
      {
        target: 'provider',
        action: `Check the ${provider} connection health, quota and model availability.`,
      },
    );
  }

  return { deviations, recommendations };
}
