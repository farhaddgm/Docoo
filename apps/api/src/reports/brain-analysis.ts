import { EVIDENCE_LIMIT, type Evidence } from './brain.js';

/**
 * Deterministic Brain analysis (ADR-0033). Pure rules over rows that were already read: they
 * turn what happened into ranked findings, each with evidence ids and concrete next actions.
 * A finding carries ids, kinds, counts and numbers only; the words a person reads are made by
 * the interface from `kind` and `params`. Nothing here changes any state.
 */
export const ANALYSIS_VERSION = 'brain-analysis-v1';

export type FindingKind =
  | 'knowledge_weak'
  | 'knowledge_unaudited'
  | 'knowledge_stale'
  | 'knowledge_contradiction'
  | 'quality_drift'
  | 'risky_decision'
  | 'cost_anomaly'
  | 'recurring_failure';

export type FindingSeverity = 'low' | 'medium' | 'high';

/** Actions that only open a page: nothing changes, so they need no approval. */
export type LinkActionKind =
  | 'open_knowledge'
  | 'open_conflicts'
  | 'open_project'
  | 'open_costs'
  | 'open_providers'
  | 'open_agent';

/** Actions that change something: they run only after an administrator approves them. */
export type ExecutableActionKind = 'audit_knowledge' | 'request_revision' | 'pause_project';

export type ActionKind = LinkActionKind | ExecutableActionKind;

export const EXECUTABLE_ACTIONS: readonly ExecutableActionKind[] = [
  'audit_knowledge',
  'request_revision',
  'pause_project',
];

export function isExecutableAction(kind: string): kind is ExecutableActionKind {
  return (EXECUTABLE_ACTIONS as readonly string[]).includes(kind);
}

export interface FindingAction {
  /** Unique inside its finding. */
  readonly key: string;
  readonly kind: ActionKind;
  readonly target: { readonly type: string; readonly id: string } | null;
  /** Values fixed when the report was made; an executable action is run from these, not from the request. */
  readonly params: Readonly<Record<string, string | number>>;
}

export interface Finding {
  /** Stable inside its report. */
  readonly key: string;
  readonly kind: FindingKind;
  readonly severity: FindingSeverity;
  /** 0 to 100; the list is sorted by it. */
  readonly score: number;
  readonly count: number;
  readonly projectId: string | null;
  /** Numbers and fixed codes the interface needs to word the finding. */
  readonly params: Readonly<Record<string, string | number>>;
  readonly evidence: readonly Evidence[];
  readonly actions: readonly FindingAction[];
}

export const FINDINGS_LIMIT = 40;
const ACTIONS_PER_FINDING = 6;

/** A row with the time it happened, which only feeds the recency part of the score. */
export interface Dated {
  readonly id: string;
  readonly at?: string | null | undefined;
}

export interface QualityWindow {
  /** Outputs that an administrator approved or rejected. */
  readonly reviewed: number;
  readonly rejected: number;
  readonly attempts: number;
  /** Attempts whose output did not match the stage schema. */
  readonly incomplete: number;
}

export interface AnalysisInput {
  /** The moment of the analysis (ISO); recency is measured from it. */
  readonly now: string;
  readonly projectId: string | null;
  readonly knowledge: {
    readonly weak: readonly (Dated & { itemId: string; overall: number })[];
    readonly unaudited: readonly (Dated & { itemId: string; ageDays: number })[];
    readonly stale: readonly (Dated & {
      itemId: string;
      reason: 'expired' | 'expiring' | 'source_changed';
    })[];
    readonly conflicts: readonly (Dated & {
      severity: 'low' | 'medium' | 'high';
      itemId: string;
    })[];
  };
  readonly stages: readonly {
    readonly stage: string;
    readonly role: string;
    readonly recent: QualityWindow;
    readonly previous: QualityWindow;
    readonly recentRejections: readonly Dated[];
    readonly recentIncomplete: readonly Dated[];
    /** Outputs that wait for an administrator's review now. */
    readonly waiting: readonly { projectId: string; stageRunId: string; outputId: string }[];
  }[];
  readonly decisions: {
    readonly passedStages: readonly (Dated & { projectId: string })[];
    readonly exceptions: readonly (Dated & { projectId: string })[];
    readonly overrides: readonly (Dated & { itemId: string })[];
  };
  readonly costs: {
    readonly projects: readonly {
      readonly projectId: string;
      readonly status: string;
      readonly version: number;
      readonly recentUsd: number;
      readonly previousUsd: number;
    }[];
    readonly unpriced: readonly Dated[];
  };
  readonly failures: {
    readonly invocations: readonly (Dated & { provider: string; errorCode: string })[];
    readonly exhaustedStages: readonly (Dated & { stage: string; projectId: string })[];
  };
}

/** Thresholds of `brain-analysis-v1`; a change of any of them is a new analysis version. */
export const THRESHOLDS = {
  weakKnowledgeBelow: 70,
  weakKnowledgeHighBelow: 55,
  unauditedDays: 3,
  unauditedHighDays: 14,
  driftPoints: 0.2,
  driftHighPoints: 0.4,
  driftMinReviewed: 3,
  driftMinAttempts: 3,
  costMinUsd: 1,
  costNoBaselineUsd: 5,
  costRatio: 2,
  costHighRatio: 4,
  costHighUsd: 20,
  failureMin: 3,
  failureHigh: 10,
  exhaustedMin: 2,
} as const;

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = { low: 15, medium: 35, high: 60 };
const DAY_MS = 86_400_000;

function recency(rows: readonly Dated[], now: number): number {
  let newest = 0;
  for (const row of rows) {
    const time = row.at ? Date.parse(row.at) : Number.NaN;
    if (Number.isFinite(time) && time > newest) newest = time;
  }
  if (newest === 0) return 0;
  const age = now - newest;
  return age <= 3 * DAY_MS ? 10 : age <= 7 * DAY_MS ? 6 : age <= 30 * DAY_MS ? 3 : 0;
}

/** The score of a finding: severity, how many things it covers, and how fresh the newest one is. */
export function scoreFinding(
  severity: FindingSeverity,
  count: number,
  rows: readonly Dated[],
  now: number,
): number {
  return Math.min(100, SEVERITY_WEIGHT[severity] + Math.min(count, 10) * 3 + recency(rows, now));
}

const rate = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
const percent = (value: number) => Math.round(value * 100);
const unique = <T>(values: readonly T[]) => [...new Set(values)];

/** Applies every rule; equal input gives equal output, in the same order. */
export function analyse(input: AnalysisInput): Finding[] {
  const now = Date.parse(input.now);
  const findings: Finding[] = [];
  const push = (finding: {
    key: string;
    kind: FindingKind;
    severity: FindingSeverity;
    count: number;
    projectId?: string | null;
    params?: Record<string, string | number>;
    rows: readonly (Dated & { type: string })[];
    actions: readonly FindingAction[];
  }) => {
    findings.push({
      key: finding.key,
      kind: finding.kind,
      severity: finding.severity,
      score: scoreFinding(finding.severity, finding.count, finding.rows, now),
      count: finding.count,
      projectId: finding.projectId ?? input.projectId,
      params: finding.params ?? {},
      evidence: finding.rows
        .slice(0, EVIDENCE_LIMIT)
        .map((row) => ({ type: row.type, id: row.id })),
      actions: finding.actions.slice(0, ACTIONS_PER_FINDING),
    });
  };
  const open = (kind: LinkActionKind, key: string, target: FindingAction['target']) =>
    ({ key, kind, target, params: {} }) satisfies FindingAction;
  const openKnowledge = (itemIds: readonly string[]) =>
    unique(itemIds)
      .slice(0, 3)
      .map((id) => open('open_knowledge', `open_knowledge:${id}`, { type: 'knowledge', id }));

  const { knowledge } = input;
  if (knowledge.weak.length > 0) {
    const worst = Math.min(...knowledge.weak.map((row) => row.overall));
    push({
      key: 'knowledge_weak',
      kind: 'knowledge_weak',
      severity: worst < THRESHOLDS.weakKnowledgeHighBelow ? 'high' : 'medium',
      count: knowledge.weak.length,
      params: { lowest: Math.round(worst), below: THRESHOLDS.weakKnowledgeBelow },
      rows: knowledge.weak.map((row) => ({ ...row, id: row.itemId, type: 'knowledge' })),
      actions: openKnowledge(
        [...knowledge.weak].sort((a, b) => a.overall - b.overall).map((row) => row.itemId),
      ),
    });
  }

  if (knowledge.unaudited.length > 0) {
    const oldest = [...knowledge.unaudited].sort((a, b) => b.ageDays - a.ageDays);
    const waiting = Math.max(...oldest.map((row) => row.ageDays));
    push({
      key: 'knowledge_unaudited',
      kind: 'knowledge_unaudited',
      severity: waiting >= THRESHOLDS.unauditedHighDays ? 'high' : 'medium',
      count: oldest.length,
      params: { oldestDays: waiting },
      rows: oldest.map((row) => ({ ...row, id: row.itemId, type: 'knowledge' })),
      actions: [
        ...oldest.slice(0, 3).map((row): FindingAction => ({
          key: `audit_knowledge:${row.itemId}`,
          kind: 'audit_knowledge',
          target: { type: 'knowledge', id: row.itemId },
          params: {},
        })),
        ...openKnowledge([oldest[0]!.itemId]),
      ],
    });
  }

  if (knowledge.stale.length > 0) {
    const count = (reason: string) => knowledge.stale.filter((row) => row.reason === reason).length;
    const expired = count('expired');
    push({
      key: 'knowledge_stale',
      kind: 'knowledge_stale',
      severity:
        expired >= 3 ? 'high' : expired > 0 || count('source_changed') > 0 ? 'medium' : 'low',
      count: knowledge.stale.length,
      params: { expired, expiring: count('expiring'), sourceChanged: count('source_changed') },
      rows: knowledge.stale.map((row) => ({ ...row, id: row.itemId, type: 'knowledge' })),
      actions: openKnowledge(
        [...knowledge.stale]
          .sort((a, b) => Number(b.reason === 'expired') - Number(a.reason === 'expired'))
          .map((row) => row.itemId),
      ),
    });
  }

  if (knowledge.conflicts.length > 0) {
    const high = knowledge.conflicts.filter((row) => row.severity === 'high').length;
    push({
      key: 'knowledge_contradiction',
      kind: 'knowledge_contradiction',
      severity: high > 0 ? 'high' : 'medium',
      count: knowledge.conflicts.length,
      params: { high },
      rows: knowledge.conflicts.map((row) => ({ ...row, type: 'knowledge_conflict' })),
      actions: [
        open('open_conflicts', 'open_conflicts', null),
        ...openKnowledge(knowledge.conflicts.map((row) => row.itemId)).slice(0, 1),
      ],
    });
  }

  for (const stage of input.stages) {
    const recentRejection = rate(stage.recent.rejected, stage.recent.reviewed);
    const previousRejection = rate(stage.previous.rejected, stage.previous.reviewed);
    const recentIncomplete = rate(stage.recent.incomplete, stage.recent.attempts);
    const previousIncomplete = rate(stage.previous.incomplete, stage.previous.attempts);
    const rejectionDelta =
      stage.recent.reviewed >= THRESHOLDS.driftMinReviewed
        ? recentRejection - previousRejection
        : 0;
    const incompleteDelta =
      stage.recent.attempts >= THRESHOLDS.driftMinAttempts
        ? recentIncomplete - previousIncomplete
        : 0;
    const delta = Math.max(rejectionDelta, incompleteDelta);
    if (delta < THRESHOLDS.driftPoints - 1e-9) continue;
    const byRejection = rejectionDelta >= incompleteDelta;
    const rows = byRejection
      ? stage.recentRejections.map((row) => ({ ...row, type: 'stage_review' }))
      : stage.recentIncomplete.map((row) => ({ ...row, type: 'stage_attempt' }));
    push({
      key: `quality_drift:${stage.stage}`,
      kind: 'quality_drift',
      severity: delta >= THRESHOLDS.driftHighPoints - 1e-9 ? 'high' : 'medium',
      count: byRejection ? stage.recent.rejected : stage.recent.incomplete,
      params: {
        stage: stage.stage,
        metric: byRejection ? 'rejection' : 'incomplete',
        recentPercent: percent(byRejection ? recentRejection : recentIncomplete),
        previousPercent: percent(byRejection ? previousRejection : previousIncomplete),
      },
      rows,
      actions: [
        open('open_agent', `open_agent:${stage.role}`, { type: 'role', id: stage.role }),
        ...stage.waiting.slice(0, 3).map((target): FindingAction => ({
          key: `request_revision:${target.outputId}`,
          kind: 'request_revision',
          target: { type: 'stage_output', id: target.outputId },
          params: {
            projectId: target.projectId,
            stageRunId: target.stageRunId,
            outputId: target.outputId,
            stage: stage.stage,
            recentPercent: percent(byRejection ? recentRejection : recentIncomplete),
          },
        })),
      ],
    });
  }

  const { decisions } = input;
  const projectOpen = (projectIds: readonly string[]) =>
    unique(projectIds)
      .slice(0, 3)
      .map((id) => open('open_project', `open_project:${id}`, { type: 'project', id }));
  if (decisions.passedStages.length > 0) {
    push({
      key: 'risky_decision:passed_stage',
      kind: 'risky_decision',
      severity: decisions.passedStages.length >= 3 ? 'high' : 'medium',
      count: decisions.passedStages.length,
      params: { variant: 'passed_stage' },
      rows: decisions.passedStages.map((row) => ({ ...row, type: 'stage_run' })),
      actions: projectOpen(decisions.passedStages.map((row) => row.projectId)),
    });
  }
  if (decisions.exceptions.length > 0) {
    push({
      key: 'risky_decision:exception',
      kind: 'risky_decision',
      severity: decisions.exceptions.length >= 3 ? 'medium' : 'low',
      count: decisions.exceptions.length,
      params: { variant: 'exception' },
      rows: decisions.exceptions.map((row) => ({ ...row, type: 'evaluation' })),
      actions: projectOpen(decisions.exceptions.map((row) => row.projectId)),
    });
  }
  if (decisions.overrides.length > 0) {
    push({
      key: 'risky_decision:override',
      kind: 'risky_decision',
      severity: decisions.overrides.length >= 3 ? 'high' : 'medium',
      count: decisions.overrides.length,
      params: { variant: 'override' },
      rows: decisions.overrides.map((row) => ({ ...row, type: 'audit_override' })),
      actions: openKnowledge(decisions.overrides.map((row) => row.itemId)),
    });
  }

  for (const project of input.costs.projects) {
    const baseline = project.previousUsd;
    const spiking =
      project.recentUsd >= THRESHOLDS.costMinUsd &&
      (baseline > 0
        ? project.recentUsd >= baseline * THRESHOLDS.costRatio
        : project.recentUsd >= THRESHOLDS.costNoBaselineUsd);
    if (!spiking) continue;
    const ratio = baseline > 0 ? project.recentUsd / baseline : 0;
    push({
      key: `cost_anomaly:spike:${project.projectId}`,
      kind: 'cost_anomaly',
      severity:
        project.recentUsd >= THRESHOLDS.costHighUsd || ratio >= THRESHOLDS.costHighRatio
          ? 'high'
          : 'medium',
      count: 1,
      projectId: project.projectId,
      params: {
        variant: 'spike',
        recentUsd: Math.round(project.recentUsd * 100) / 100,
        previousUsd: Math.round(baseline * 100) / 100,
      },
      rows: [{ id: project.projectId, type: 'project' }],
      actions: [
        open('open_costs', `open_costs:${project.projectId}`, {
          type: 'project',
          id: project.projectId,
        }),
        open('open_project', `open_project:${project.projectId}`, {
          type: 'project',
          id: project.projectId,
        }),
        ...(project.status === 'active'
          ? [
              {
                key: `pause_project:${project.projectId}`,
                kind: 'pause_project',
                target: { type: 'project', id: project.projectId },
                params: { projectId: project.projectId, expectedVersion: project.version },
              } satisfies FindingAction,
            ]
          : []),
      ],
    });
  }
  if (input.costs.unpriced.length > 0) {
    push({
      key: 'cost_anomaly:unpriced',
      kind: 'cost_anomaly',
      severity: 'low',
      count: input.costs.unpriced.length,
      params: { variant: 'unpriced' },
      rows: input.costs.unpriced.map((row) => ({ ...row, type: 'model_invocation' })),
      actions: [open('open_providers', 'open_providers', null)],
    });
  }

  const byCode = new Map<string, (Dated & { provider: string; errorCode: string })[]>();
  for (const row of input.failures.invocations) {
    const key = `${row.provider}:${row.errorCode}`;
    byCode.set(key, [...(byCode.get(key) ?? []), row]);
  }
  for (const [code, rows] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    if (rows.length < THRESHOLDS.failureMin) continue;
    push({
      key: `recurring_failure:provider:${code}`,
      kind: 'recurring_failure',
      severity: rows.length >= THRESHOLDS.failureHigh ? 'high' : 'medium',
      count: rows.length,
      params: { variant: 'provider', provider: rows[0]!.provider, errorCode: rows[0]!.errorCode },
      rows: rows.map((row) => ({ ...row, type: 'model_invocation' })),
      actions: [open('open_providers', 'open_providers', null)],
    });
  }
  const byStage = new Map<string, (Dated & { stage: string; projectId: string })[]>();
  for (const row of input.failures.exhaustedStages)
    byStage.set(row.stage, [...(byStage.get(row.stage) ?? []), row]);
  for (const [stage, rows] of [...byStage].sort(([a], [b]) => a.localeCompare(b))) {
    if (rows.length < THRESHOLDS.exhaustedMin) continue;
    push({
      key: `recurring_failure:attempts:${stage}`,
      kind: 'recurring_failure',
      severity: rows.length >= 4 ? 'high' : 'medium',
      count: rows.length,
      params: { variant: 'attempts', stage },
      rows: rows.map((row) => ({ ...row, type: 'stage_run' })),
      actions: projectOpen(rows.map((row) => row.projectId)),
    });
  }

  return findings
    .sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key))
    .slice(0, FINDINGS_LIMIT);
}

/**
 * The facts the model may see when it writes the optional plain-language summary: kinds,
 * severities and counts. No id, title, text or stage output is part of it.
 */
export function narrativeFacts(findings: readonly Finding[]) {
  return findings.slice(0, 12).map((finding) => ({
    kind: finding.kind,
    variant: typeof finding.params['variant'] === 'string' ? finding.params['variant'] : null,
    severity: finding.severity,
    count: finding.count,
  }));
}
