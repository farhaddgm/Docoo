import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LiveAssistantService } from '../src/live-assistant/live-assistant.service.js';
import { adminUrl, createHarness, type Harness } from './support/harness.js';

/**
 * The first real capabilities of the live assistant (ADR-0055) against the real project services:
 * look at the projects, pause one and resume it, each through the gateway and a person's
 * confirmation, with the same audit trail and workflow follow-up as the back office.
 */
describe.skipIf(!adminUrl)('live assistant: projects', () => {
  let h: Harness;
  let cookieA: string;
  let service: LiveAssistantService;
  let sessionId: string;
  let projectId: string;
  let draftId: string;
  let lifeId: string;
  const context = () => ({
    workspaceId: h.ids.workspaceA,
    actorId: h.ids.userA,
    correlationId: randomUUID(),
  });
  const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

  async function setting(key: string, value: unknown) {
    const response = await h.request('PUT', api('/settings/assignments'), {
      cookie: cookieA,
      payload: {
        key,
        scopeType: 'workspace',
        scopeId: h.ids.workspaceA,
        value,
        reason: `integration test ${key}`,
      },
    });
    expect(response.statusCode, `${key}: ${response.body}`).toBe(200);
  }

  async function createProject(code: string, topicId: string) {
    const response = await h.request('POST', api('/projects'), {
      cookie: cookieA,
      payload: {
        code,
        title: `Project ${code}`,
        initialProblem: 'Confidential problem statement for the board',
        topics: [{ topicId }],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ project: { id: string; version: number } }>().project;
  }

  const stateOf = async (id: string) =>
    (await h.request('GET', api(`/projects/${id}`), { cookie: cookieA })).json<{
      project: { status: string; pauseReason: string | null };
    }>().project;
  const projectState = () => stateOf(projectId);

  const propose = (capability: string, params: Record<string, unknown>) =>
    service.propose(context(), { sessionId, capability, params, tainted: false });

  beforeAll(async () => {
    h = await createHarness('liveproj');
    cookieA = await h.login(h.emails.a);
    service = h.app.get(LiveAssistantService);

    await setting('live_assistant.enabled', true);
    await setting('live_assistant.disclosure_accepted', true);
    await setting('live_assistant.connection_id', '44444444-4444-4444-8444-444444444444');
    await setting('live_assistant.model', 'some-realtime-model');
    await setting('live_assistant.access_level', 'act');

    const topic = await h.request('POST', api('/topics'), {
      cookie: cookieA,
      payload: { code: 'live-topic', title: 'Live topic' },
    });
    expect(topic.statusCode, topic.body).toBe(201);
    const topicId = topic.json<{ topic: { id: string } }>().topic.id;
    const project = await createProject('live-active', topicId);
    projectId = project.id;
    const activated = await h.request('POST', api(`/projects/${projectId}/activate`), {
      cookie: cookieA,
      payload: { expectedVersion: project.version },
    });
    expect(activated.statusCode, activated.body).toBe(200);
    draftId = (await createProject('live-draft', topicId)).id;
    const life = await createProject('live-life', topicId);
    lifeId = life.id;
    const lifeActive = await h.request('POST', api(`/projects/${lifeId}/activate`), {
      cookie: cookieA,
      payload: { expectedVersion: life.version },
    });
    expect(lifeActive.statusCode, lifeActive.body).toBe(200);

    sessionId = (await service.startSession(context())).id;
  });

  afterAll(async () => {
    await h?.close();
  });

  it('lists the projects and reads one, with a small fixed set of fields', async () => {
    const list = await propose('projects.overview', {});
    expect(list).toMatchObject({ status: 'executed', tier: 'T0' });
    const projects = (list.result as { projects: { id: string; code: string }[] }).projects;
    expect(projects.map((item) => item.code)).toEqual(
      expect.arrayContaining(['live-active', 'live-draft']),
    );

    const status = await propose('project.status', { projectId });
    expect(status).toMatchObject({
      status: 'executed',
      result: { id: projectId, status: 'active' },
    });
    expect(JSON.stringify(status.result)).not.toContain('Confidential problem statement');
  });

  it("describes a pause by the project's real title, then pauses it only after a confirmation", async () => {
    const proposed = await propose('project.pause', {
      projectId,
      reason: 'Waiting for finance data',
    });
    expect(proposed).toMatchObject({ status: 'proposed', tier: 'T1', nextStep: 'confirm' });
    expect(proposed.summary).toContain('Project live-active');
    expect(proposed.summary).toContain('live-active');
    expect((await projectState()).status).toBe('active');

    const done = await service.confirm(context(), proposed.id, { via: 'click' });
    expect(done).toMatchObject({ status: 'executed', result: { status: 'paused' } });
    const after = await projectState();
    expect(after.status).toBe('paused');
    expect(after.pauseReason).toBe('Voice assistant: Waiting for finance data');

    const audit = (
      await h.admin.query(
        `select actor_id, reason from audit_events where project_id = $1 and action = 'project.pause'`,
        [projectId],
      )
    ).rows as { actor_id: string; reason: string }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_id: h.ids.userA,
      reason: 'Voice assistant: Waiting for finance data',
    });
    const ledger = (
      await h.admin.query(
        `select action from audit_events where target_id = $1 order by occurred_at, id`,
        [proposed.id],
      )
    ).rows.map((row: { action: string }) => row.action);
    expect(ledger).toEqual([
      'live_assistant.action_proposed',
      'live_assistant.action_confirmed',
      'live_assistant.action_executed',
    ]);
  });

  it('resumes it as a consequential change: read back, then confirmed by voice', async () => {
    const proposed = await propose('project.resume', { projectId });
    expect(proposed).toMatchObject({ status: 'proposed', tier: 'T2' });
    expect(proposed.steps).toEqual(['preview', 'readback', 'voice_or_click']);
    expect(await projectState()).toMatchObject({ status: 'paused' });

    const unclear = await service
      .confirm(context(), proposed.id, { via: 'voice', transcript: 'هوم' })
      .catch((error: { getStatus?: () => number }) => error);
    expect((unclear as { getStatus: () => number }).getStatus()).toBe(422);
    expect(await projectState()).toMatchObject({ status: 'paused' });

    const done = await service.confirm(context(), proposed.id, {
      via: 'voice',
      transcript: 'تایید',
    });
    expect(done).toMatchObject({ status: 'executed', result: { status: 'active' } });
    expect(await projectState()).toMatchObject({ status: 'active', pauseReason: null });
  });

  it('records a project that refuses the command as a failure with its own code', async () => {
    // A draft cannot be paused: the back office refuses it with PROJECT_STATE_CONFLICT.
    const proposed = await propose('project.pause', { projectId: draftId, reason: 'try' });
    expect(proposed.status).toBe('proposed');
    const out = await service.confirm(context(), proposed.id, { via: 'click' });
    expect(out).toMatchObject({ status: 'failed', errorCode: 'PROJECT_STATE_CONFLICT' });
  });

  /** A new session, so what an earlier test read does not make this one stricter. */
  const fresh = async () => {
    sessionId = (await service.startSession(context())).id;
  };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('archives a project and brings it back, each a reversible change', async () => {
    await fresh();
    const archive = await propose('project.archive', { projectId: lifeId });
    expect(archive).toMatchObject({ status: 'proposed', tier: 'T1' });
    expect(await service.confirm(context(), archive.id, { via: 'click' })).toMatchObject({
      status: 'executed',
      result: { status: 'archived' },
    });
    expect((await stateOf(lifeId)).status).toBe('archived');
    const back = await propose('project.unarchive', { projectId: lifeId });
    expect(back.tier).toBe('T1');
    expect(await service.confirm(context(), back.id, { via: 'click' })).toMatchObject({
      status: 'executed',
      result: { status: 'active' },
    });
    expect((await stateOf(lifeId)).status).toBe('active');
  });

  it('completes a project with a reason, as a consequential change, and reopens it', async () => {
    await fresh();
    const noReason = await propose('project.complete', { projectId: lifeId });
    expect(noReason).toMatchObject({ status: 'refused', refusalReason: 'invalid_params' });
    const complete = await propose('project.complete', { projectId: lifeId, reason: 'Delivered' });
    expect(complete).toMatchObject({ status: 'proposed', tier: 'T2' });
    expect(complete.steps).toEqual(['preview', 'readback', 'voice_or_click']);
    expect(await service.confirm(context(), complete.id, { via: 'click' })).toMatchObject({
      status: 'executed',
      result: { status: 'completed' },
    });
    expect((await stateOf(lifeId)).status).toBe('completed');
    const reopen = await propose('project.reopen', { projectId: lifeId, reason: 'One more round' });
    expect(reopen.tier).toBe('T2');
    expect(await service.confirm(context(), reopen.id, { via: 'click' })).toMatchObject({
      status: 'executed',
      result: { status: 'active' },
    });
    expect((await stateOf(lifeId)).status).toBe('active');
  });

  it('deletes only once its category is on, after two confirmations, the second by the name, and restores', async () => {
    await fresh();
    expect(await propose('project.delete', { projectId: lifeId })).toMatchObject({
      status: 'refused',
      refusalReason: 't3_disabled',
    });
    await setting('live_assistant.t3_categories', ['delete']);

    const proposed = await propose('project.delete', { projectId: lifeId });
    expect(proposed).toMatchObject({
      status: 'proposed',
      tier: 'T3',
      targetName: 'Project live-life',
    });
    expect(proposed.steps).toContain('target_echo_or_click');
    expect((await stateOf(lifeId)).status).toBe('active');

    const first = await service.confirm(context(), proposed.id, {
      via: 'voice',
      transcript: 'بله',
    });
    expect(first).toMatchObject({ status: 'first_confirmed', nextStep: 'echo' });
    expect((await stateOf(lifeId)).status).toBe('active');

    const tooSoon = await service
      .confirm(context(), proposed.id, { via: 'click' })
      .catch((error: unknown) => error as { getStatus: () => number });
    expect((tooSoon as { getStatus: () => number }).getStatus()).toBe(422);
    await sleep(1800);
    const wrong = await service
      .confirm(context(), proposed.id, { via: 'voice', transcript: 'تایید' })
      .catch((error: unknown) => error as { getStatus: () => number });
    expect((wrong as { getStatus: () => number }).getStatus()).toBe(422);
    expect((await stateOf(lifeId)).status).toBe('active');

    const done = await service.confirm(context(), proposed.id, {
      via: 'voice',
      transcript: 'Project live-life',
    });
    expect(done).toMatchObject({ status: 'executed', result: { status: 'deleted' } });
    expect((await stateOf(lifeId)).status).toBe('deleted');
    const audit = (
      await h.admin.query(
        `select actor_id, reason from audit_events where project_id = $1 and action = 'project.delete'`,
        [lifeId],
      )
    ).rows as { actor_id: string; reason: string }[];
    expect(audit).toEqual([{ actor_id: h.ids.userA, reason: 'Voice assistant: deleted' }]);

    const restore = await propose('project.restore', { projectId: lifeId });
    expect(restore.tier).toBe('T1');
    expect(await service.confirm(context(), restore.id, { via: 'click' })).toMatchObject({
      status: 'executed',
    });
    expect((await stateOf(lifeId)).status).not.toBe('deleted');
    await setting('live_assistant.t3_categories', []);
  });

  it("reads a project in depth, and then confirms the session's changes more strictly", async () => {
    await fresh();
    const before = await propose('project.pause', { projectId: lifeId, reason: 'Check' });
    expect(before.tier).toBe('T1');
    await service.cancel(context(), before.id);

    const report = await propose('project.report', { projectId: lifeId });
    expect(report).toMatchObject({ status: 'executed', tier: 'T0' });
    const body = report.result as {
      project: { code: string };
      problem: { initialProblem: string };
      usage: { invocations: number };
      ideas: { items: unknown[] };
      outputs: { final: unknown[] };
    };
    expect(body.project.code).toBe('live-life');
    expect(body.problem.initialProblem).toContain('Confidential problem statement');
    expect(body.usage.invocations).toBe(0);
    expect(body.ideas.items).toEqual([]);
    expect(body.outputs.final).toEqual([]);

    const after = await propose('project.pause', { projectId: lifeId, reason: 'Check' });
    expect(after).toMatchObject({ status: 'proposed', tier: 'T2' });
    const stored = (
      await h.admin.query(`select tainted from live_actions where id = $1`, [after.id])
    ).rows[0] as { tainted: boolean };
    expect(stored.tainted).toBe(true);
    await service.cancel(context(), after.id);
  });

  it('refuses a project that is not there, and one from another workspace, without a name', async () => {
    const gone = await propose('project.pause', { projectId: randomUUID(), reason: 'x' });
    expect(gone).toMatchObject({
      status: 'refused',
      refusalReason: 'target_not_found',
      summary: '',
    });
    const otherWorkspace = (
      await h.admin.query(`select id from projects where workspace_id = $1 limit 1`, [
        h.ids.workspaceB,
      ])
    ).rows[0] as { id: string } | undefined;
    const foreign = await propose('project.status', {
      projectId: otherWorkspace?.id ?? randomUUID(),
    });
    expect(foreign).toMatchObject({ status: 'refused', refusalReason: 'target_not_found' });
  });

  it('keeps a read only assistant from pausing anything', async () => {
    await setting('live_assistant.access_level', 'read');
    const refused = await propose('project.pause', { projectId, reason: 'x' });
    expect(refused).toMatchObject({ status: 'refused', refusalReason: 'read_only' });
    expect((await propose('project.status', { projectId })).status).toBe('executed');
    await setting('live_assistant.access_level', 'act');
  });

  it('answers over HTTP with the same gateway', async () => {
    const response = await h.request('POST', api('/live-assistant/actions'), {
      cookie: cookieA,
      payload: { sessionId, capability: 'projects.overview', params: { limit: 5 } },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ status: 'executed', tier: 'T0' });
    const unknown = await h.request('POST', api('/live-assistant/actions'), {
      cookie: cookieA,
      payload: { sessionId, capability: 'project.destroy_everything', params: { projectId } },
    });
    expect(unknown.statusCode).toBe(201);
    expect(unknown.json()).toMatchObject({
      status: 'refused',
      refusalReason: 'unknown_capability',
    });
  });
});
