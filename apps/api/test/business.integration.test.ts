import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';
import { FAKE_CONTENTER_TOKEN, FakeContenter, wePod } from './support/fake-contenter.js';

let h: Harness;
let cookieA: string;
let cookieB: string;
let topicId: string;
const contenter = new FakeContenter();
const api = (suffix: string, workspaceId = h.ids.workspaceA) =>
  `/v1/workspaces/${workspaceId}${suffix}`;

interface BusinessView {
  connection: { configured: boolean; status: string };
  link: {
    externalBusinessId: string;
    name: string;
    snapshotId: string;
    syncedAt: string | null;
    syncError: string | null;
    contenterUrl: string | null;
  } | null;
  snapshot: {
    id: string;
    versionNo: number;
    contentSha256: string;
    changes: { sections: string[]; facts: boolean; terms: boolean };
    content: {
      business: { name: string };
      sections: { key: string; content: string }[];
      facts: { label: string }[];
    };
  } | null;
}

async function createProject(code: string, extra: Record<string, unknown> = {}) {
  const response = await h.request('POST', api('/projects'), {
    cookie: cookieA,
    payload: {
      code,
      title: `Project ${code}`,
      initialProblem: 'Confidential problem statement',
      topics: [{ topicId }],
      ...extra,
    },
  });
  return response;
}

async function newProject(code: string, extra: Record<string, unknown> = {}) {
  const response = await createProject(code, extra);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{
    project: {
      id: string;
      version: number;
      business: { externalBusinessId: string; name: string } | null;
    };
  }>().project;
}

const businessOf = async (projectId: string) =>
  (
    await h.request('GET', api(`/projects/${projectId}/business`), { cookie: cookieA })
  ).json<BusinessView>();

describe.skipIf(!adminUrl)('the business of a project, from Contenter (ADR-0021)', () => {
  beforeAll(async () => {
    await contenter.start();
    contenter.add(wePod());
    h = await createHarness('business');
    cookieA = await h.login(h.emails.a);
    cookieB = await h.login(h.emails.b);
    const topic = await h.request('POST', api('/topics'), {
      cookie: cookieA,
      payload: { code: 'biz-topic', title: 'Business topic' },
    });
    topicId = topic.json<{ topic: { id: string } }>().topic.id;
  }, 60_000);

  afterAll(async () => {
    await h?.close();
    await contenter.stop();
  });

  it('BIZ-001: the token is write-only and sealed, and a wrong token or an outage is reported', async () => {
    const before = await h.request('GET', api('/integrations/contenter'), { cookie: cookieA });
    expect(before.json<{ connection: unknown }>().connection).toBeNull();
    const notYet = await h.request('GET', api('/contenter-businesses'), { cookie: cookieA });
    expect(notYet.statusCode).toBe(409);
    expect(notYet.json<{ code: string }>().code).toBe('CONTENTER_NOT_CONFIGURED');
    const noToken = await h.request('PUT', api('/integrations/contenter'), {
      cookie: cookieA,
      payload: { apiUrl: contenter.apiUrl },
    });
    expect(noToken.json<{ code: string }>().code).toBe('CONTENTER_TOKEN_REQUIRED');

    const saved = await h.request('PUT', api('/integrations/contenter'), {
      cookie: cookieA,
      payload: {
        apiUrl: contenter.apiUrl,
        webUrl: 'https://contenter.example.test',
        token: FAKE_CONTENTER_TOKEN,
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.body).not.toContain(FAKE_CONTENTER_TOKEN);
    expect(saved.json<{ connection: Record<string, unknown> }>().connection).toMatchObject({
      apiUrl: contenter.apiUrl,
      status: 'healthy',
      secret: { configured: true, version: 1 },
      lastError: null,
    });
    // The only credential that crosses the wire is the bearer token, and only to Contenter.
    expect(contenter.requests.at(-1)!.authorization).toBe(`Bearer ${FAKE_CONTENTER_TOKEN}`);

    const stored = await h.admin.query<{ row: string }>(
      'select row_to_json(c)::text as row from contenter_connections c where workspace_id = $1',
      [h.ids.workspaceA],
    );
    expect(stored.rows[0]!.row).not.toContain(FAKE_CONTENTER_TOKEN);
    const audit = await h.admin.query<{ row: string }>(
      `select row_to_json(a)::text as row from audit_events a where action like 'integration.contenter%'`,
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    for (const row of audit.rows) expect(row.row).not.toContain(FAKE_CONTENTER_TOKEN);

    // Changing only the addresses keeps the token (and its version).
    const moved = await h.request('PUT', api('/integrations/contenter'), {
      cookie: cookieA,
      payload: { apiUrl: contenter.apiUrl, webUrl: null },
    });
    expect(
      moved.json<{ connection: { secret: { version: number }; webUrl: null } }>().connection,
    ).toMatchObject({
      secret: { version: 1 },
      webUrl: null,
    });

    // A refused token, an outage and a switched-off API each say what is wrong.
    const wrong = await h.request('PUT', api('/integrations/contenter'), {
      cookie: cookieA,
      payload: { apiUrl: contenter.apiUrl, token: 'a-wrong-service-token-that-is-long-enough-123' },
    });
    expect(wrong.json<{ connection: unknown }>().connection).toMatchObject({
      status: 'invalid',
      lastError: 'unauthorized',
      secret: { version: 2 },
    });
    contenter.token = 'a-wrong-service-token-that-is-long-enough-123';
    const fixed = await h.request('POST', api('/integrations/contenter/test'), { cookie: cookieA });
    expect(fixed.json<{ connection: { status: string } }>().connection.status).toBe('healthy');
    contenter.mode = 'down';
    const down = await h.request('POST', api('/integrations/contenter/test'), { cookie: cookieA });
    expect(down.json<{ connection: unknown }>().connection).toMatchObject({
      status: 'unreachable',
      lastError: 'server_error',
    });
    contenter.mode = 'disabled';
    const off = await h.request('POST', api('/integrations/contenter/test'), { cookie: cookieA });
    expect(off.json<{ connection: unknown }>().connection).toMatchObject({
      lastError: 'not_available',
    });
    contenter.mode = 'up';
    contenter.token = FAKE_CONTENTER_TOKEN;
    await h.request('PUT', api('/integrations/contenter'), {
      cookie: cookieA,
      payload: {
        apiUrl: contenter.apiUrl,
        webUrl: 'https://contenter.example.test',
        token: FAKE_CONTENTER_TOKEN,
      },
    });

    // Another workspace sees nothing of it.
    const foreign = await h.request('GET', api('/integrations/contenter', h.ids.workspaceB), {
      cookie: cookieB,
    });
    expect(foreign.json<{ connection: unknown }>().connection).toBeNull();
    const crossTenant = await h.request('GET', api('/integrations/contenter'), { cookie: cookieB });
    expect(crossTenant.statusCode).toBeGreaterThanOrEqual(403);
  });

  it('BIZ-002: the businesses of Contenter can be browsed, with a search', async () => {
    const all = await h.request('GET', api('/contenter-businesses'), { cookie: cookieA });
    expect(all.statusCode, all.body).toBe(200);
    expect(
      all.json<{
        items: { id: string; name: string; filledSections: number; totalSections: number }[];
      }>(),
    ).toMatchObject({
      items: [
        { id: 'biz-wepod', name: 'WePod Digital Branch', filledSections: 7, totalSections: 15 },
      ],
      total: 1,
    });
    const none = await h.request('GET', api('/contenter-businesses?q=zzz'), { cookie: cookieA });
    expect(none.json<{ items: unknown[] }>().items).toEqual([]);
    const bad = await h.request('GET', api('/contenter-businesses?pageSize=500'), {
      cookie: cookieA,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('BIZ-003: a project links to a business and reads all of it as a pinned snapshot', async () => {
    const project = await newProject('biz-link');
    expect(project.business).toBeNull();
    expect((await businessOf(project.id)).link).toBeNull();

    const linked = await h.request('PUT', api(`/projects/${project.id}/business`), {
      cookie: cookieA,
      payload: { externalBusinessId: 'biz-wepod', reason: 'Belongs to WePod' },
    });
    expect(linked.statusCode, linked.body).toBe(200);
    const view = linked.json<BusinessView>();
    expect(view.link).toMatchObject({
      externalBusinessId: 'biz-wepod',
      name: 'WePod Digital Branch',
      syncError: null,
      contenterUrl: 'https://contenter.example.test/app/businesses/biz-wepod',
    });
    expect(view.snapshot).toMatchObject({ versionNo: 1 });
    expect(view.snapshot!.contentSha256).toMatch(/^[0-9a-f]{64}$/u);
    // Everything Contenter knows about the business is there, not a summary.
    expect(view.snapshot!.content.sections.find((s) => s.key === 'PERSONAS')!.content).toContain(
      'Sara',
    );
    expect(view.snapshot!.content.facts.map((f) => f.label)).toEqual([
      'Loan ceiling',
      'Old campaign rate',
    ]);

    // The project itself says which business it belongs to.
    const read = await h.request('GET', api(`/projects/${project.id}`), { cookie: cookieA });
    expect(read.json<{ project: { business: unknown } }>().project.business).toEqual({
      externalBusinessId: 'biz-wepod',
      name: 'WePod Digital Branch',
    });
    const list = await h.request('GET', api('/projects?status=all'), { cookie: cookieA });
    const row = list
      .json<{ items: { id: string; business: { name: string } | null }[] }>()
      .items.find((p) => p.id === project.id);
    expect(row!.business).toMatchObject({ name: 'WePod Digital Branch' });

    // A second project of the same business reads the same snapshot: nothing is stored twice.
    const other = await newProject('biz-link-2');
    await h.request('PUT', api(`/projects/${other.id}/business`), {
      cookie: cookieA,
      payload: { externalBusinessId: 'biz-wepod' },
    });
    expect((await businessOf(other.id)).snapshot!.id).toBe(view.snapshot!.id);
    const rows = await h.admin.query<{ count: number }>(
      `select count(*)::int as count from business_snapshots where workspace_id = $1 and external_business_id = 'biz-wepod'`,
      [h.ids.workspaceA],
    );
    expect(rows.rows[0]!.count).toBe(1);

    const audit = await h.admin.query<{ action: string; reason: string | null }>(
      `select action, reason from audit_events where project_id = $1 and action = 'business.link_set'`,
      [project.id],
    );
    expect(audit.rows).toEqual([{ action: 'business.link_set', reason: 'Belongs to WePod' }]);

    const unknown = await h.request('PUT', api(`/projects/${project.id}/business`), {
      cookie: cookieA,
      payload: { externalBusinessId: 'no-such-business' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<{ code: string }>().code).toBe('BUSINESS_NOT_FOUND');
    expect((await businessOf(project.id)).link!.externalBusinessId).toBe('biz-wepod');
  });

  it('BIZ-004: a change in Contenter becomes a new version when asked, and an outage keeps the saved one', async () => {
    const project = await newProject('biz-sync');
    await h.request('PUT', api(`/projects/${project.id}/business`), {
      cookie: cookieA,
      payload: { externalBusinessId: 'biz-wepod' },
    });
    const first = (await businessOf(project.id)).snapshot!;

    const same = await h.request('POST', api(`/projects/${project.id}/business/sync`), {
      cookie: cookieA,
    });
    expect(same.statusCode, same.body).toBe(200);
    expect(same.json<{ changed: boolean; versionNo: number }>()).toMatchObject({
      changed: false,
      versionNo: first.versionNo,
    });

    const edited = contenter.businesses.get('biz-wepod')!;
    edited.sections['GOALS'] = 'Grow digital loan applications by 35 percent this year.';
    edited.facts.push({ label: 'Card fee', value: 'Free for the first year' });
    const changed = await h.request('POST', api(`/projects/${project.id}/business/sync`), {
      cookie: cookieA,
    });
    const outcome = changed.json<BusinessView & { changed: boolean; versionNo: number }>();
    expect(outcome).toMatchObject({ changed: true, versionNo: first.versionNo + 1 });
    expect(outcome.snapshot!.changes.sections).toEqual(['GOALS']);
    expect(outcome.snapshot!.changes).toMatchObject({ facts: true, terms: false });
    expect(outcome.snapshot!.content.sections.find((s) => s.key === 'GOALS')!.content).toContain(
      '35 percent',
    );

    // The earlier version is kept, and the history says which is current.
    const history = await h.request('GET', api(`/projects/${project.id}/business/snapshots`), {
      cookie: cookieA,
    });
    const items = history.json<{ items: { id: string; versionNo: number; current: boolean }[] }>()
      .items;
    expect(items.map((i) => [i.versionNo, i.current])).toEqual([
      [first.versionNo + 1, true],
      [first.versionNo, false],
    ]);
    const old = await h.request(
      'GET',
      api(`/projects/${project.id}/business/snapshots/${first.id}`),
      { cookie: cookieA },
    );
    expect(
      old
        .json<{ snapshot: { content: { sections: { key: string; content: string }[] } } }>()
        .snapshot.content.sections.find((s) => s.key === 'GOALS')!.content,
    ).toContain('20 percent');

    // Contenter is down: the page says so, the saved snapshot stays what the agents read.
    contenter.mode = 'down';
    const failed = await h.request('POST', api(`/projects/${project.id}/business/sync`), {
      cookie: cookieA,
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json<{ code: string }>().code).toBe('CONTENTER_ERROR');
    const afterOutage = await businessOf(project.id);
    expect(afterOutage.link!.syncError).toBe('CONTENTER_ERROR');
    expect(afterOutage.snapshot!.versionNo).toBe(first.versionNo + 1);
    contenter.mode = 'up';
    await h.request('POST', api(`/projects/${project.id}/business/sync`), { cookie: cookieA });
    expect((await businessOf(project.id)).link!.syncError).toBeNull();

    // A snapshot cannot be read through another project's link.
    const stranger = await newProject('biz-sync-stranger');
    const foreign = await h.request(
      'GET',
      api(`/projects/${stranger.id}/business/snapshots/${first.id}`),
      { cookie: cookieA },
    );
    expect(foreign.statusCode).toBe(404);
    // Put the business back for the tests that follow.
    edited.sections['GOALS'] = 'Grow digital loan applications by 20 percent this year.';
    edited.facts.pop();
  });

  it('BIZ-005: a project is created and linked in one step, or not created at all', async () => {
    const created = await newProject('biz-create', { businessId: 'biz-wepod' });
    expect(created.business).toMatchObject({ externalBusinessId: 'biz-wepod' });
    expect((await businessOf(created.id)).snapshot).not.toBeNull();

    contenter.mode = 'down';
    const outage = await createProject('biz-create-outage', { businessId: 'biz-wepod' });
    expect(outage.statusCode).toBe(502);
    contenter.mode = 'up';
    const missing = await createProject('biz-create-missing', { businessId: 'no-such-business' });
    expect(missing.statusCode).toBe(404);
    const rows = await h.admin.query<{ count: number }>(
      `select count(*)::int as count from projects where workspace_id = $1 and code like 'biz-create-%'`,
      [h.ids.workspaceA],
    );
    expect(rows.rows[0]!.count).toBe(0);
    // With the outage over, the same form succeeds.
    expect((await createProject('biz-create-outage', { businessId: 'biz-wepod' })).statusCode).toBe(
      201,
    );
  });

  it('BIZ-006: unlinking and linking another business are recorded; an archived project cannot change', async () => {
    contenter.add({ ...wePod(), id: 'biz-other', name: 'Other Company' });
    const project = await newProject('biz-unlink', { businessId: 'biz-wepod' });
    const moved = await h.request('PUT', api(`/projects/${project.id}/business`), {
      cookie: cookieA,
      payload: { externalBusinessId: 'biz-other' },
    });
    expect(moved.json<BusinessView>().link!.name).toBe('Other Company');
    const unlinked = await h.request('POST', api(`/projects/${project.id}/business/unlink`), {
      cookie: cookieA,
      payload: { reason: 'Wrong company' },
    });
    expect(unlinked.statusCode, unlinked.body).toBe(200);
    expect(unlinked.json<BusinessView>().link).toBeNull();
    const again = await h.request('POST', api(`/projects/${project.id}/business/unlink`), {
      cookie: cookieA,
      payload: {},
    });
    expect(again.statusCode).toBe(404);
    const audit = await h.admin.query<{ action: string }>(
      `select action from audit_events where project_id = $1 and action like 'business.%' order by occurred_at, id`,
      [project.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'business.link_set',
      'business.link_set',
      'business.unlinked',
    ]);
    // Snapshots stay as records even when no project reads them any more.
    const kept = await h.admin.query<{ count: number }>(
      `select count(*)::int as count from business_snapshots where workspace_id = $1 and external_business_id = 'biz-other'`,
      [h.ids.workspaceA],
    );
    expect(kept.rows[0]!.count).toBe(1);

    await h.request('PUT', api(`/projects/${project.id}/business`), {
      cookie: cookieA,
      payload: { externalBusinessId: 'biz-wepod' },
    });
    const archived = await h.request('POST', api(`/projects/${project.id}/archive`), {
      cookie: cookieA,
      payload: { expectedVersion: project.version, reason: 'Done' },
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const blocked = await h.request('PUT', api(`/projects/${project.id}/business`), {
      cookie: cookieA,
      payload: { externalBusinessId: 'biz-other' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ code: string }>().code).toBe('PROJECT_READ_ONLY');
  });

  it('BIZ-007: when the workspace requires a business, a project cannot be activated without one', async () => {
    const set = (value: boolean) =>
      h.request('PUT', api('/settings/assignments'), {
        cookie: cookieA,
        payload: {
          key: 'business.required',
          scopeType: 'workspace',
          scopeId: h.ids.workspaceA,
          value,
          reason: 'Test',
        },
      });
    expect((await set(true)).statusCode).toBe(200);
    try {
      const project = await newProject('biz-required');
      const refused = await h.request('POST', api(`/projects/${project.id}/activate`), {
        cookie: cookieA,
        payload: { expectedVersion: project.version },
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json<{ code: string; problems: string[] }>()).toMatchObject({
        code: 'PROJECT_NOT_READY',
        problems: ['business_missing'],
      });
      await h.request('PUT', api(`/projects/${project.id}/business`), {
        cookie: cookieA,
        payload: { externalBusinessId: 'biz-wepod' },
      });
      const read = await h.request('GET', api(`/projects/${project.id}`), { cookie: cookieA });
      const version = read.json<{ project: { version: number } }>().project.version;
      const ok = await h.request('POST', api(`/projects/${project.id}/activate`), {
        cookie: cookieA,
        payload: { expectedVersion: version },
      });
      expect(ok.statusCode, ok.body).toBe(200);
    } finally {
      await set(false);
    }
  });

  it('BIZ-008: a cloned project belongs to the same business', async () => {
    const source = await newProject('biz-clone-src', { businessId: 'biz-wepod' });
    const clone = await h.request('POST', api(`/projects/${source.id}/clone`), {
      cookie: cookieA,
      payload: { code: 'biz-clone-copy' },
    });
    expect(clone.statusCode, clone.body).toBe(201);
    const copy = clone.json<{
      project: { id: string; business: { externalBusinessId: string } | null };
    }>().project;
    expect(copy.business).toMatchObject({ externalBusinessId: 'biz-wepod' });
    expect((await businessOf(copy.id)).snapshot!.id).toBe(
      (await businessOf(source.id)).snapshot!.id,
    );
  });

  it('BIZ-009: the page can show exactly what each agent role is given', async () => {
    const project = await newProject('biz-context', { businessId: 'biz-wepod' });
    const preview = await h.request(
      'GET',
      api(`/projects/${project.id}/business/context?role=documenter`),
      { cookie: cookieA },
    );
    expect(preview.statusCode, preview.body).toBe(200);
    const body = preview.json<{
      linked: boolean;
      budgetChars: number;
      roles: {
        role: string;
        summary: {
          chars: number;
          sections: { key: string }[];
          facts: number;
          terms: number;
        } | null;
        data?: {
          keyFacts: { label: string }[];
          terminology?: { term: string }[];
          sections: { key: string }[];
        };
        rules?: string[];
      }[];
    }>();
    expect(body).toMatchObject({ linked: true, budgetChars: 12_000 });
    const byRole = new Map(body.roles.map((r) => [r.role, r]));
    expect(byRole.get('brain')!.summary).toBeNull();
    expect(byRole.get('analyst')!.summary!.sections.map((s) => s.key)).toEqual([
      'OVERVIEW',
      'SERVICES',
      'TARGET_MARKET',
      'PERSONAS',
      'GUIDELINES',
      'GOALS',
    ]);
    const documenter = byRole.get('documenter')!;
    // Brand terminology reaches the writer only, and a fact whose date passed reaches nobody.
    expect(documenter.summary!.terms).toBe(2);
    expect(byRole.get('analyst')!.summary!.terms).toBe(0);
    expect(documenter.data!.keyFacts.map((f) => f.label)).toEqual(['Loan ceiling']);
    expect(documenter.data!.sections.map((s) => s.key)).toContain('BRAND_VOICE');
    expect(documenter.rules!.join(' ')).toContain('authoritative description');
    // Only the role that was asked for carries its exact data.
    expect(byRole.get('analyst')!.data).toBeUndefined();

    const bad = await h.request(
      'GET',
      api(`/projects/${project.id}/business/context?role=nobody`),
      { cookie: cookieA },
    );
    expect(bad.statusCode).toBe(400);
    const none = await newProject('biz-context-none');
    const empty = await h.request('GET', api(`/projects/${none.id}/business/context`), {
      cookie: cookieA,
    });
    expect(empty.json<{ linked: boolean; roles: unknown[] }>()).toMatchObject({
      linked: false,
      roles: [],
    });
  });

  it('BIZ-010: a workspace cannot read the businesses, links or snapshots of another', async () => {
    const project = await newProject('biz-isolation', { businessId: 'biz-wepod' });
    const foreign = await h.request(
      'GET',
      api(`/projects/${project.id}/business`, h.ids.workspaceB),
      { cookie: cookieB },
    );
    expect(foreign.statusCode).toBe(404);
    const rows = await h.admin.query<{ count: number }>(
      'select count(*)::int as count from business_snapshots where workspace_id = $1',
      [h.ids.workspaceB],
    );
    expect(rows.rows[0]!.count).toBe(0);
    const removed = await h.request('DELETE', api('/integrations/contenter', h.ids.workspaceB), {
      cookie: cookieB,
    });
    expect(removed.statusCode).toBe(404);
  });
});
