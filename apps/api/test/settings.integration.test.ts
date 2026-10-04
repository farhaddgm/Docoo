import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

interface Effective {
  values: Record<string, unknown>;
  sources: Record<string, { scope: string; scopeId?: string; pending?: boolean }>;
}
interface Block {
  type: string;
  id: string;
}

let h: Harness;
let cookie: string;
let topicA: string;
let topicB: string;
let codeCounter = 0;
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

async function post(path: string, payload: unknown = {}, expected = 201) {
  const response = await h.request('POST', api(path), { cookie, payload });
  expect(response.statusCode, response.body).toBe(expected);
  return response;
}

async function put(
  key: string,
  value: unknown,
  scopeType = 'workspace',
  scopeId = h.ids.workspaceA,
  expected = 200,
) {
  const response = await h.request('PUT', api('/settings/assignments'), {
    cookie,
    payload: { key, value, scopeType, scopeId, reason: `test ${key}` },
  });
  expect(response.statusCode, response.body).toBe(expected);
  return response;
}

async function preview(topicIds: string[], settings: { key: string; value: unknown }[] = []) {
  const response = await post('/settings/preview', { topicIds, settings }, 200);
  return response.json<{ config: Effective }>().config;
}

async function createProject(
  settings?: { key: string; value: unknown }[],
  expected = 201,
): Promise<string | null> {
  codeCounter += 1;
  const response = await h.request('POST', api('/projects'), {
    cookie,
    payload: {
      code: `stp-${codeCounter}`,
      title: `Settings project ${codeCounter}`,
      initialProblem: 'Reduce repeat-customer churn by 20%.',
      topics: [{ topicId: topicA }],
      ...(settings ? { settings } : {}),
    },
  });
  expect(response.statusCode, response.body).toBe(expected);
  return expected === 201 ? response.json<{ project: { id: string } }>().project.id : null;
}

describe.skipIf(!adminUrl)('settings, templates and the project wizard (ADR-0018)', () => {
  beforeAll(async () => {
    h = await createHarness('settings');
    cookie = await h.login(h.emails.a);
    const topic = async (code: string) =>
      (await post('/topics', { code, title: code })).json<{ topic: { id: string } }>().topic.id;
    topicA = await topic('alpha');
    topicB = await topic('beta');
    const connection = await post('/provider-connections', { provider: 'fake', name: 'Fake' });
    await put('ai.connection_id', connection.json<{ connection: { id: string } }>().connection.id);
    await put('ai.model', 'fake-standard');
  }, 30_000);

  afterAll(async () => {
    await h?.close();
  });

  it('STP-001: the preview resolves workspace, topics by priority and pending choices, with the source of each', async () => {
    const plain = await preview([]);
    expect(plain.values['solution.count']).toBe(5);
    expect(plain.sources['solution.count']).toEqual({ scope: 'system' });

    await put('solution.count', 6);
    await put('solution.count', 7, 'topic', topicA);
    await put('solution.count', 9, 'topic', topicB);
    expect((await preview([])).sources['solution.count']).toMatchObject({ scope: 'workspace' });
    // The first topic has priority 1 and wins, whatever the order they were created in.
    const aFirst = await preview([topicA, topicB]);
    expect(aFirst.values['solution.count']).toBe(7);
    expect(aFirst.sources['solution.count']).toMatchObject({ scope: 'topic', scopeId: topicA });
    expect((await preview([topicB, topicA])).values['solution.count']).toBe(9);

    // What the wizard chose is applied on top and marked as not saved yet.
    const chosen = await preview([topicA], [{ key: 'solution.count', value: 12 }]);
    expect(chosen.values['solution.count']).toBe(12);
    expect(chosen.sources['solution.count']).toEqual({ scope: 'project', pending: true });
    expect(chosen.values['document.level']).toBe(3);

    // Nothing was saved by previewing.
    const assignments = await h.admin.query(
      `select 1 from config_assignments where workspace_id = $1 and scope_type = 'project'`,
      [h.ids.workspaceA],
    );
    expect(assignments.rowCount).toBe(0);
  });

  it('STP-002: the preview refuses what a project could not be created with', async () => {
    const refused = async (
      settings: { key: string; value: unknown }[],
      code: string,
      status = 400,
    ) => {
      const response = await h.request('POST', api('/settings/preview'), {
        cookie,
        payload: { topicIds: [], settings },
      });
      expect(response.statusCode, response.body).toBe(status);
      expect(response.json<{ code: string }>().code).toBe(code);
    };
    await refused([{ key: 'solution.count', value: 99 }], 'CONFIG_VALUE_INVALID');
    await refused([{ key: 'solution.count', value: 'five' }], 'CONFIG_VALUE_INVALID');
    await refused(
      [
        { key: 'solution.count', value: 3 },
        { key: 'solution.count', value: 4 },
      ],
      'CONFIG_VALUE_INVALID',
    );
    // Workspace-only settings cannot be set for one project.
    await refused(
      [{ key: 'document.level_bounds', value: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
      'CONFIG_SCOPE_NOT_ALLOWED',
    );
    await refused([{ key: 'no.such_setting', value: 1 }], 'CONFIG_SETTING_NOT_FOUND', 404);
    const unknownTopic = await h.request('POST', api('/settings/preview'), {
      cookie,
      payload: { topicIds: ['00000000-0000-4000-8000-000000000000'], settings: [] },
    });
    expect(unknownTopic.statusCode).toBe(404);
    const other = await h.login(h.emails.b);
    expect(
      (
        await h.request('POST', api('/settings/preview'), {
          cookie: other,
          payload: { topicIds: [], settings: [] },
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(403);
  });

  it('STP-003: a project is created with its settings in one transaction, or not at all', async () => {
    const before = await h.admin.query<{ count: number }>(
      'select count(*)::int as count from projects where workspace_id = $1',
      [h.ids.workspaceA],
    );
    // A bad value creates nothing: no project, no settings, no audit event.
    await createProject([{ key: 'solution.count', value: 99 }], 400);
    await createProject(
      [
        { key: 'solution.count', value: 8 },
        { key: 'document.default_template', value: 'huge' },
      ],
      400,
    );
    const after = await h.admin.query<{ count: number }>(
      'select count(*)::int as count from projects where workspace_id = $1',
      [h.ids.workspaceA],
    );
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);

    const projectId = (await createProject([
      { key: 'solution.count', value: 8 },
      { key: 'document.default_template', value: 'brief' },
      { key: 'workflow.require_human_approval', value: false },
    ]))!;
    const effective = (
      await h.request('GET', api(`/settings/effective?scopeType=project&scopeId=${projectId}`), {
        cookie,
      })
    ).json<{ config: Effective }>().config;
    expect(effective.values).toMatchObject({
      'solution.count': 8,
      'document.default_template': 'brief',
      'workflow.require_human_approval': false,
    });
    expect(effective.sources['solution.count']).toMatchObject({
      scope: 'project',
      scopeId: projectId,
      sequence: 1,
    });
    // The rest is inherited, not copied.
    expect(effective.sources['document.level']).toMatchObject({ scope: 'system' });
    const saved = await h.admin.query<{ setting_key: string; reason: string }>(
      `select setting_key, reason from config_assignments where scope_type = 'project' and scope_id = $1 order by setting_key`,
      [projectId],
    );
    expect(saved.rows.map((row) => row.setting_key)).toEqual([
      'document.default_template',
      'solution.count',
      'workflow.require_human_approval',
    ]);
    expect(new Set(saved.rows.map((row) => row.reason))).toEqual(
      new Set(['Set while creating the project']),
    );
    const audit = await h.admin.query<{ after: { settings: string[] } }>(
      `select after from audit_events where action = 'project.create' and project_id = $1`,
      [projectId],
    );
    expect(audit.rows[0]!.after.settings.sort()).toEqual([
      'document.default_template',
      'solution.count',
      'workflow.require_human_approval',
    ]);
    // Without settings it behaves as before.
    const plain = (await createProject())!;
    const none = await h.admin.query('select 1 from config_assignments where scope_id = $1', [
      plain,
    ]);
    expect(none.rowCount).toBe(0);
  });

  it('STP-004: level bounds must be whole numbers, increasing and non-overlapping', async () => {
    const defaults = [1000, 3000, 5000, 7000, 9000, 11000, 13000, 17000, 22000, 28000];
    await put(
      'document.level_bounds',
      [3000, 1000, 5000, 7000, 9000, 11000, 13000, 17000, 22000, 28000],
      'workspace',
      h.ids.workspaceA,
      400,
    );
    await put(
      'document.level_bounds',
      [1000, 3000, 3000, 7000, 9000, 11000, 13000, 17000, 22000, 28000],
      'workspace',
      h.ids.workspaceA,
      400,
    );
    const refused = await h.request('PUT', api('/settings/assignments'), {
      cookie,
      payload: {
        key: 'document.level_bounds',
        value: [1000, 3000, 3000, 7000, 9000, 11000, 13000, 17000, 22000, 28000],
        scopeType: 'workspace',
        scopeId: h.ids.workspaceA,
        reason: 'overlap',
      },
    });
    expect(refused.json<{ code: string }>().code).toBe('CONFIG_VALUE_INVALID');
    await put('document.level_bounds', [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    await put('document.level_bounds', defaults);
    // Clearing goes back to the system default, which is always valid.
    await put('document.level_bounds', null);
  });

  it('STP-005: the template catalog is served with the system level defaults', async () => {
    const response = await h.request('GET', api('/document-templates'), { cookie });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{
      templates: {
        key: string;
        version: string;
        sections: { key: string; label: { fa: string; en: string } }[];
      }[];
      levelDefaults: Record<string, { min: number; max: number }>;
      countAlgorithm: string;
    }>();
    expect(body.templates.map((item) => item.key)).toEqual(['brief', 'standard', 'detailed']);
    expect(body.templates[1]!.sections.map((section) => section.key)).toEqual([
      'summary',
      'assumptions',
      'evidence',
      'plan',
      'risks',
    ]);
    expect(
      body.templates[0]!.sections.every((section) => section.label.fa && section.label.en),
    ).toBe(true);
    expect(body.levelDefaults['3']).toEqual({ min: 9000, max: 11000 });
    expect(body.countAlgorithm).toBe('unicode-letter-number-v1');
  });

  it('STP-006: the template setting decides the sections of the first draft', async () => {
    // Short bounds keep the compliance check out of the way of the layout.
    const draftHeadings = async (
      template: string,
    ): Promise<{ ids: string[]; reason: string | null }> => {
      const projectId = (await createProject([
        { key: 'document.default_template', value: template },
        { key: 'solution.count', value: 2 },
      ]))!;
      const current = (await h.request('GET', api(`/projects/${projectId}`), { cookie })).json<{
        project: { version: number };
      }>().project;
      await post(`/projects/${projectId}/activate`, { expectedVersion: current.version }, 200);
      const generated = await post(`/projects/${projectId}/solutions/generate`, {});
      const solution = generated.json<{ solutionSet: { items: { id: string }[] } }>().solutionSet
        .items[0]!;
      await post(`/projects/${projectId}/solution-selections`, { solutionIds: [solution.id] });
      const documents = (
        await h.request('GET', api(`/projects/${projectId}/documents`), { cookie })
      ).json<{ items: { id: string }[] }>().items;
      const document = (
        await h.request('GET', api(`/documents/${documents[0]!.id}`), { cookie })
      ).json<{
        document: { currentVersion: { content: { blocks: Block[] }; reason: string | null } };
      }>().document;
      return {
        ids: document.currentVersion.content.blocks
          .filter((block) => block.type === 'heading')
          .map((block) => block.id),
        reason: document.currentVersion.reason,
      };
    };
    const brief = await draftHeadings('brief');
    expect(brief.ids).toEqual(['summary', 'plan', 'risks']);
    expect(brief.reason).toContain('brief-v1');
    expect((await draftHeadings('standard')).ids).toEqual([
      'summary',
      'assumptions',
      'evidence',
      'plan',
      'risks',
    ]);
    const detailed = await draftHeadings('detailed');
    expect(detailed.ids).toEqual([
      'problem',
      'summary',
      'assumptions',
      'evidence',
      'plan',
      'risks',
      'scores',
    ]);
    expect(detailed.reason).toContain('detailed-v1');
  });
});
