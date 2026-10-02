import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

interface EventBody {
  action: string;
  projectId: string | null;
  severity: string;
  actorId: string | null;
  before: unknown;
  after: unknown;
}

let h: Harness;
let cookie: string;
let cookieB: string;
let projectId: string;

const audit = (query = '') => `/v1/workspaces/${h.ids.workspaceA}/audit-events${query}`;

describe.skipIf(!adminUrl)('audit explorer (TC-AUD-*)', () => {
  beforeAll(async () => {
    h = await createHarness('audit');
    cookie = await h.login(h.emails.a);
    cookieB = await h.login(h.emails.b);
    const topic = (
      await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/topics`, {
        cookie,
        payload: { code: 'secret-topic', title: 'Board-only topic' },
      })
    ).json<{ topic: { id: string } }>().topic.id;
    const project = (
      await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/projects`, {
        cookie,
        payload: {
          code: 'audited',
          title: 'Audited',
          initialProblem: 'Highly confidential merger plan',
          topics: [{ topicId: topic }],
        },
      })
    ).json<{ project: { id: string; version: number } }>().project;
    projectId = project.id;
    await h.request('DELETE', `/v1/workspaces/${h.ids.workspaceA}/projects/${projectId}`, {
      cookie,
      payload: { expectedVersion: project.version, reason: 'Cancelled' },
    });
  }, 30_000);

  afterAll(async () => {
    await h?.close();
  });

  it('filters by project, action family, severity and time range with paging', async () => {
    const byProject = await h.request('GET', audit(`?projectId=${projectId}`), { cookie });
    expect(byProject.statusCode).toBe(200);
    expect(byProject.json<{ items: EventBody[] }>().items.map((event) => event.action)).toEqual([
      'project.delete',
      'project.create',
    ]);

    const family = await h.request('GET', audit('?action=topic.*'), { cookie });
    expect(family.json<{ items: EventBody[] }>().items.map((event) => event.action)).toEqual([
      'topic.create',
    ]);

    const warnings = await h.request('GET', audit('?severity=warning'), { cookie });
    expect(warnings.json<{ items: EventBody[] }>().items).toEqual([
      expect.objectContaining({
        action: 'project.delete',
        severity: 'warning',
        actorId: h.ids.userA,
      }),
    ]);

    const future = await h.request(
      'GET',
      audit(`?from=${encodeURIComponent('2999-01-01T00:00:00Z')}`),
      { cookie },
    );
    expect(future.json<{ items: EventBody[] }>().items).toEqual([]);

    const first = await h.request('GET', audit('?limit=1'), { cookie });
    const page = first.json<{ items: EventBody[]; nextCursor: string }>();
    expect(page.items).toHaveLength(1);
    const second = await h.request('GET', audit(`?limit=1&cursor=${page.nextCursor}`), { cookie });
    expect(second.json<{ items: EventBody[] }>().items[0]?.action).not.toBe(page.items[0]?.action);

    const tampered = await h.request(
      'GET',
      audit(`?limit=1&severity=info&cursor=${page.nextCursor}`),
      { cookie },
    );
    expect(tampered.statusCode).toBe(400);

    const invalid = await h.request('GET', audit('?action=DROP TABLE'), { cookie });
    expect(invalid.statusCode).toBe(400);
  });

  it('never exposes confidential content and is isolated per workspace', async () => {
    const all = await h.request('GET', audit(), { cookie });
    expect(all.body).not.toContain('Highly confidential merger plan');
    expect(all.body).not.toContain('Board-only topic');

    const other = await h.request('GET', `/v1/workspaces/${h.ids.workspaceB}/audit-events`, {
      cookie: cookieB,
    });
    expect(other.json<{ items: EventBody[] }>().items).toEqual([]);
    const foreign = await h.request('GET', audit(), { cookie: cookieB });
    expect(foreign.statusCode).toBe(404);
  });

  it('exports JSON and CSV and audits each export', async () => {
    const json = await h.request('POST', audit('/export'), {
      cookie,
      payload: { format: 'json', filters: { projectId } },
    });
    expect(json.statusCode).toBe(200);
    expect(json.headers['content-disposition']).toContain('docoo-audit.json');
    expect(json.json<{ items: EventBody[] }>().items).toHaveLength(2);

    const csv = await h.request('POST', audit('/export'), {
      cookie,
      payload: { format: 'csv', filters: { action: 'project.*' } },
    });
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.body.trim().split('\r\n');
    expect(lines[0]).toBe(
      'occurredAt,action,severity,securityRelevant,actorId,targetType,targetId,projectId,reason,correlationId,before,after',
    );
    expect(lines).toHaveLength(3);

    const exports = await h.request('GET', audit('?action=audit.export'), { cookie });
    const events = exports.json<{ items: EventBody[] }>().items;
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ severity: 'warning' });
  });

  it('rejects any attempt to change history', async () => {
    await expect(
      h.admin.query(`update audit_events set action = 'tampered' where project_id = $1`, [
        projectId,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      h.admin.query('delete from audit_events where project_id = $1', [projectId]),
    ).rejects.toThrow(/append-only/);
  });
});
