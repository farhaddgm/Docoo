import { createHash } from 'node:crypto';

import { conflictFingerprint } from '@docoo/domain';
import { activeResearchFollowup, promptConflictDecisions } from '@docoo/orchestration';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

let h: Harness;
let cookie: string;
let projectId: string;
let stageRunId: string;
let outputId: string;
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;
const plan = () => api(`/projects/${projectId}/research-plan`);
const post = (url: string, payload: unknown = {}) => h.request('POST', url, { cookie, payload });
const put = (url: string, payload: unknown) => h.request('PUT', url, { cookie, payload });
const code = (response: { json<T>(): T }) => response.json<{ code: string }>().code;
const asClient = () => h.admin as unknown as PoolClient;

const QUESTIONS = [
  { question: 'What drives early churn?', why: '', channel: 'both' },
  { question: 'Which laws apply to the data?', why: '', channel: 'knowledge' },
  { question: 'What do rivals charge?', why: '', channel: 'web' },
];
const OUTPUT = {
  findings: [
    {
      questionId: 'Q1',
      level: 'solid',
      support: 'knowledge',
      claim: 'Support contact predicts churn',
      source: 'k',
      evidence: [{ ref: 'K1', quote: 'twice in a month', verified: true, problem: null }],
    },
    {
      questionId: 'Q2',
      level: 'unverified',
      support: 'unverified',
      claim: 'Some law applies',
      source: 'memory',
      evidence: [],
    },
  ],
  gaps: ['Q3: nothing found'],
  conflicts: [{ description: 'Sources disagree on churn', refs: ['K1', 'K2'] }],
  knowledge: {
    queries: ['q'],
    snapshots: [],
    offered: [
      {
        ref: 'K1',
        knowledgeId: 'k',
        versionId: 'v',
        versionNo: 1,
        title: 'T',
        snapshotId: 's',
        cited: true,
      },
      {
        ref: 'K2',
        knowledgeId: 'k2',
        versionId: 'v2',
        versionNo: 1,
        title: 'Other study',
        snapshotId: 's',
        cited: false,
      },
    ],
    excludedRestricted: true,
    retrieveTool: 'allowed',
    verifierTool: 'allowed',
    conflictWarnings: [],
  },
  web: { status: 'off', code: null, queries: [], sources: [] },
  verification: {
    findings: 2,
    supported: 1,
    unverified: 1,
    citations: 1,
    verified: 1,
    rejected: 0,
  },
  plan: {
    versionNo: 1,
    questions: [
      {
        id: 'Q1',
        question: QUESTIONS[0]!.question,
        channel: 'both',
        findings: 1,
        supported: 1,
        status: 'answered',
      },
      {
        id: 'Q2',
        question: QUESTIONS[1]!.question,
        channel: 'knowledge',
        findings: 1,
        supported: 0,
        status: 'weak',
      },
      {
        id: 'Q3',
        question: QUESTIONS[2]!.question,
        channel: 'web',
        findings: 0,
        supported: 0,
        status: 'unanswered',
      },
    ],
  },
  summary: {
    findings: 2,
    solid: 1,
    limited: 0,
    unverified: 1,
    disputed: 0,
    questions: { total: 3, answered: 1, weak: 1, unanswered: 1 },
    sources: { knowledge: 1, web: 0 },
  },
};

describe.skipIf(!adminUrl)('Research follow-up round and requirement gaps (ADR-0039)', () => {
  beforeAll(async () => {
    h = await createHarness('resfollow');
    cookie = await h.login(h.emails.a);
    const connection = await post(api('/provider-connections'), {
      provider: 'fake',
      name: 'Deterministic',
    });
    const connectionId = connection.json<{ connection: { id: string } }>().connection.id;
    await post(api(`/provider-connections/${connectionId}/health-check`));
    for (const [key, value] of [
      ['ai.connection_id', connectionId],
      ['ai.model', 'fake-standard'],
    ] as const) {
      const response = await h.request('PUT', api('/settings/assignments'), {
        cookie,
        payload: { key, scopeType: 'workspace', scopeId: h.ids.workspaceA, value, reason: 'test' },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    const topic = await post(api('/topics'), { code: 'retail', title: 'Retail' });
    const topicId = topic.json<{ topic: { id: string } }>().topic.id;
    const created = await post(api('/projects'), {
      code: 'fu-1',
      title: 'Churn programme',
      initialProblem: 'Reduce repeat-customer churn in Q3.',
      topics: [{ topicId }],
    });
    projectId = created.json<{ project: { id: string } }>().project.id;

    const run = await h.admin.query<{ id: string }>(
      `insert into workflow_runs (workspace_id,project_id,run_no,temporal_workflow_id)
       values ($1,$2,1,$3) returning id`,
      [h.ids.workspaceA, projectId, `fu-${projectId}`],
    );
    stageRunId = (
      await h.admin.query<{ id: string }>(
        `insert into stage_runs (workspace_id,project_id,run_id,stage,sequence,status)
         values ($1,$2,$3,'research',2,'waiting_for_human') returning id`,
        [h.ids.workspaceA, projectId, run.rows[0]!.id],
      )
    ).rows[0]!.id;
    const json = JSON.stringify(OUTPUT);
    outputId = (
      await h.admin.query<{ id: string }>(
        `insert into stage_outputs (workspace_id,stage_run_id,version_no,content,content_sha256,origin)
         values ($1,$2,1,$3::jsonb,$4,'model') returning id`,
        [h.ids.workspaceA, stageRunId, json, createHash('sha256').update(json).digest('hex')],
      )
    ).rows[0]!.id;
    await h.admin.query('update stage_runs set latest_output_id = $2 where id = $1', [
      stageRunId,
      outputId,
    ]);
    await h.admin.query(
      `insert into gate_decisions (workspace_id,stage_run_id,output_id,mode) values ($1,$2,$3,'manual')`,
      [h.ids.workspaceA, stageRunId, outputId],
    );
    // The plan the research worked to, confirmed.
    expect((await put(plan(), { basedOnVersionNo: 0, questions: QUESTIONS })).statusCode).toBe(200);
    expect((await post(`${plan()}/confirm`, { versionNo: 1 })).statusCode).toBe(200);
  });

  afterAll(async () => {
    await h?.close();
  });

  it('lists the open questions and the gate the output waits at', async () => {
    const view = (await h.request('GET', plan(), { cookie })).json<{
      followup: {
        stageRunId: string;
        atGate: boolean;
        hasPlan: boolean;
        planChanged: boolean;
        open: { id: string }[];
      };
    }>();
    expect(view.followup).toMatchObject({
      stageRunId,
      atGate: true,
      hasPlan: true,
      planChanged: false,
    });
    expect(view.followup.open.map((item) => item.id)).toEqual(['Q2', 'Q3']);
  });

  it('refuses questions that are not open, and a plan that is not the output’s', async () => {
    const answered = await post(`${plan()}/followup`, { questionIds: ['Q1'] });
    expect(answered.statusCode).toBe(400);
    expect(code(answered)).toBe('RESEARCH_FOLLOWUP_NOT_OPEN');
    const malformed = await post(`${plan()}/followup`, { questionIds: ['x'] });
    expect(malformed.statusCode).toBe(400);
  });

  it('rejects the output with the round’s token and records the questions it works on', async () => {
    const started = await post(`${plan()}/followup`, { questionIds: ['Q2'] });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json<{ questionIds: string[] }>().questionIds).toEqual(['Q2']);

    const review = await h.admin.query<{ action: string; comment: string }>(
      `select action::text as action, comment from stage_reviews where stage_run_id = $1`,
      [stageRunId],
    );
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0]!.action).toBe('reject');
    expect(review.rows[0]!.comment).toMatch(/Q2.*#fu-[0-9a-f]{8}/u);

    const followup = await activeResearchFollowup(asClient(), stageRunId, projectId);
    expect(followup?.focus.map((item) => item.id)).toEqual(['Q2']);
    expect(followup?.previous.findings).toHaveLength(2);
    expect(followup?.plan.questions).toHaveLength(3);

    const audit = await h.admin.query(
      `select after from audit_events where action = 'research_plan.followup_requested' and project_id = $1`,
      [projectId],
    );
    expect(JSON.stringify(audit.rows)).toContain('Q2');
    expect(JSON.stringify(audit.rows)).not.toContain('Which laws');
  });

  it('allows no second round until the new output waits at its gate', async () => {
    const again = await post(`${plan()}/followup`, { questionIds: ['Q3'] });
    expect(again.statusCode).toBe(409);
    expect(code(again)).toBe('RESEARCH_FOLLOWUP_NOT_AT_GATE');
  });

  it('does not let a round without its rejection start, or any ordinary rejection', async () => {
    const before = await activeResearchFollowup(asClient(), stageRunId, projectId);
    const planId = (
      await h.admin.query<{ id: string }>(
        'select id from research_plans where workspace_id = $1 and project_id = $2 limit 1',
        [h.ids.workspaceA, projectId],
      )
    ).rows[0]!.id;
    // A later round whose rejection never happened (for example the review failed): dormant.
    await h.admin.query(
      `insert into research_followups
         (workspace_id,project_id,stage_run_id,output_id,plan_id,token,questions,requested_by)
       values ($1,$2,$3,$4,$5,'deadbeef','[{"id":"Q3","question":"x","why":"","channel":"web"}]'::jsonb,
               (select requested_by from research_followups where stage_run_id = $3 limit 1))`,
      [h.ids.workspaceA, projectId, stageRunId, outputId, planId],
    );
    await h.admin.query(
      `insert into stage_reviews (workspace_id,stage_run_id,output_id,action,comment)
       values ($1,$2,$3,'reject','Please redo it.')`,
      [h.ids.workspaceA, stageRunId, outputId],
    );
    const after = await activeResearchFollowup(asClient(), stageRunId, projectId);
    expect(after?.id).toBe(before?.id);
    expect(after?.focus.map((item) => item.id)).toEqual(['Q2']);
  });

  it('drops the round when the plan was rewritten since the output', async () => {
    const view = (await h.request('GET', plan(), { cookie })).json<{
      plan: { versionNo: number };
    }>();
    const reordered = [QUESTIONS[1]!, QUESTIONS[0]!, QUESTIONS[2]!];
    expect(
      (await put(plan(), { basedOnVersionNo: view.plan.versionNo, questions: reordered }))
        .statusCode,
    ).toBe(200);
    expect(
      (await post(`${plan()}/confirm`, { versionNo: view.plan.versionNo + 1 })).statusCode,
    ).toBe(200);
    expect(await activeResearchFollowup(asClient(), stageRunId, projectId)).toBeNull();
    const after = (await h.request('GET', plan(), { cookie })).json<{
      followup: { planChanged: boolean; open: unknown[] };
    }>();
    expect(after.followup.planChanged).toBe(true);
    expect(after.followup.open).toEqual([]);
  });

  it('names the "must" requirements the research does not support and suggests questions', async () => {
    const none = await post(`${plan()}/requirement-gaps`);
    expect(none.statusCode).toBe(409);
    expect(code(none)).toBe('RESEARCH_GAPS_NO_REQUIREMENTS');

    const requirement = await post(api(`/projects/${projectId}/output-requirements`), {
      kind: 'must',
      text: 'Compare our price with the market',
    });
    expect(requirement.statusCode, requirement.body).toBe(201);
    const requirementId = requirement.json<{ requirement: { id: string } }>().requirement.id;
    await post(api(`/projects/${projectId}/output-requirements`), {
      kind: 'must_not',
      text: 'No staff names anywhere',
    });

    const original = h.fake.responder;
    h.fake.responder = (request) =>
      request.responseSchema?.name === 'research_requirement_gaps'
        ? {
            results: [
              {
                requirementId,
                verdict: 'missing',
                evidence: 'No finding bears on price.',
                question: 'What do competitors charge for the basic plan?',
                why: 'To compare our price',
                channel: 'web',
              },
            ],
          }
        : original(request);
    try {
      const checked = await post(`${plan()}/requirement-gaps`);
      expect(checked.statusCode, checked.body).toBe(200);
      const { items } = checked.json<{
        items: {
          requirement: { id: string };
          verdict: string;
          suggestion: { question: string; channel: string } | null;
        }[];
      }>();
      // Only the "must" item is checked; the "must not" one is not research's business.
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ requirement: { id: requirementId }, verdict: 'missing' });
      expect(items[0]!.suggestion).toMatchObject({
        question: 'What do competitors charge for the basic plan?',
        channel: 'web',
      });
    } finally {
      h.fake.responder = original;
    }
  });

  describe('decisions on research conflicts (ADR-0040)', () => {
    const fingerprint = conflictFingerprint('Sources disagree on churn', ['K1', 'K2']);
    const conflicts = () => api(`/projects/${projectId}/research-conflicts`);
    const decide = (payload: unknown, print = fingerprint) =>
      post(`${conflicts()}/${print}/decision`, payload);
    interface Listing {
      stageRunId: string | null;
      items: {
        fingerprint: string;
        description: string;
        sources: { ref: string; title: string; kind: string }[];
        decision: { decision: string; trustedRef: string | null; note: string } | null;
      }[];
    }
    const listing = async () => (await h.request('GET', conflicts(), { cookie })).json<Listing>();

    it('lists the conflict with the sources it names and no decision yet', async () => {
      const view = await listing();
      expect(view.stageRunId).toBe(stageRunId);
      expect(view.items).toHaveLength(1);
      expect(view.items[0]).toMatchObject({ fingerprint, decision: null });
      expect(
        view.items[0]!.sources.map((source) => [source.ref, source.title, source.kind]),
      ).toEqual([
        ['K1', 'T', 'knowledge'],
        ['K2', 'Other study', 'knowledge'],
      ]);
    });

    it('refuses a decision that does not fit the conflict', async () => {
      for (const payload of [
        { decision: 'trust' },
        { decision: 'trust', trustedRef: 'K9' },
        { decision: 'dismiss', trustedRef: 'K1' },
      ]) {
        const bad = await decide(payload);
        expect(bad.statusCode, JSON.stringify(payload)).toBe(400);
        expect(code(bad)).toBe('RESEARCH_CONFLICT_INVALID');
      }
      expect((await decide({ decision: 'maybe' })).statusCode).toBe(400);
      expect((await decide({ decision: 'dismiss' }, 'not-a-print')).statusCode).toBe(400);
      const unknown = await decide({ decision: 'dismiss' }, '0123456789abcdef');
      expect(unknown.statusCode).toBe(404);
      expect(code(unknown)).toBe('RESEARCH_CONFLICT_NOT_FOUND');
    });

    it('records a decision, lets a later one replace it, and tells the later stages', async () => {
      const trusted = await decide({ decision: 'trust', trustedRef: 'k2', note: 'Newer data' });
      expect(trusted.statusCode, trusted.body).toBe(200);
      expect((await listing()).items[0]!.decision).toMatchObject({
        decision: 'trust',
        trustedRef: 'K2',
        note: 'Newer data',
      });
      const told = await promptConflictDecisions(asClient(), stageRunId, OUTPUT);
      expect(told).toEqual([
        {
          conflict: 'Sources disagree on churn',
          decision: 'trust',
          trustedSource: 'K2 — Other study',
          note: 'Newer data',
        },
      ]);

      expect((await decide({ decision: 'dismiss' })).statusCode).toBe(200);
      expect((await listing()).items[0]!.decision).toMatchObject({
        decision: 'dismiss',
        trustedRef: null,
      });
      expect(await promptConflictDecisions(asClient(), stageRunId, OUTPUT)).toEqual([
        { conflict: 'Sources disagree on churn', decision: 'dismiss' },
      ]);
      // A conflict the output no longer reports needs no decision.
      expect(
        await promptConflictDecisions(asClient(), stageRunId, { ...OUTPUT, conflicts: [] }),
      ).toEqual([]);
    });

    it('audits the kind of decision, never the conflict text', async () => {
      const audit = await h.admin.query(
        `select after from audit_events where action = 'research_plan.conflict_decided' and project_id = $1`,
        [projectId],
      );
      expect(audit.rows.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(audit.rows)).not.toContain('Sources disagree');
    });

    it('keeps the decisions append-only', async () => {
      await expect(
        h.admin.query(`update research_conflict_decisions set note = 'x'`),
      ).rejects.toThrow(/append-only/);
    });
  });

  it('keeps the follow-up rows append-only', async () => {
    await expect(h.admin.query(`update research_followups set token = 'abcdef12'`)).rejects.toThrow(
      /append-only/,
    );
  });
});
