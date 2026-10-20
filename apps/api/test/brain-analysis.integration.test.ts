import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

let h: Harness;
let cookie: string;
let projectId: string;
let otherProjectId: string;
let unauditedId: string;
let staleId: string;
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

interface Action {
  key: string;
  kind: string;
  target: { type: string; id: string } | null;
  params: Record<string, string | number>;
}
interface Finding {
  key: string;
  kind: string;
  severity: string;
  score: number;
  count: number;
  projectId: string | null;
  evidence: { type: string; id: string }[];
  actions: Action[];
}
interface Report {
  id: string;
  scope: string;
  analysisVersion: string;
  findings: Finding[];
  narrative: string | null;
  summary: { narrative?: { status: string; reason: string | null } };
  decisions: { findingKey: string; actionKey: string; status: string; actionKind: string }[];
}

const post = (suffix: string, payload: unknown = {}) =>
  h.request('POST', api(suffix), { cookie, payload });

async function generate(payload: Record<string, unknown>): Promise<Report> {
  const response = await post('/brain-reports', payload);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ report: Report }>().report;
}

async function knowledge(title: string, content: string, scopeProject: string) {
  const response = await post('/knowledge', {
    title,
    sourceType: 'admin_provided',
    provenance: { declaration: 'Approved by the finance committee' },
    content,
    scopes: [{ type: 'project', id: scopeProject }],
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ knowledge: { id: string; currentVersion: { id: string } } }>().knowledge;
}

const find = (report: Report, key: string) => report.findings.find((item) => item.key === key);

describe.skipIf(!adminUrl)(
  'Brain analysis, ranked findings and approved actions (ADR-0032)',
  () => {
    beforeAll(async () => {
      h = await createHarness('brainanalysis');
      cookie = await h.login(h.emails.a);
      const topic = await post('/topics', { code: 'ret', title: 'Retail' });
      const topicId = topic.json<{ topic: { id: string } }>().topic.id;
      const connection = await post('/provider-connections', { provider: 'fake', name: 'Fake' });
      const connectionId = connection.json<{ connection: { id: string } }>().connection.id;
      for (const [key, value] of [
        ['ai.connection_id', connectionId],
        ['ai.model', 'fake-standard'],
      ] as const) {
        await h.request('PUT', api('/settings/assignments'), {
          cookie,
          payload: {
            key,
            scopeType: 'workspace',
            scopeId: h.ids.workspaceA,
            value,
            reason: 'test',
          },
        });
      }
      const makeProject = async (code: string) => {
        const created = await post('/projects', {
          code,
          title: `Project ${code}`,
          initialProblem: 'Reduce churn.',
          topics: [{ topicId }],
        });
        const project = created.json<{ project: { id: string; version: number } }>().project;
        const activated = await post(`/projects/${project.id}/activate`, {
          expectedVersion: project.version,
        });
        expect(activated.statusCode, activated.body).toBe(200);
        return project.id;
      };
      projectId = await makeProject('alpha');
      otherProjectId = await makeProject('beta');

      // Knowledge of project alpha: one draft that has waited for ten days, one approved item that expired.
      const unaudited = await knowledge(
        'Return window draft',
        'Customers can return retail items within 30 days with a receipt.',
        projectId,
      );
      unauditedId = unaudited.id;
      await h.admin.query(
        `update knowledge_versions set created_at = now() - interval '10 days' where id = $1`,
        [unaudited.currentVersion.id],
      );
      const stale = await knowledge(
        'Discount rule',
        'Retail discounts should not exceed 15 percent without approval from finance.',
        projectId,
      );
      staleId = stale.id;
      const audited = await h.request('POST', api(`/knowledge/${stale.id}/submit-audit`), {
        cookie,
      });
      expect(audited.statusCode, audited.body).toBe(200);
      await h.admin.query(
        `update knowledge_versions set valid_until = now() - interval '2 days' where id = $1 and status = 'approved'`,
        [stale.currentVersion.id],
      );

      // A cost spike on alpha: ten dollars in the recent half of the period, nothing before.
      await h.admin.query(
        `insert into model_invocations (workspace_id, project_id, provider, model, purpose, status, input_tokens, output_tokens, cost_usd, price_id)
       values ($1, $2, 'fake', 'fake-standard', 'test', 'succeeded', 100, 100, 10, null)`,
        [h.ids.workspaceA, projectId],
      );
    }, 90_000);

    afterAll(async () => {
      await h?.close();
    });

    it('ranks findings with evidence and next actions, and changes nothing by itself', async () => {
      const before = await h.admin.query<{ fingerprint: string }>(
        `select md5(string_agg(row, '|' order by row)) as fingerprint from (
         select 'p:' || id || ':' || status || ':' || version as row from projects where workspace_id = $1
         union all select 'k:' || id || ':' || status from knowledge_versions where workspace_id = $1
       ) rows`,
        [h.ids.workspaceA],
      );
      const report = await generate({ projectId, periodDays: 30 });
      expect(report).toMatchObject({ scope: 'project', analysisVersion: 'brain-analysis-v1' });

      const unaudited = find(report, 'knowledge_unaudited')!;
      expect(unaudited).toMatchObject({ kind: 'knowledge_unaudited', count: 1, projectId });
      expect(unaudited.evidence).toEqual([{ type: 'knowledge', id: unauditedId }]);
      expect(unaudited.actions.map((action) => action.kind)).toEqual([
        'audit_knowledge',
        'open_knowledge',
      ]);
      const stale = find(report, 'knowledge_stale')!;
      expect(stale.evidence).toEqual([{ type: 'knowledge', id: staleId }]);
      const spike = find(report, `cost_anomaly:spike:${projectId}`)!;
      expect(spike).toMatchObject({ kind: 'cost_anomaly', severity: 'medium' });
      expect(spike.actions.find((action) => action.kind === 'pause_project')!.params).toMatchObject(
        {
          projectId,
        },
      );
      expect(report.findings.map((finding) => finding.score)).toEqual(
        report.findings.map((finding) => finding.score).sort((a, b) => b - a),
      );

      const after = await h.admin.query<{ fingerprint: string }>(
        `select md5(string_agg(row, '|' order by row)) as fingerprint from (
         select 'p:' || id || ':' || status || ':' || version as row from projects where workspace_id = $1
         union all select 'k:' || id || ':' || status from knowledge_versions where workspace_id = $1
       ) rows`,
        [h.ids.workspaceA],
      );
      expect(after.rows[0]!.fingerprint).toBe(before.rows[0]!.fingerprint);
      await expect(
        h.admin.query(`update brain_reports set findings = '[]' where id = $1`, [report.id]),
      ).rejects.toThrow();
    });

    it('chooses the scope: another project sees none of alpha, all projects sees all of it', async () => {
      const other = await generate({ projectId: otherProjectId });
      expect(other.findings.filter((finding) => finding.kind !== 'quality_drift')).toEqual([]);
      const workspace = await generate({ periodDays: 7 });
      expect(workspace.scope).toBe('workspace');
      expect(workspace.findings.map((finding) => finding.kind)).toEqual(
        expect.arrayContaining(['knowledge_unaudited', 'knowledge_stale', 'cost_anomaly']),
      );
      expect((await post('/brain-reports', { periodDays: 5 })).statusCode).toBe(400);
    });

    it('runs an action only after approval, once, with an audit trail', async () => {
      const report = await generate({ projectId });
      const finding = find(report, 'knowledge_unaudited')!;
      const action = finding.actions.find((item) => item.kind === 'audit_knowledge')!;
      const body = { findingKey: finding.key, actionKey: action.key };

      // A page link and an unknown action have nothing to approve.
      const link = finding.actions.find((item) => item.kind === 'open_knowledge')!;
      expect(
        (
          await post(`/brain-reports/${report.id}/actions`, {
            ...body,
            actionKey: link.key,
            decision: 'approve',
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await post(`/brain-reports/${report.id}/actions`, {
            ...body,
            actionKey: 'nope',
            decision: 'approve',
          })
        ).statusCode,
      ).toBe(404);
      const stillDraft = await h.admin.query<{ status: string }>(
        `select v.status from knowledge_items i join knowledge_versions v on v.id = i.current_version_id where i.id = $1`,
        [unauditedId],
      );
      expect(stillDraft.rows[0]!.status).toBe('draft');

      const approved = await post(`/brain-reports/${report.id}/actions`, {
        ...body,
        decision: 'approve',
      });
      expect(approved.statusCode, approved.body).toBe(200);
      expect(approved.json<{ decision: { status: string } }>().decision.status).toBe('done');
      const audited = await h.admin.query<{ status: string }>(
        `select v.status from knowledge_items i join knowledge_versions v on v.id = i.current_version_id where i.id = $1`,
        [unauditedId],
      );
      expect(audited.rows[0]!.status).not.toBe('draft');
      const events = await h.admin.query<{ action: string }>(
        `select action from audit_events where workspace_id = $1 and action in ('brain.action_approved', 'knowledge.audit')
         order by occurred_at desc, id desc limit 2`,
        [h.ids.workspaceA],
      );
      expect(events.rows.map((row) => row.action).sort()).toEqual([
        'brain.action_approved',
        'knowledge.audit',
      ]);

      const again = await post(`/brain-reports/${report.id}/actions`, {
        ...body,
        decision: 'approve',
      });
      expect(again.statusCode).toBe(409);
      const read = await h.request('GET', api(`/brain-reports/${report.id}`), { cookie });
      expect(read.json<{ report: Report }>().report.decisions).toEqual([
        expect.objectContaining({
          actionKey: action.key,
          status: 'done',
          actionKind: 'audit_knowledge',
        }),
      ]);
      await expect(
        h.admin.query(`update brain_action_decisions set note = 'x' where report_id = $1`, [
          report.id,
        ]),
      ).rejects.toThrow();
      await expect(
        h.admin.query(`delete from brain_action_decisions where report_id = $1`, [report.id]),
      ).rejects.toThrow();

      // Another workspace cannot see or decide on this report.
      const foreign = await h.login(h.emails.b);
      expect(
        (
          await h.request(
            'POST',
            `/v1/workspaces/${h.ids.workspaceB}/brain-reports/${report.id}/actions`,
            {
              cookie: foreign,
              payload: { ...body, decision: 'dismiss' },
            },
          )
        ).statusCode,
      ).toBe(404);
    });

    it('dismisses a proposal without running it, then pauses a project when approved', async () => {
      const report = await generate({ projectId });
      const spike = find(report, `cost_anomaly:spike:${projectId}`)!;
      const pause = spike.actions.find((item) => item.kind === 'pause_project')!;
      const dismissed = await post(`/brain-reports/${report.id}/actions`, {
        findingKey: spike.key,
        actionKey: pause.key,
        decision: 'dismiss',
        note: 'Planned experiment',
      });
      expect(dismissed.json<{ decision: { status: string } }>().decision.status).toBe('dismissed');
      const active = await h.admin.query<{ status: string }>(
        'select status::text as status from projects where id = $1',
        [projectId],
      );
      expect(active.rows[0]!.status).toBe('active');

      const next = await generate({ projectId });
      const nextSpike = find(next, spike.key)!;
      const nextPause = nextSpike.actions.find((item) => item.kind === 'pause_project')!;
      const paused = await post(`/brain-reports/${next.id}/actions`, {
        findingKey: nextSpike.key,
        actionKey: nextPause.key,
        decision: 'approve',
      });
      expect(paused.statusCode, paused.body).toBe(200);
      const status = await h.admin.query<{ status: string }>(
        'select status::text as status from projects where id = $1',
        [projectId],
      );
      expect(status.rows[0]!.status).toBe('paused');
      const audit = await h.admin.query<{ action: string }>(
        `select action from audit_events where workspace_id = $1 and action in ('project.pause', 'brain.action_approved', 'brain.action_dismissed')`,
        [h.ids.workspaceA],
      );
      expect(audit.rows.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'project.pause',
          'brain.action_approved',
          'brain.action_dismissed',
        ]),
      );
      // The same project cannot be paused again from a stale proposal: the action keeps its own checks.
      const stale = await post(`/brain-reports/${report.id}/actions`, {
        findingKey: spike.key,
        actionKey: pause.key,
        decision: 'approve',
      });
      expect(stale.statusCode).toBe(409);
    });

    it('writes the optional summary from kinds and counts only, behind a setting', async () => {
      const off = await generate({});
      expect(off.narrative).toBeNull();
      expect(off.summary.narrative).toBeUndefined();

      const enable = await h.request('PUT', api('/settings/assignments'), {
        cookie,
        payload: {
          key: 'brain.narrative_enabled',
          scopeType: 'workspace',
          scopeId: h.ids.workspaceA,
          value: true,
          reason: 'test',
        },
      });
      expect(enable.statusCode, enable.body).toBe(200);
      const invoke = h.fake.invoke.bind(h.fake);
      const sent: string[] = [];
      const spy = vi.spyOn(h.fake, 'invoke').mockImplementation(async (request) => {
        sent.push(JSON.stringify(request));
        return invoke(request);
      });
      try {
        const report = await generate({});
        expect(report.summary.narrative).toEqual({ status: 'done', reason: null });
        expect(report.narrative).toMatch(/^Fake answer/u);
        expect(sent).toHaveLength(1);
        for (const secret of [
          projectId,
          otherProjectId,
          unauditedId,
          staleId,
          'Return window',
          'Discount rule',
        ]) {
          expect(sent[0]).not.toContain(secret);
        }
        const purposes = await h.admin.query<{ purpose: string }>(
          `select purpose from model_invocations where workspace_id = $1 and purpose = 'brain:narrative'`,
          [h.ids.workspaceA],
        );
        expect(purposes.rowCount).toBe(1);
        const audit = await h.admin.query<{ after: unknown }>(
          `select after from audit_events where workspace_id = $1 and action = 'brain.report_generated' order by occurred_at desc limit 1`,
          [h.ids.workspaceA],
        );
        expect(JSON.stringify(audit.rows[0]!.after)).not.toContain('Fake answer');
      } finally {
        spy.mockRestore();
      }
    });
  },
);
