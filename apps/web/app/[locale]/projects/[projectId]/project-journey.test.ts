import { describe, expect, it } from 'vitest';

import { hasJourney, projectJourney, type JourneyState, type JourneyStep } from './project-journey';
import type { WorkflowFacts } from './project-health';

const project = (over: Partial<Parameters<typeof projectJourney>[0]> = {}) => ({
  status: 'active',
  initialProblem: 'A problem',
  topics: [{}],
  availableCommands: [] as string[],
  ...over,
});
const flow = (over: Partial<WorkflowFacts> = {}): WorkflowFacts => ({
  run: { status: 'running', currentStage: 'analysis' },
  stages: [],
  humanTasks: [],
  ...over,
});
const states = (items: ReturnType<typeof projectJourney>) =>
  Object.fromEntries(items.map((item) => [item.step, item.state])) as Record<
    JourneyStep,
    JourneyState
  >;

describe('project journey', () => {
  it('shows a draft ready to activate', () => {
    const items = projectJourney(project({ status: 'draft' }), null);
    expect(states(items)).toEqual({
      created: 'done',
      activate: 'current',
      analysis: 'upcoming',
      ideas: 'upcoming',
      documents: 'upcoming',
      complete: 'upcoming',
    });
  });

  it('blocks activation without a problem or a topic and says which', () => {
    const noTopic = projectJourney(project({ status: 'draft', topics: [] }), null);
    expect(noTopic[1]).toMatchObject({ state: 'blocked', block: 'needs_topics' });
    const noProblem = projectJourney(project({ status: 'draft', initialProblem: '  ' }), null);
    expect(noProblem[1]).toMatchObject({ state: 'blocked', block: 'needs_problem' });
  });

  it('starts at the analysis once active, even before the first run', () => {
    expect(states(projectJourney(project(), null)).analysis).toBe('current');
    expect(states(projectJourney(project(), flow())).activate).toBe('done');
  });

  it('waits for the person when tasks are open and counts them', () => {
    const items = projectJourney(
      project(),
      flow({ humanTasks: [{ kind: 'analysis_answers' }, { kind: 'agent_question' }] }),
    );
    expect(items[2]).toMatchObject({ state: 'waiting', tasks: 2 });
  });

  it('moves on as stages complete', () => {
    const items = projectJourney(
      project(),
      flow({
        stages: [
          { stage: 'analysis', status: 'completed' },
          { stage: 'research', status: 'completed' },
          { stage: 'ideation', status: 'running' },
        ],
      }),
    );
    expect(states(items)).toMatchObject({
      analysis: 'done',
      ideas: 'current',
      documents: 'upcoming',
    });
  });

  it('is blocked by a paused project, a failed provider, a missing model or the cost ceiling', () => {
    expect(projectJourney(project({ status: 'paused' }), flow())[2]).toMatchObject({
      state: 'blocked',
      block: 'paused',
    });
    const kinds = [
      ['provider_failure', 'run_failed'],
      ['configuration', 'configuration'],
      ['cost_limit', 'cost_limit'],
    ] as const;
    for (const [kind, block] of kinds) {
      expect(projectJourney(project(), flow({ humanTasks: [{ kind }] }))[2]).toMatchObject({
        state: 'blocked',
        block,
      });
    }
    expect(
      projectJourney(project(), flow({ run: { status: 'failed', currentStage: 'analysis' } }))[2],
    ).toMatchObject({ state: 'blocked', block: 'run_failed' });
  });

  it('offers to complete the project when every stage is done', () => {
    const stages = ['analysis', 'research', 'ideation', 'documentation', 'evaluation'].map(
      (stage) => ({ stage, status: 'completed' }),
    );
    const items = projectJourney(project({ availableCommands: ['complete'] }), flow({ stages }));
    expect(states(items)).toMatchObject({ documents: 'done', complete: 'current' });
    expect(
      states(projectJourney(project({ availableCommands: [] }), flow({ stages }))).complete,
    ).toBe('upcoming');
  });

  it('is all done for a completed project', () => {
    const items = projectJourney(project({ status: 'completed' }), null);
    expect(items.every((item) => item.state === 'done')).toBe(true);
  });

  it('is shown only while the project is being worked on', () => {
    expect(['draft', 'active', 'paused'].every(hasJourney)).toBe(true);
    expect(['completed', 'archived', 'deleted'].some(hasJourney)).toBe(false);
  });
});
