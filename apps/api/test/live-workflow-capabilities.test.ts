import { describe, expect, it, vi } from 'vitest';

import { LiveCapabilityRegistry } from '../src/live-assistant/capabilities.js';
import { CAPABILITY_TOOLS } from '../src/live-assistant/capability-tools.js';
import { decideProposal, liveSettingsFrom } from '../src/live-assistant/live-gateway.js';
import { workflowCapabilities } from '../src/live-assistant/workflow-capabilities.js';
import type { ProjectsService } from '../src/projects/projects.service.js';
import type { WorkflowService } from '../src/workflow/workflow.service.js';

const P1 = '11111111-1111-4111-8111-111111111111';
const STAGE = '55555555-5555-4555-8555-555555555555';
const OUTPUT = '66666666-6666-4666-8666-666666666666';
const QUESTION = '77777777-7777-4777-8777-777777777777';
const ACTION = '88888888-8888-4888-8888-888888888888';
const context = {
  workspaceId: '22222222-2222-4222-8222-222222222222',
  actorId: '33333333-3333-4333-8333-333333333333',
  correlationId: '44444444-4444-4444-8444-444444444444',
};
const execution = { context, sessionId: '99999999-9999-4999-8999-999999999999', actionId: ACTION };

function overview(over: Record<string, unknown> = {}) {
  return {
    stages: [
      { id: null, stage: 'analysis', status: 'pending' },
      {
        id: STAGE,
        stage: 'research',
        status: 'waiting_for_human',
        pendingGateOutputId: OUTPUT,
        latestOutputId: OUTPUT,
      },
    ],
    humanTasks: [{ id: 't1' }],
    agentQuestions: [
      {
        id: QUESTION,
        stageRunId: STAGE,
        role: 'researcher',
        question: 'Which market? '.repeat(100),
        reason: 'r',
        status: 'open',
      },
      { id: 'old', stageRunId: STAGE, role: 'researcher', question: 'done', status: 'answered' },
    ],
    ...over,
  };
}

function fakes(over: Record<string, unknown> = {}) {
  const get = vi.fn().mockResolvedValue({ id: P1, title: 'Spring plan', code: 'spring' });
  const overviewOf = vi.fn().mockResolvedValue(overview(over));
  const review = vi.fn().mockResolvedValue({ replayed: false });
  const answerAgentQuestion = vi.fn().mockResolvedValue({ replayed: false });
  const registry = new LiveCapabilityRegistry(
    workflowCapabilities({
      projects: { get } as unknown as ProjectsService,
      workflow: { overview: overviewOf, review, answerAgentQuestion } as unknown as WorkflowService,
    }),
  );
  return { registry, get, overviewOf, review, answerAgentQuestion };
}

const settings = (over: Record<string, unknown> = {}) =>
  liveSettingsFrom({
    'live_assistant.enabled': true,
    'live_assistant.disclosure_accepted': true,
    'live_assistant.connection_id': P1,
    'live_assistant.model': 'm',
    'live_assistant.access_level': 'act',
    ...over,
  });

describe('the workflow capabilities of the live assistant (wave 2)', () => {
  it('are one read and three changes that start model work again, none lighter than T2', () => {
    const { registry } = fakes();
    expect(registry.names()).toEqual([
      'question.answer',
      'stage.approve',
      'stage.reject',
      'workflow.waiting',
    ]);
    expect(registry.get('workflow.waiting')?.meta).toMatchObject({ klass: 'T0', write: false });
    for (const name of ['stage.approve', 'stage.reject', 'question.answer']) {
      expect(registry.get(name)?.meta, name).toMatchObject({
        klass: 'T2',
        write: true,
        area: 'project',
      });
    }
    // The model is told about each, and only the read is allowed to be untrusted-output.
    for (const name of registry.names()) expect(CAPABILITY_TOOLS[name], name).toBeDefined();
    expect(registry.get('workflow.waiting')?.untrustedOutput).toBe(true);
    expect(registry.get('stage.approve')?.untrustedOutput).toBeUndefined();
  });

  it('read what waits, with the ids a decision needs and the agents’ words cut short', async () => {
    const { registry } = fakes();
    const result = (await registry
      .get('workflow.waiting')
      ?.execute(execution, { projectId: P1 })) as {
      project: string;
      stagesAwaitingReview: { stageRunId: string; outputId: string }[];
      openQuestions: { questionId: string; question: string }[];
      pendingTasks: number;
    };
    expect(result.project).toBe('«Spring plan» (spring)');
    expect(result.stagesAwaitingReview).toEqual([
      { stageRunId: STAGE, stage: 'research', outputId: OUTPUT },
    ]);
    // Only the open question, and not more than 500 characters of what the agent wrote.
    expect(result.openQuestions).toHaveLength(1);
    expect(result.openQuestions[0]?.questionId).toBe(QUESTION);
    expect(result.openQuestions[0]?.question.length).toBeLessThanOrEqual(500);
    expect(result.pendingTasks).toBe(1);
  });

  it('check their parameters: real ids, feedback for a rejection, a bounded answer', () => {
    const { registry } = fakes();
    const approve = registry.get('stage.approve')!;
    expect(
      approve.params.safeParse({ projectId: P1, stageRunId: STAGE, outputId: OUTPUT }).success,
    ).toBe(true);
    expect(
      approve.params.safeParse({ projectId: P1, stageRunId: 'x', outputId: OUTPUT }).success,
    ).toBe(false);
    const reject = registry.get('stage.reject')!;
    const base = { projectId: P1, stageRunId: STAGE, outputId: OUTPUT };
    expect(reject.params.safeParse({ ...base, feedback: '   ' }).success).toBe(false);
    expect(reject.params.safeParse(base).success).toBe(false);
    expect(reject.params.safeParse({ ...base, feedback: 'x'.repeat(2001) }).success).toBe(false);
    expect(reject.params.safeParse({ ...base, feedback: 'needs sources' }).success).toBe(true);
    const answer = registry.get('question.answer')!;
    const q = { projectId: P1, questionId: QUESTION };
    expect(answer.params.safeParse({ ...q, answer: 'Europe' }).success).toBe(true);
    // Nothing at all (the executor drops an empty field) is a refusal to answer, shown as such.
    expect(answer.params.parse(q)).toMatchObject({ answer: null });
    expect(answer.params.safeParse({ ...q, answer: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('look the stage up themselves, and treat a replaced or finished output as not there', async () => {
    const { registry, overviewOf } = fakes();
    const approve = registry.get('stage.approve')!;
    const params = { projectId: P1, stageRunId: STAGE, outputId: OUTPUT };
    await expect(approve.prepare?.(context, params)).resolves.toMatchObject({
      project: '«Spring plan» (spring)',
      stage: 'research',
    });
    // A different output version than the one waiting now: the approval would be for nothing.
    await expect(
      approve.prepare?.(context, { ...params, outputId: '12121212-1212-4212-8212-121212121212' }),
    ).rejects.toMatchObject({ response: { code: 'LIVE_STAGE_NOT_WAITING' } });
    // A stage that is not waiting at all.
    overviewOf.mockResolvedValue(
      overview({ stages: [{ id: STAGE, stage: 'research', status: 'running' }] }),
    );
    await expect(approve.prepare?.(context, params)).rejects.toMatchObject({
      response: { code: 'LIVE_STAGE_NOT_WAITING' },
    });
    // A question already answered.
    const answer = registry.get('question.answer')!;
    overviewOf.mockResolvedValue(overview());
    await expect(
      answer.prepare?.(context, { projectId: P1, questionId: 'old', answer: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'LIVE_QUESTION_NOT_OPEN' } });
  });

  it('tell the owner the project, the stage and the exact words before they confirm', () => {
    const { registry } = fakes();
    const facts = { project: '«Spring plan» (spring)', stage: 'research', outputWaiting: true };
    const base = { projectId: P1, stageRunId: STAGE, outputId: OUTPUT };
    const approve = registry.get('stage.approve')!.describe(base, 'en', facts).summary;
    expect(approve).toContain('Approve');
    expect(approve).toContain('«Spring plan»');
    expect(approve).toContain('research');
    expect(approve).toContain('cost');
    const reject = registry
      .get('stage.reject')!
      .describe({ ...base, feedback: 'add the EU numbers' }, 'fa', facts).summary;
    expect(reject).toContain('add the EU numbers');
    expect(reject).toContain('Spring plan');
    const answered = registry
      .get('question.answer')!
      .describe({ projectId: P1, questionId: QUESTION, answer: 'Europe' }, 'en', {
        project: facts.project,
        role: 'researcher',
        question: 'Which market?',
      }).summary;
    expect(answered).toContain('Which market?');
    expect(answered).toContain('"Europe"');
    const declined = registry
      .get('question.answer')!
      .describe({ projectId: P1, questionId: QUESTION, answer: null }, 'en', {
        project: facts.project,
        role: 'researcher',
        question: 'Which market?',
      }).summary;
    expect(declined).toContain('Decline');
  });

  it('decide as the back office does, with the owner’s words and a key that makes a repeat harmless', async () => {
    const { registry, review, answerAgentQuestion } = fakes();
    const base = { projectId: P1, stageRunId: STAGE, outputId: OUTPUT };
    await registry.get('stage.approve')!.execute(execution, base);
    expect(review).toHaveBeenLastCalledWith(context, P1, STAGE, OUTPUT, {
      action: 'approve',
      idempotencyKey: `live-${ACTION}`,
    });
    await registry
      .get('stage.reject')!
      .execute(execution, { ...base, feedback: 'add the EU numbers' });
    expect(review).toHaveBeenLastCalledWith(context, P1, STAGE, OUTPUT, {
      action: 'reject',
      comment: 'add the EU numbers',
      idempotencyKey: `live-${ACTION}`,
    });
    await registry
      .get('question.answer')!
      .execute(execution, { projectId: P1, questionId: QUESTION, answer: 'Europe' });
    expect(answerAgentQuestion).toHaveBeenLastCalledWith(context, P1, QUESTION, {
      answer: 'Europe',
      idempotencyKey: `live-${ACTION}`,
    });
    await registry
      .get('question.answer')!
      .execute(execution, { projectId: P1, questionId: QUESTION, answer: null });
    expect(answerAgentQuestion).toHaveBeenLastCalledWith(context, P1, QUESTION, {
      answer: null,
      idempotencyKey: `live-${ACTION}`,
    });
  });

  it('go through the gateway: a decision waits for confirmation, a read-only owner cannot make one, an out-of-scope project is refused first', () => {
    const { registry } = fakes();
    const params = { projectId: P1, stageRunId: STAGE, outputId: OUTPUT };
    const ask = (name: string, p: unknown, over: Record<string, unknown> = {}, extra = {}) =>
      decideProposal({
        registry,
        capability: name,
        params: p,
        settings: settings(over),
        tainted: false,
        currentProjectId: null,
        ...extra,
      });
    const facts = { project: '«Spring plan» (spring)', stage: 'research', outputWaiting: true };
    expect(ask('stage.approve', params, {}, { facts })).toMatchObject({
      outcome: 'accepted',
      tier: 'T2',
    });
    expect(ask('stage.approve', params, { 'live_assistant.access_level': 'read' })).toEqual({
      outcome: 'refused',
      reason: 'read_only',
    });
    expect(
      ask(
        'stage.reject',
        { ...params, feedback: 'no' },
        {
          'live_assistant.access_scope': 'selected_projects',
          'live_assistant.access_project_ids': ['99999999-9999-4999-8999-999999999999'],
        },
        { prepareFailed: true },
      ),
    ).toEqual({ outcome: 'refused', reason: 'out_of_scope' });
    // A stage that is not waiting is "target not found", not a silent success.
    expect(ask('stage.approve', params, {}, { prepareFailed: true })).toEqual({
      outcome: 'refused',
      reason: 'target_not_found',
    });
    // Reading is allowed to a read-only owner.
    expect(
      ask('workflow.waiting', { projectId: P1 }, { 'live_assistant.access_level': 'read' }),
    ).toMatchObject({ outcome: 'accepted', tier: 'T0' });
    // A session that just read agent-written text asks for more confirmation of a change.
    expect(ask('stage.approve', params, {}, { facts, tainted: true })).toMatchObject({
      outcome: 'accepted',
    });
  });
});
