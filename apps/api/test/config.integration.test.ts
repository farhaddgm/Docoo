import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

interface Effective {
  values: Record<string, unknown>;
  sources: Record<string, { scope: string; scopeId?: string; sequence?: number }>;
  hash: string;
}

let h: Harness;
let cookie: string;
let topicHigh: string;
let topicLow: string;
let projectId: string;

const settings = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}/settings${suffix}`;

async function put(payload: Record<string, unknown>) {
  return h.request('PUT', settings('/assignments'), { cookie, payload });
}

async function effective(scopeType: string, scopeId: string): Promise<Effective> {
  const response = await h.request(
    'GET',
    settings(`/effective?scopeType=${scopeType}&scopeId=${scopeId}`),
    { cookie },
  );
  expect(response.statusCode).toBe(200);
  return response.json<{ config: Effective }>().config;
}

describe.skipIf(!adminUrl)('versioned config resolution (TC-CFG-*)', () => {
  beforeAll(async () => {
    h = await createHarness('config');
    cookie = await h.login(h.emails.a);
    const topic = async (code: string) =>
      (
        await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/topics`, {
          cookie,
          payload: { code, title: code },
        })
      ).json<{ topic: { id: string } }>().topic.id;
    topicHigh = await topic('high');
    topicLow = await topic('low');
    const project = await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/projects`, {
      cookie,
      payload: {
        code: 'config-project',
        title: 'Config project',
        initialProblem: 'Problem',
        topics: [{ topicId: topicHigh }, { topicId: topicLow }],
      },
    });
    projectId = project.json<{ project: { id: string } }>().project.id;
  }, 30_000);

  afterAll(async () => {
    await h?.close();
  });

  it('lists definitions and validates values and scopes', async () => {
    const definitions = await h.request('GET', settings('/definitions'), { cookie });
    const keys = definitions.json<{ items: { key: string }[] }>().items.map((item) => item.key);
    expect(keys).toContain('research.max_sources');

    const outOfRange = await put({
      key: 'research.max_sources',
      scopeType: 'workspace',
      scopeId: h.ids.workspaceA,
      value: 5000,
      reason: 'Too many',
    });
    expect(outOfRange.json<{ code: string }>().code).toBe('CONFIG_VALUE_INVALID');

    const wrongScope = await put({
      key: 'ai.max_cost_usd_per_run',
      scopeType: 'topic',
      scopeId: topicHigh,
      value: 5,
      reason: 'Not allowed on topics',
    });
    expect(wrongScope.json<{ code: string }>().code).toBe('CONFIG_SCOPE_NOT_ALLOWED');

    const foreignScope = await put({
      key: 'research.max_sources',
      scopeType: 'workspace',
      scopeId: h.ids.workspaceB,
      value: 10,
      reason: 'Other tenant',
    });
    expect(foreignScope.statusCode).toBe(404);

    const missingReason = await put({
      key: 'research.max_sources',
      scopeType: 'workspace',
      scopeId: h.ids.workspaceA,
      value: 10,
    });
    expect(missingReason.statusCode).toBe(400);
  });

  it('resolves system → workspace → topic (by priority) → project with sources', async () => {
    let config = await effective('project', projectId);
    expect(config.values['research.max_sources']).toBe(30);
    expect(config.sources['research.max_sources']).toEqual({ scope: 'system' });

    await put({
      key: 'research.max_sources',
      scopeType: 'workspace',
      scopeId: h.ids.workspaceA,
      value: 40,
      reason: 'Workspace default',
    });
    await put({
      key: 'research.max_sources',
      scopeType: 'topic',
      scopeId: topicLow,
      value: 50,
      reason: 'Low topic',
    });
    config = await effective('project', projectId);
    expect(config.values['research.max_sources']).toBe(50);
    expect(config.sources['research.max_sources']).toMatchObject({
      scope: 'topic',
      scopeId: topicLow,
    });

    await put({
      key: 'research.max_sources',
      scopeType: 'topic',
      scopeId: topicHigh,
      value: 60,
      reason: 'High topic',
    });
    config = await effective('project', projectId);
    expect(config.values['research.max_sources']).toBe(60);
    expect(config.sources['research.max_sources']).toMatchObject({
      scope: 'topic',
      scopeId: topicHigh,
    });

    await put({
      key: 'research.max_sources',
      scopeType: 'project',
      scopeId: projectId,
      value: 70,
      reason: 'Project',
    });
    config = await effective('project', projectId);
    expect(config.values['research.max_sources']).toBe(70);
    expect(config.sources['research.max_sources']).toMatchObject({ scope: 'project', sequence: 1 });

    const workspace = await effective('workspace', h.ids.workspaceA);
    expect(workspace.values['research.max_sources']).toBe(40);
  });

  it('keeps every version with actor and reason; clearing and restoring append versions', async () => {
    const cleared = await put({
      key: 'research.max_sources',
      scopeType: 'project',
      scopeId: projectId,
      value: null,
      reason: 'Inherit again',
    });
    expect(
      cleared.json<{ assignment: { sequence: number; cleared: boolean } }>().assignment,
    ).toMatchObject({ sequence: 2, cleared: true });
    expect((await effective('project', projectId)).values['research.max_sources']).toBe(60);

    const stale = await put({
      key: 'research.max_sources',
      scopeType: 'project',
      scopeId: projectId,
      value: 80,
      reason: 'Stale',
      expectedSequence: 1,
    });
    expect(stale.statusCode).toBe(412);

    const restore = await h.request('POST', settings('/assignments/restore'), {
      cookie,
      payload: {
        key: 'research.max_sources',
        scopeType: 'project',
        scopeId: projectId,
        sequence: 1,
        reason: 'Back to 70',
      },
    });
    expect(
      restore.json<{
        assignment: { sequence: number; value: unknown; restoredFromSequence: number };
      }>().assignment,
    ).toMatchObject({
      sequence: 3,
      value: 70,
      restoredFromSequence: 1,
    });

    const history = await h.request(
      'GET',
      settings(
        `/assignments/history?key=research.max_sources&scopeType=project&scopeId=${projectId}`,
      ),
      { cookie },
    );
    const items = history.json<{
      items: { sequence: number; reason: string; createdBy: string }[];
    }>().items;
    expect(items.map((item) => item.sequence)).toEqual([3, 2, 1]);
    expect(items.every((item) => item.createdBy === h.ids.userA)).toBe(true);

    const audit = await h.admin.query<{
      action: string;
      before: { value: unknown };
      after: { value: unknown };
    }>(
      `select action, before, after from audit_events
        where project_id = $1 and action like 'config.%' order by occurred_at`,
      [projectId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'config.set',
      'config.clear',
      'config.restore',
    ]);
    expect(audit.rows[0]).toMatchObject({ before: { value: null }, after: { value: 70 } });

    await expect(
      h.admin.query('update config_assignments set value = $1 where scope_id = $2', [
        '1',
        projectId,
      ]),
    ).rejects.toThrow(/append-only/);
  });

  it('pins a snapshot at activation so later changes apply from the next boundary', async () => {
    let project = (
      await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/projects/${projectId}/activate`, {
        cookie,
        payload: { expectedVersion: 1 },
      })
    ).json<{ project: { configSnapshotId: string; version: number } }>().project;
    const pinned = project.configSnapshotId;

    await put({
      key: 'research.max_sources',
      scopeType: 'project',
      scopeId: projectId,
      value: 90,
      reason: 'Mid-run change',
    });
    const snapshots = await h.request(
      'GET',
      `/v1/workspaces/${h.ids.workspaceA}/projects/${projectId}/config-snapshots`,
      { cookie },
    );
    const list = snapshots.json<{ items: { id: string; values: Record<string, unknown> }[] }>()
      .items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: pinned });
    expect(list[0]?.values['research.max_sources']).toBe(70);

    project = (
      await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/projects/${projectId}/pause`, {
        cookie,
        payload: { expectedVersion: project.version, reason: 'Boundary' },
      })
    ).json<{ project: { configSnapshotId: string; version: number } }>().project;
    expect(project.configSnapshotId).toBe(pinned);
    project = (
      await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/projects/${projectId}/resume`, {
        cookie,
        payload: { expectedVersion: project.version },
      })
    ).json<{ project: { configSnapshotId: string; version: number } }>().project;
    expect(project.configSnapshotId).not.toBe(pinned);
    const after = await h.request(
      'GET',
      `/v1/workspaces/${h.ids.workspaceA}/projects/${projectId}/config-snapshots`,
      { cookie },
    );
    expect(
      after.json<{ items: { values: Record<string, unknown> }[] }>().items[0]?.values[
        'research.max_sources'
      ],
    ).toBe(90);
  });
});
