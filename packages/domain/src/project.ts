export const projectStatuses = [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
  'deleted',
] as const;

export type ProjectStatus = (typeof projectStatuses)[number];

const allowedTransitions: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  draft: ['active', 'archived', 'deleted'],
  active: ['paused', 'completed', 'archived', 'deleted'],
  paused: ['active', 'archived', 'deleted'],
  completed: ['active', 'archived', 'deleted'],
  archived: ['draft', 'active', 'deleted'],
  deleted: ['draft', 'archived'],
};

export class InvalidProjectTransitionError extends Error {
  constructor(from: ProjectStatus, to: ProjectStatus) {
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
