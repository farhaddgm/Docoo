import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

let h: Harness;
let cookieA: string;
let cookieB: string;
let projectId: string;
let researchStageId: string;
let chatMessageId: string;
const api = (suffix: string, workspace = h.ids.workspaceA) =>
  `/v1/workspaces/${workspace}${suffix}`;
const base = () => api(`/projects/${projectId}/output-requirements`);

interface Requirement {
  id: string;
  kind: 'must' | 'must_not';
  text: string;
  source: 'admin' | 'chat';
  stage: string | null;
  target: string | null;
  messageId: string | null;
  supersedesId: string | null;
  behindStages: string[];
}
interface Listing {
  items: Requirement[];
  history: (Requirement & { endedKind: string })[];
  limit: number;
  stages: { stage: string; outputCreatedAt: string | null }[];
  check: null | {
    checkId: string;
    stale: boolean;
    summary: {
      total: number;
      covered: number;
      partial: number;
      notCovered: number;
      unknown: number;
    };
    results: { requirementId: string; verdict: string; evidence: string }[];
  };
}

const post = (url: string, payload: unknown = {}, cookie = cookieA) =>
  h.request('POST', url, { cookie, payload });
const list = async () => (await h.request('GET', base(), { cookie: cookieA })).json<Listing>();
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe.skipIf(!adminUrl)('Output requirements (ADR-0037)', () => {
  beforeAll(async () => {
    h = await createHarness('outreq');
    cookieA = await h.login(h.emails.a);
    cookieB = await h.login(h.emails.b);
    const connection = await post(api('/provider-connections'), {
      provider: 'fake',
      name: 'Deterministic',
    });
    const connectionId = connection.json<{ connection: { id: string } }>().connection.id;
    await post(api(`/provider-connections/${connectionId}/health-check`));
    for (const [key, value] of [
      ['ai.connection_id', connectionId],
      ['ai.model', 'fake-standard'],
    ] as const) {
      const response = await h.request('PUT', api('/settings/assignments'), {
        cookie: cookieA,
        payload: { key, scopeType: 'workspace', scopeId: h.ids.workspaceA, value, reason: 'test' },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    const topic = await post(api('/topics'), { code: 'retail', title: 'Retail' });
    const topicId = topic.json<{ topic: { id: string } }>().topic.id;
    const created = await post(api('/projects'), {
      code: 'req-1',
      title: 'Churn programme',
      initialProblem: 'Reduce repeat-customer churn in Q3.',
      topics: [{ topicId }],
    });
    projectId = created.json<{ project: { id: string } }>().project.id;

    const run = await h.admin.query<{ id: string }>(
      `insert into workflow_runs (workspace_id,project_id,run_no,temporal_workflow_id)
       values ($1,$2,1,$3) returning id`,
      [h.ids.workspaceA, projectId, `outreq-${projectId}`],
    );
    const stages = await h.admin.query<{ id: string; stage: string }>(
      `insert into stage_runs (workspace_id,project_id,run_id,stage,sequence,status)
       values ($1,$2,$3,'analysis',1,'completed'), ($1,$2,$3,'research',2,'waiting_for_human')
       returning id, stage::text as stage`,
      [h.ids.workspaceA, projectId, run.rows[0]!.id],
    );
    researchStageId = stages.rows.find((row) => row.stage === 'research')!.id;
    for (const row of stages.rows) {
      const content = { note: `Output of ${row.stage}` };
      const output = await h.admin.query<{ id: string }>(
        `insert into stage_outputs (workspace_id,stage_run_id,version_no,content,content_sha256,origin)
         values ($1,$2,1,$3::jsonb,$4,'model') returning id`,
        [h.ids.workspaceA, row.id, JSON.stringify(content), sha(content)],
      );
      await h.admin.query('update stage_runs set latest_output_id = $2 where id = $1', [
        row.id,
        output.rows[0]!.id,
      ]);
    }
    const message = await post(api(`/projects/${projectId}/stages/${researchStageId}/messages`), {
      kind: 'ask',
      content: 'The final report has to include a budget for the pilot.',
    });
    expect(message.statusCode, message.body).toBe(200);
    chatMessageId = message.json<{ asked: { id: string } }>().asked.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await h?.close();
  });

  it('starts empty and checks nothing when there is no requirement', async () => {
    const empty = await list();
    expect(empty).toMatchObject({ items: [], history: [], check: null, limit: 50 });
    const check = await post(`${base()}/check`);
    expect(check.statusCode).toBe(409);
    expect(check.json<{ code: string }>().code).toBe('OUTPUT_REQUIREMENTS_NONE');
  });

  it('adds a requirement at any time and tells which stages were written before it', async () => {
    const added = await post(base(), {
      kind: 'must',
      text: '  The   output must contain a risk register  ',
      stage: 'ideation',
    });
    expect(added.statusCode, added.body).toBe(201);
    const { requirement } = added.json<{ requirement: Requirement }>();
    expect(requirement).toMatchObject({
      kind: 'must',
      text: 'The output must contain a risk register',
      source: 'admin',
      stage: 'ideation',
      messageId: null,
    });

    const listing = await list();
    expect(listing.items).toHaveLength(1);
    expect(listing.items[0]!.behindStages).toEqual(['analysis', 'research']);
    expect(listing.stages.map((item) => item.stage)).toEqual([
      'analysis',
      'research',
      'ideation',
      'documentation',
      'evaluation',
    ]);
  });

  it('refuses a bad kind, a short text, an unknown stage and a duplicate', async () => {
    for (const payload of [
      { kind: 'should', text: 'Something long enough' },
      { kind: 'must', text: 'ab' },
      { kind: 'must', text: 'Long enough text', stage: 'dreaming' },
    ]) {
      const response = await post(base(), payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const duplicate = await post(base(), {
      kind: 'must',
      text: 'the output MUST contain a risk register',
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json<{ code: string }>().code).toBe('OUTPUT_REQUIREMENT_DUPLICATE');
    // The same words with the opposite kind are a different requirement.
    const opposite = await post(base(), {
      kind: 'must_not',
      text: 'The output must contain a risk register',
    });
    expect(opposite.statusCode, opposite.body).toBe(201);
  });

  it('turns a chat message into a requirement and remembers the link', async () => {
    const url = api(
      `/projects/${projectId}/stages/${researchStageId}/messages/${chatMessageId}/requirements`,
    );
    const added = await post(url, { kind: 'must' });
    expect(added.statusCode, added.body).toBe(201);
    const { requirement } = added.json<{ requirement: Requirement }>();
    expect(requirement).toMatchObject({
      source: 'chat',
      stage: 'research',
      messageId: chatMessageId,
      text: 'The final report has to include a budget for the pilot.',
    });

    const conversation = (
      await h.request('GET', api(`/projects/${projectId}/stages/${researchStageId}/messages`), {
        cookie: cookieA,
      })
    ).json<{ items: { id: string; savedAsRequirement?: boolean }[] }>();
    expect(conversation.items.find((item) => item.id === chatMessageId)?.savedAsRequirement).toBe(
      true,
    );

    const wrongProject = await post(
      api(
        `/projects/${projectId}/stages/${researchStageId}/messages/00000000-0000-4000-8000-000000000000/requirements`,
      ),
      { kind: 'must' },
    );
    expect(wrongProject.statusCode).toBe(404);
  });

  it('shows the active requirements to the stage agent', async () => {
    const invoke = vi.spyOn(h.fake, 'invoke');
    const sent = await post(api(`/projects/${projectId}/stages/${researchStageId}/messages`), {
      kind: 'ask',
      content: 'Does your output meet the requirements?',
    });
    expect(sent.statusCode, sent.body).toBe(200);
    const request = invoke.mock.calls[0]![0];
    expect(request.messages[0]!.content).toContain('outputRequirements');
    expect(request.messages[0]!.content).toContain('a risk register');
    expect(request.instructions ?? '').toContain('binding constraint');
    invoke.mockRestore();
  });

  it('aims a requirement at one stage so only that stage reads it (ADR-0041)', async () => {
    const added = await post(base(), {
      kind: 'must',
      text: 'Cite a primary source for every churn figure',
      target: 'research',
    });
    expect(added.statusCode, added.body).toBe(201);
    const requirement = added.json<{ requirement: Requirement }>().requirement;
    expect(requirement.target).toBe('research');
    expect(
      (await list()).items.find((item) => item.id === requirement.id)!.behindStages,
    ).not.toContain('analysis');
    const unknown = await post(base(), { kind: 'must', text: 'Nothing here', target: 'finale' });
    expect(unknown.statusCode).toBe(400);

    const invoke = vi.spyOn(h.fake, 'invoke');
    const asked = await post(api(`/projects/${projectId}/stages/${researchStageId}/messages`), {
      kind: 'ask',
      content: 'Which requirements bind you?',
    });
    expect(asked.statusCode, asked.body).toBe(200);
    expect(invoke.mock.calls[0]![0].messages[0]!.content).toContain('primary source');
    expect(invoke.mock.calls[0]![0].messages[0]!.content).toContain('"appliesTo":"research"');
    invoke.mockRestore();

    // Moving it to the final output as a whole is an edit: a new row, the old one in history.
    const moved = await h.request('PATCH', `${base()}/${requirement.id}`, {
      cookie: cookieA,
      payload: { target: null },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json<{ requirement: Requirement }>().requirement.target).toBeNull();
    const after = await list();
    expect(after.history.some((item) => item.id === requirement.id)).toBe(true);
    await post(`${base()}/${moved.json<{ requirement: Requirement }>().requirement.id}/withdraw`);
  });

  it('replaces a requirement on edit and keeps the old one in the history', async () => {
    const before = await list();
    const target = before.items.find((item) => item.kind === 'must' && item.source === 'admin')!;
    const edited = await h.request('PATCH', `${base()}/${target.id}`, {
      cookie: cookieA,
      payload: { text: 'The output must contain a risk register with owners' },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    const { requirement } = edited.json<{ requirement: Requirement }>();
    expect(requirement.supersedesId).toBe(target.id);
    expect(requirement.stage).toBe('ideation');

    const after = await list();
    expect(after.items.map((item) => item.id)).not.toContain(target.id);
    expect(after.items.map((item) => item.id)).toContain(requirement.id);
    expect(after.history.find((item) => item.id === target.id)?.endedKind).toBe('replaced');

    const again = await h.request('PATCH', `${base()}/${target.id}`, {
      cookie: cookieA,
      payload: { text: 'Another try at an old one' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe('OUTPUT_REQUIREMENT_ENDED');
    const same = await h.request('PATCH', `${base()}/${requirement.id}`, {
      cookie: cookieA,
      payload: { text: requirement.text },
    });
    expect(same.statusCode).toBe(400);
  });

  it('checks the coverage, stores it, and calls it stale after a change', async () => {
    const { items } = await list();
    const original = h.fake.responder;
    h.fake.responder = (request) =>
      request.responseSchema?.name === 'output_requirement_coverage'
        ? {
            results: items.map((item, index) => ({
              requirementId: item.id,
              verdict: index === 0 ? 'covered' : 'partial',
              evidence: `Evidence ${index}`,
              foundIn: 'research',
            })),
          }
        : original(request);
    const checked = await post(`${base()}/check`);
    expect(checked.statusCode, checked.body).toBe(200);
    const { check } = checked.json<{ check: NonNullable<Listing['check']> }>();
    expect(check.stale).toBe(false);
    expect(check.summary).toMatchObject({
      total: items.length,
      covered: 1,
      partial: items.length - 1,
    });
    expect(check.results[0]).toMatchObject({ verdict: 'covered', evidence: 'Evidence 0' });
    expect((await list()).check?.checkId).toBe(check.checkId);

    const extra = await post(base(), { kind: 'must_not', text: 'No staff names anywhere' });
    expect(extra.statusCode, extra.body).toBe(201);
    expect((await list()).check?.stale).toBe(true);
  });

  it('fails a check whose answer judged nothing', async () => {
    const original = h.fake.responder;
    h.fake.responder = () => ({ results: [] });
    const failed = await post(`${base()}/check`);
    expect(failed.statusCode).toBe(422);
    expect(failed.json<{ code: string }>().code).toBe('OUTPUT_REQUIREMENTS_CHECK_FAILED');
    h.fake.responder = original;
  });

  it('withdraws a requirement and lists it in the history with its reason', async () => {
    const { items } = await list();
    const target = items[items.length - 1]!;
    const response = await post(`${base()}/${target.id}/withdraw`, {
      reason: 'Not needed any more',
    });
    expect(response.statusCode, response.body).toBe(200);
    const after = await list();
    expect(after.items.map((item) => item.id)).not.toContain(target.id);
    expect(after.history.map((item) => item.id)).toContain(target.id);
    const again = await post(`${base()}/${target.id}/withdraw`);
    expect(again.statusCode).toBe(409);
  });

  it('stops at the limit of active requirements', async () => {
    const { items, limit } = await list();
    for (let index = items.length; index < limit; index += 1) {
      const response = await post(base(), { kind: 'must', text: `Filler requirement ${index}` });
      expect(response.statusCode, response.body).toBe(201);
    }
    const over = await post(base(), { kind: 'must', text: 'One requirement too many' });
    expect(over.statusCode).toBe(409);
    expect(over.json<{ code: string }>().code).toBe('OUTPUT_REQUIREMENT_LIMIT');
  });

  it('audits by ids and counts, never by text', async () => {
    const audit = await h.admin.query(
      `select action, after from audit_events where action like 'output_requirements.%' and project_id = $1`,
      [projectId],
    );
    const actions = new Set(audit.rows.map((row: { action: string }) => row.action));
    expect([...actions]).toEqual(
      expect.arrayContaining([
        'output_requirements.added',
        'output_requirements.edited',
        'output_requirements.withdrawn',
        'output_requirements.checked',
      ]),
    );
    expect(JSON.stringify(audit.rows)).not.toContain('risk register');
  });

  it('never shows the requirements to another workspace', async () => {
    const response = await h.request(
      'GET',
      `/v1/workspaces/${h.ids.workspaceB}/projects/${projectId}/output-requirements`,
      { cookie: cookieB },
    );
    expect(response.statusCode).toBe(404);
  });

  it('keeps every table append-only', async () => {
    await expect(h.admin.query(`update output_requirements set body = 'x'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(h.admin.query('delete from output_requirement_withdrawals')).rejects.toThrow(
      /append-only/,
    );
    await expect(
      h.admin.query(`update output_requirement_checks set verdict = 'covered'`),
    ).rejects.toThrow(/append-only/);
  });
});
