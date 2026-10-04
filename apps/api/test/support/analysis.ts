import { expect } from 'vitest';

import type { Harness } from './harness.js';

export interface AnalysisQuestionView {
  id: string;
  number: number;
  batchId: string;
  batchNo: number;
  category: string;
  text: string;
  rationale: string;
  status: string;
  followUpOf: number | null;
  answer: { id: string; revisionNo: number; text: string | null; attachments: unknown[] } | null;
}

export interface AnalysisView {
  runId: string | null;
  stageRunId: string | null;
  phase: string;
  limits: { minimum: number; maximum: number; batchSize: number };
  progress: {
    asked: number;
    answered: number;
    unanswered: number;
    irrelevant: number;
    later: number;
    open: number;
    minimumReached: boolean;
    maximumReached: boolean;
  };
  coverage: { category: string; required: boolean; asked: number; level: string }[];
  coverageGaps: string[];
  openBatchId: string | null;
  finish: { requested: boolean; available: boolean; reason: string | null };
  understanding: {
    round: number;
    understood: string;
    nextAmbiguity: string;
    sufficient: boolean;
  } | null;
  contradictions: {
    id: string;
    questions: [number, number];
    description: string;
    status: string;
  }[];
  followUps: AnalysisQuestionView[];
  definition: {
    outputId: string;
    stageRunId: string;
    versionNo: number;
    status: string;
    approved: boolean;
    content: Record<string, unknown>;
    unresolvedQuestions: { number: number; status: string; text: string }[];
  } | null;
}

export interface BatchView {
  id: string;
  batchNo: number;
  status: string;
  round: number;
  reason: string;
  understood: string | null;
  questions: AnalysisQuestionView[];
}

export interface AnswerBody {
  questionId: string;
  status: 'answered' | 'unanswered' | 'irrelevant' | 'later';
  text?: string;
  attachments?: { sourceId: string }[];
}

/** An administrator's view of the analysis API for one workspace. */
export class AnalysisDriver {
  constructor(
    private readonly h: Harness,
    private readonly cookie: string,
    private readonly workspaceId: string,
  ) {}

  api(suffix: string): string {
    return `/v1/workspaces/${this.workspaceId}${suffix}`;
  }

  async overview(projectId: string): Promise<AnalysisView> {
    const response = await this.h.request('GET', this.api(`/projects/${projectId}/analysis`), {
      cookie: this.cookie,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ analysis: AnalysisView }>().analysis;
  }

  async batches(projectId: string): Promise<BatchView[]> {
    const response = await this.h.request(
      'GET',
      this.api(`/projects/${projectId}/analysis/question-batches`),
      { cookie: this.cookie },
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ batches: BatchView[] }>().batches;
  }

  answer(batchId: string, answers: AnswerBody[], key?: string) {
    return this.h.request('POST', this.api(`/question-batches/${batchId}/answers`), {
      cookie: this.cookie,
      payload: { answers },
      ...(key ? { headers: { 'idempotency-key': key } } : {}),
    });
  }

  finish(projectId: string, reason = 'The picture is clear enough.', key?: string) {
    return this.h.request('POST', this.api(`/projects/${projectId}/analysis/finish`), {
      cookie: this.cookie,
      payload: { reason },
      ...(key ? { headers: { 'idempotency-key': key } } : {}),
    });
  }

  async waitFor(
    projectId: string,
    predicate: (view: AnalysisView) => boolean,
    label: string,
    timeoutMs = 45_000,
  ): Promise<AnalysisView> {
    const deadline = Date.now() + timeoutMs;
    let last: AnalysisView | null = null;
    while (Date.now() < deadline) {
      last = await this.overview(projectId);
      if (predicate(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
  }

  /** Answers every open question of the open batch with a text answer. */
  async answerOpenBatch(
    projectId: string,
    pick: (question: AnalysisQuestionView) => AnswerBody = (question) => ({
      questionId: question.id,
      status: 'answered',
      text: `Answer to question ${question.number}`,
    }),
  ): Promise<string> {
    const batches = await this.batches(projectId);
    const open = batches.find((batch) => batch.status === 'open');
    if (!open) throw new Error('No batch is open.');
    const answers = open.questions.filter((question) => question.status === 'open').map(pick);
    const response = await this.answer(open.id, answers);
    expect(response.statusCode, response.body).toBe(200);
    return open.id;
  }

  /**
   * Plays the administrator until the problem definition waits for a decision: answers every
   * batch the analyst opens. Returns the analysis at that point.
   */
  async reachDefinition(
    projectId: string,
    options: {
      pick?: (question: AnalysisQuestionView) => AnswerBody;
      timeoutMs?: number;
      maxBatches?: number;
    } = {},
  ): Promise<AnalysisView> {
    const deadline = Date.now() + (options.timeoutMs ?? 60_000);
    let answered = 0;
    let lastAnswered: string | null = null;
    for (;;) {
      const view = await this.overview(projectId);
      if (view.phase === 'awaiting_approval' || view.phase === 'approved') return view;
      if (view.phase === 'answering' && view.openBatchId && view.openBatchId !== lastAnswered) {
        lastAnswered = await this.answerOpenBatch(projectId, options.pick);
        answered += 1;
        if (options.maxBatches && answered > options.maxBatches) {
          throw new Error(`More than ${options.maxBatches} batches were opened.`);
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out reaching the definition: ${JSON.stringify(view)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
}
