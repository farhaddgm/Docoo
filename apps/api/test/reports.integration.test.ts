import { SYSTEM_RUBRIC } from '@docoo/documents';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

let h: Harness;
let cookie: string;
let projectId: string;
let documentId: string;
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

interface Deviation {
  rule: string;
  clause: string;
  role: string;
  severity: string;
  count: number;
  evidence: { type: string; id: string }[];
}

interface BrainReport {
  id: string;
  scope: string;
  projectId: string | null;
  charterVersion: string;
  summary: {
    roles: { stage: string; role: string; deviations: number }[];
    totals: { deviations: number; invocations: number };
  };
  deviations: Deviation[];
  recommendations: { rule: string; target: string; action: string; evidence: unknown[] }[];
}

async function post(url: string, payload: unknown = {}) {
  return h.request('POST', api(url), { cookie, payload });
}

async function setting(key: string, value: unknown) {
  const response = await h.request('PUT', api('/settings/assignments'), {
    cookie,
    payload: {
      key,
      scopeType: 'workspace',
      scopeId: h.ids.workspaceA,
      value,
      reason: `test ${key}`,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
}

/** Row counts of every table an administrator decides on; a Brain report must not touch them. */
async function stateFingerprint(): Promise<string> {
  const result = await h.admin.query<{ fingerprint: string }>(
    `select md5(string_agg(row, '|' order by row)) as fingerprint from (
       select 'p:' || id || ':' || status || ':' || version as row from projects where workspace_id = $1
       union all select 'd:' || id || ':' || status || ':' || version from documents where workspace_id = $1
       union all select 's:' || id from config_assignments where workspace_id = $1
       union all select 'e:' || id || ':' || status from evaluations where workspace_id = $1
       union all select 'f:' || id || ':' || target_stage from evaluation_findings where workspace_id = $1
       union all select 'h:' || id || ':' || status from human_tasks where workspace_id = $1
     ) rows`,
    [h.ids.workspaceA],
  );
  return result.rows[0]!.fingerprint;
}

describe.skipIf(!adminUrl)('dashboard, usage and Brain reports (REP-001, REP-002, REP-004)', () => {
  beforeAll(async () => {
    h = await createHarness('reports');
    cookie = await h.login(h.emails.a);
    const topic = await post('/topics', { code: 'retail', title: 'Retail' });
    const topicId = topic.json<{ topic: { id: string } }>().topic.id;
    const connection = await post('/provider-connections', {
      provider: 'fake',
      name: 'Deterministic',
    });
    await setting(
      'ai.connection_id',
      connection.json<{ connection: { id: string } }>().connection.id,
    );
    await setting('ai.model', 'fake-standard');
    await setting('document.level', 1);
    await setting(
      'document.level_bounds',
      [20, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000],
    );

    const created = await post('/projects', {
      code: 'reports',
      title: 'Churn programme',
      initialProblem: 'Reduce repeat-customer churn by 20%.',
      topics: [{ topicId }],
    });
    const project = created.json<{ project: { id: string; version: number } }>().project;
    projectId = project.id;
    const activated = await post(`/projects/${projectId}/activate`, {
      expectedVersion: project.version,
    });
    expect(activated.statusCode, activated.body).toBe(200);

    // Real activity: solutions, a selected document, a non-compliant submit and a failed evaluation.
    const generated = await post(`/projects/${projectId}/solutions/generate`, { count: 2 });
    const solutionId = generated.json<{ solutionSet: { items: { id: string }[] } }>().solutionSet
      .items[0]!.id;
    await post(`/projects/${projectId}/solution-selections`, { solutionIds: [solutionId] });
    const documents = await h.request('GET', api(`/projects/${projectId}/documents`), { cookie });
    documentId = documents.json<{ items: { id: string; version: number }[] }>().items[0]!.id;
    const document = (await h.request('GET', api(`/documents/${documentId}`), { cookie })).json<{
      document: { version: number; currentVersion: { content: unknown } };
    }>().document;
    await h.request('PUT', api(`/documents/${documentId}/content`), {
      cookie,
      payload: { content: document.currentVersion.content, reason: 'Try level 2', level: 2 },
      headers: { 'if-match': `"${document.version}"` },
    });
    await post(`/documents/${documentId}/submit`);
    h.fake.responder = (request) =>
      request.responseSchema?.name === 'evaluation'
        ? {
            scores: SYSTEM_RUBRIC.criteria.map((criterion) => ({
              criterion: criterion.key,
              score: criterion.key === 'evidence' ? 20 : 90,
              evidence: `Evidence for ${criterion.key}`,
            })),
            findings: [
              { severity: 'high', criterion: 'evidence', evidence: '', location: 'section 2' },
            ],
          }
        : null;
    try {
      await post(`/documents/${documentId}/evaluate`);
    } finally {
      h.fake.responder = () => null;
    }
    await h.admin.query(
      `insert into human_tasks (workspace_id, project_id, kind, title, payload) values ($1, $2, 'gate', 'Approve the analysis', '{}'::jsonb)`,
      [h.ids.workspaceA, projectId],
    );
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  });

  it('REP-001: the dashboard shows live cards for tasks, workflows, knowledge, providers, retries, cost and Brain', async () => {
    const response = await h.request('GET', api('/dashboard'), { cookie });
    expect(response.statusCode, response.body).toBe(200);
    const dashboard = response.json<{
      dashboard: {
        waiting: { total: number; items: { projectId: string; projectTitle: string }[] };
        workflows: { active: number; paused: number; failed: number };
        knowledge: Record<string, number>;
        providers: { items: { provider: string; status: string }[]; unhealthy: number };
        retriesNearLimit: unknown[];
        usage: { invocations: number; tokens: number; costUsd: number };
        latestBrainReport: unknown;
      };
    }>().dashboard;
    expect(dashboard.waiting.total).toBe(1);
    expect(dashboard.waiting.items[0]).toMatchObject({
      projectId,
      projectTitle: 'Churn programme',
    });
    expect(dashboard.workflows.active).toBe(1);
    expect(dashboard.knowledge).toEqual({
      pending: 0,
      expired: 0,
      needsRevision: 0,
      conflicted: 0,
    });
    expect(dashboard.providers.items).toEqual([
      expect.objectContaining({ provider: 'fake', status: 'configured' }),
    ]);
    expect(dashboard.usage.invocations).toBe(2);
    expect(dashboard.usage.tokens).toBeGreaterThan(0);
    expect(dashboard.latestBrainReport).toBeNull();

    expect(
      (
        await h.request(
          'GET',
          api('/dashboard?from=2026-10-02T00:00:00Z&to=2026-01-01T00:00:00Z'),
          { cookie },
        )
      ).statusCode,
    ).toBe(400);
    const other = await h.login(h.emails.b);
    const foreign = await h.request('GET', `/v1/workspaces/${h.ids.workspaceB}/dashboard`, {
      cookie: other,
    });
    expect(
      foreign.json<{ dashboard: { usage: { invocations: number }; waiting: { total: number } } }>()
        .dashboard,
    ).toMatchObject({
      usage: { invocations: 0 },
      waiting: { total: 0 },
    });
  });

  it('REP-004: usage is reported per stage, project, day and model for a period', async () => {
    const totals = await h.admin.query<{ tokens: number; invocations: number }>(
      `select sum(input_tokens)::int as tokens, count(*)::int as invocations from model_invocations where workspace_id = $1`,
      [h.ids.workspaceA],
    );
    for (const groupBy of ['stage', 'project', 'day', 'model'] as const) {
      const response = await h.request('GET', api(`/reports/usage?groupBy=${groupBy}`), { cookie });
      expect(response.statusCode, response.body).toBe(200);
      const usage = response.json<{
        usage: {
          totals: { invocations: number; inputTokens: number };
          groups: { key: string; label: string; invocations: number; inputTokens: number }[];
          estimate: boolean;
        };
      }>().usage;
      expect(usage.estimate).toBe(true);
      expect(usage.totals).toMatchObject({
        invocations: totals.rows[0]!.invocations,
        inputTokens: totals.rows[0]!.tokens,
      });
      expect(usage.groups.reduce((sum, group) => sum + group.invocations, 0)).toBe(
        usage.totals.invocations,
      );
      if (groupBy === 'stage')
        expect(usage.groups.map((group) => group.key).sort()).toEqual(['evaluation', 'solutions']);
      if (groupBy === 'project')
        expect(usage.groups[0]).toMatchObject({ key: projectId, label: 'Churn programme' });
      if (groupBy === 'day') expect(usage.groups[0]!.key).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      if (groupBy === 'model') expect(usage.groups[0]!.key).toBe('fake:fake-standard');
    }
    const empty = await h.request(
      'GET',
      api('/reports/usage?from=2020-01-01T00:00:00Z&to=2020-02-01T00:00:00Z'),
      { cookie },
    );
    expect(
      empty.json<{ usage: { totals: { invocations: number }; groups: unknown[] } }>().usage,
    ).toMatchObject({ totals: { invocations: 0 }, groups: [] });
    expect(
      (await h.request('GET', api('/reports/usage?groupBy=user'), { cookie })).statusCode,
    ).toBe(400);
  });

  it('REP-002: Brain reports deviations from the charter with evidence and changes nothing', async () => {
    const before = await stateFingerprint();
    const auditBefore = await h.admin.query<{ count: number }>(
      'select count(*)::int as count from audit_events where workspace_id = $1',
      [h.ids.workspaceA],
    );

    const response = await post('/brain-reports', { projectId });
    expect(response.statusCode, response.body).toBe(201);
    const report = response.json<{ report: BrainReport }>().report;
    expect(report).toMatchObject({ scope: 'project', projectId, charterVersion: 'charter-v1' });
    const rules = Object.fromEntries(
      report.deviations.map((deviation) => [deviation.rule, deviation]),
    );
    expect(rules['finding_evidence']).toMatchObject({
      clause: 'evaluator.principles.1',
      role: 'evaluator',
      severity: 'high',
      count: 1,
    });
    expect(rules['quality_findings']).toMatchObject({ role: 'researcher' });
    expect(rules['length_level']).toMatchObject({
      role: 'documenter',
      evidence: [{ type: 'document', id: documentId }],
    });
    for (const deviation of report.deviations) expect(deviation.evidence.length).toBeGreaterThan(0);
    expect(report.recommendations.map((item) => item.rule).sort()).toEqual(
      report.deviations.map((item) => item.rule).sort(),
    );
    expect(
      report.recommendations.every((item) => item.action.length > 0 && item.evidence.length > 0),
    ).toBe(true);
    expect(report.summary.roles.map((role) => role.role)).toEqual([
      'analyst',
      'researcher',
      'ideator',
      'documenter',
      'evaluator',
    ]);

    expect(await stateFingerprint()).toBe(before);
    const added = await h.admin.query<{ action: string }>(
      'select action from audit_events where workspace_id = $1 order by occurred_at, id offset $2',
      [h.ids.workspaceA, auditBefore.rows[0]!.count],
    );
    expect(added.rows.map((row) => row.action)).toEqual(['brain.report_generated']);
    await expect(
      h.admin.query('update brain_reports set deviations = $2 where id = $1', [report.id, '[]']),
    ).rejects.toThrow();

    const workspace = await post('/brain-reports', {});
    expect(workspace.json<{ report: BrainReport }>().report).toMatchObject({
      scope: 'workspace',
      projectId: null,
    });
    const list = await h.request('GET', api(`/brain-reports?projectId=${projectId}`), { cookie });
    expect(list.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toEqual([
      report.id,
    ]);
    const read = await h.request('GET', api(`/brain-reports/${report.id}`), { cookie });
    expect(read.json<{ report: BrainReport }>().report.deviations).toEqual(report.deviations);

    const dashboard = await h.request('GET', api('/dashboard'), { cookie });
    expect(
      dashboard.json<{ dashboard: { latestBrainReport: { scope: string } } }>().dashboard
        .latestBrainReport,
    ).toMatchObject({ scope: 'workspace' });

    const other = await h.login(h.emails.b);
    expect(
      (
        await h.request('GET', `/v1/workspaces/${h.ids.workspaceB}/brain-reports/${report.id}`, {
          cookie: other,
        })
      ).statusCode,
    ).toBe(404);
  });
});
