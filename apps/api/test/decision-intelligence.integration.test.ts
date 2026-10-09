import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IntelligenceSearchResult, ProjectResearchPlan } from '@docoo/contracts';
import { createDecisionResearchActivities } from '@docoo/orchestration';
import { DATABASE_POOL } from '../src/tokens.js';
import type { TemporalTestRuntime } from './support/harness.js';
import { adminUrl, createHarness, temporalAddress, type Harness } from './support/harness.js';
import { retrievalGold, retrievalMetrics } from './support/decision-intelligence-gold.js';

let h: Harness, cookie: string, projectId: string, solutionId: string, viewer: string;
const goldIds = new Map<string, string[]>();
const path = (suffix: string) =>
  `/v1/workspaces/${h.ids.workspaceA}/projects/${projectId}/intelligence${suffix}`;
async function post<T>(suffix: string, payload: unknown, who = cookie) {
  const res = await h.request('POST', path(suffix), { cookie: who, payload });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<T>();
}
async function seed(title: string, text: string, language: 'fa' | 'en' = 'en', scope = projectId) {
  const res = await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/knowledge`, {
    cookie,
    payload: {
      title,
      content:
        text +
        '\nThe committee reviewed this observation and supplied it for the project decision.',
      language,
      sourceType: 'admin_provided',
      provenance: { declaration: 'Approved committee evidence' },
      scopes: [{ type: 'project', id: scope }],
      claims: [{ text }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json<{ knowledge: { id: string } }>().knowledge.id;
  const audit = await h.request(
    'POST',
    `/v1/workspaces/${h.ids.workspaceA}/knowledge/${id}/submit-audit`,
    { cookie },
  );
  expect(audit.statusCode, audit.body).toBe(200);
  expect(audit.json<{ review: { decision: string } }>().review.decision).toBe('approved');
  const claim = (
    await h.admin.query<{ id: string }>(
      `select c.id from claims c join knowledge_versions v on v.id=c.knowledge_version_id where v.item_id=$1`,
      [id],
    )
  ).rows[0]!.id;
  return { id, claim };
}
const plan = (): ProjectResearchPlan => ({
  version: 1,
  query: 'customer churn',
  language: 'en',
  knowledgeSourceTypes: ['admin'],
  country: null,
  timeRange: { from: null, to: null },
  sourcePolicy: { mode: 'unrestricted', domains: [] },
  targetCount: 40,
  similarSampleCount: 0,
  depth: 'standard',
  sourceLanguages: ['fa', 'en'],
  adaptive: {
    questions: [
      { id: 'churn', text: 'customer churn', importance: 5 },
      { id: 'missing', text: 'unobtainable actuarial liability', importance: 4 },
    ],
    maxRounds: 5,
    maxClaimVisits: 40,
    targetCoverage: 100,
    perQuestionLimit: 5,
  },
});

describe.skipIf(!adminUrl || !temporalAddress)(
  'decision intelligence against current main, PostgreSQL 18 and Temporal',
  () => {
    beforeAll(async () => {
      h = await createHarness('intelligence', { workflow: true });
      cookie = await h.login(h.emails.a);
      const project = await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/projects`, {
        cookie,
        payload: {
          code: 'intelligence-' + h.suffix,
          title: 'Decision intelligence',
          initialProblem: 'Reduce customer churn',
          topics: [],
        },
      });
      expect(project.statusCode, project.body).toBe(201);
      projectId = project.json<{ project: { id: string } }>().project.id;
      for (const item of retrievalGold) {
        const fa = await seed(item.key + ' fa', item.fa, 'fa'),
          en = await seed(item.key + ' en', item.en);
        goldIds.set(item.key, [fa.claim, en.claim]);
      }
      const set = (
        await h.admin.query<{ id: string }>(
          `insert into solution_sets(workspace_id,project_id,requested_count,origin,created_by) values($1,$2,2,'manual',$3) returning id`,
          [h.ids.workspaceA, projectId, h.ids.userA],
        )
      ).rows[0]!.id;
      solutionId = (
        await h.admin.query<{ id: string }>(
          `insert into solutions(workspace_id,project_id,set_id,ordinal,title,summary,assumptions,evidence,plan,risks,score_inputs) values($1,$2,$3,1,'Retain customers','Customer churn decreased','[]','[]','{}','[]','{}') returning id`,
          [h.ids.workspaceA, projectId, set],
        )
      ).rows[0]!.id;
    }, 60000);
    afterAll(async () => {
      await h?.close();
    });
    it('benchmarks 24 bilingual searches against independently pinned relevance and filters source language', async () => {
      const metrics: { language: string; mode: string; recall: number; ndcg: number }[] = [];
      for (const item of retrievalGold)
        for (const language of ['fa', 'en'] as const)
          for (const mode of ['hybrid', 'lexical'] as const) {
            const result = await post<IntelligenceSearchResult>('/search', {
              query: item.queries[language],
              mode,
              languages: ['fa', 'en'],
              limit: 10,
            });
            const measured = retrievalMetrics(
              result.items.map((r) => r.claim.id),
              new Set(goldIds.get(item.key)),
            );
            metrics.push({ language, mode, ...measured });
            if (mode === 'hybrid') {
              expect(measured.recall).toBe(1);
              expect(measured.ndcg).toBeGreaterThan(0.9);
            }
          }
      const english = await post<IntelligenceSearchResult>('/search', {
        query: 'ریزش مشتری',
        languages: ['en'],
        limit: 10,
      });
      expect(english.items.every((r) => r.claim.language === 'en')).toBe(true);
      expect(english.items.some((r) => goldIds.get('churn')!.includes(r.claim.id))).toBe(true);
      if (process.env['DECISION_BENCHMARK_OUTPUT'])
        writeFileSync(
          process.env['DECISION_BENCHMARK_OUTPUT'],
          JSON.stringify(
            { date: '2026-10-09', version: '0.25.0', synthetic: true, queries: metrics },
            null,
            2,
          ) + '\n',
        );
    });
    it('pins exact assertions, rejects forged text, replays writes and shows limited support', async () => {
      const input = {
        targetType: 'solution',
        targetVersionId: solutionId,
        blockIndex: null,
        assertion: 'Customer churn decreased',
        claimId: goldIds.get('churn')![1],
        relation: 'supports',
        applicabilityReviewed: true,
        reason: 'Reviewed applicability to customer retention',
        idempotencyKey: randomUUID(),
      };
      const first = await post<{ id: string; replayed: boolean }>('/evidence-links', input),
        replay = await post<{ id: string; replayed: boolean }>('/evidence-links', input);
      expect(first.id).toBe(replay.id);
      expect(replay.replayed).toBe(true);
      const forged = await h.request('POST', path('/evidence-links'), {
        cookie,
        payload: { ...input, assertion: 'Churn decreased by 130%', idempotencyKey: randomUUID() },
      });
      expect(forged.statusCode).toBe(400);
      const graph = await h.request('GET', path('/graph'), { cookie });
      expect(graph.statusCode, graph.body).toBe(200);
      const target = graph
        .json<{
          targets: {
            versionId: string;
            assessment: { status: string; probabilityOfTruth: null };
          }[];
        }>()
        .targets.find((t) => t.versionId === solutionId)!;
      expect(target.assessment.status).toBe('supported_with_limits');
      expect(target.assessment.probabilityOfTruth).toBeNull();
    });
    it('requires human conflict review and keeps conditional opposition visible', async () => {
      await seed('Opposing observation', 'Customer churn increased');
      const response = await h.request('GET', path('/conflicts'), { cookie });
      expect(response.statusCode, response.body).toBe(200);
      const c = response
        .json<{ items: { claimAId: string; claimBId: string; fingerprint: string }[] }>()
        .items.find((c) => [c.claimAId, c.claimBId].includes(goldIds.get('churn')![1]!))!;
      expect(c).toBeDefined();
      const input = {
        claimAId: c.claimAId,
        claimBId: c.claimBId,
        expectedFingerprint: c.fingerprint,
        decision: 'conditioned',
        applicabilityCondition: 'Results concern different customer cohorts',
        reason: 'Human review retains both findings',
        idempotencyKey: randomUUID(),
      };
      await post('/conflicts/reviews', input);
      await post('/conflicts/reviews', input);
      const stale = await h.request('POST', path('/conflicts/reviews'), {
        cookie,
        payload: { ...input, expectedFingerprint: '0'.repeat(64), idempotencyKey: randomUUID() },
      });
      expect(stale.statusCode).toBe(409);
      const g = (await h.request('GET', path('/graph'), { cookie })).json<{
        targets: { versionId: string; assessment: { status: string } }[];
      }>();
      expect(g.targets.find((t) => t.versionId === solutionId)!.assessment.status).toBe(
        'conflicted',
      );
    });
    it('runs bounded durable research after worker restart and creates one immutable report', async () => {
      const runtime = h.engine as TemporalTestRuntime;
      await runtime.stopWorker();
      const payload = { plan: plan(), idempotencyKey: randomUUID() };
      const run = await post<{ workflowRunId: string }>('/research/runs', payload);
      const replay = await post<{ workflowRunId: string }>('/research/runs', payload);
      expect(replay.workflowRunId).toBe(run.workflowRunId);
      await runtime.startWorker();
      await runtime.client.workflow.getHandle('decision-research-' + run.workflowRunId).result();
      const report = (await h.request('GET', path('/research/reports'), { cookie })).json<{
        items: {
          current: boolean;
          report: { status: string; claimVisits: number; coverage: number };
        }[];
      }>().items[0]!;
      expect(report.current).toBe(true);
      expect(report.report.status).toBe('insufficient_evidence');
      expect(report.report.claimVisits).toBeLessThanOrEqual(40);
      expect(report.report.coverage).toBeLessThan(100);
      const pool = h.app.get<Pool>(DATABASE_POOL);
      await createDecisionResearchActivities(pool).runDecisionResearch({
        workspaceId: h.ids.workspaceA,
        projectId,
        actorId: h.ids.userA,
        reportId: run.workflowRunId,
      });
      expect(
        Number(
          (
            await h.admin.query<{ count: string }>(
              `select count(*) from audit_events where target_id=$1 and action='intelligence.research.completed'`,
              [run.workflowRunId],
            )
          ).rows[0]!.count,
        ),
      ).toBe(1);
      await expect(
        h.admin.query(
          `update project_research_intelligence_reports set status='failed' where id=$1`,
          [run.workflowRunId],
        ),
      ).rejects.toThrow('immutable');
    }, 30000);
    it('allows viewer searches, blocks edits and rejects cross-workspace project access', async () => {
      await h.admin.query(`update users set account_role='viewer' where id=$1`, [h.ids.userB]);
      await h.admin.query(`update memberships set role='viewer' where user_id=$1`, [h.ids.userB]);
      await h.admin.query(
        `insert into memberships(workspace_id,user_id,role) values($1,$2,'viewer')`,
        [h.ids.workspaceA, h.ids.userB],
      );
      await h.admin.query(
        `insert into resource_access(workspace_id,user_id,kind,resource_id,access) values($1,$2,'project',$3,'VIEW')`,
        [h.ids.workspaceA, h.ids.userB, projectId],
      );
      viewer = await h.login(h.emails.b);
      const read = await h.request('POST', path('/search'), {
        cookie: viewer,
        payload: { query: 'customer churn' },
      });
      expect(read.statusCode, read.body).toBe(201);
      const write = await h.request('POST', path('/evidence-links'), {
        cookie: viewer,
        payload: {},
      });
      expect(write.statusCode).toBe(403);
      const foreign = await h.request(
        'GET',
        `/v1/workspaces/${h.ids.workspaceB}/projects/${projectId}/intelligence/graph`,
        { cookie: viewer },
      );
      expect([403, 404]).toContain(foreign.statusCode);
    });
    it('revalidates quotes, approval and scope for stored graph links and reports', async () => {
      await h.admin.query(
        `update knowledge_items set deleted_at=now() where current_version_id in(select knowledge_version_id from claims where id=any($1::uuid[]))`,
        [goldIds.get('churn')],
      );
      const graph = (await h.request('GET', path('/graph'), { cookie })).json<{
        claims: { id: string }[];
        targets: {
          versionId: string;
          unavailableLinkCount: number;
          assessment: { status: string };
        }[];
      }>();
      expect(graph.claims.some((c) => goldIds.get('churn')!.includes(c.id))).toBe(false);
      const target = graph.targets.find((t) => t.versionId === solutionId)!;
      expect(target.unavailableLinkCount).toBe(1);
      expect(target.assessment.status).toBe('insufficient');
      const reports = (await h.request('GET', path('/research/reports'), { cookie })).json<{
        items: { current: boolean; report: unknown }[];
      }>();
      expect(reports.items[0]!.current).toBe(false);
      expect(reports.items[0]!.report).toBeNull();
    });
  },
);
