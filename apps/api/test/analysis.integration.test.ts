import { randomUUID } from 'node:crypto';

import { questionCategories } from '@docoo/domain';
import { fakeAnalystResponder } from '@docoo/orchestration';
import type { NormalizedModelRequest } from '@docoo/providers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { WorkflowEngineUnavailableError } from '../src/workflow/workflow.engine.js';
import {
  AnalysisDriver,
  type AnalysisView,
  type AnswerBody,
  type BatchView,
} from './support/analysis.js';
import type { TemporalTestRuntime } from './support/harness.js';
import { adminUrl, createHarness, temporalAddress, type Harness } from './support/harness.js';

interface RoundData {
  asked: number;
  capacity: number;
  round: number;
  coverageGaps: string[];
  reviewerFeedback: string[];
  openContradictions: { questions: number[]; description: string }[];
  questionsAndAnswers: {
    number: number;
    status: string;
    note: string | null;
    attachments: { title: string; state: string; excerpt: string | null }[];
  }[];
}

let h: Harness;
let cookie: string;
let temporal: TemporalTestRuntime;
let topicId: string;
let analysis: AnalysisDriver;
let codeCounter = 0;
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;
const captured: NormalizedModelRequest[] = [];

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

async function project(prefix: string): Promise<string> {
  codeCounter += 1;
  const created = await h.request('POST', api('/projects'), {
    cookie,
    payload: {
      code: `${prefix}-${codeCounter}`,
      title: `Project ${prefix}`,
      initialProblem: 'Reduce repeat-customer churn by 20%.',
      topics: [{ topicId }],
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const body = created.json<{ project: { id: string; version: number } }>().project;
  const activated = await h.request('POST', api(`/projects/${body.id}/activate`), {
    cookie,
    payload: { expectedVersion: body.version },
  });
  expect(activated.statusCode, activated.body).toBe(200);
  return body.id;
}

async function projectCommand(projectId: string, command: 'pause' | 'resume') {
  const current = (await h.request('GET', api(`/projects/${projectId}`), { cookie })).json<{
    project: { version: number };
  }>().project;
  const response = await h.request('POST', api(`/projects/${projectId}/${command}`), {
    cookie,
    payload: {
      expectedVersion: current.version,
      ...(command === 'pause' ? { reason: 'Collecting data' } : {}),
    },
  });
  expect(response.statusCode, response.body).toBe(200);
}

function dataOf(request: NormalizedModelRequest): RoundData {
  const content = request.messages[0]?.content ?? '';
  return JSON.parse(/<data>([\s\S]*)<\/data>/u.exec(content)![1]!) as RoundData;
}

/** Unique questions that do not look alike. */
function questions(count: number, from: number) {
  return Array.from({ length: count }, (_, index) => {
    const n = from + index;
    return {
      text: `Question ${n} concerning topic-${n.toString(36)} regarding aspect-${(n * 7919).toString(36)}?`,
      category: questionCategories[n % questionCategories.length]!,
      rationale: 'It informs a decision.',
      followUpOf: 0,
    };
  });
}

function roundOutput(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    understood: 'What is clear so far.',
    nextAmbiguity: 'The next open point.',
    sufficient: false,
    sufficiencyReason: 'More is needed.',
    categoryNotes: [],
    contradictions: [],
    questions: [],
    ...partial,
  };
}

/** Replaces the analyst for the rest of the test; every request is recorded. */
function analyst(script: (data: RoundData) => Record<string, unknown> | null) {
  temporal.fake.responder = (request) => {
    captured.push(request);
    if (request.responseSchema?.name !== 'analysis_round') return null;
    const out = script(dataOf(request));
    return out === null ? fakeAnalystResponder(request) : roundOutput(out);
  };
}

const roundRequests = () =>
  captured.filter((request) => request.responseSchema?.name === 'analysis_round');
const definitionRequests = () =>
  captured.filter((request) => request.responseSchema?.name === 'analysis_output');

const answerAll =
  (status: AnswerBody['status'] = 'answered') =>
  (question: { id: string; number: number }): AnswerBody => ({
    questionId: question.id,
    status,
    ...(status === 'answered' ? { text: `Answer to ${question.number}` } : {}),
  });

async function approve(projectId: string, definition: NonNullable<AnalysisView['definition']>) {
  return h.request(
    'POST',
    api(
      `/projects/${projectId}/stages/${definition.stageRunId}/outputs/${definition.outputId}/approve`,
    ),
    { cookie, payload: {} },
  );
}

async function reject(
  projectId: string,
  definition: NonNullable<AnalysisView['definition']>,
  comment: string,
) {
  return h.request(
    'POST',
    api(
      `/projects/${projectId}/stages/${definition.stageRunId}/outputs/${definition.outputId}/reject`,
    ),
    { cookie, payload: { comment } },
  );
}

const dbCount = async (sql: string, params: unknown[]) =>
  Number((await h.admin.query<{ count: string }>(sql, params)).rows[0]!.count);

describe.skipIf(!adminUrl || !temporalAddress)(
  'analyst questions and answers (ANL-001..006)',
  () => {
    beforeAll(async () => {
      h = await createHarness('analysis', { workflow: true });
      temporal = h.engine as TemporalTestRuntime;
      cookie = await h.login(h.emails.a);
      analysis = new AnalysisDriver(h, cookie, h.ids.workspaceA);
      const topic = await h.request('POST', api('/topics'), {
        cookie,
        payload: { code: 'retail', title: 'Retail' },
      });
      topicId = topic.json<{ topic: { id: string } }>().topic.id;
      const connection = await h.request('POST', api('/provider-connections'), {
        cookie,
        payload: { provider: 'fake', name: 'Deterministic' },
      });
      expect(connection.statusCode, connection.body).toBe(201);
      await setting(
        'ai.connection_id',
        connection.json<{ connection: { id: string } }>().connection.id,
      );
      await setting('ai.model', 'fake-standard');
    }, 60_000);

    // The default analyst is the stack's fake one; every request is recorded for inspection.
    beforeEach(() => {
      captured.length = 0;
      temporal.fake.responder = (request) => {
        captured.push(request);
        return fakeAnalystResponder(request);
      };
    });

    afterEach(() => {
      temporal.fake.responder = fakeAnalystResponder;
      temporal.fakeScript = () => null;
    });

    afterAll(async () => {
      await h?.close();
    });

    it('ANL-001..006: batches, answers, coverage, the problem definition and its approval', async () => {
      const projectId = await project('flow');
      let view = await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');
      expect(view.limits).toEqual({ minimum: 30, maximum: 300, batchSize: 40 });
      expect(view.progress).toMatchObject({
        asked: 20,
        open: 20,
        answered: 0,
        minimumReached: false,
      });
      expect(view.coverage).toHaveLength(10);
      expect(view.coverageGaps).toEqual([]);
      expect(view.understanding).toMatchObject({ round: 1 });

      // The workflow waits for a human; the analyst is not asked again meanwhile.
      const workflow = (
        await h.request('GET', api(`/projects/${projectId}/workflow`), { cookie })
      ).json<{
        workflow: {
          run: { status: string };
          humanTasks: { kind: string; payload: { batchNo: number } }[];
        };
      }>().workflow;
      expect(workflow.run.status).toBe('waiting_for_human');
      expect(workflow.humanTasks).toEqual([
        expect.objectContaining({
          kind: 'analysis_answers',
          payload: expect.objectContaining({ batchNo: 1 }),
        }),
      ]);

      let batches = await analysis.batches(projectId);
      expect(batches).toHaveLength(1);
      const first = batches[0]!;
      expect(first).toMatchObject({ batchNo: 1, status: 'open', round: 1 });
      expect(first.questions.map((question) => question.number)).toEqual(
        Array.from({ length: 20 }, (_, index) => index + 1),
      );
      for (const question of first.questions) {
        expect(question.status).toBe('open');
        expect(question.text.length).toBeGreaterThan(5);
        expect(questionCategories).toContain(question.category);
        expect(question.rationale.length).toBeGreaterThan(5);
        expect(question.answer).toBeNull();
      }

      // Partial answers are saved but do not close the batch.
      const partial = await analysis.answer(first.id, first.questions.slice(0, 5).map(answerAll()));
      expect(partial.statusCode, partial.body).toBe(200);
      expect(partial.json<{ result: Record<string, unknown> }>().result).toMatchObject({
        saved: 5,
        remainingOpen: 15,
        batchStatus: 'open',
        counts: { answered: 5, unanswered: 0, irrelevant: 0, later: 0 },
      });
      expect(
        await dbCount(
          `select count(*) from model_invocations where project_id = $1 and purpose = 'analysis:round'`,
          [projectId],
        ),
      ).toBe(1);

      // The rest, with every special status (FR-ANL-003): the batch is complete.
      const rest = first.questions.slice(5);
      const statuses: AnswerBody['status'][] = [
        ...Array<AnswerBody['status']>(3).fill('later'),
        ...Array<AnswerBody['status']>(2).fill('irrelevant'),
        ...Array<AnswerBody['status']>(2).fill('unanswered'),
      ];
      const closing = await analysis.answer(
        first.id,
        rest.map((question, index) => answerAll(statuses[index] ?? 'answered')(question)),
      );
      expect(closing.statusCode, closing.body).toBe(200);
      expect(closing.json<{ result: Record<string, unknown> }>().result).toMatchObject({
        remainingOpen: 0,
        batchStatus: 'submitted',
        counts: { answered: 8, unanswered: 2, irrelevant: 2, later: 3 },
      });

      // The analyst reads them and opens the second batch: thirty questions are now reached.
      view = await analysis.waitFor(
        projectId,
        (v) => v.phase === 'answering' && v.progress.asked === 40,
        'second batch',
      );
      expect(view.progress).toMatchObject({
        asked: 40,
        answered: 13,
        unanswered: 2,
        irrelevant: 2,
        later: 3,
        open: 20,
        minimumReached: true,
      });
      expect(view.followUps.map((question) => question.number)).toHaveLength(3);
      expect(view.finish.available).toBe(false); // twenty questions are waiting
      batches = await analysis.batches(projectId);
      expect(batches.map((batch) => [batch.batchNo, batch.status])).toEqual([
        [1, 'submitted'],
        [2, 'open'],
      ]);
      expect(batches[1]!.round).toBe(2);
      // The second prompt carried the first answers as data, not as instructions.
      const second = roundRequests()[1]!;
      expect(second.instructions).not.toContain('Answer to');
      expect(
        dataOf(second).questionsAndAnswers.filter((q) => q.status === 'answered'),
      ).toHaveLength(13);

      await analysis.answerOpenBatch(projectId);
      view = await analysis.waitFor(
        projectId,
        (v) => v.phase === 'awaiting_approval',
        'definition',
      );
      const definition = view.definition!;
      expect(definition).toMatchObject({
        versionNo: 1,
        status: 'awaiting_approval',
        approved: false,
      });
      for (const field of [
        'problemStatement',
        'needStatement',
        'objectives',
        'constraints',
        'stakeholders',
        'successCriteria',
        'assumptions',
        'unresolved',
        'glossary',
        'recommendedScope',
        'outOfScope',
      ]) {
        expect(definition.content).toHaveProperty(field);
      }
      // FR-ANL-006: whatever the model wrote, the records name what is still open.
      expect(definition.unresolvedQuestions.map((question) => question.status).sort()).toEqual([
        'later',
        'later',
        'later',
        'unanswered',
        'unanswered',
      ]);

      const rounds = await h.admin.query<{ round_no: number; outcome: string; reason: string }>(
        `select r.round_no, r.outcome, r.reason from analysis_rounds r join analysis_sessions s on s.id = r.session_id
          where s.project_id = $1 order by r.round_no`,
        [projectId],
      );
      expect(rounds.rows).toEqual([
        { round_no: 1, outcome: 'batch', reason: 'minimum' },
        { round_no: 2, outcome: 'batch', reason: 'minimum' },
        { round_no: 3, outcome: 'definition', reason: 'sufficient' },
      ]);
      const gate = (
        await h.request('GET', api(`/projects/${projectId}/workflow`), { cookie })
      ).json<{ workflow: { humanTasks: { kind: string }[] } }>().workflow;
      expect(gate.humanTasks.map((task) => task.kind)).toEqual(['gate_review']);

      // Approval closes the analysis and pins the definition on the project (FR-ANL-005).
      const approved = await approve(projectId, definition);
      expect(approved.statusCode, approved.body).toBe(200);
      view = await analysis.waitFor(projectId, (v) => v.phase === 'approved', 'approval');
      expect(view.definition).toMatchObject({ status: 'approved', approved: true });
      const detail = (await h.request('GET', api(`/projects/${projectId}`), { cookie })).json<{
        project: { approvedProblemVersionId: string | null };
      }>().project;
      expect(detail.approvedProblemVersionId).toBe(definition.outputId);
      const definitions = (
        await h.request('GET', api(`/projects/${projectId}/problem-definitions`), { cookie })
      ).json<{
        definitions: { outputId: string; status: string; approved: boolean; runNo: number }[];
        approvedOutputId: string;
      }>();
      expect(definitions.approvedOutputId).toBe(definition.outputId);
      expect(definitions.definitions).toEqual([
        expect.objectContaining({
          outputId: definition.outputId,
          status: 'approved',
          approved: true,
          runNo: 1,
        }),
      ]);

      // The record shows who did what, without the content of the answers.
      const audit = await h.admin.query<{ action: string; after: Record<string, unknown> | null }>(
        `select action, after from audit_events where project_id = $1 and action like 'analysis.%' order by occurred_at`,
        [projectId],
      );
      const actions = audit.rows.map((row) => row.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'analysis.batch_opened',
          'analysis.answers_saved',
          'analysis.batch_submitted',
          'analysis.ready_to_define',
          'analysis.definition_approved',
        ]),
      );
      expect(JSON.stringify(audit.rows)).not.toContain('Answer to');
    }, 120_000);

    it('ANL-003: answers are validated, saved all or nothing and replayed by Idempotency-Key', async () => {
      const projectId = await project('atomic');
      await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');
      const batch = (await analysis.batches(projectId))[0]!;
      const [q1, q2, q3, q4] = batch.questions as [
        BatchView['questions'][number],
        BatchView['questions'][number],
        BatchView['questions'][number],
        BatchView['questions'][number],
      ];
      const saved = () =>
        dbCount(`select count(*) from analysis_answers where project_id = $1`, [projectId]);

      // One bad answer rejects the whole request and saves nothing.
      const mixed = await analysis.answer(batch.id, [
        answerAll()(q1),
        answerAll()(q2),
        { questionId: q3.id, status: 'answered', text: '   ' },
      ]);
      expect(mixed.statusCode).toBe(422);
      expect(mixed.json<{ code: string; number: number }>()).toMatchObject({
        code: 'ANSWER_EMPTY',
        number: 3,
      });
      expect(await saved()).toBe(0);
      expect((await analysis.overview(projectId)).progress.open).toBe(20);

      const cases: [string, AnswerBody[], number, string][] = [
        [
          'too long',
          [{ questionId: q1.id, status: 'answered', text: 'x'.repeat(8001) }],
          422,
          'ANSWER_TOO_LONG',
        ],
        [
          'file with a status',
          [{ questionId: q1.id, status: 'later', attachments: [{ sourceId: randomUUID() }] }],
          422,
          'ANSWER_STATUS_HAS_ATTACHMENTS',
        ],
        [
          'six files',
          [
            {
              questionId: q1.id,
              status: 'answered',
              attachments: Array.from({ length: 6 }, () => ({ sourceId: randomUUID() })),
            },
          ],
          422,
          'ANSWER_TOO_MANY_ATTACHMENTS',
        ],
        [
          'a question of nowhere',
          [{ questionId: randomUUID(), status: 'later' }],
          422,
          'ANALYSIS_QUESTION_NOT_IN_BATCH',
        ],
        [
          'the same question twice',
          [answerAll()(q1), answerAll()(q1)],
          400,
          'ANALYSIS_INVALID_REQUEST',
        ],
        ['no answers', [], 400, 'ANALYSIS_INVALID_REQUEST'],
        [
          'too many answers',
          Array.from({ length: 41 }, () => ({
            questionId: randomUUID(),
            status: 'later' as const,
          })),
          400,
          'ANALYSIS_INVALID_REQUEST',
        ],
        [
          'an unknown status',
          [{ questionId: q1.id, status: 'maybe' as unknown as 'later' }],
          400,
          'ANALYSIS_INVALID_REQUEST',
        ],
      ];
      for (const [label, answers, status, code] of cases) {
        const response = await analysis.answer(batch.id, answers);
        expect(response.statusCode, `${label}: ${response.body}`).toBe(status);
        expect(response.json<{ code: string }>().code, label).toBe(code);
      }
      const extra = await h.request('POST', api(`/question-batches/${batch.id}/answers`), {
        cookie,
        payload: { answers: [answerAll()(q1)], surprise: true },
      });
      expect(extra.statusCode).toBe(400);
      const badKey = await analysis.answer(batch.id, [answerAll()(q1)], 'short');
      expect(badKey.statusCode).toBe(400);
      expect(await saved()).toBe(0);

      // A repeated command with the same key is replayed without a second revision.
      const key = 'answers-key-0001';
      const first = await analysis.answer(batch.id, [answerAll()(q1), answerAll()(q2)], key);
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json<{ result: { replayed: boolean } }>().result.replayed).toBe(false);
      const again = await analysis.answer(batch.id, [answerAll()(q1), answerAll()(q2)], key);
      expect(again.statusCode).toBe(200);
      expect(again.json<{ result: { replayed: boolean; saved: number } }>().result).toMatchObject({
        replayed: true,
        saved: 2,
      });
      expect(await saved()).toBe(2);
      const reused = await analysis.answer(batch.id, [answerAll()(q3)], key);
      expect(reused.statusCode).toBe(409);
      expect(reused.json<{ code: string }>().code).toBe('IDEMPOTENCY_KEY_REUSED');

      // Changing an answer in the open batch adds a revision; the history stays.
      const revised = await analysis.answer(batch.id, [{ questionId: q4.id, status: 'later' }]);
      expect(revised.statusCode).toBe(200);
      const changed = await analysis.answer(batch.id, [
        { questionId: q4.id, status: 'answered', text: 'Now I know' },
      ]);
      expect(changed.statusCode).toBe(200);
      const after = (await analysis.batches(projectId))[0]!.questions.find((q) => q.id === q4.id)!;
      expect(after).toMatchObject({ status: 'answered' });
      expect(after.answer).toMatchObject({ revisionNo: 2, text: 'Now I know' });
      const history = await h.admin.query<{ revision_no: number; status: string }>(
        'select revision_no, status from analysis_answers where question_id = $1 order by revision_no',
        [q4.id],
      );
      expect(history.rows).toEqual([
        { revision_no: 1, status: 'later' },
        { revision_no: 2, status: 'answered' },
      ]);
    }, 90_000);

    it('ANL-003: questions left for later stay answerable after their batch closed', async () => {
      const projectId = await project('later');
      await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');
      const batch = (await analysis.batches(projectId))[0]!;
      const closing = await analysis.answer(
        batch.id,
        batch.questions.map((question, index) =>
          index < 3 ? answerAll('later')(question) : answerAll()(question),
        ),
      );
      expect(closing.statusCode, closing.body).toBe(200);
      let view = await analysis.waitFor(
        projectId,
        (v) => v.phase === 'answering' && v.progress.asked === 40,
        'second batch',
      );
      expect(view.followUps).toHaveLength(3);

      // An answered question of a closed batch is closed.
      const closed = await analysis.answer(batch.id, [answerAll()(batch.questions[5]!)]);
      expect(closed.statusCode).toBe(409);
      expect(closed.json<{ code: string; number: number }>()).toMatchObject({
        code: 'ANALYSIS_QUESTION_CLOSED',
        number: 6,
      });
      // A later one can still be answered; the batch stays closed and the analyst is not signalled again.
      const late = await analysis.answer(batch.id, [
        {
          questionId: batch.questions[0]!.id,
          status: 'answered',
          text: 'Late answer from finance',
        },
      ]);
      expect(late.statusCode, late.body).toBe(200);
      expect(late.json<{ result: { batchStatus: string } }>().result.batchStatus).toBe('submitted');
      view = await analysis.overview(projectId);
      expect(view.followUps).toHaveLength(2);
      expect(view.progress.later).toBe(2);

      // The definition is written with the late answer.
      await analysis.answerOpenBatch(projectId);
      await analysis.waitFor(projectId, (v) => v.phase === 'awaiting_approval', 'definition');
      const prompt = definitionRequests().at(-1)!;
      expect(prompt.messages[0]!.content).toContain('Late answer from finance');
    }, 90_000);

    it('ANL-002: the analyst cannot finish below thirty questions or with open ones; finishing skips more questions', async () => {
      analyst((data) =>
        data.asked === 0 ? { questions: questions(35, 0) } : { sufficient: true },
      );
      const projectId = await project('finish');
      await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');
      const batch = (await analysis.batches(projectId))[0]!;
      expect(batch.questions).toHaveLength(35);

      const open = await analysis.finish(projectId);
      expect(open.statusCode).toBe(409);
      expect(open.json<{ code: string; open: number }>()).toMatchObject({
        code: 'ANALYSIS_ANSWERS_PENDING',
        open: 35,
      });
      const short = await analysis.finish(projectId, 'no');
      expect(short.statusCode).toBe(400);

      // Hold the analyst while the batch is answered, then ask for the definition.
      await projectCommand(projectId, 'pause');
      const answered = await analysis.answer(batch.id, batch.questions.map(answerAll()));
      expect(answered.statusCode, answered.body).toBe(200);
      let view = await analysis.overview(projectId);
      expect(view.progress).toMatchObject({ asked: 35, open: 0, minimumReached: true });
      expect(view.finish).toMatchObject({ available: true, requested: false });

      const finished = await analysis.finish(
        projectId,
        'The picture is clear enough.',
        'finish-key-0001',
      );
      expect(finished.statusCode, finished.body).toBe(200);
      expect(finished.json<{ result: { finishRequested: boolean } }>().result.finishRequested).toBe(
        true,
      );
      const repeated = await analysis.finish(
        projectId,
        'The picture is clear enough.',
        'finish-key-0001',
      );
      expect(repeated.json<{ result: { replayed: boolean } }>().result.replayed).toBe(true);
      view = await analysis.overview(projectId);
      expect(view.finish).toMatchObject({
        requested: true,
        available: false,
        reason: 'The picture is clear enough.',
      });

      await projectCommand(projectId, 'resume');
      await analysis.waitFor(projectId, (v) => v.phase === 'awaiting_approval', 'definition');
      const rounds = await h.admin.query<{
        round_no: number;
        reason: string;
        invocation_id: string | null;
      }>(
        `select r.round_no, r.reason, r.invocation_id from analysis_rounds r join analysis_sessions s on s.id = r.session_id
          where s.project_id = $1 order by r.round_no`,
        [projectId],
      );
      // The second round handed over without asking the model.
      expect(rounds.rows).toEqual([
        { round_no: 1, reason: 'minimum', invocation_id: expect.any(String) },
        { round_no: 2, reason: 'finish_requested', invocation_id: null },
      ]);
      expect(roundRequests()).toHaveLength(1);
      const audit = await h.admin.query<{ reason: string }>(
        `select reason from audit_events where project_id = $1 and action = 'analysis.finish_requested'`,
        [projectId],
      );
      expect(audit.rows).toEqual([{ reason: 'The picture is clear enough.' }]);

      const after = await analysis.finish(projectId);
      expect(after.statusCode).toBe(409);
      expect(after.json<{ code: string }>().code).toBe('ANALYSIS_AWAITING_APPROVAL');
    }, 90_000);

    it('ANL-001: a batch never holds more than forty questions and repeated questions are dropped', async () => {
      const repeated = questions(1, 5)[0]!;
      analyst((data) =>
        data.asked === 0
          ? {
              questions: [
                ...questions(30, 0),
                repeated,
                { ...repeated, text: `${repeated.text}!` },
                ...questions(30, 100),
              ],
            }
          : { sufficient: true },
      );
      const projectId = await project('cap');
      await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');
      const batch = (await analysis.batches(projectId))[0]!;
      expect(batch.questions).toHaveLength(40);
      const texts = batch.questions.map((question) => question.text);
      expect(new Set(texts).size).toBe(40);
      expect(texts.filter((text) => text.startsWith('Question 5 '))).toHaveLength(1);
      expect(
        await dbCount(`select count(*) from analysis_questions where project_id = $1`, [projectId]),
      ).toBe(40);
    }, 60_000);

    it('ANL-002: an eager analyst cannot end the analysis before thirty questions; a round with nothing new pauses the project for a human', async () => {
      let call = 0;
      analyst((data) => {
        call += 1;
        if (data.asked === 0) return { sufficient: true, questions: questions(10, 0) };
        // Only repeats of earlier questions while twenty are still missing.
        if (call === 2) return { sufficient: true, questions: questions(10, 0) };
        if (data.asked === 10) return { sufficient: true, questions: questions(25, 200) };
        return { sufficient: true };
      });
      const projectId = await project('eager');
      await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');
      expect((await analysis.batches(projectId))[0]!.questions).toHaveLength(10);
      await analysis.answerOpenBatch(projectId);

      // Round 2 brought nothing new at ten questions: the project is paused with a task.
      const stalled = await h.admin.query<{ payload: { code: string }; status: string }>(
        `select payload, status from human_tasks where project_id = $1 and kind = 'provider_failure'`,
        [projectId],
      );
      const deadline = Date.now() + 20_000;
      let task = stalled.rows[0];
      while (!task && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        task = (
          await h.admin.query<{ payload: { code: string }; status: string }>(
            `select payload, status from human_tasks where project_id = $1 and kind = 'provider_failure'`,
            [projectId],
          )
        ).rows[0];
      }
      expect(task?.payload.code).toBe('analysis_no_new_questions');
      const paused = (await h.request('GET', api(`/projects/${projectId}`), { cookie })).json<{
        project: { status: string; version: number };
      }>().project;
      expect(paused.status).toBe('paused');
      expect((await analysis.overview(projectId)).progress.asked).toBe(10);

      // Resumed, the analyst asks the missing questions; only then can it be satisfied.
      await projectCommand(projectId, 'resume');
      const view = await analysis.waitFor(
        projectId,
        (v) => v.phase === 'answering' && v.progress.asked === 35,
        'questions up to thirty-five',
      );
      expect(view.progress.minimumReached).toBe(true);
      await analysis.answerOpenBatch(projectId);
      await analysis.waitFor(projectId, (v) => v.phase === 'awaiting_approval', 'definition');
    }, 90_000);

    it('ANL-004: an administrator may also require the risk and out-of-scope dimensions', async () => {
      // Questions that avoid both optional dimensions.
      const plain = (count: number, from: number) =>
        questions(count, from).map((item, index) => ({
          ...item,
          category: questionCategories[index % 8]!,
        }));
      const firstRound = (projectId: string) =>
        analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');

      // Off (the default): the eight required dimensions are all there is to ask about.
      analyst((data) => (data.asked === 0 ? { questions: plain(10, 0) } : null));
      const relaxed = await project('dims-off');
      const relaxedView = await firstRound(relaxed);
      expect(
        relaxedView.coverage.filter((entry) => entry.required).map((entry) => entry.category),
      ).toEqual(questionCategories.slice(0, 8));
      expect(relaxedView.coverageGaps).not.toContain('risk');

      // On: risk and out of scope are required too, the overview says so and the analyst is told.
      await setting('analysis.require_risk_dimension', true);
      await setting('analysis.require_out_of_scope_dimension', true);
      try {
        captured.length = 0;
        const strict = await project('dims-on');
        const strictView = await firstRound(strict);
        expect(
          strictView.coverage.filter((entry) => entry.required).map((entry) => entry.category),
        ).toEqual([...questionCategories.slice(0, 8), 'risk', 'out_of_scope']);
        expect(strictView.coverageGaps).toEqual(expect.arrayContaining(['risk', 'out_of_scope']));
        expect(roundRequests().map(dataOf)[0]!.coverageGaps).toEqual(
          expect.arrayContaining(['risk', 'out_of_scope']),
        );
      } finally {
        await setting('analysis.require_risk_dimension', false);
        await setting('analysis.require_out_of_scope_dimension', false);
      }
    }, 90_000);

    it('AI-005: every analyst call carries an output limit and, with no entered price, is estimated high', async () => {
      const projectId = await project('limits');
      await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');
      const requests = roundRequests();
      expect(requests.length).toBeGreaterThan(0);
      // The provider's own default would cut a long structured answer at 4096 tokens.
      for (const request of requests) expect(request.maxOutputTokens).toBe(16_000);

      const invocations = await h.request('GET', api(`/model-invocations?projectId=${projectId}`), {
        cookie,
      });
      const [first] = invocations.json<{
        items: { status: string; priced: boolean; costUsd: number | null }[];
      }>().items;
      expect(first).toMatchObject({ status: 'succeeded', priced: false });
      expect(first!.costUsd).toBeGreaterThan(0); // never free: the ceiling must keep counting
      const usage = await h.request('GET', api(`/projects/${projectId}/usage`), { cookie });
      expect(
        usage.json<{ usage: { totals: { unpricedInvocations: number } } }>().usage.totals
          .unpricedInvocations,
      ).toBeGreaterThan(0);
    }, 90_000);

    it('ANL-002: the analysis stops at three hundred questions in batches of forty', async () => {
      analyst((data) => ({ questions: questions(data.capacity, data.asked) }));
      const projectId = await project('ceiling');
      const view = await analysis.reachDefinition(projectId, { maxBatches: 8, timeoutMs: 100_000 });
      expect(view.progress).toMatchObject({ asked: 300, maximumReached: true, open: 0 });
      const batches = await analysis.batches(projectId);
      expect(batches.map((batch) => batch.questions.length)).toEqual([
        40, 40, 40, 40, 40, 40, 40, 20,
      ]);
      expect(Math.max(...batches.map((batch) => batch.questions.length))).toBeLessThanOrEqual(40);
      const rounds = await h.admin.query<{
        round_no: number;
        reason: string;
        invocation_id: string | null;
      }>(
        `select r.round_no, r.reason, r.invocation_id from analysis_rounds r join analysis_sessions s on s.id = r.session_id
          where s.project_id = $1 order by r.round_no desc limit 1`,
        [projectId],
      );
      expect(rounds.rows[0]).toEqual({
        round_no: 9,
        reason: 'maximum_reached',
        invocation_id: null,
      });
      expect(roundRequests()).toHaveLength(8);
      // The ordinals run 1..300 without a gap.
      const ordinals = await h.admin.query<{ ordinal: number }>(
        `select ordinal from analysis_questions where project_id = $1 order by ordinal`,
        [projectId],
      );
      expect(ordinals.rows.map((row) => row.ordinal)).toEqual(
        Array.from({ length: 300 }, (_, i) => i + 1),
      );
    }, 150_000);

    it('ANL-004: contradictions are logged against both questions and resolved when the analyst drops them', async () => {
      analyst((data) => {
        if (data.asked === 0) return { questions: questions(20, 0) };
        if (data.asked === 20) {
          return {
            questions: questions(15, 20),
            contradictions: [
              {
                questionNumbers: [3, 1],
                description: 'The deadline conflicts with the team size.',
              },
            ],
          };
        }
        return { sufficient: true };
      });
      const projectId = await project('conflict');
      await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');
      await analysis.answerOpenBatch(projectId);
      let view = await analysis.waitFor(
        projectId,
        (v) => v.phase === 'answering' && v.progress.asked === 35,
        'second batch',
      );
      expect(view.contradictions).toEqual([
        expect.objectContaining({
          questions: [1, 3],
          status: 'open',
          description: 'The deadline conflicts with the team size.',
        }),
      ]);
      await analysis.answerOpenBatch(projectId);
      view = await analysis.waitFor(
        projectId,
        (v) => v.phase === 'awaiting_approval',
        'definition',
      );
      expect(view.contradictions).toEqual([
        expect.objectContaining({ questions: [1, 3], status: 'resolved' }),
      ]);
      // Nothing is open any more, so the definition prompt names no contradiction.
      expect(dataOf(roundRequests().at(-1)!).openContradictions).toEqual([
        expect.objectContaining({ questions: [1, 3] }),
      ]);
      const prompt = JSON.parse(
        /<data>([\s\S]*)<\/data>/u.exec(definitionRequests().at(-1)!.messages[0]!.content)![1]!,
      ) as { openContradictions: unknown[]; coverage: unknown[] };
      expect(prompt.openContradictions).toEqual([]);
      expect(prompt.coverage).toHaveLength(10);
    }, 90_000);

    it('ANL-005: a rejected definition goes back to the analyst, who redefines it or asks more', async () => {
      const projectId = await project('rejected');
      let view = await analysis.reachDefinition(projectId);
      const first = view.definition!;
      expect(first.versionNo).toBe(1);
      // A finish request does not survive a rejection: the analyst may ask more again.
      await h.admin.query(
        `update analysis_sessions set finish_requested_at = now(), finish_reason = 'Enough' where project_id = $1`,
        [projectId],
      );
      const rejected = await reject(projectId, first, 'Add the budget details');
      expect(rejected.statusCode, rejected.body).toBe(200);

      view = await analysis.waitFor(
        projectId,
        (v) => v.phase === 'awaiting_approval' && v.definition?.outputId !== first.outputId,
        'second definition',
      );
      expect(view.definition).toMatchObject({ versionNo: 2, status: 'awaiting_approval' });
      expect(view.finish.requested).toBe(false);
      const feedback = dataOf(roundRequests().at(-1)!).reviewerFeedback;
      expect(feedback).toEqual(['Add the budget details']);
      const listed = (
        await h.request('GET', api(`/projects/${projectId}/problem-definitions`), { cookie })
      ).json<{ definitions: { outputId: string; versionNo: number; status: string }[] }>()
        .definitions;
      expect(listed.map((entry) => [entry.versionNo, entry.status])).toEqual([
        [2, 'awaiting_approval'],
        [1, 'rejected'],
      ]);
      expect(
        await dbCount(
          `select count(*) from analysis_rounds r join analysis_sessions s on s.id = r.session_id where s.project_id = $1`,
          [projectId],
        ),
      ).toBe(4);

      // A second rejection, this time the analyst has more to ask.
      analyst((data) =>
        data.reviewerFeedback.length > 1 && data.asked === 40
          ? { questions: questions(5, 500) }
          : { sufficient: true },
      );
      const again = await reject(projectId, view.definition!, 'Still missing the rollout plan');
      expect(again.statusCode, again.body).toBe(200);
      view = await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'more questions');
      expect(view.progress).toMatchObject({ asked: 45, open: 5 });
      const finalView = await analysis.reachDefinition(projectId);
      expect(finalView.definition).toMatchObject({ versionNo: 3, status: 'awaiting_approval' });
      expect((await approve(projectId, finalView.definition!)).statusCode).toBe(200);
      view = await analysis.waitFor(projectId, (v) => v.phase === 'approved', 'approval');
      expect(view.definition).toMatchObject({ versionNo: 3, approved: true });
    }, 120_000);

    it('ANL-003: files can be answers; they are read by the analyst and must be usable', async () => {
      analyst((data) =>
        data.asked === 0 ? { questions: questions(32, 0) } : { sufficient: true },
      );
      const projectId = await project('files');
      await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');
      const batch = (await analysis.batches(projectId))[0]!;

      const source = await h.request('POST', api('/sources/text'), {
        cookie,
        payload: {
          title: 'Churn survey',
          text: 'Churn rose to 14% in the last quarter, mostly among new customers.',
          language: 'en',
          scope: { type: 'project', id: projectId },
        },
      });
      expect(source.statusCode, source.body).toBe(202);
      const sourceId = source.json<{ source: { id: string } }>().source.id;

      const unknown = await analysis.answer(batch.id, [
        {
          questionId: batch.questions[0]!.id,
          status: 'answered',
          attachments: [{ sourceId: randomUUID() }],
        },
      ]);
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json<{ code: string }>().code).toBe('ANALYSIS_ATTACHMENT_NOT_FOUND');
      const elsewhere = await h.request('POST', api('/sources/text'), {
        cookie,
        payload: {
          title: 'Workspace note',
          text: 'Not part of this project.',
          language: 'en',
          scope: { type: 'workspace', id: h.ids.workspaceA },
        },
      });
      const other = await analysis.answer(batch.id, [
        {
          questionId: batch.questions[0]!.id,
          status: 'answered',
          attachments: [{ sourceId: elsewhere.json<{ source: { id: string } }>().source.id }],
        },
      ]);
      expect(other.statusCode).toBe(404);
      const declared = await h.request('POST', api('/sources/uploads'), {
        cookie,
        payload: {
          title: 'Not uploaded yet',
          filename: 'notes.txt',
          mime: 'text/plain',
          size: 10,
          sha256: 'a'.repeat(64),
          scope: { type: 'project', id: projectId },
        },
      });
      expect(declared.statusCode, declared.body).toBe(201);
      const notReady = await analysis.answer(batch.id, [
        {
          questionId: batch.questions[0]!.id,
          status: 'answered',
          attachments: [{ sourceId: declared.json<{ source: { id: string } }>().source.id }],
        },
      ]);
      expect(notReady.statusCode).toBe(409);
      expect(notReady.json<{ code: string }>().code).toBe('ANALYSIS_ATTACHMENT_NOT_READY');

      const spoiled = await h.request('POST', api('/sources/text'), {
        cookie,
        payload: {
          title: 'Spoiled',
          text: 'Pretend this was infected.',
          language: 'en',
          scope: { type: 'project', id: projectId },
        },
      });
      const spoiledId = spoiled.json<{ source: { id: string } }>().source.id;
      await h.admin.query(`update source_versions set status = 'rejected' where asset_id = $1`, [
        spoiledId,
      ]);
      const unusable = await analysis.answer(batch.id, [
        {
          questionId: batch.questions[0]!.id,
          status: 'answered',
          attachments: [{ sourceId: spoiledId }],
        },
      ]);
      expect(unusable.statusCode).toBe(409);
      expect(unusable.json<{ code: string }>().code).toBe('ANALYSIS_ATTACHMENT_UNUSABLE');

      // The good file: a text note with it, and the analyst reads its content as data.
      const good = await analysis.answer(
        batch.id,
        batch.questions.map((question, index) =>
          index === 0
            ? {
                questionId: question.id,
                status: 'answered' as const,
                text: 'See the survey.',
                attachments: [{ sourceId }],
              }
            : answerAll()(question),
        ),
      );
      expect(good.statusCode, good.body).toBe(200);
      const stored = (await analysis.batches(projectId))[0]!.questions[0]!;
      expect(stored.answer?.attachments).toEqual([
        expect.objectContaining({ sourceId, title: 'Churn survey' }),
      ]);
      await analysis.waitFor(projectId, (v) => v.phase === 'awaiting_approval', 'definition');
      const read = dataOf(roundRequests()[1]!).questionsAndAnswers[0]!;
      expect(read.attachments).toEqual([
        expect.objectContaining({
          title: 'Churn survey',
          state: 'processed',
          excerpt: expect.stringContaining('Churn rose to 14%'),
        }),
      ]);
    }, 90_000);

    it('ANL-005: only the owner workspace can read or answer; the state of the analysis limits what is accepted', async () => {
      const projectId = await project('private');
      await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');
      const batch = (await analysis.batches(projectId))[0]!;
      const cookieB = await h.login(h.emails.b);
      const asB = (suffix: string) => `/v1/workspaces/${h.ids.workspaceB}${suffix}`;

      const read = await h.request('GET', asB(`/projects/${projectId}/analysis`), {
        cookie: cookieB,
      });
      expect(read.statusCode).toBe(404);
      const list = await h.request('GET', asB(`/projects/${projectId}/analysis/question-batches`), {
        cookie: cookieB,
      });
      expect(list.statusCode).toBe(404);
      const write = await h.request('POST', asB(`/question-batches/${batch.id}/answers`), {
        cookie: cookieB,
        payload: { answers: [answerAll()(batch.questions[0]!)] },
      });
      expect(write.statusCode).toBe(404);
      expect(write.json<{ code: string }>().code).toBe('ANALYSIS_BATCH_NOT_FOUND');
      const foreign = await h.request('GET', api(`/projects/${projectId}/analysis`), {
        cookie: cookieB,
      });
      expect(foreign.statusCode).toBe(404);
      const anonymous = await h.request('GET', api(`/projects/${projectId}/analysis`));
      expect(anonymous.statusCode).toBe(401);
      expect(
        (await h.request('GET', api('/projects/not-a-uuid/analysis'), { cookie })).statusCode,
      ).toBe(400);
      expect(
        (await h.request('GET', api(`/projects/${randomUUID()}/analysis`), { cookie })).statusCode,
      ).toBe(404);

      // Cancelling the run closes the analysis for answers.
      const cancelled = await h.request('POST', api(`/projects/${projectId}/workflow/cancel`), {
        cookie,
        payload: { reason: 'Scope changed' },
      });
      expect(cancelled.statusCode).toBe(202);
      const view = await analysis.waitFor(projectId, (v) => v.phase === 'cancelled', 'cancelled');
      expect(view.openBatchId).not.toBeNull();
      const late = await analysis.answer(batch.id, [answerAll()(batch.questions[0]!)]);
      expect(late.statusCode).toBe(409);
      expect(late.json<{ code: string }>().code).toBe('ANALYSIS_CLOSED');
    }, 60_000);

    it('ANL-003: answers wait for the definition decision and the closed analysis refuses more', async () => {
      const projectId = await project('closed');
      const view = await analysis.reachDefinition(projectId);
      const batch = (await analysis.batches(projectId))[0]!;
      const awaiting = await analysis.answer(batch.id, [
        { questionId: batch.questions[0]!.id, status: 'later' },
      ]);
      expect(awaiting.statusCode).toBe(409);
      expect(awaiting.json<{ code: string }>().code).toBe('ANALYSIS_AWAITING_APPROVAL');
      expect((await approve(projectId, view.definition!)).statusCode).toBe(200);
      await analysis.waitFor(projectId, (v) => v.phase === 'approved', 'approval');
      const closed = await analysis.answer(batch.id, [
        { questionId: batch.questions[0]!.id, status: 'later' },
      ]);
      expect(closed.statusCode).toBe(409);
      expect(closed.json<{ code: string }>().code).toBe('ANALYSIS_CLOSED');
    }, 60_000);

    it('WF-004: a lost signal is made up by workflow/sync and a worker restart loses no answers', async () => {
      const projectId = await project('resilient');
      await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');
      let batch = (await analysis.batches(projectId))[0]!;

      // The engine is unreachable when the batch is completed: the answers are kept.
      const original = temporal.signal.bind(temporal);
      temporal.signal = (workflowId, name, payload) =>
        name === 'answers'
          ? Promise.reject(new WorkflowEngineUnavailableError('temporal_signal_failed'))
          : original(workflowId, name, payload);
      const lost = await analysis.answer(batch.id, batch.questions.map(answerAll()));
      temporal.signal = original;
      expect(lost.statusCode).toBe(503);
      expect(lost.json<{ code: string }>().code).toBe('WORKFLOW_ENGINE_UNAVAILABLE');
      const kept = await analysis.overview(projectId);
      expect(kept.progress).toMatchObject({ asked: 20, answered: 20, open: 0 });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect((await analysis.overview(projectId)).progress.asked).toBe(20);

      const sync = await h.request('POST', api(`/projects/${projectId}/workflow/sync`), { cookie });
      expect(sync.statusCode, sync.body).toBe(202);
      await analysis.waitFor(
        projectId,
        (v) => v.phase === 'answering' && v.progress.asked === 40,
        'second batch after sync',
      );

      // The worker is gone while the second batch is answered; nothing is lost.
      batch = (await analysis.batches(projectId)).find((item) => item.status === 'open')!;
      await temporal.stopWorker();
      const answered = await analysis.answer(batch.id, batch.questions.map(answerAll()));
      expect(answered.statusCode, answered.body).toBe(200);
      await temporal.startWorker();
      await analysis.waitFor(
        projectId,
        (v) => v.phase === 'awaiting_approval',
        'definition after restart',
      );
    }, 90_000);

    it('REL: the tables refuse invalid or cross-tenant rows and keep history append-only', async () => {
      const projectId = await project('integrity');
      await analysis.waitFor(projectId, (v) => v.phase === 'answering', 'first batch');
      const batch = (await analysis.batches(projectId))[0]!;
      await analysis.answer(batch.id, [
        { questionId: batch.questions[0]!.id, status: 'later', text: 'ask finance' },
      ]);
      const row = (
        await h.admin.query<{
          session_id: string;
          workspace_id: string;
          round_id: string;
          stage_run_id: string;
        }>(
          `select b.session_id, b.workspace_id, b.round_id, b.stage_run_id from question_batches b where b.id = $1`,
          [batch.id],
        )
      ).rows[0]!;
      const sqlState = async (sql: string, params: unknown[] = []) => {
        try {
          await h.admin.query(sql, params);
          return 'ok';
        } catch (error) {
          return (error as { code?: string }).code ?? 'unknown';
        }
      };

      // History is append-only (rounds, answers).
      expect(
        await sqlState(`update analysis_answers set text = 'x' where project_id = $1`, [projectId]),
      ).toBe('P0001');
      expect(await sqlState(`delete from analysis_rounds where id = $1`, [row.round_id])).toBe(
        'P0001',
      );
      // Values are checked.
      expect(
        await sqlState(`update analysis_sessions set batch_size = 41 where id = $1`, [
          row.session_id,
        ]),
      ).toBe('23514');
      expect(
        await sqlState(`update analysis_sessions set maximum_questions = 301 where id = $1`, [
          row.session_id,
        ]),
      ).toBe('23514');
      expect(
        await sqlState(
          `insert into analysis_answers (workspace_id, project_id, question_id, revision_no, status, text, submission_id)
           values ($1, $2, $3, 99, 'answered', '   ', gen_random_uuid())`,
          [row.workspace_id, projectId, batch.questions[1]!.id],
        ),
      ).toBe('23514');
      expect(
        await sqlState(
          `insert into analysis_answers (workspace_id, project_id, question_id, revision_no, status, text, attachments, submission_id)
           values ($1, $2, $3, 98, 'later', null, '[{"sourceId":"x"}]'::jsonb, gen_random_uuid())`,
          [row.workspace_id, projectId, batch.questions[1]!.id],
        ),
      ).toBe('23514');
      expect(
        await sqlState(`update analysis_questions set category = 'mood' where id = $1`, [
          batch.questions[2]!.id,
        ]),
      ).toBe('23514');
      expect(
        await sqlState(`update analysis_questions set status = 'answered' where id = $1`, [
          batch.questions[2]!.id,
        ]),
      ).toBe('23514'); // an answered question must point at its answer
      // One open batch per analysis.
      expect(
        await sqlState(
          `insert into question_batches (workspace_id, project_id, session_id, stage_run_id, round_id, batch_no)
           values ($1, $2, $3, $4, $5, 2)`,
          [row.workspace_id, projectId, row.session_id, row.stage_run_id, row.round_id],
        ),
      ).toBe('23505');
      // Rows cannot point across workspaces.
      expect(
        await sqlState(
          `insert into analysis_questions (workspace_id, project_id, session_id, batch_id, ordinal, category, text)
           values ($1, $2, $3, $4, 299, 'goal', 'Across tenants?')`,
          [h.ids.workspaceB, projectId, row.session_id, batch.id],
        ),
      ).toBe('23503');
    }, 60_000);
  },
);
