import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

interface CandidateView {
  candidateKey: string;
  versionNo: number;
  title: string;
  problemDraft: string;
  state: string;
  source: string;
}
interface Detail {
  exploration: { id: string; status: string; version: number; title: string };
  messages: { seq: number; role: string; status: string; content: string }[];
  candidates: CandidateView[];
  limits: { usedMessages: number; usedCandidates: number; maxMessages: number };
}

let h: Harness;
let cookie: string;
const api = (suffix = '') => `/v1/workspaces/${h.ids.workspaceA}/explorations${suffix}`;

async function setting(key: string, value: unknown) {
  const response = await h.request(
    'PUT',
    `/v1/workspaces/${h.ids.workspaceA}/settings/assignments`,
    {
      cookie,
      payload: {
        key,
        scopeType: 'workspace',
        scopeId: h.ids.workspaceA,
        value,
        reason: `test ${key}`,
      },
    },
  );
  expect(response.statusCode, response.body).toBe(200);
}

async function create(title = 'Large clients left'): Promise<Detail> {
  const response = await h.request('POST', api(), {
    cookie,
    payload: {
      title,
      eventText: 'Three of our biggest clients cancelled this month. CONFIDENTIAL-EVENT-TEXT',
      outputLanguage: 'en',
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<Detail>();
}

const detail = async (id: string) =>
  (await h.request('GET', api(`/${id}`), { cookie })).json<Detail>();

/** What the scripted model proposes in the next proposal call. */
let proposal: unknown[] = [];
const candidate = (title: string) => ({
  title,
  problemDraft: `The problem behind ${title}`,
  why: 'It matters',
  assumptions: 'None confirmed',
  expectedOutput: 'A plan',
});

describe.skipIf(!adminUrl)('explorations (ADR-0044 P1)', () => {
  beforeAll(async () => {
    h = await createHarness('explorations');
    cookie = await h.login(h.emails.a);
    const base = h.fake.responder;
    h.fake.responder = (request) =>
      request.responseSchema?.name === 'exploration_candidates'
        ? { candidates: proposal }
        : base(request);
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  });

  it('refuses a model call while no model is configured and keeps no half-written message', async () => {
    const { exploration } = await create();
    const response = await h.request('POST', api(`/${exploration.id}/messages`), {
      cookie,
      payload: { content: 'What could be going on?' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('AI_NOT_CONFIGURED');
    expect((await detail(exploration.id)).messages).toEqual([]);
    const propose = await h.request('POST', api(`/${exploration.id}/propose`), { cookie });
    expect(propose.json<{ code: string }>().code).toBe('AI_NOT_CONFIGURED');

    const connection = await h.request(
      'POST',
      `/v1/workspaces/${h.ids.workspaceA}/provider-connections`,
      { cookie, payload: { provider: 'fake', name: 'Deterministic' } },
    );
    expect(connection.statusCode, connection.body).toBe(201);
    await setting(
      'ai.connection_id',
      connection.json<{ connection: { id: string } }>().connection.id,
    );
    await setting('ai.model', 'fake-standard');
  });

  it('keeps an exploration in its workspace and shows it to a viewer who can only read', async () => {
    const { exploration } = await create('Private to A');
    // Another workspace cannot see it, whatever the id.
    const other = await h.login(h.emails.b);
    for (const path of [`/v1/workspaces/${h.ids.workspaceA}/explorations/${exploration.id}`]) {
      expect((await h.request('GET', path, { cookie: other })).statusCode).toBe(404);
    }
    const mine = await h.request('GET', `/v1/workspaces/${h.ids.workspaceB}/explorations`, {
      cookie: other,
    });
    expect(mine.json<{ items: unknown[] }>().items).toEqual([]);
    const foreign = await h.request(
      'GET',
      `/v1/workspaces/${h.ids.workspaceB}/explorations/${exploration.id}`,
      { cookie: other },
    );
    expect(foreign.statusCode).toBe(404);

    await h.admin.query("update users set account_role='viewer' where id=$1", [h.ids.userB]);
    await h.admin.query("update memberships set role='viewer' where user_id=$1", [h.ids.userB]);
    await h.admin.query(
      "insert into memberships(workspace_id,user_id,role) values($1,$2,'viewer')",
      [h.ids.workspaceA, h.ids.userB],
    );
    try {
      const viewer = await h.login(h.emails.b);
      const read = await h.request('GET', api(`/${exploration.id}`), { cookie: viewer });
      expect(read.statusCode, read.body).toBe(200);
      expect((await h.request('GET', api(), { cookie: viewer })).statusCode).toBe(200);
      for (const [method, path, payload] of [
        ['POST', api(), { title: 'No', eventText: 'No' }],
        ['POST', api(`/${exploration.id}/messages`), { content: 'No' }],
        ['POST', api(`/${exploration.id}/propose`), {}],
        ['POST', api(`/${exploration.id}/archive`), { expectedVersion: 1 }],
      ] as const) {
        expect((await h.request(method, path, { cookie: viewer, payload })).statusCode).toBe(403);
      }
    } finally {
      await h.admin.query('delete from memberships where user_id=$1 and workspace_id=$2', [
        h.ids.userB,
        h.ids.workspaceA,
      ]);
      await h.admin.query("update memberships set role='super_admin' where user_id=$1", [
        h.ids.userB,
      ]);
      await h.admin.query("update users set account_role='super_admin' where id=$1", [h.ids.userB]);
    }
  });

  it('keeps a conversation in order, stores the answer as plain history and stops at the limit', async () => {
    await setting('exploration.max_messages', 5);
    const { exploration } = await create('Conversation');
    for (let n = 1; n <= 5; n += 1) {
      const response = await h.request('POST', api(`/${exploration.id}/messages`), {
        cookie,
        payload: { content: `Question ${n}` },
      });
      expect(response.statusCode, response.body).toBe(201);
    }
    const state = await detail(exploration.id);
    expect(state.messages.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(state.messages.map((item) => item.role).slice(0, 4)).toEqual([
      'admin',
      'agent',
      'admin',
      'agent',
    ]);
    expect(state.messages.every((item) => item.status === 'done' && item.content !== '')).toBe(
      true,
    );
    expect(state.limits).toMatchObject({ usedMessages: 5, maxMessages: 5 });
    const over = await h.request('POST', api(`/${exploration.id}/messages`), {
      cookie,
      payload: { content: 'One too many' },
    });
    expect(over.statusCode).toBe(409);
    expect(over.json<{ code: string }>().code).toBe('EXPLORATION_MESSAGE_LIMIT');
    expect(state.candidates).toEqual([]);
    await setting('exploration.max_messages', 40);
  });

  it('adds what the model proposes as proposed candidates and never repeats or revives one', async () => {
    const { exploration } = await create('Proposals');
    proposal = [
      candidate('Churn of large clients'),
      candidate('churn of LARGE clients'),
      { title: 'x', problemDraft: '' },
      candidate('Slow onboarding'),
    ];
    const first = await h.request('POST', api(`/${exploration.id}/propose`), { cookie });
    expect(first.statusCode, first.body).toBe(200);
    const state = first.json<Detail>();
    expect(state.candidates.map((item) => item.title)).toEqual([
      'Churn of large clients',
      'Slow onboarding',
    ]);
    expect(
      state.candidates.every((item) => item.state === 'proposed' && item.source === 'ai'),
    ).toBe(true);
    // Nothing became a project or a decision by itself.
    const decisions = await h.admin.query(
      'select 1 from exploration_candidate_decisions where exploration_id = $1',
      [exploration.id],
    );
    expect(decisions.rowCount).toBe(0);

    // The same answer again adds nothing, and says so instead of pretending.
    const again = await h.request('POST', api(`/${exploration.id}/propose`), { cookie });
    expect(again.statusCode).toBe(422);
    expect(again.json<{ code: string }>().code).toBe('EXPLORATION_PROPOSAL_FAILED');
    expect((await detail(exploration.id)).candidates).toHaveLength(2);
    proposal = [];
  });

  it('parks, drops and brings a candidate back, one decision at a time, and never promotes by request', async () => {
    const { exploration } = await create('Decisions');
    proposal = [candidate('Pricing complaints')];
    const proposed = await h.request('POST', api(`/${exploration.id}/propose`), { cookie });
    const key = proposed.json<Detail>().candidates[0]!.candidateKey;
    const decide = (decision: string, reason = '') =>
      h.request('POST', api(`/${exploration.id}/candidates/${key}/decision`), {
        cookie,
        payload: { decision, reason },
      });
    const stateOf = async () => (await detail(exploration.id)).candidates[0]!.state;

    expect((await decide('parked', 'Not now')).statusCode).toBe(200);
    expect(await stateOf()).toBe('parked');
    expect((await decide('dropped')).statusCode).toBe(200);
    expect(await stateOf()).toBe('dropped');
    // Repeating the current state is not another decision.
    await decide('dropped');
    expect((await decide('proposed', 'Came back')).statusCode).toBe(200);
    expect(await stateOf()).toBe('proposed');
    const rows = await h.admin.query<{ decision: string }>(
      'select decision from exploration_candidate_decisions where exploration_id = $1 order by created_at, id',
      [exploration.id],
    );
    expect(rows.rows.map((row) => row.decision)).toEqual(['parked', 'dropped', 'proposed']);

    expect((await decide('promoted')).statusCode).toBe(400);
    expect((await decide('nonsense')).statusCode).toBe(400);
    const missing = await h.request(
      'POST',
      api(`/${exploration.id}/candidates/00000000-0000-4000-8000-000000000000/decision`),
      { cookie, payload: { decision: 'parked' } },
    );
    expect(missing.statusCode).toBe(404);

    // A dropped candidate is shown to the model as dropped.
    await decide('dropped');
    const seen: string[] = [];
    const base = h.fake.responder;
    h.fake.responder = (request) => {
      seen.push(request.messages[0]?.content ?? '');
      return base(request);
    };
    proposal = [candidate('Another one')];
    await h.request('POST', api(`/${exploration.id}/propose`), { cookie });
    h.fake.responder = base;
    expect(seen.join('')).toContain('"state":"dropped"');
    proposal = [];
  });

  it('writes an edit as a new version, refuses a stale or duplicate one, and takes hand-written candidates', async () => {
    const { exploration } = await create('Edits');
    const add = (title: string) =>
      h.request('POST', api(`/${exploration.id}/candidates`), {
        cookie,
        payload: { title, problemDraft: `About ${title}` },
      });
    const added = await add('First problem');
    expect(added.statusCode, added.body).toBe(201);
    expect((await add('first PROBLEM')).statusCode).toBe(409);
    expect((await add('x')).statusCode).toBe(400);
    const second = (await add('Second problem')).json<Detail>();
    const key = second.candidates[0]!.candidateKey;
    const edit = (basedOnVersionNo: number, title: string) =>
      h.request('PATCH', api(`/${exploration.id}/candidates/${key}`), {
        cookie,
        payload: { basedOnVersionNo, candidate: { title, problemDraft: 'Reworded' } },
      });
    const edited = await edit(1, 'First problem, reworded');
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json<Detail>().candidates[0]).toMatchObject({
      candidateKey: key,
      versionNo: 2,
      title: 'First problem, reworded',
      source: 'admin',
    });
    expect((await edit(1, 'Stale')).statusCode).toBe(409);
    expect((await edit(2, 'Second problem')).statusCode).toBe(409);
    const versions = await h.admin.query<{ version_no: number }>(
      'select version_no from exploration_candidates where candidate_key = $1 order by version_no',
      [key],
    );
    expect(versions.rows.map((row) => row.version_no)).toEqual([1, 2]);
  });

  it('stops at the candidate limit', async () => {
    await setting('exploration.max_candidates', 5);
    const { exploration } = await create('Limit');
    for (let n = 1; n <= 5; n += 1) {
      const response = await h.request('POST', api(`/${exploration.id}/candidates`), {
        cookie,
        payload: { title: `Problem ${n}`, problemDraft: 'x' },
      });
      expect(response.statusCode, response.body).toBe(201);
    }
    const over = await h.request('POST', api(`/${exploration.id}/candidates`), {
      cookie,
      payload: { title: 'Problem 6', problemDraft: 'x' },
    });
    expect(over.json<{ code: string }>().code).toBe('EXPLORATION_CANDIDATE_LIMIT');
    proposal = [candidate('Seventh')];
    const propose = await h.request('POST', api(`/${exploration.id}/propose`), { cookie });
    expect(propose.json<{ code: string }>().code).toBe('EXPLORATION_CANDIDATE_LIMIT');
    proposal = [];
    await setting('exploration.max_candidates', 30);
  });

  it('closes messages and new candidates when archived but still lets a parked one be revived', async () => {
    const { exploration } = await create('Archive');
    const key = (
      await h.request('POST', api(`/${exploration.id}/candidates`), {
        cookie,
        payload: { title: 'Kept problem', problemDraft: 'x' },
      })
    ).json<Detail>().candidates[0]!.candidateKey;
    await h.request('POST', api(`/${exploration.id}/candidates/${key}/decision`), {
      cookie,
      payload: { decision: 'parked' },
    });
    const stale = await h.request('POST', api(`/${exploration.id}/archive`), {
      cookie,
      payload: { expectedVersion: 99 },
    });
    expect(stale.statusCode).toBe(409);
    const archived = await h.request('POST', api(`/${exploration.id}/archive`), {
      cookie,
      payload: { expectedVersion: exploration.version },
    });
    expect(archived.json<Detail>().exploration.status).toBe('archived');
    const code = async (method: 'POST' | 'PATCH', suffix: string, payload: unknown) =>
      (await h.request(method, api(`/${exploration.id}${suffix}`), { cookie, payload })).json<{
        code: string;
      }>().code;
    expect(await code('POST', '/messages', { content: 'Hello' })).toBe('EXPLORATION_ARCHIVED');
    expect(await code('POST', '/propose', {})).toBe('EXPLORATION_ARCHIVED');
    expect(await code('POST', '/candidates', { title: 'New one', problemDraft: 'x' })).toBe(
      'EXPLORATION_ARCHIVED',
    );
    expect(
      await code('PATCH', '', {
        expectedVersion: archived.json<Detail>().exploration.version,
        title: 'Renamed',
      }),
    ).toBe('EXPLORATION_ARCHIVED');
    const revived = await h.request('POST', api(`/${exploration.id}/candidates/${key}/decision`), {
      cookie,
      payload: { decision: 'proposed' },
    });
    expect(revived.statusCode, revived.body).toBe(200);
    const reopened = await h.request('POST', api(`/${exploration.id}/reopen`), {
      cookie,
      payload: { expectedVersion: archived.json<Detail>().exploration.version },
    });
    expect(reopened.json<Detail>().exploration.status).toBe('open');
    const list = await h.request('GET', api('?status=all'), { cookie });
    const item = list
      .json<{ items: { id: string; byState: Record<string, number> }[] }>()
      .items.find((entry) => entry.id === exploration.id);
    expect(item?.byState).toMatchObject({ proposed: 1, parked: 0 });
  });

  it('keeps history append-only and the audit trail free of the administrator’s text', async () => {
    const { exploration } = await create('History');
    await h.request('POST', api(`/${exploration.id}/messages`), {
      cookie,
      payload: { content: 'SECRET-MESSAGE-TEXT' },
    });
    proposal = [candidate('SECRET-CANDIDATE-TITLE')];
    await h.request('POST', api(`/${exploration.id}/propose`), { cookie });
    proposal = [];
    for (const statement of [
      "update exploration_messages set content = 'changed' where exploration_id = $1",
      'delete from exploration_messages where exploration_id = $1',
      "update exploration_candidates set title = 'changed' where exploration_id = $1",
      'delete from exploration_candidates where exploration_id = $1',
    ]) {
      await expect(h.admin.query(statement, [exploration.id])).rejects.toThrow();
    }
    const audit = await h.admin.query<{ action: string; before: unknown; after: unknown }>(
      `select action, before, after from audit_events where target_id = $1 order by occurred_at, id`,
      [exploration.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'exploration.created',
      'exploration.message',
      'exploration.candidates_proposed',
    ]);
    const text = JSON.stringify(audit.rows);
    for (const secret of [
      'SECRET-MESSAGE-TEXT',
      'SECRET-CANDIDATE-TITLE',
      'CONFIDENTIAL-EVENT-TEXT',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('makes projects from a candidate: marked once, linked for good, refused when dropped (P2)', async () => {
    const { exploration } = await create('From problem to project');
    const added = await h.request('POST', api(`/${exploration.id}/candidates`), {
      cookie,
      payload: { title: 'Slow onboarding', problemDraft: 'New clients wait weeks to start.' },
    });
    const key = added.json<Detail>().candidates[0]!.candidateKey;
    const projectsUrl = `/v1/workspaces/${h.ids.workspaceA}/projects`;
    const make = (code: string, extra: Record<string, unknown> = {}) =>
      h.request('POST', projectsUrl, {
        cookie,
        payload: {
          code,
          title: 'Onboarding',
          initialProblem: 'New clients wait weeks to start.',
          topics: [],
          explorationCandidate: { explorationId: exploration.id, candidateKey: key },
          ...extra,
        },
      });
    const candidateOf = async () =>
      (await detail(exploration.id)).candidates.find(
        (item) => item.candidateKey === key,
      )! as CandidateView & {
        projects: { id: string; code: string }[];
      };
    const decisions = () =>
      h.admin.query<{ decision: string }>(
        'select decision from exploration_candidate_decisions where candidate_key = $1 order by created_at, id',
        [key],
      );

    // A failed creation leaves the candidate as it was: nothing is half done.
    expect((await make('p2-dup')).statusCode).toBe(201);
    const duplicate = await make('p2-dup');
    expect(duplicate.statusCode).toBe(409);
    expect((await candidateOf()).projects).toHaveLength(1);
    expect((await decisions()).rows.map((row) => row.decision)).toEqual(['promoted']);

    const first = await h.request('GET', `${projectsUrl}?q=p2-dup`, { cookie });
    const project = first
      .json<{ items: { id: string; explorationOrigin: unknown }[] }>()
      .items.find(Boolean)!;
    expect(project.explorationOrigin).toEqual({
      explorationId: exploration.id,
      candidateKey: key,
      explorationTitle: 'From problem to project',
      candidateTitle: 'Slow onboarding',
    });
    const state = await candidateOf();
    expect(state.state).toBe('promoted');
    expect(state.projects.map((item) => item.code)).toEqual(['p2-dup']);

    // One candidate can give another project; the candidate is not marked a second time.
    expect((await make('p2-second')).statusCode).toBe(201);
    expect((await candidateOf()).projects.map((item) => item.code)).toEqual([
      'p2-dup',
      'p2-second',
    ]);
    expect((await decisions()).rows).toHaveLength(1);

    // A promoted candidate no longer changes state by hand.
    const decide = await h.request('POST', api(`/${exploration.id}/candidates/${key}/decision`), {
      cookie,
      payload: { decision: 'dropped' },
    });
    expect(decide.json<{ code: string }>().code).toBe('EXPLORATION_CANDIDATE_PROMOTED');

    // The link never changes, not even by the database owner.
    await expect(
      h.admin.query('update projects set origin_candidate_key = null where id = $1', [project.id]),
    ).rejects.toThrow();

    // Audit: ids and counts only.
    const audit = await h.admin.query<{ action: string; after: unknown }>(
      `select action, after from audit_events where target_id = $1 and action = 'exploration.candidate_promoted' order by occurred_at`,
      [exploration.id],
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[0]!.after).toMatchObject({ candidateKey: key, firstProject: true });
    expect(audit.rows[1]!.after).toMatchObject({ firstProject: false });
    expect(JSON.stringify(audit.rows)).not.toContain('New clients wait');
  });

  it('refuses a dropped, unknown or foreign candidate and creates no project (P2)', async () => {
    const { exploration } = await create('Refusals');
    const key = (
      await h.request('POST', api(`/${exploration.id}/candidates`), {
        cookie,
        payload: { title: 'Dropped idea', problemDraft: 'x' },
      })
    ).json<Detail>().candidates[0]!.candidateKey;
    await h.request('POST', api(`/${exploration.id}/candidates/${key}/decision`), {
      cookie,
      payload: { decision: 'dropped' },
    });
    const projectsUrl = `/v1/workspaces/${h.ids.workspaceA}/projects`;
    const attempt = (code: string, explorationId: string, candidateKey: string) =>
      h.request('POST', projectsUrl, {
        cookie,
        payload: {
          code,
          title: 'No',
          initialProblem: 'x',
          topics: [],
          explorationCandidate: { explorationId, candidateKey },
        },
      });
    const dropped = await attempt('p2-dropped', exploration.id, key);
    expect(dropped.statusCode).toBe(409);
    expect(dropped.json<{ code: string }>().code).toBe('EXPLORATION_CANDIDATE_DROPPED');
    const unknown = await attempt(
      'p2-unknown',
      exploration.id,
      '00000000-0000-4000-8000-000000000000',
    );
    expect(unknown.statusCode).toBe(404);
    const noExploration = await attempt('p2-none', '00000000-0000-4000-8000-000000000000', key);
    expect(noExploration.statusCode).toBe(404);
    expect((await attempt('p2-bad', 'not-a-uuid', key)).statusCode).toBe(400);

    // An exploration of another workspace is invisible, even with its real ids.
    const other = await h.login(h.emails.b);
    const foreign = await h.request('POST', `/v1/workspaces/${h.ids.workspaceB}/projects`, {
      cookie: other,
      payload: {
        code: 'p2-foreign',
        title: 'No',
        initialProblem: 'x',
        topics: [],
        explorationCandidate: { explorationId: exploration.id, candidateKey: key },
      },
    });
    expect(foreign.statusCode).toBe(404);

    const created = await h.admin.query(
      "select 1 from projects where code in ('p2-dropped','p2-unknown','p2-none','p2-bad','p2-foreign')",
    );
    expect(created.rowCount).toBe(0);
    // Brought back, the same candidate can be used.
    await h.request('POST', api(`/${exploration.id}/candidates/${key}/decision`), {
      cookie,
      payload: { decision: 'proposed' },
    });
    expect((await attempt('p2-ok', exploration.id, key)).statusCode).toBe(201);
  });

  it('validates what it receives', async () => {
    for (const payload of [
      {},
      { title: 'A', eventText: 'x' },
      { title: 'Fine title', eventText: '' },
      { title: 'Fine title', eventText: 'x', extra: true },
      { title: 'Fine title', eventText: 'x'.repeat(5001) },
    ]) {
      expect((await h.request('POST', api(), { cookie, payload })).statusCode).toBe(400);
    }
    expect((await h.request('GET', api('/not-a-uuid'), { cookie })).statusCode).toBe(400);
    expect(
      (await h.request('GET', api('/00000000-0000-4000-8000-000000000000'), { cookie })).statusCode,
    ).toBe(404);
  });
});
