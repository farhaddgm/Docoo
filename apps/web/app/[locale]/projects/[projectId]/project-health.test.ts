import { describe, expect, it } from 'vitest';

import { projectHealth, projectMilestone, type WorkflowFacts } from './project-health';

const stages = (statuses: Record<string, string>): WorkflowFacts['stages'] =>
  ['analysis', 'research', 'ideation', 'documentation', 'evaluation'].map((stage) => ({
    stage,
    status: statuses[stage] ?? 'pending',
  }));

const running = (
  statuses: Record<string, string>,
  humanTasks: WorkflowFacts['humanTasks'] = [],
  runStatus = 'running',
  currentStage: string | null = 'research',
): WorkflowFacts => ({
  run: { status: runStatus, currentStage },
  stages: stages(statuses),
  humanTasks,
});

describe('project health', () => {
  it('is not assessed for a project that is not running', () => {
    expect(projectHealth({ status: 'draft', pauseReason: null }, null)).toEqual({
      level: 'idle',
      reasons: [],
    });
    expect(projectHealth({ status: 'archived', pauseReason: null }, running({}))).toMatchObject({
      level: 'idle',
    });
    expect(projectHealth({ status: 'completed', pauseReason: null }, running({}))).toEqual({
      level: 'done',
      reasons: [],
    });
  });

  it('is ok while the run goes on by itself', () => {
    expect(
      projectHealth(
        { status: 'active', pauseReason: null },
        running({ analysis: 'completed', research: 'running' }),
      ),
    ).toEqual({ level: 'ok', reasons: [] });
  });

  it('waits for a person when a task or a gate needs one', () => {
    const health = projectHealth(
      { status: 'active', pauseReason: null },
      running(
        { analysis: 'waiting_for_human' },
        [{ kind: 'gate_review' }, { kind: 'gate_review' }],
        'waiting_for_human',
        'analysis',
      ),
    );
    expect(health.level).toBe('waiting');
    expect(health.reasons).toEqual([{ code: 'task', kind: 'gate_review', count: 2 }]);
    expect(
      projectHealth(
        { status: 'active', pauseReason: null },
        running({}, [], 'waiting_for_human', 'analysis'),
      ).reasons,
    ).toEqual([{ code: 'run_waiting' }]);
  });

  it('is blocked by a failure that has to be fixed first, whatever else is waiting', () => {
    const health = projectHealth(
      { status: 'paused', pauseReason: 'Provider did not answer' },
      running(
        { research: 'failed' },
        [{ kind: 'provider_failure' }, { kind: 'gate_review' }],
        'paused',
      ),
    );
    expect(health.level).toBe('blocked');
    expect(health.reasons).toEqual([
      { code: 'paused', detail: 'Provider did not answer' },
      { code: 'stage_failed', stage: 'research' },
      { code: 'task', kind: 'provider_failure', count: 1 },
      { code: 'task', kind: 'gate_review', count: 1 },
    ]);
    for (const kind of ['configuration', 'cost_limit']) {
      expect(
        projectHealth({ status: 'active', pauseReason: null }, running({}, [{ kind }])).level,
      ).toBe('blocked');
    }
  });

  it('flags an active project with no run, or with a run that ended', () => {
    const active = { status: 'active', pauseReason: null };
    expect(projectHealth(active, { run: null, stages: stages({}), humanTasks: [] })).toEqual({
      level: 'waiting',
      reasons: [{ code: 'no_run' }],
    });
    expect(projectHealth(active, running({}, [], 'failed')).level).toBe('blocked');
    expect(projectHealth(active, running({}, [], 'cancelled')).level).toBe('waiting');
    expect(projectHealth(active, running({}, [], 'completed')).level).toBe('waiting');
    expect(projectHealth(active, running({}, [], 'paused')).reasons).toEqual([
      { code: 'run_paused' },
    ]);
  });

  it('still answers from the project alone when the workflow could not be read', () => {
    expect(projectHealth({ status: 'active', pauseReason: null }, null).level).toBe('ok');
    expect(projectHealth({ status: 'paused', pauseReason: null }, null)).toEqual({
      level: 'blocked',
      reasons: [{ code: 'paused', detail: null }],
    });
  });
});

describe('project milestone', () => {
  it('counts completed stages and names the one in progress', () => {
    expect(
      projectMilestone(
        'active',
        running(
          { analysis: 'completed', research: 'completed', ideation: 'running' },
          [],
          'running',
          'ideation',
        ),
      ),
    ).toEqual({ total: 5, completed: 2, current: 'ideation' });
  });

  it('falls back to the first unfinished stage when the run names none', () => {
    expect(
      projectMilestone('active', running({ analysis: 'completed' }, [], 'paused', null)),
    ).toEqual({ total: 5, completed: 1, current: 'research' });
  });

  it('is empty before the first run and full for a completed project', () => {
    expect(projectMilestone('draft', null)).toEqual({ total: 5, completed: 0, current: null });
    expect(projectMilestone('active', { run: null, stages: stages({}), humanTasks: [] })).toEqual({
      total: 5,
      completed: 0,
      current: 'analysis',
    });
    expect(projectMilestone('completed', null)).toEqual({ total: 5, completed: 5, current: null });
    expect(
      projectMilestone(
        'active',
        running(
          Object.fromEntries(
            ['analysis', 'research', 'ideation', 'documentation', 'evaluation'].map((stage) => [
              stage,
              'completed',
            ]),
          ),
          [],
          'completed',
          null,
        ),
      ),
    ).toEqual({ total: 5, completed: 5, current: null });
  });
});
