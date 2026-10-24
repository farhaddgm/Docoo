/**
 * The project journey (ADR-0035): the six steps from creating a project to completing it, as
 * the person who runs it sees them. Every state is worked out from facts the API already gives
 * (the project, its latest workflow run, the stages of that run and the tasks waiting for a
 * person), so nothing about the journey is stored.
 */
import type { WorkflowFacts } from './project-health';

export const JOURNEY_STEPS = [
  'created',
  'activate',
  'analysis',
  'ideas',
  'documents',
  'complete',
] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/**
 * `done` is finished, `current` is the step in front of the person, `waiting` is the current step
 * when it needs them, `blocked` cannot go on until something is fixed and `upcoming` is later.
 */
export type JourneyState = 'done' | 'current' | 'waiting' | 'blocked' | 'upcoming';

export type JourneyBlock =
  'needs_problem' | 'needs_topics' | 'paused' | 'run_failed' | 'configuration' | 'cost_limit';

export interface JourneyItem {
  step: JourneyStep;
  state: JourneyState;
  /** Tasks waiting for the person on this step (only the current step carries them). */
  tasks: number;
  block: JourneyBlock | null;
}

interface JourneyProject {
  status: string;
  initialProblem: string;
  topics: readonly unknown[];
  availableCommands: readonly string[];
}

/** The workflow stages each of the three working steps covers. */
const STEP_STAGES: Record<'analysis' | 'ideas' | 'documents', readonly string[]> = {
  analysis: ['analysis'],
  ideas: ['research', 'ideation'],
  documents: ['documentation', 'evaluation'],
};

const BLOCKING_TASKS: Record<string, JourneyBlock> = {
  provider_failure: 'run_failed',
  configuration: 'configuration',
  cost_limit: 'cost_limit',
};

/** Whether the journey is shown at all: a finished, archived or deleted project has none. */
export function hasJourney(status: string): boolean {
  return status === 'draft' || status === 'active' || status === 'paused';
}

export function projectJourney(
  project: JourneyProject,
  workflow: WorkflowFacts | null,
): JourneyItem[] {
  const items: JourneyItem[] = JOURNEY_STEPS.map((step) => ({
    step,
    state: 'upcoming',
    tasks: 0,
    block: null,
  }));
  const at = (step: JourneyStep) => items.find((item) => item.step === step)!;
  at('created').state = 'done';

  if (project.status === 'draft') {
    const activate = at('activate');
    const block: JourneyBlock | null =
      project.initialProblem.trim() === ''
        ? 'needs_problem'
        : project.topics.length === 0
          ? 'needs_topics'
          : null;
    activate.state = block ? 'blocked' : 'current';
    activate.block = block;
    return items;
  }

  at('activate').state = 'done';
  if (project.status === 'completed') {
    for (const item of items) item.state = 'done';
    return items;
  }

  const stageDone = (stage: string) =>
    workflow?.stages.some((item) => item.stage === stage && item.status === 'completed') ?? false;
  let currentFound = false;
  for (const step of ['analysis', 'ideas', 'documents'] as const) {
    const item = at(step);
    if (STEP_STAGES[step].every(stageDone)) {
      item.state = 'done';
      continue;
    }
    if (!currentFound) {
      currentFound = true;
      item.state = 'current';
      markCurrent(item, project, workflow);
    }
  }
  if (!currentFound) {
    // Every stage is finished; only the person's decision to complete the project is left.
    const complete = at('complete');
    complete.state = project.availableCommands.includes('complete') ? 'current' : 'upcoming';
    if (project.status === 'paused') {
      complete.state = 'blocked';
      complete.block = 'paused';
    }
  }
  return items;
}

/** The current working step: waiting for the person, blocked, or simply running. */
function markCurrent(
  item: JourneyItem,
  project: JourneyProject,
  workflow: WorkflowFacts | null,
): void {
  if (project.status === 'paused') {
    item.state = 'blocked';
    item.block = 'paused';
    return;
  }
  const tasks = workflow?.humanTasks ?? [];
  const blocking = tasks.find((task) => task.kind in BLOCKING_TASKS);
  if (blocking) {
    item.state = 'blocked';
    item.block = BLOCKING_TASKS[blocking.kind] ?? null;
    return;
  }
  if (workflow?.run?.status === 'failed') {
    item.state = 'blocked';
    item.block = 'run_failed';
    return;
  }
  if (tasks.length > 0) {
    item.state = 'waiting';
    item.tasks = tasks.length;
  }
}
