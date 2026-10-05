import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

interface ProjectBody {
  id: string;
  code: string;
  status: string;
  previousStatus: string | null;
  pauseReason: string | null;
  nextAction: string;
  availableCommands: string[];
  version: number;
  configSnapshotId: string | null;
  clonedFromId: string | null;
  purgeAfter: string | null;
  topics: { topicId: string; priority: number; topicStatus: string }[];
}

let h: Harness;
let cookieA: string;
let cookieB: string;
let topicIds: string[];

const projects = (workspaceId: string, suffix = '') =>
  `/v1/workspaces/${workspaceId}/projects${suffix}`;

async function createTopic(code: string): Promise<string> {
  const response = await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/topics`, {
    cookie: cookieA,
    payload: { code, title: `Topic ${code}` },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ topic: { id: string } }>().topic.id;
}

async function createProject(code: string, topics: string[] = topicIds): Promise<ProjectBody> {
  const response = await h.request('POST', projects(h.ids.workspaceA), {
    cookie: cookieA,
    payload: {
      code,
      title: `Project ${code}`,
      initialProblem: 'Confidential problem statement for the board',
      topics: topics.map((topicId) => ({ topicId })),
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ project: ProjectBody }>().project;
}

async function command(project: ProjectBody, name: string, reason?: string) {
  const response = await h.request(
    name === 'delete' ? 'DELETE' : 'POST',
    projects(h.ids.workspaceA, name === 'delete' ? `/${project.id}` : `/${project.id}/${name}`),
    {
      cookie: cookieA,
      payload: { expectedVersion: project.version, ...(reason ? { reason } : {}) },
    },
  );
  return response;
}

async function step(project: ProjectBody, name: string, reason?: string): Promise<ProjectBody> {
  const response = await command(project, name, reason);
  expect(response.statusCode, `${name}: ${response.body}`).toBe(200);
  return response.json<{ project: ProjectBody }>().project;
}

describe.skipIf(!adminUrl)('projects integration (TC-PRJ-*)', () => {
  beforeAll(async () => {
    h = await createHarness('projects');
    cookieA = await h.login(h.emails.a);
    cookieB = await h.login(h.emails.b);
    topicIds = [await createTopic('market'), await createTopic('finance')];
  }, 30_000);

  afterAll(async () => {
    await h?.close();
  });

  it('creates a draft with prioritized topics and validates topic availability', async () => {
    const project = await createProject('alpha');
    expect(project).toMatchObject({
      status: 'draft',
      version: 1,
      nextAction: 'complete_setup_and_activate',
      availableCommands: ['activate', 'archive', 'delete'],
    });
    expect(project.topics.map((topic) => [topic.topicId, topic.priority])).toEqual([
      [topicIds[0], 1],
      [topicIds[1], 2],
    ]);

    const duplicate = await h.request('POST', projects(h.ids.workspaceA), {
      cookie: cookieA,
      payload: { code: 'alpha', title: 'Again', initialProblem: 'x' },
    });
    expect(duplicate.statusCode).toBe(409);

    const archivedTopic = await createTopic('archived-topic');
    await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/topics/${archivedTopic}/archive`, {
      cookie: cookieA,
      payload: {},
    });
    const withArchived = await h.request('POST', projects(h.ids.workspaceA), {
      cookie: cookieA,
      payload: {
        code: 'beta',
        title: 'Beta',
        initialProblem: 'x',
        topics: [{ topicId: archivedTopic }],
      },
    });
    expect(withArchived.statusCode).toBe(409);
    expect(withArchived.json<{ code: string }>().code).toBe('PROJECT_TOPIC_UNAVAILABLE');
  });

  it('enforces the formal lifecycle with versions, reasons and idempotent commands', async () => {
    const empty = await createProject('no-topics', []);
    const notReady = await command(empty, 'activate');
    expect(notReady.statusCode).toBe(409);
    expect(notReady.json<{ code: string; problems: string[] }>()).toMatchObject({
      code: 'PROJECT_NOT_READY',
      problems: ['topics_missing'],
    });

    let project = await createProject('lifecycle');
    const invalid = await command(project, 'pause', 'not active yet');
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json<{ code: string }>().code).toBe('PROJECT_STATE_CONFLICT');

    project = await step(project, 'activate');
    expect(project).toMatchObject({ status: 'active', version: 2 });
    // The backoffice offers exactly the commands the state machine accepts.
    expect(project.availableCommands).toEqual(['pause', 'complete', 'archive', 'delete']);
    expect(project.configSnapshotId).toMatch(/^[0-9a-f-]{36}$/);

    const stale = await h.request('POST', projects(h.ids.workspaceA, `/${project.id}/pause`), {
      cookie: cookieA,
      payload: { expectedVersion: 1, reason: 'stale' },
    });
    expect(stale.statusCode).toBe(412);

    const noReason = await command(project, 'pause');
    expect(noReason.json<{ code: string }>().code).toBe('PROJECT_REASON_REQUIRED');

    project = await step(project, 'pause', 'Waiting for finance data');
    expect(project).toMatchObject({ status: 'paused', pauseReason: 'Waiting for finance data' });
    const repeat = await step(project, 'pause', 'again');
    expect(repeat.version).toBe(project.version);

    project = await step(project, 'resume');
    expect(project.pauseReason).toBeNull();
    project = await step(project, 'complete', 'Accepted by the board');
    project = await step(project, 'reopen', 'New quarter');
    expect(project.status).toBe('active');

    const problemLocked = await h.request('PATCH', projects(h.ids.workspaceA, `/${project.id}`), {
      cookie: cookieA,
      headers: { 'if-match': `"${project.version}"` },
      payload: { initialProblem: 'Changed problem' },
    });
    expect(problemLocked.json<{ code: string }>().code).toBe('PROJECT_PROBLEM_LOCKED');

    const missingIfMatch = await h.request('PATCH', projects(h.ids.workspaceA, `/${project.id}`), {
      cookie: cookieA,
      payload: { title: 'New title' },
    });
    expect(missingIfMatch.statusCode).toBe(428);
    const edited = await h.request('PATCH', projects(h.ids.workspaceA, `/${project.id}`), {
      cookie: cookieA,
      headers: { 'if-match': `"${project.version}"` },
      payload: { title: 'New title', topics: [{ topicId: topicIds[1] }, { topicId: topicIds[0] }] },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.headers['etag']).toBe(`"${project.version + 1}"`);
    project = edited.json<{ project: ProjectBody }>().project;
    expect(project.topics.map((topic) => topic.topicId)).toEqual([topicIds[1], topicIds[0]]);

    project = await step(project, 'archive');
    expect(project).toMatchObject({ status: 'archived', previousStatus: 'active' });
    expect(project.availableCommands).toEqual(['unarchive', 'delete']);
    const readOnly = await h.request('PATCH', projects(h.ids.workspaceA, `/${project.id}`), {
      cookie: cookieA,
      headers: { 'if-match': `"${project.version}"` },
      payload: { title: 'Blocked' },
    });
    expect(readOnly.json<{ code: string }>().code).toBe('PROJECT_READ_ONLY');
    project = await step(project, 'unarchive');
    expect(project.status).toBe('active');
  });

  it('keeps deleted projects recoverable for 30 days, then purges with an audit tombstone', async () => {
    let project = await createProject('recoverable');
    project = await step(project, 'delete', 'Duplicate request');
    expect(project.status).toBe('deleted');
    expect(project.availableCommands).toEqual(['restore']);
    const days = (Date.parse(project.purgeAfter!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    const listed = await h.request('GET', projects(h.ids.workspaceA), { cookie: cookieA });
    expect(listed.json<{ items: ProjectBody[] }>().items.map((item) => item.id)).not.toContain(
      project.id,
    );
    const deletedList = await h.request('GET', projects(h.ids.workspaceA, '?status=deleted'), {
      cookie: cookieA,
    });
    expect(deletedList.json<{ items: ProjectBody[] }>().items.map((item) => item.id)).toContain(
      project.id,
    );

    project = await step(project, 'restore');
    expect(project).toMatchObject({ status: 'draft', purgeAfter: null });

    project = await step(project, 'delete');
    await h.admin.query(
      "update projects set purge_after = now() - interval '1 minute' where id = $1",
      [project.id],
    );
    const expired = await command(project, 'restore');
    expect(expired.statusCode).toBe(410);
    // Past the recovery window the backoffice must not offer a restore that cannot succeed.
    const afterWindow = await h.request('GET', projects(h.ids.workspaceA, `/${project.id}`), {
      cookie: cookieA,
    });
    expect(afterWindow.json<{ project: ProjectBody }>().project.availableCommands).toEqual([]);

    const dryRun = await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/retention/purge`, {
      cookie: cookieA,
      payload: { reason: 'Monthly retention', dryRun: true },
    });
    expect(dryRun.json<{ projectIds: string[] }>().projectIds).toContain(project.id);
    const purge = await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/retention/purge`, {
      cookie: cookieA,
      payload: { reason: 'Monthly retention' },
    });
    expect(purge.statusCode).toBe(200);
    expect(
      (await h.request('GET', projects(h.ids.workspaceA, `/${project.id}`), { cookie: cookieA }))
        .statusCode,
    ).toBe(404);
    const tombstone = await h.admin.query<{ action: string; severity: string }>(
      `select action, severity from audit_events where target_id = $1 and action = 'project.purge'`,
      [project.id],
    );
    expect(tombstone.rows).toEqual([{ action: 'project.purge', severity: 'critical' }]);
  });

  it('clones settings and topics without history and lists a timeline', async () => {
    let source = await createProject('source');
    await h.request('PUT', `/v1/workspaces/${h.ids.workspaceA}/settings/assignments`, {
      cookie: cookieA,
      payload: {
        key: 'research.max_sources',
        scopeType: 'project',
        scopeId: source.id,
        value: 12,
        reason: 'Narrow research',
      },
    });
    source = await step(source, 'activate');
    const clone = await h.request('POST', projects(h.ids.workspaceA, `/${source.id}/clone`), {
      cookie: cookieA,
      payload: { code: 'source-copy' },
    });
    expect(clone.statusCode).toBe(201);
    const copy = clone.json<{ project: ProjectBody; skippedTopicIds: string[] }>().project;
    expect(copy).toMatchObject({ status: 'draft', clonedFromId: source.id, version: 1 });
    expect(copy.topics).toHaveLength(2);

    const effective = await h.request(
      'GET',
      projects(h.ids.workspaceA, `/${copy.id}/effective-config`),
      {
        cookie: cookieA,
      },
    );
    expect(
      effective.json<{ config: { values: Record<string, unknown> } }>().config.values[
        'research.max_sources'
      ],
    ).toBe(12);

    const copyTimeline = await h.request(
      'GET',
      projects(h.ids.workspaceA, `/${copy.id}/timeline`),
      {
        cookie: cookieA,
      },
    );
    expect(
      copyTimeline.json<{ items: { action: string }[] }>().items.map((item) => item.action),
    ).toEqual(['project.clone']);

    const timeline = await h.request(
      'GET',
      projects(h.ids.workspaceA, `/${source.id}/timeline?limit=2`),
      {
        cookie: cookieA,
      },
    );
    const page = timeline.json<{ items: { action: string }[]; nextCursor: string | null }>();
    // Activation also creates the workflow run (WF-001), which joins the timeline.
    expect(page.items.map((item) => item.action)).toEqual([
      'workflow.run_created',
      'project.activate',
    ]);
    expect(page.nextCursor).not.toBeNull();
    const next = await h.request(
      'GET',
      projects(h.ids.workspaceA, `/${source.id}/timeline?limit=2&cursor=${page.nextCursor}`),
      { cookie: cookieA },
    );
    expect(next.json<{ items: { action: string }[] }>().items.map((item) => item.action)).toEqual([
      'config.set',
      'project.create',
    ]);

    const audit = await h.admin.query<{ before: unknown; after: unknown }>(
      `select before, after from audit_events where project_id = $1`,
      [source.id],
    );
    expect(JSON.stringify(audit.rows)).not.toContain('Confidential problem');
  });

  it('filters the list by topic, language, last change, waiting and text, and shows the owner (UX §4)', async () => {
    const solo = await createTopic('solo-filter');
    const mine = await createProject('flt-alpha', [solo]);
    const other = await createProject('flt-beta');
    const list = async (query: string) => {
      const response = await h.request('GET', projects(h.ids.workspaceA, `?${query}`), {
        cookie: cookieA,
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json<{
        items: {
          id: string;
          code: string;
          owner: { displayName: string } | null;
          waiting: { kind: string } | null;
        }[];
        nextCursor: string | null;
      }>();
    };
    const codes = async (query: string) => (await list(query)).items.map((item) => item.code);

    // Topic: only the project that uses it.
    expect(await codes(`topicId=${solo}`)).toEqual(['flt-alpha']);
    expect(await codes(`topicId=${topicIds[0]}`)).toContain('flt-beta');
    expect(await codes(`topicId=${topicIds[0]}`)).not.toContain('flt-alpha');

    // Text: part of the code or the title, case-insensitively; wildcards are plain characters.
    expect(await codes('q=FLT-BETA')).toEqual(['flt-beta']);
    expect(await codes('q=Project%20flt-alpha')).toEqual(['flt-alpha']);
    expect(await codes('q=%25')).toEqual([]);

    // Language and last change.
    expect((await codes('language=fa')).length).toBeGreaterThan(0);
    expect(await codes('language=en&q=flt-')).toEqual([]);
    const today = new Date().toISOString().slice(0, 10);
    expect(await codes(`updatedFrom=${today}&q=flt-`)).toEqual(
      expect.arrayContaining(['flt-alpha', 'flt-beta']),
    );
    expect(await codes('updatedTo=2000-01-01&q=flt-')).toEqual([]);

    // Waiting: a person has something to decide.
    expect(await codes('waiting=true&q=flt-')).toEqual([]);
    await h.admin.query(
      `insert into human_tasks (workspace_id, project_id, kind, title, payload)
       values ($1, $2, 'gate_review', 'Review', '{}'::jsonb)`,
      [h.ids.workspaceA, other.id],
    );
    const waiting = await list('waiting=true&q=flt-');
    expect(waiting.items.map((item) => item.code)).toEqual(['flt-beta']);
    expect(waiting.items[0]!.waiting).toMatchObject({ kind: 'gate_review' });

    // Owner: who created the project.
    const everything = await list('q=flt-alpha');
    expect(everything.items[0]!.owner?.displayName).toBe('Admin A');
    expect(everything.items[0]!.waiting).toBeNull();
    expect(mine.id).toBe(everything.items[0]!.id);

    // A cursor belongs to its filters: reusing it for another filter is refused.
    const page = await list('limit=1&q=flt-');
    expect(page.nextCursor).not.toBeNull();
    const reused = await h.request(
      'GET',
      projects(h.ids.workspaceA, `?limit=1&q=alpha&cursor=${page.nextCursor}`),
      { cookie: cookieA },
    );
    expect(reused.statusCode).toBe(400);
    expect(reused.json<{ code: string }>().code).toBe('PROJECT_CURSOR_INVALID');

    // Bad filters are refused.
    for (const bad of ['language=de', 'updatedFrom=yesterday', 'topicId=nope', 'waiting=maybe']) {
      expect(
        (await h.request('GET', projects(h.ids.workspaceA, `?${bad}`), { cookie: cookieA }))
          .statusCode,
      ).toBe(400);
    }
  });

  it('isolates projects between workspaces', async () => {
    const project = await createProject('isolated');
    const foreignWorkspace = await h.request('GET', projects(h.ids.workspaceA, `/${project.id}`), {
      cookie: cookieB,
    });
    expect(foreignWorkspace.statusCode).toBe(404);
    expect(foreignWorkspace.json<{ code: string }>().code).toBe('AUTH_WORKSPACE_NOT_FOUND');
    const ownWorkspace = await h.request('GET', projects(h.ids.workspaceB, `/${project.id}`), {
      cookie: cookieB,
    });
    expect(ownWorkspace.statusCode).toBe(404);
    expect(ownWorkspace.json<{ code: string }>().code).toBe('PROJECT_NOT_FOUND');
    const foreignTopic = await h.request('POST', projects(h.ids.workspaceB), {
      cookie: cookieB,
      payload: {
        code: 'steal',
        title: 'Steal',
        initialProblem: 'x',
        topics: [{ topicId: topicIds[0] }],
      },
    });
    expect(foreignTopic.json<{ code: string }>().code).toBe('PROJECT_TOPIC_UNAVAILABLE');
  });
});
