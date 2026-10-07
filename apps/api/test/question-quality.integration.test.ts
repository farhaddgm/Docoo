import { fakeResponder } from '@docoo/orchestration';
import type { NormalizedModelRequest } from '@docoo/providers';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { StageFlow } from './support/flow.js';
import type { TemporalTestRuntime } from './support/harness.js';
import { adminUrl, createHarness, temporalAddress, type Harness } from './support/harness.js';

interface Review {
  id: string;
  criteria: string[];
  questionCount: number;
  status: string;
  reason: string | null;
  score: number | null;
  summary: string | null;
  findings: {
    kind: string;
    criterion: string;
    severity: string;
    detail: string;
    recommendation: string | null;
    questions: { ref: string; id: string; number: number }[];
  }[];
  discarded: number;
  invocationId: string | null;
  errorCode: string | null;
}

let h: Harness;
let flow: StageFlow;
let temporal: TemporalTestRuntime;
let projectId: string;
const captured: NormalizedModelRequest[] = [];

const judged = () =>
  captured.filter((request) => request.responseSchema?.name === 'brain_question_quality');
const dataOf = (request: NormalizedModelRequest) =>
  JSON.parse(
    (request.messages[0] as { content: string }).content.slice('<data>'.length, -'</data>'.length),
  ) as { criteria: string[]; questions: { ref: string; text: string }[]; knownSimilar: unknown[] };
const quality = (id = projectId, who = flow.cookie) =>
  h.request('POST', flow.api(`/projects/${id}/analysis/question-quality`), {
    cookie: who,
    payload: {},
  });

describe.skipIf(!adminUrl || !temporalAddress)(
  'the Brain judges the analyst’s questions (ADR-0024)',
  () => {
    beforeAll(async () => {
      h = await createHarness('qquality', { workflow: true });
      temporal = h.engine as TemporalTestRuntime;
      flow = new StageFlow(h, await h.login(h.emails.a));
      await flow.prepare();
      temporal.fake.responder = (request) => {
        captured.push(request);
        return fakeResponder(request);
      };
      projectId = await flow.project('qq');
    }, 90_000);

    afterEach(async () => {
      temporal.fake.responder = (request) => {
        captured.push(request);
        return fakeResponder(request);
      };
      temporal.fakeScript = () => null;
      await flow.setting('analysis.quality_criteria', []);
    });
    afterAll(async () => {
      await h?.close();
    });

    it('QQ-001: there is nothing to judge before the analyst has asked', async () => {
      const response = await quality();
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json<{ code: string }>().code).toBe('ANALYSIS_NO_QUESTIONS');
      const list = await flow.get<{ reviews: Review[]; questionCount: number }>(
        `/projects/${projectId}/analysis/question-quality`,
      );
      expect(list).toEqual({ reviews: [], questionCount: 0 });
    });

    it('QQ-002: judges the questions with every criterion, names real questions and changes nothing', async () => {
      await flow.activate(projectId);
      await flow.analysis.reachDefinition(projectId);
      const before = await h.admin.query<{ questions: string; outputs: string; answers: string }>(
        `select (select count(*) from analysis_questions where project_id = $1) as questions,
                (select count(*) from stage_outputs o join stage_runs s on s.id = o.stage_run_id where s.project_id = $1) as outputs,
                (select count(*) from analysis_answers where project_id = $1) as answers`,
        [projectId],
      );
      captured.length = 0;

      const response = await quality();
      expect(response.statusCode, response.body).toBe(201);
      const { review } = response.json<{ review: Review }>();
      expect(review).toMatchObject({
        status: 'completed',
        reason: null,
        score: 4,
        criteria: ['decision_relevance', 'leading', 'duplicate', 'vague', 'tone'],
        discarded: 0,
      });
      expect(review.questionCount).toBeGreaterThanOrEqual(30);
      expect(review.findings.map((finding) => finding.criterion)).toEqual([
        'decision_relevance',
        'vague',
      ]);
      // Each finding points at questions that exist, by number and stored id.
      const stored = await h.admin.query<{ id: string; ordinal: number }>(
        'select id, ordinal from analysis_questions where project_id = $1',
        [projectId],
      );
      const byId = new Map(stored.rows.map((row) => [row.id, row.ordinal]));
      for (const finding of review.findings) {
        for (const question of finding.questions) {
          expect(byId.get(question.id)).toBe(question.number);
          expect(question.ref).toBe(`Q${question.number}`);
        }
      }
      expect(review.findings[0]!.questions[0]!.number).toBe(1);

      // The judge saw the numbered questions, the criteria and the rules, and no answers.
      const [request] = judged();
      expect(request).toBeDefined();
      const data = dataOf(request!);
      expect(data.criteria).toEqual(review.criteria);
      expect(data.questions).toHaveLength(review.questionCount);
      expect(data.questions[0]!.ref).toBe('Q1');
      expect(Object.keys(data.questions[0]!).sort()).toEqual(['category', 'ref', 'status', 'text']);
      expect(request!.instructions).toContain('Every finding names a criterion');
      expect(request!.instructions).not.toContain(data.questions[0]!.text);
      expect(JSON.stringify(data)).not.toContain('Test answer');

      // It is a model call like any other: recorded with the project, priced, with the Brain's version.
      const calls = await h.admin.query<{
        purpose: string;
        project_id: string;
        cost_usd: number | null;
        agent_definition_version_id: string | null;
      }>(
        `select purpose, project_id, cost_usd, agent_definition_version_id from model_invocations where id = $1`,
        [review.invocationId],
      );
      expect(calls.rows[0]).toMatchObject({
        purpose: 'brain:question_quality',
        project_id: projectId,
      });
      expect(calls.rows[0]!.cost_usd).not.toBeNull();
      expect(calls.rows[0]!.agent_definition_version_id).not.toBeNull();

      // Nothing else changed (FR-BRN-004), and the audit log has the outcome, not the words.
      const after = await h.admin.query<{ questions: string; outputs: string; answers: string }>(
        `select (select count(*) from analysis_questions where project_id = $1) as questions,
                (select count(*) from stage_outputs o join stage_runs s on s.id = o.stage_run_id where s.project_id = $1) as outputs,
                (select count(*) from analysis_answers where project_id = $1) as answers`,
        [projectId],
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
      const events = await h.admin.query<{ after: Record<string, unknown> }>(
        `select after from audit_events where project_id = $1 and action = 'analysis.question_quality_reviewed'`,
        [projectId],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]!.after).toMatchObject({
        reviewId: review.id,
        status: 'completed',
        score: 4,
        findings: 2,
      });
      expect(JSON.stringify(events.rows)).not.toContain(data.questions[0]!.text);

      // The list shows it, newest first.
      const list = await flow.get<{ reviews: Review[]; questionCount: number }>(
        `/projects/${projectId}/analysis/question-quality`,
      );
      expect(list.reviews.map((item) => item.id)).toEqual([review.id]);
      expect(list.questionCount).toBe(review.questionCount);
    });

    it('QQ-003: only the criteria the administrator chose are judged, and a finding on another one is discarded', async () => {
      await flow.setting('analysis.quality_criteria', ['tone', 'duplicate']);
      captured.length = 0;
      temporal.fake.responder = (request) => {
        captured.push(request);
        if (request.responseSchema?.name !== 'brain_question_quality')
          return fakeResponder(request);
        return {
          score: 3,
          summary: 'Mixed.',
          findings: [
            {
              kind: 'weakness',
              criterion: 'tone',
              severity: 'high',
              detail: 'Q2 is accusing.',
              recommendation: 'Soften it.',
              questionRefs: ['Q2'],
            },
            // Not asked about, with no real question, and a repeat of the first: all discarded.
            {
              kind: 'weakness',
              criterion: 'leading',
              severity: 'low',
              detail: 'Q3 leads.',
              recommendation: '',
              questionRefs: ['Q3'],
            },
            {
              kind: 'weakness',
              criterion: 'duplicate',
              severity: 'low',
              detail: 'Q9999 repeats.',
              recommendation: '',
              questionRefs: ['Q9999'],
            },
            {
              kind: 'weakness',
              criterion: 'tone',
              severity: 'high',
              detail: 'Q2 is accusing.',
              recommendation: 'Soften it.',
              questionRefs: ['q2'],
            },
          ],
        };
      };
      const response = await quality();
      expect(response.statusCode, response.body).toBe(201);
      const { review } = response.json<{ review: Review }>();
      expect(review.criteria).toEqual(['duplicate', 'tone']);
      expect(dataOf(judged()[0]!).criteria).toEqual(['duplicate', 'tone']);
      expect(review.findings).toHaveLength(1);
      expect(review.findings[0]).toMatchObject({
        criterion: 'tone',
        severity: 'high',
        questions: [{ ref: 'Q2' }],
      });
      expect(review.discarded).toBe(3);
    });

    it('QQ-004: an unusable answer or a provider failure is kept as a failed review, never as a verdict', async () => {
      temporal.fake.responder = (request) => {
        captured.push(request);
        return request.responseSchema?.name === 'brain_question_quality'
          ? { score: 9, summary: '', findings: 'none' }
          : fakeResponder(request);
      };
      const invalid = await quality();
      expect(invalid.statusCode, invalid.body).toBe(201);
      expect(invalid.json<{ review: Review }>().review).toMatchObject({
        status: 'failed',
        reason: 'invalid_output',
        score: null,
        summary: null,
        findings: [],
      });

      temporal.fake.responder = fakeResponder;
      // The retry schedule belongs to the workflow; a single failing call is saved as it is.
      temporal.fakeScript = (request) =>
        request.responseSchema?.name === 'brain_question_quality' ? 'permanent' : null;
      const failed = await quality();
      expect(failed.statusCode, failed.body).toBe(201);
      expect(failed.json<{ review: Review }>().review).toMatchObject({
        status: 'failed',
        reason: 'provider_failure',
        score: null,
      });
      expect(failed.json<{ review: Review }>().review.errorCode).toMatch(/permanent/u);
      const list = await flow.get<{ reviews: Review[] }>(
        `/projects/${projectId}/analysis/question-quality`,
      );
      expect(list.reviews.map((item) => item.status).slice(0, 2)).toEqual(['failed', 'failed']);
    });

    it('QQ-005: another workspace cannot see or run it, and without a model nothing is saved', async () => {
      const cookieB = await h.login(h.emails.b);
      const foreign = await h.request(
        'POST',
        `/v1/workspaces/${h.ids.workspaceB}/projects/${projectId}/analysis/question-quality`,
        { cookie: cookieB, payload: {} },
      );
      expect(foreign.statusCode).toBe(404);
      const foreignList = await h.request(
        'GET',
        `/v1/workspaces/${h.ids.workspaceB}/projects/${projectId}/analysis/question-quality`,
        { cookie: cookieB },
      );
      expect(foreignList.statusCode).toBe(404);

      const before = await h.admin.query<{ count: string }>(
        'select count(*) as count from question_quality_reviews where project_id = $1',
        [projectId],
      );
      await flow.setting('ai.model', '');
      const unconfigured = await quality();
      expect(unconfigured.statusCode, unconfigured.body).toBe(409);
      expect(unconfigured.json<{ code: string }>().code).toBe('AI_NOT_CONFIGURED');
      await flow.setting('ai.model', 'fake-standard');
      const after = await h.admin.query<{ count: string }>(
        'select count(*) as count from question_quality_reviews where project_id = $1',
        [projectId],
      );
      expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
    });
  },
);
