import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

interface TopicBody {
  id: string;
  title: string;
  description: string;
  status: string;
  version: number;
  purgeAfter: string | null;
}

let h: Harness;
let cookie: string;

const topics = (suffix = '') => `/v1/workspaces/${h.ids.workspaceA}/topics${suffix}`;

async function create(code: string): Promise<TopicBody> {
  const response = await h.request('POST', topics(), {
    cookie,
    payload: { code, title: `Title ${code}`, description: 'First description' },
  });
  expect(response.statusCode).toBe(201);
  expect(response.headers['etag']).toBe('"1"');
  return response.json<{ topic: TopicBody }>().topic;
}

describe.skipIf(!adminUrl)('topic CRUD, versions and dependencies (TC-TOP-*)', () => {
  beforeAll(async () => {
    h = await createHarness('topiclife');
    cookie = await h.login(h.emails.a);
  }, 30_000);

  afterAll(async () => {
    await h?.close();
  });

  it('edits with If-Match and keeps every description version', async () => {
    const topic = await create('versioned');
    const noPrecondition = await h.request('PATCH', topics(`/${topic.id}`), {
      cookie,
      payload: { description: 'Second' },
    });
    expect(noPrecondition.statusCode).toBe(428);

    const updated = await h.request('PATCH', topics(`/${topic.id}`), {
      cookie,
      headers: { 'if-match': '"1"' },
      payload: { description: 'Second description', reason: 'Clarify scope' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ topic: TopicBody }>().topic).toMatchObject({
      description: 'Second description',
      version: 2,
    });

    const stale = await h.request('PATCH', topics(`/${topic.id}`), {
      cookie,
      headers: { 'if-match': '"1"' },
      payload: { title: 'Lost update' },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json<{ code: string }>().code).toBe('TOPIC_VERSION_CONFLICT');

    const versions = await h.request('GET', topics(`/${topic.id}/versions`), { cookie });
    expect(
      versions.json<{ items: { version: number; description: string; reason: string | null }[] }>()
        .items,
    ).toMatchObject([
      { version: 2, description: 'Second description', reason: 'Clarify scope' },
      { version: 1, description: 'First description', reason: null },
    ]);

    const read = await h.request('GET', topics(`/${topic.id}`), { cookie });
    expect(read.headers['etag']).toBe('"2"');
  });

  it('archives, restores and lists topics by status', async () => {
    const topic = await create('archivable');
    const archived = await h.request('POST', topics(`/${topic.id}/archive`), {
      cookie,
      payload: { reason: 'Out of scope' },
    });
    expect(archived.json<{ topic: TopicBody }>().topic.status).toBe('archived');
    const readOnly = await h.request('PATCH', topics(`/${topic.id}`), {
      cookie,
      headers: { 'if-match': `"${archived.json<{ topic: TopicBody }>().topic.version}"` },
      payload: { title: 'Nope' },
    });
    expect(readOnly.json<{ code: string }>().code).toBe('TOPIC_READ_ONLY');

    const active = await h.request('GET', topics(), { cookie });
    expect(active.json<{ items: TopicBody[] }>().items.map((item) => item.id)).not.toContain(
      topic.id,
    );
    const archivedList = await h.request('GET', topics('?status=archived'), { cookie });
    expect(archivedList.json<{ items: TopicBody[] }>().items.map((item) => item.id)).toContain(
      topic.id,
    );

    const restored = await h.request('POST', topics(`/${topic.id}/restore`), {
      cookie,
      payload: {},
    });
    expect(restored.json<{ topic: TopicBody }>().topic.status).toBe('active');
  });

  it('shows dependent projects and blocks deletion until they are gone', async () => {
    const topic = await create('depended');
    const project = await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/projects`, {
      cookie,
      payload: {
        code: 'uses-topic',
        title: 'Uses topic',
        initialProblem: 'x',
        topics: [{ topicId: topic.id }],
      },
    });
    const projectBody = project.json<{ project: { id: string; version: number } }>().project;

    const dependencies = await h.request('GET', topics(`/${topic.id}/dependencies`), { cookie });
    expect(dependencies.json<{ items: { projectId: string; status: string }[] }>().items).toEqual([
      expect.objectContaining({ projectId: projectBody.id, status: 'draft' }),
    ]);

    const blocked = await h.request('DELETE', topics(`/${topic.id}`), { cookie, payload: {} });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ code: string; dependencies: unknown[] }>()).toMatchObject({
      code: 'TOPIC_HAS_DEPENDENCIES',
      dependencies: [expect.objectContaining({ projectId: projectBody.id })],
    });

    await h.request('DELETE', `/v1/workspaces/${h.ids.workspaceA}/projects/${projectBody.id}`, {
      cookie,
      payload: { expectedVersion: projectBody.version },
    });
    const deleted = await h.request('DELETE', topics(`/${topic.id}`), {
      cookie,
      payload: { reason: 'Merged into another topic' },
    });
    expect(deleted.statusCode).toBe(200);
    const body = deleted.json<{ topic: TopicBody }>().topic;
    expect(body.status).toBe('deleted');
    expect(body.purgeAfter).not.toBeNull();

    // The link to the deleted project is kept, so the relationship stays traceable.
    const links = await h.admin.query('select 1 from project_topics where topic_id = $1', [
      topic.id,
    ]);
    expect(links.rowCount).toBe(1);
    const audit = await h.admin.query<{ after: { linkedDeletedProjects: string[] } }>(
      `select after from audit_events where target_id = $1 and action = 'topic.delete'`,
      [topic.id],
    );
    expect(audit.rows[0]?.after.linkedDeletedProjects).toEqual([projectBody.id]);

    const restored = await h.request('POST', topics(`/${topic.id}/restore`), {
      cookie,
      payload: {},
    });
    expect(restored.json<{ topic: TopicBody }>().topic.status).toBe('active');
  });

  it('purges an expired deleted topic and its versions with a tombstone', async () => {
    const topic = await create('expiring');
    await h.request('DELETE', topics(`/${topic.id}`), { cookie, payload: {} });
    await h.admin.query(
      "update topics set purge_after = now() - interval '1 minute' where id = $1",
      [topic.id],
    );
    const expired = await h.request('POST', topics(`/${topic.id}/restore`), {
      cookie,
      payload: {},
    });
    expect(expired.statusCode).toBe(410);

    const purge = await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/retention/purge`, {
      cookie,
      payload: { reason: 'Retention' },
    });
    expect(purge.json<{ topicIds: string[] }>().topicIds).toContain(topic.id);
    const versions = await h.admin.query('select 1 from topic_versions where topic_id = $1', [
      topic.id,
    ]);
    expect(versions.rowCount).toBe(0);
    const tombstone = await h.admin.query(
      `select 1 from audit_events where target_id = $1 and action = 'topic.purge'`,
      [topic.id],
    );
    expect(tombstone.rowCount).toBe(1);
  });
});
