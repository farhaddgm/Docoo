import { describe, expect, it } from 'vitest';

import {
  canTransitionProject,
  InvalidProjectTransitionError,
  isProjectReadOnly,
  nextProjectAction,
  planProjectCommand,
  projectCommandRequiresReason,
  transitionProject,
  type ProjectState,
} from './project.js';

const state = (
  status: ProjectState['status'],
  previousStatus: ProjectState['previousStatus'] = null,
) => ({
  status,
  previousStatus,
});

describe('project state machine', () => {
  it('allows only documented status transitions', () => {
    expect(canTransitionProject('draft', 'active')).toBe(true);
    expect(canTransitionProject('active', 'paused')).toBe(true);
    expect(canTransitionProject('completed', 'active')).toBe(true);
    expect(canTransitionProject('draft', 'completed')).toBe(false);
    expect(canTransitionProject('paused', 'draft')).toBe(false);
    expect(() => transitionProject('draft', 'paused')).toThrow(InvalidProjectTransitionError);
  });

  it('runs the main lifecycle through commands', () => {
    let current: ProjectState = state('draft');
    for (const [command, expected] of [
      ['activate', 'active'],
      ['pause', 'paused'],
      ['resume', 'active'],
      ['complete', 'completed'],
      ['reopen', 'active'],
    ] as const) {
      const next = planProjectCommand(current, command);
      expect(next?.status).toBe(expected);
      current = next ?? current;
    }
  });

  it('returns to the previous state after unarchive and restore', () => {
    const archived = planProjectCommand(state('paused'), 'archive');
    expect(archived).toEqual({ status: 'archived', previousStatus: 'paused' });
    expect(planProjectCommand(archived!, 'unarchive')).toEqual({
      status: 'paused',
      previousStatus: null,
    });

    const deleted = planProjectCommand(state('completed'), 'delete');
    expect(deleted).toEqual({ status: 'deleted', previousStatus: 'completed' });
    expect(planProjectCommand(deleted!, 'restore')?.status).toBe('completed');

    const deletedFromArchive = planProjectCommand(state('archived', 'active'), 'delete');
    expect(deletedFromArchive).toEqual({ status: 'deleted', previousStatus: 'archived' });
    expect(planProjectCommand(deletedFromArchive!, 'restore')?.status).toBe('archived');
    expect(planProjectCommand(state('deleted'), 'restore')?.status).toBe('draft');
  });

  it('treats a repeated command as an idempotent no-op', () => {
    expect(planProjectCommand(state('paused'), 'pause')).toBeNull();
    expect(planProjectCommand(state('active'), 'resume')).toBeNull();
    expect(planProjectCommand(state('archived', 'draft'), 'archive')).toBeNull();
    expect(planProjectCommand(state('deleted', 'draft'), 'delete')).toBeNull();
  });

  it('rejects commands that are invalid from the current status', () => {
    expect(() => planProjectCommand(state('draft'), 'pause')).toThrow(
      InvalidProjectTransitionError,
    );
    expect(() => planProjectCommand(state('draft'), 'complete')).toThrow(
      InvalidProjectTransitionError,
    );
    expect(() => planProjectCommand(state('deleted', 'active'), 'activate')).toThrow(
      InvalidProjectTransitionError,
    );
    expect(() => planProjectCommand(state('archived', 'active'), 'pause')).toThrow(
      InvalidProjectTransitionError,
    );
  });

  it('marks sensitive commands, read-only states and next actions', () => {
    expect(projectCommandRequiresReason('pause')).toBe(true);
    expect(projectCommandRequiresReason('complete')).toBe(true);
    expect(projectCommandRequiresReason('activate')).toBe(false);
    expect(isProjectReadOnly('archived')).toBe(true);
    expect(isProjectReadOnly('deleted')).toBe(true);
    expect(isProjectReadOnly('paused')).toBe(false);
    expect(nextProjectAction('paused')).toBe('resolve_pause_and_resume');
    expect(nextProjectAction('deleted')).toBe('restore_before_purge');
  });
});
