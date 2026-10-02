export const projectStatuses = [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
  'deleted',
] as const;

export type ProjectStatus = (typeof projectStatuses)[number];

export const projectCommands = [
  'activate',
  'pause',
  'resume',
  'complete',
  'reopen',
  'archive',
  'unarchive',
  'delete',
  'restore',
] as const;

export type ProjectCommand = (typeof projectCommands)[number];

export interface ProjectState {
  readonly status: ProjectStatus;
  /** The last non-deleted, non-archived status, used by unarchive and restore. */
  readonly previousStatus: ProjectStatus | null;
}

/** Status graph of docs/02-domain/02-state-machines.md §1. */
const allowedTransitions: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  draft: ['active', 'archived', 'deleted'],
  active: ['paused', 'completed', 'archived', 'deleted'],
  paused: ['active', 'completed', 'archived', 'deleted'],
  completed: ['active', 'archived', 'deleted'],
  archived: ['draft', 'active', 'paused', 'completed', 'deleted'],
  deleted: ['draft', 'active', 'paused', 'completed', 'archived'],
};

const commandSources: Readonly<Record<ProjectCommand, readonly ProjectStatus[]>> = {
  activate: ['draft'],
  pause: ['active'],
  resume: ['paused'],
  complete: ['active', 'paused'],
  reopen: ['completed'],
  archive: ['draft', 'active', 'paused', 'completed'],
  unarchive: ['archived'],
  delete: ['draft', 'active', 'paused', 'completed', 'archived'],
  restore: ['deleted'],
};

/** Sensitive transitions that must carry a reason (state machine §10). */
const reasonRequired: ReadonlySet<ProjectCommand> = new Set(['pause', 'complete', 'reopen']);

export class InvalidProjectTransitionError extends Error {
  constructor(from: ProjectStatus, to: ProjectStatus | ProjectCommand) {
    super(`Project status cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidProjectTransitionError';
  }
}

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function transitionProject(from: ProjectStatus, to: ProjectStatus): ProjectStatus {
  if (!canTransitionProject(from, to)) {
    throw new InvalidProjectTransitionError(from, to);
  }

  return to;
}

export function projectCommandRequiresReason(command: ProjectCommand): boolean {
  return reasonRequired.has(command);
}

/** Target status of `command`, or null when the project already holds it (idempotent). */
export function planProjectCommand(
  state: ProjectState,
  command: ProjectCommand,
): ProjectState | null {
  const target = commandTarget(state, command);
  if (target.status === state.status && !commandSources[command].includes(state.status)) {
    return null;
  }
  if (!commandSources[command].includes(state.status)) {
    throw new InvalidProjectTransitionError(state.status, command);
  }
  transitionProject(state.status, target.status);
  return target;
}

function commandTarget(state: ProjectState, command: ProjectCommand): ProjectState {
  switch (command) {
    case 'activate':
    case 'resume':
    case 'reopen':
      return { status: 'active', previousStatus: state.previousStatus };
    case 'pause':
      return { status: 'paused', previousStatus: state.previousStatus };
    case 'complete':
      return { status: 'completed', previousStatus: state.previousStatus };
    case 'archive':
      return { status: 'archived', previousStatus: state.status };
    case 'delete':
      return {
        status: 'deleted',
        previousStatus: state.status === 'archived' ? 'archived' : state.status,
      };
    case 'unarchive':
      return { status: restorable(state.previousStatus, ['archived']), previousStatus: null };
    case 'restore':
      return { status: restorable(state.previousStatus, ['deleted']), previousStatus: null };
  }
}

function restorable(
  previous: ProjectStatus | null,
  excluded: readonly ProjectStatus[],
): ProjectStatus {
  return previous && !excluded.includes(previous) ? previous : 'draft';
}

/** Archived and deleted projects are read-only for edits and execution. */
export function isProjectReadOnly(status: ProjectStatus): boolean {
  return status === 'archived' || status === 'deleted';
}

export type ProjectNextAction =
  | 'complete_setup_and_activate'
  | 'monitor_progress'
  | 'resolve_pause_and_resume'
  | 'review_outputs'
  | 'unarchive_to_continue'
  | 'restore_before_purge';

/** Next step shown on the project page (FR-PRJ-007). */
export function nextProjectAction(status: ProjectStatus): ProjectNextAction {
  switch (status) {
    case 'draft':
      return 'complete_setup_and_activate';
    case 'active':
      return 'monitor_progress';
    case 'paused':
      return 'resolve_pause_and_resume';
    case 'completed':
      return 'review_outputs';
    case 'archived':
      return 'unarchive_to_continue';
    case 'deleted':
      return 'restore_before_purge';
  }
}
