import { fileURLToPath } from 'node:url';

import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AnalysisDriver } from './support/analysis.js';
import type { TemporalTestRuntime } from './support/harness.js';
import { adminUrl, createHarness, temporalAddress, type Harness } from './support/harness.js';

interface StageView {
  id: string | null;
  stage: string;
  status: string;
  attemptsUsed?: number;
  attemptLimit?: number;
  latestOutputId?: string | null;
  pendingGateOutputId?: string | null;
  passedByDecision?: boolean;
}
interface Overview {
  run: { id: string; workflowId: string; status: string; currentStage: string | null } | null;
  stages: StageView[];
  humanTasks: { id: string; kind: string; stageRunId: string }[];
}

let h: Harness;
let cookie: string;
let temporal: TemporalTestRuntime;
let topicId: string;
let connectionId: string;
let analysis: AnalysisDriver;
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

async function setting(key: string, value: unknown, scopeType = 'workspace', scopeId?: string) {
  const response = await h.request('PUT', api('/settings/assignments'), {
    cookie,
    payload: { key, scopeType, scopeId: scopeId ?? h.ids.workspaceA, value, reason: `test ${key}` },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function project(
  code: string,
  configure?: (projectId: string) => Promise<void>,
): Promise<string> {
  const created = await h.request('POST', api('/projects'), {
    cookie,
    payload: {
      code,
      title: `Project ${code}`,
      initialProblem: 'Reduce repeat-customer churn by 20%.',
      topics: [{ topicId }],
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const body = created.json<{ project: { id: string; version: number } }>().project;
  if (configure) await configure(body.id);
  const activated = await h.request('POST', api(`/projects/${body.id}/activate`), {
    cookie,
    payload: { expectedVersion: body.version },
  });
  expect(activated.statusCode, activated.body).toBe(200);
  return body.id;
}

async function overview(projectId: string): Promise<Overview> {
  const response = await h.request('GET', api(`/projects/${projectId}/workflow`), { cookie });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ workflow: Overview }>().workflow;
}

async function waitFor(
  projectId: string,
  predicate: (view: Overview) => boolean,
  label: string,
): Promise<Overview> {
  const deadline = Date.now() + 45_000;
  let last: Overview | null = null;
  while (Date.now() < deadline) {
    last = await overview(projectId);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

const stageOf = (view: Overview, stage: string) =>
  view.stages.find((item) => item.stage === stage)!;
const waiting = (stage: string) => (view: Overview) =>
  stageOf(view, stage).status === 'waiting_for_human' &&
  Boolean(stageOf(view, stage).pendingGateOutputId);

/** The administrator answers the analyst's questions until the definition waits for a decision. */
async function analysisGate(projectId: string): Promise<Overview> {
  await analysis.reachDefinition(projectId);
  return waitFor(projectId, waiting('analysis'), 'analysis gate');
}

async function decide(
  projectId: string,
  stage: StageView,
  action: 'approve' | 'reject',
  comment?: string,
  key?: string,
) {
  return h.request(
    'POST',
    api(`/projects/${projectId}/stages/${stage.id}/outputs/${stage.pendingGateOutputId}/${action}`),
    {
      cookie,
      payload: comment ? { comment } : {},
      ...(key ? { headers: { 'idempotency-key': key } } : {}),
    },
  );
}

async function projectStatus(projectId: string): Promise<{ status: string; version: number }> {
  return (await h.request('GET', api(`/projects/${projectId}`), { cookie })).json<{
    project: { status: string; version: number };
  }>().project;
}

describe.skipIf(!adminUrl || !temporalAddress)(
  'project workflow on Temporal (WF-*, AI-004/005)',
  () => {
    beforeAll(async () => {
      h = await createHarness('workflow', { workflow: true });
      temporal = h.engine as TemporalTestRuntime;
      cookie = await h.login(h.emails.a);
      analysis = new AnalysisDriver(h, cookie, h.ids.workspaceA);
      const topic = await h.request('POST', api('/topics'), {
        cookie,
        payload: { code: 'retail', title: 'Retail' },
      });
      topicId = topic.json<{ topic: { id: string } }>().topic.id;
      const connection = await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'fake', name: 'Deterministic' },
      });
      expect(connection.statusCode, connection.body).toBe(201);
      connectionId = connection.json<{ connection: { id: string } }>().connection.id;
      await setting('ai.connection_id', connectionId);
      await setting('ai.model', 'fake-standard');
    }, 60_000);

    afterAll(async () => {
      await h?.close();
    });

    it('WF-001/003: activation starts the fixed stages; each manual gate waits for a human and updates the timeline', async () => {
      const projectId = await project('ordered');
      await analysis.waitFor(projectId, (state) => state.phase === 'answering', 'first questions');
      let view = await overview(projectId);
      expect(view.run).toMatchObject({ status: 'waiting_for_human', currentStage: 'analysis' });
      expect(view.humanTasks).toEqual([expect.objectContaining({ kind: 'analysis_answers' })]);
      expect(view.stages.map((stage) => stage.stage)).toEqual([
        'analysis',
        'research',
        'ideation',
        'documentation',
        'evaluation',
      ]);
      expect(view.stages.slice(1).every((stage) => stage.status === 'pending')).toBe(true);
      view = await analysisGate(projectId);
      expect(view.humanTasks).toEqual([expect.objectContaining({ kind: 'gate_review' })]);

      const timeline = await h.request('GET', api(`/projects/${projectId}/timeline`), { cookie });
      const actions = timeline
        .json<{ items: { action: string }[] }>()
        .items.map((item) => item.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'project.activate',
          'workflow.run_created',
          'workflow.started',
          'workflow.stage_started',
          'analysis.batch_opened',
          'workflow.waiting_for_human',
        ]),
      );

      for (const stage of ['analysis', 'research', 'ideation', 'documentation', 'evaluation']) {
        view = await waitFor(projectId, waiting(stage), `${stage} gate`);
        const stageView = stageOf(view, stage);
        const detail = await h.request(
          'GET',
          api(`/projects/${projectId}/stages/${stageView.id}`),
          { cookie },
        );
        expect(
          detail.json<{ stage: { outputs: { content: Record<string, unknown> }[] } }>().stage
            .outputs[0]!.content,
        ).toBeTypeOf('object');
        expect((await decide(projectId, stageView, 'approve')).statusCode).toBe(200);
      }
      view = await waitFor(
        projectId,
        (current) => current.run?.status === 'completed',
        'completion',
      );
      expect(view.stages.every((stage) => stage.status === 'completed')).toBe(true);
      expect((await projectStatus(projectId)).status).toBe('completed');
    }, 120_000);

    it('WF-003: with automatic gates the run goes through without human tasks', async () => {
      const projectId = await project('automatic', (id) =>
        setting('workflow.require_human_approval', false, 'project', id),
      );
      // Only approval of the problem definition closes the analysis, whatever the gate setting.
      const gate = await analysisGate(projectId);
      expect((await decide(projectId, stageOf(gate, 'analysis'), 'approve')).statusCode).toBe(200);
      const view = await waitFor(
        projectId,
        (current) => current.run?.status === 'completed',
        'automatic completion',
      );
      expect(view.humanTasks).toEqual([]);
      const gates = await h.admin.query<{ mode: string; status: string }>(
        `select g.mode, g.status from gate_decisions g join stage_runs s on s.id = g.stage_run_id where s.project_id = $1`,
        [projectId],
      );
      expect(gates.rows).toHaveLength(5);
      expect(gates.rows.every((gate) => gate.status === 'approved')).toBe(true);
      expect(gates.rows.filter((gate) => gate.mode === 'manual')).toHaveLength(1);
      expect(gates.rows.filter((gate) => gate.mode === 'automatic')).toHaveLength(4);
    }, 60_000);

    it('WF-002: a repeated command has no second side effect and the workflow replays deterministically', async () => {
      const projectId = await project('idempotent');
      const view = await analysisGate(projectId);
      const stage = stageOf(view, 'analysis');
      const first = await decide(projectId, stage, 'approve', undefined, 'approve-analysis-0001');
      const second = await decide(projectId, stage, 'approve', undefined, 'approve-analysis-0001');
      expect(first.json<{ review: { replayed: boolean } }>().review.replayed).toBe(false);
      expect(second.statusCode).toBe(200);
      expect(second.json<{ review: { replayed: boolean; gate: string } }>().review).toMatchObject({
        replayed: true,
        gate: 'approved',
      });
      const reviews = await h.admin.query(
        `select 1 from stage_reviews where stage_run_id = $1 and action = 'approve'`,
        [stage.id],
      );
      expect(reviews.rowCount).toBe(1);
      const reused = await decide(
        projectId,
        stage,
        'reject',
        'different body',
        'approve-analysis-0001',
      );
      expect(reused.statusCode).toBe(409);
      expect(reused.json<{ code: string }>().code).toBe('IDEMPOTENCY_KEY_REUSED');

      await waitFor(projectId, waiting('research'), 'research gate');
      // One provider call per attempt: the stored output is reused on activity retries.
      const calls = await h.admin.query<{ attempts: number; invocations: number }>(
        `select count(distinct a.id)::int as attempts, count(i.id)::int as invocations
         from stage_attempts a join stage_runs s on s.id = a.stage_run_id
         left join model_invocations i on i.attempt_id = a.id
        where s.project_id = $1`,
        [projectId],
      );
      expect(calls.rows[0]).toEqual({ attempts: 2, invocations: 2 });

      const run = (await overview(projectId)).run!;
      const history = await temporal.client.workflow.getHandle(run.workflowId).fetchHistory();
      await expect(
        Worker.runReplayHistory(
          { workflowsPath: fileURLToPath(import.meta.resolve('@docoo/orchestration/workflows')) },
          history,
          run.workflowId,
        ),
      ).resolves.toBeUndefined();
    }, 60_000);

    it('WF-004: pause stops at the next safe boundary, a worker restart loses nothing, resume continues, cancel keeps outputs', async () => {
      const projectId = await project('pausable');
      let view = await analysisGate(projectId);
      const current = await projectStatus(projectId);
      const paused = await h.request('POST', api(`/projects/${projectId}/pause`), {
        cookie,
        payload: { expectedVersion: current.version, reason: 'Waiting for data' },
      });
      expect(paused.statusCode, paused.body).toBe(200);

      await temporal.stopWorker();
      expect((await decide(projectId, stageOf(view, 'analysis'), 'approve')).statusCode).toBe(200);
      await temporal.startWorker();

      view = await waitFor(
        projectId,
        (state) =>
          state.run?.status === 'paused' && stageOf(state, 'analysis').status === 'completed',
        'paused run',
      );
      // The next stage may be prepared but no attempt starts while paused.
      expect(stageOf(view, 'research').attemptsUsed ?? 0).toBe(0);
      expect(['pending', 'ready']).toContain(stageOf(view, 'research').status);

      const pausedProject = await projectStatus(projectId);
      const resumed = await h.request('POST', api(`/projects/${projectId}/resume`), {
        cookie,
        payload: { expectedVersion: pausedProject.version },
      });
      expect(resumed.statusCode, resumed.body).toBe(200);
      await waitFor(projectId, waiting('research'), 'research after resume');

      const cancelled = await h.request('POST', api(`/projects/${projectId}/workflow/cancel`), {
        cookie,
        payload: { reason: 'Scope changed' },
      });
      expect(cancelled.statusCode).toBe(202);
      view = await waitFor(
        projectId,
        (state) => state.run?.status === 'cancelled',
        'cancelled run',
      );
      expect(stageOf(view, 'research').status).toBe('cancelled');
      expect(view.humanTasks).toEqual([]);
      const outputs = await h.admin.query(
        'select 1 from stage_outputs o join stage_runs s on s.id = o.stage_run_id where s.project_id = $1',
        [projectId],
      );
      expect(outputs.rowCount).toBe(2);
    }, 90_000);

    it('WF-005: past the attempt limit only a recorded decision with a reason continues', async () => {
      const projectId = await project('limited', (id) =>
        setting('workflow.max_attempts_per_stage', 2, 'project', id),
      );
      let view = await analysisGate(projectId);
      expect(
        (await decide(projectId, stageOf(view, 'analysis'), 'reject', 'Too vague')).statusCode,
      ).toBe(200);
      view = await waitFor(
        projectId,
        (state) => waiting('analysis')(state) && stageOf(state, 'analysis').attemptsUsed === 2,
        'attempt 2',
      );
      expect(
        (await decide(projectId, stageOf(view, 'analysis'), 'reject', 'Still vague')).statusCode,
      ).toBe(200);
      view = await waitFor(
        projectId,
        (state) => state.humanTasks.some((task) => task.kind === 'attempt_limit'),
        'attempt limit task',
      );
      const stageId = stageOf(view, 'analysis').id!;
      const attempts = await h.admin.query('select 1 from stage_attempts where stage_run_id = $1', [
        stageId,
      ]);
      expect(attempts.rowCount).toBe(2);

      const noReason = await h.request(
        'POST',
        api(`/projects/${projectId}/stages/${stageId}/attempt-decision`),
        { cookie, payload: { decision: 'extend' } },
      );
      expect(noReason.statusCode).toBe(400);
      const extend = await h.request(
        'POST',
        api(`/projects/${projectId}/stages/${stageId}/attempt-decision`),
        {
          cookie,
          payload: { decision: 'extend', reason: 'One more try with the new data' },
        },
      );
      expect(extend.statusCode, extend.body).toBe(200);
      view = await waitFor(
        projectId,
        (state) => waiting('analysis')(state) && stageOf(state, 'analysis').attemptsUsed === 3,
        'attempt 3',
      );
      expect(stageOf(view, 'analysis').attemptLimit).toBe(3);
      await decide(projectId, stageOf(view, 'analysis'), 'reject', 'Not there yet');
      await waitFor(
        projectId,
        (state) => state.humanTasks.some((task) => task.kind === 'attempt_limit'),
        'second limit',
      );
      const pass = await h.request(
        'POST',
        api(`/projects/${projectId}/stages/${stageId}/attempt-decision`),
        {
          cookie,
          payload: { decision: 'pass', reason: 'Accepted by the owner as is' },
        },
      );
      expect(pass.statusCode).toBe(200);
      view = await waitFor(projectId, waiting('research'), 'research after pass');
      expect(stageOf(view, 'analysis')).toMatchObject({
        status: 'completed',
        passedByDecision: true,
      });
      const decisions = await h.admin.query<{ reason: string; severity: string }>(
        `select reason, severity from audit_events where project_id = $1 and action = 'workflow.attempt_decision' order by occurred_at`,
        [projectId],
      );
      expect(decisions.rows.map((row) => row.reason)).toEqual([
        'One more try with the new data',
        'Accepted by the owner as is',
      ]);
    }, 90_000);

    it('WF-006: an edit creates a new version and invalidates the earlier approval; comments are kept', async () => {
      const projectId = await project('editable');
      const view = await analysisGate(projectId);
      const stage = stageOf(view, 'analysis');
      const original = stage.pendingGateOutputId!;
      const comment = await h.request(
        'POST',
        api(`/projects/${projectId}/stages/${stage.id}/outputs/${original}/comment`),
        {
          cookie,
          payload: { comment: 'Check the churn figure' },
        },
      );
      expect(comment.statusCode).toBe(200);
      const edited = await h.request(
        'POST',
        api(`/projects/${projectId}/stages/${stage.id}/outputs/${original}/edit`),
        {
          cookie,
          payload: {
            content: {
              problemStatement: 'Edited statement',
              needStatement: 'Keep customers',
              objectives: [],
              constraints: [],
              stakeholders: [],
              successCriteria: [],
              assumptions: [],
              unresolved: [],
              glossary: [],
              recommendedScope: 'Retail only',
              outOfScope: [],
            },
            reason: 'Sharper wording',
          },
        },
      );
      expect(edited.statusCode, edited.body).toBe(200);
      const newOutput = edited.json<{
        edit: { outputId: string; versionNo: number; invalidatedGates: number };
      }>().edit;
      expect(newOutput).toMatchObject({ versionNo: 2, invalidatedGates: 1 });

      const stale = await h.request(
        'POST',
        api(`/projects/${projectId}/stages/${stage.id}/outputs/${original}/approve`),
        { cookie, payload: {} },
      );
      expect(stale.statusCode).toBe(409);
      expect(stale.json<{ code: string }>().code).toBe('WORKFLOW_OUTPUT_SUPERSEDED');

      const detail = (
        await h.request('GET', api(`/projects/${projectId}/stages/${stage.id}`), { cookie })
      ).json<{
        stage: {
          outputs: { id: string; origin: string; current: boolean }[];
          gates: { outputId: string; status: string }[];
          reviews: { action: string }[];
        };
      }>().stage;
      expect(detail.outputs.map((output) => [output.origin, output.current])).toEqual([
        ['edit', true],
        ['model', false],
      ]);
      expect(detail.gates).toEqual([
        expect.objectContaining({ outputId: original, status: 'expired' }),
        expect.objectContaining({ outputId: newOutput.outputId, status: 'pending' }),
      ]);
      expect(detail.reviews.map((review) => review.action)).toEqual(['comment', 'edit']);

      const approve = await h.request(
        'POST',
        api(`/projects/${projectId}/stages/${stage.id}/outputs/${newOutput.outputId}/approve`),
        { cookie, payload: {} },
      );
      expect(approve.statusCode).toBe(200);
      await waitFor(projectId, waiting('research'), 'research');
      const research = await h.admin.query<{ content: unknown }>(
        `select o.content from stage_outputs o join stage_runs s on s.id = o.stage_run_id where s.project_id = $1 and s.stage = 'analysis' and o.origin = 'edit'`,
        [projectId],
      );
      expect(research.rows[0]?.content).toMatchObject({ problemStatement: 'Edited statement' });
    }, 60_000);

    it('AI-004: transient provider errors follow the retry schedule, then the project pauses for a human; resume continues', async () => {
      temporal.fakeScript = () => 'transient';
      const projectId = await project('flaky');
      const view = await waitFor(
        projectId,
        (state) => state.humanTasks.some((task) => task.kind === 'provider_failure'),
        'provider failure task',
      );
      expect(view.run?.status).toBe('paused');
      const pausedProject = await projectStatus(projectId);
      expect(pausedProject.status).toBe('paused');
      const invocations = await h.admin.query<{ status: string; retry_no: number }>(
        `select status, retry_no from model_invocations where project_id = $1 order by created_at`,
        [projectId],
      );
      expect(invocations.rows.map((row) => row.retry_no)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      expect(invocations.rows.every((row) => row.status === 'transient_failed')).toBe(true);
      const connections = await h.admin.query(
        'select 1 from provider_connections where workspace_id = $1',
        [h.ids.workspaceA],
      );
      expect(connections.rowCount).toBe(1); // no fallback connection was tried

      temporal.fakeScript = () => null;
      const resumed = await h.request('POST', api(`/projects/${projectId}/resume`), {
        cookie,
        payload: { expectedVersion: pausedProject.version },
      });
      expect(resumed.statusCode, resumed.body).toBe(200);
      const after = await analysisGate(projectId);
      expect(after.humanTasks.map((task) => task.kind)).toEqual(['gate_review']);
    }, 90_000);

    it('AI-005: every invocation has tokens, latency, finish reason and cost, compared with the project ceiling', async () => {
      await h.request('POST', api('/model-prices'), {
        cookie,
        payload: {
          provider: 'fake',
          model: 'fake-standard',
          inputPerMillion: 1000,
          outputPerMillion: 2000,
          effectiveFrom: '2026-01-01T00:00:00Z',
        },
      });
      const projectId = await project('costly');
      await analysisGate(projectId);
      const invocations = await h.request('GET', api(`/model-invocations?projectId=${projectId}`), {
        cookie,
      });
      const [invocation] = invocations.json<{ items: Record<string, unknown>[] }>().items;
      expect(invocation).toMatchObject({
        status: 'succeeded',
        finishReason: 'stop',
        provider: 'fake',
        model: 'fake-standard',
      });
      expect(invocation!['inputTokens']).toBeGreaterThan(0);
      expect(invocation!['outputTokens']).toBeGreaterThan(0);
      expect(invocation!['latencyMs']).toBeTypeOf('number');
      expect(invocation!['costUsd']).toBeGreaterThan(0);

      const usage = await h.request('GET', api(`/projects/${projectId}/usage`), { cookie });
      expect(
        usage.json<{
          usage: {
            totals: { invocations: number };
            byStage: { stage: string }[];
            costLimit: { status: string; limitUsd: number };
          };
        }>().usage,
      ).toMatchObject({
        // Three analyst rounds (two batches, then "enough") and the definition itself.
        totals: { invocations: 4 },
        byStage: [expect.objectContaining({ stage: 'analysis' })],
        costLimit: { status: 'ok', limitUsd: 20 },
      });

      const capped = await project('capped', (id) =>
        setting('ai.max_cost_usd_per_run', 0, 'project', id),
      );
      const blocked = await waitFor(
        capped,
        (state) => state.humanTasks.some((task) => task.kind === 'cost_limit'),
        'cost limit',
      );
      expect(blocked.run?.status).toBe('paused');
    }, 90_000);
  },
);
