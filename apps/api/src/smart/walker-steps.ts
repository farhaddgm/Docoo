import { STAGES } from '@docoo/orchestration';

/**
 * Smart walker: the guided path from an empty workspace to an approved, evaluated document
 * (docs/01-product/01-prd.md §5). The order is the recommended order; `requires` are hard
 * prerequisites. Completion is always computed by code from stored data, never by a model.
 */
export const WALKER_STEP_KEYS = [
  'connect_provider',
  'configure_ai',
  'create_topic',
  'add_sources',
  'approve_knowledge',
  'create_project',
  'activate_project',
  'complete_stages',
  'choose_solution',
  'evaluate_document',
  'approve_document',
  'review_brain',
] as const;

export type WalkerStepKey = (typeof WALKER_STEP_KEYS)[number];

interface StepDefinition {
  readonly key: WalkerStepKey;
  /** The step is about one project; without a selected project it cannot be started. */
  readonly project: boolean;
  readonly requires: readonly WalkerStepKey[];
}

export const WALKER_STEPS: readonly StepDefinition[] = [
  { key: 'connect_provider', project: false, requires: [] },
  { key: 'configure_ai', project: false, requires: ['connect_provider'] },
  { key: 'create_topic', project: false, requires: [] },
  { key: 'add_sources', project: false, requires: [] },
  { key: 'approve_knowledge', project: false, requires: ['add_sources'] },
  { key: 'create_project', project: false, requires: ['create_topic'] },
  { key: 'activate_project', project: true, requires: ['create_project', 'configure_ai'] },
  { key: 'complete_stages', project: true, requires: ['activate_project'] },
  { key: 'choose_solution', project: true, requires: ['activate_project'] },
  { key: 'evaluate_document', project: true, requires: ['choose_solution'] },
  { key: 'approve_document', project: true, requires: ['choose_solution'] },
  { key: 'review_brain', project: true, requires: ['activate_project'] },
];

/** Facts read from the database; the only input of {@link evaluateWalker}. */
export interface WalkerFacts {
  readonly providers: { readonly healthy: number; readonly total: number };
  readonly aiConfigured: boolean;
  readonly topics: number;
  readonly indexedSources: number;
  readonly approvedKnowledge: number;
  readonly projects: number;
  /** Present only when a project is selected. */
  readonly project: {
    readonly status: string;
    readonly completedStages: number;
    readonly pendingTasks: number;
    readonly selections: number;
    readonly documents: number;
    readonly approvedDocuments: number;
    readonly passedEvaluations: number;
    readonly brainReports: number;
  } | null;
}

export type WalkerStepStatus = 'done' | 'ready' | 'blocked';

export interface WalkerStepState {
  readonly key: WalkerStepKey;
  readonly order: number;
  readonly status: WalkerStepStatus;
  /** Why a blocked step cannot start: no project selected, or an unfinished prerequisite. */
  readonly blockedBy: 'project' | 'step' | null;
  readonly counter: { readonly current: number; readonly total: number } | null;
  /** Items that wait for the admin on this step (for example pending human tasks). */
  readonly attention: number;
}

export interface WalkerProgress {
  readonly steps: readonly WalkerStepState[];
  readonly doneCount: number;
  readonly total: number;
  readonly nextStep: WalkerStepKey | null;
}

const ACTIVE_PROJECT_STATUSES = new Set(['active', 'paused', 'completed']);

function isDone(key: WalkerStepKey, facts: WalkerFacts): boolean {
  const project = facts.project;
  switch (key) {
    case 'connect_provider':
      return facts.providers.healthy >= 1;
    case 'configure_ai':
      return facts.aiConfigured;
    case 'create_topic':
      return facts.topics >= 1;
    case 'add_sources':
      return facts.indexedSources >= 1;
    case 'approve_knowledge':
      return facts.approvedKnowledge >= 1;
    case 'create_project':
      return facts.projects >= 1;
    case 'activate_project':
      return project !== null && ACTIVE_PROJECT_STATUSES.has(project.status);
    case 'complete_stages':
      return project !== null && project.completedStages >= STAGES.length;
    case 'choose_solution':
      return project !== null && project.selections >= 1;
    case 'evaluate_document':
      return project !== null && project.passedEvaluations >= 1;
    case 'approve_document':
      return project !== null && project.approvedDocuments >= 1;
    case 'review_brain':
      return project !== null && project.brainReports >= 1;
  }
}

function counterOf(key: WalkerStepKey, facts: WalkerFacts): WalkerStepState['counter'] {
  const project = facts.project;
  if (key === 'connect_provider' && facts.providers.total > 0) {
    return { current: facts.providers.healthy, total: facts.providers.total };
  }
  if (key === 'complete_stages' && project) {
    return { current: Math.min(project.completedStages, STAGES.length), total: STAGES.length };
  }
  if (key === 'approve_document' && project && project.documents > 0) {
    return { current: project.approvedDocuments, total: project.documents };
  }
  return null;
}

export function evaluateWalker(facts: WalkerFacts): WalkerProgress {
  const done = new Set<WalkerStepKey>(
    WALKER_STEPS.filter((step) => isDone(step.key, facts)).map((step) => step.key),
  );
  const steps = WALKER_STEPS.map((step, index): WalkerStepState => {
    let status: WalkerStepStatus = 'ready';
    let blockedBy: WalkerStepState['blockedBy'] = null;
    if (done.has(step.key)) {
      status = 'done';
    } else if (step.project && facts.project === null) {
      status = 'blocked';
      blockedBy = 'project';
    } else if (step.requires.some((required) => !done.has(required))) {
      status = 'blocked';
      blockedBy = 'step';
    }
    return {
      key: step.key,
      order: index + 1,
      status,
      blockedBy,
      counter: counterOf(step.key, facts),
      attention: step.key === 'complete_stages' ? (facts.project?.pendingTasks ?? 0) : 0,
    };
  });
  return {
    steps,
    doneCount: done.size,
    total: steps.length,
    nextStep: steps.find((step) => step.status === 'ready')?.key ?? null,
  };
}
