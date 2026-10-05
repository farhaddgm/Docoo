/**
 * How a project is doing and how far it has come (UX §6: the health in the header, the milestone
 * in the overview). Derived only from facts the API already gives: the project's own status, its
 * latest workflow run, the stages of that run and the tasks waiting for a person.
 */

export const PROJECT_STAGES = [
  'analysis',
  'research',
  'ideation',
  'documentation',
  'evaluation',
] as const;

/** `ok` runs by itself, `waiting` needs a person, `blocked` cannot go on until something is fixed. */
export type HealthLevel = 'ok' | 'waiting' | 'blocked' | 'idle' | 'done';

export type HealthReason =
  | { code: 'paused'; detail: string | null }
  | { code: 'no_run' }
  | { code: 'run_failed' }
  | { code: 'run_paused' }
  | { code: 'run_cancelled' }
  | { code: 'run_completed' }
  | { code: 'run_waiting' }
  | { code: 'stage_failed'; stage: string }
  | { code: 'task'; kind: string; count: number };

export interface Health {
  level: HealthLevel;
  reasons: HealthReason[];
}

export interface WorkflowFacts {
  run: { status: string; currentStage: string | null } | null;
  stages: { stage: string; status: string }[];
  humanTasks: { kind: string }[];
}

/** Tasks that stop the project until the connection, the model or the cost limit is dealt with. */
const BLOCKING_TASKS = new Set(['provider_failure', 'configuration', 'cost_limit']);

const rank: Record<HealthLevel, number> = { ok: 0, idle: 0, done: 0, waiting: 1, blocked: 2 };

export function projectHealth(
  project: { status: string; pauseReason: string | null },
  workflow: WorkflowFacts | null,
): Health {
  if (project.status === 'completed') return { level: 'done', reasons: [] };
  if (project.status !== 'active' && project.status !== 'paused') {
    return { level: 'idle', reasons: [] };
  }

  let level: HealthLevel = 'ok';
  const reasons: HealthReason[] = [];
  const raise = (to: HealthLevel, reason: HealthReason) => {
    if (rank[to] > rank[level]) level = to;
    reasons.push(reason);
  };

  if (project.status === 'paused') {
    raise('blocked', { code: 'paused', detail: project.pauseReason });
  }
  if (workflow) {
    const { run } = workflow;
    if (!run) {
      if (project.status === 'active') raise('waiting', { code: 'no_run' });
    } else if (run.status === 'failed') raise('blocked', { code: 'run_failed' });
    else if (run.status === 'paused' && project.status !== 'paused') {
      raise('blocked', { code: 'run_paused' });
    } else if (run.status === 'cancelled') raise('waiting', { code: 'run_cancelled' });
    else if (run.status === 'completed') raise('waiting', { code: 'run_completed' });

    for (const stage of workflow.stages) {
      if (stage.status === 'failed') raise('blocked', { code: 'stage_failed', stage: stage.stage });
    }
    const counts = new Map<string, number>();
    for (const task of workflow.humanTasks) counts.set(task.kind, (counts.get(task.kind) ?? 0) + 1);
    for (const [kind, count] of counts) {
      raise(BLOCKING_TASKS.has(kind) ? 'blocked' : 'waiting', { code: 'task', kind, count });
    }
    // A run that waits for a person without a task listed still has to say so.
    if (run?.status === 'waiting_for_human' && counts.size === 0) {
      raise('waiting', { code: 'run_waiting' });
    }
  }
  return { level, reasons };
}

export interface Milestone {
  total: number;
  completed: number;
  /** The stage the run is on now; null before the first run and after the last stage. */
  current: string | null;
}

export function projectMilestone(projectStatus: string, workflow: WorkflowFacts | null): Milestone {
  const total = PROJECT_STAGES.length;
  if (projectStatus === 'completed') return { total, completed: total, current: null };
  if (!workflow) return { total, completed: 0, current: null };
  const done = new Set(
    workflow.stages.filter((stage) => stage.status === 'completed').map((stage) => stage.stage),
  );
  const completed = PROJECT_STAGES.filter((stage) => done.has(stage)).length;
  const live = workflow.run?.currentStage ?? null;
  const next = PROJECT_STAGES.find((stage) => !done.has(stage)) ?? null;
  return { total, completed, current: completed === total ? null : (live ?? next) };
}
