import { z } from 'zod';

import { notFound } from '../common/problems.js';
import type { ProjectsService } from '../projects/projects.service.js';
import type { WorkflowService } from '../workflow/workflow.service.js';
import { defineCapability, type LiveCapability, type LiveLocale } from './capabilities.js';
import { CAPABILITY_TOOLS } from './capability-tools.js';

/**
 * The capabilities of the live assistant about a project's workflow (ADR-0055 §4-3, wave 2): see
 * what waits for the owner, then approve or reject a stage's output, or answer (or decline) a
 * question an agent asked. They call the same service as the back office screens, as the
 * administrator, so the rules, the audit trail and the workflow's follow-up are the same.
 *
 * Every one of them starts model work again (and so costs money) or decides what the workflow
 * does next, which is why none is lighter than T2: the owner sees what exactly is approved, by
 * stage and project name taken from the database, and has it read back before confirming.
 *
 * What a model could be talked into is closed off where it matters: an approval is only valid for
 * the output version that is waiting right now (the preview is looked up, and a replaced version
 * is "not there"); a rejection must carry feedback; an answer is shown to the owner in full, as
 * the words that will be given to the agent.
 */

const uuid = z.uuid().transform((value) => value.toLowerCase());
const t = (locale: LiveLocale, fa: string, en: string): string => (locale === 'fa' ? fa : en);
const clip = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

type Context = Parameters<ProjectsService['get']>[0];

interface StageFacts {
  readonly project: string;
  readonly stage: string;
  readonly outputWaiting: boolean;
}

interface QuestionFacts {
  readonly project: string;
  readonly role: string;
  readonly question: string;
}

interface OverviewStage {
  readonly id: string | null;
  readonly stage: string;
  readonly status: string;
  readonly pendingGateOutputId?: string | null;
}

interface OverviewQuestion {
  readonly id: string;
  readonly stageRunId: string;
  readonly role: string;
  readonly question: string;
  readonly reason: string | null;
  readonly status: string;
}

export function workflowCapabilities(services: {
  readonly projects: ProjectsService;
  readonly workflow: WorkflowService;
}): LiveCapability[] {
  const { projects, workflow } = services;

  const nameOf = async (context: Context, projectId: string): Promise<string> => {
    const project = await projects.get(context, projectId);
    return `«${project.title}» (${project.code})`;
  };

  const overviewOf = async (context: Context, projectId: string) => {
    const overview = (await workflow.overview(context, projectId)) as unknown as {
      stages: OverviewStage[];
      agentQuestions: OverviewQuestion[];
      humanTasks: unknown[];
    };
    return overview;
  };

  /** The stage waiting for a decision on exactly this output, or "not there". */
  const waitingStage = async (
    context: Context,
    projectId: string,
    stageRunId: string,
    outputId: string,
  ): Promise<StageFacts> => {
    const overview = await overviewOf(context, projectId);
    const stage = overview.stages.find((item) => item.id === stageRunId);
    if (!stage || stage.pendingGateOutputId !== outputId) {
      throw notFound(
        'LIVE_STAGE_NOT_WAITING',
        'No output of this stage is waiting for a decision any more.',
      );
    }
    return {
      project: await nameOf(context, projectId),
      stage: stage.stage,
      outputWaiting: true,
    };
  };

  const waiting = defineCapability<{ projectId: string }>({
    meta: { name: 'workflow.waiting', klass: 'T0', area: 'project', write: false },
    tool: CAPABILITY_TOOLS['workflow.waiting'],
    params: z.object({ projectId: uuid }),
    projectOf: (params) => params.projectId,
    // What an agent asked is text a model wrote: it may carry instructions, so a change made soon
    // after reading it is confirmed more strictly.
    untrustedOutput: true,
    describe: (params, locale) => ({
      summary: t(
        locale,
        `خواندن آنچه در گردش‌کار پروژهٔ ${params.projectId} منتظر شماست`,
        `Read what waits for you in the workflow of project ${params.projectId}`,
      ),
    }),
    execute: async ({ context }, params) => {
      const overview = await overviewOf(context, params.projectId);
      return {
        project: await nameOf(context, params.projectId),
        // The ids a change needs: the stage run and the output version that waits.
        stagesAwaitingReview: overview.stages
          .filter((stage) => stage.id !== null && stage.pendingGateOutputId)
          .map((stage) => ({
            stageRunId: stage.id,
            stage: stage.stage,
            outputId: stage.pendingGateOutputId,
          })),
        openQuestions: overview.agentQuestions
          .filter((question) => question.status === 'open')
          .slice(0, 10)
          .map((question) => ({
            questionId: question.id,
            role: question.role,
            question: clip(question.question, 500),
            reason: clip(question.reason, 300),
          })),
        pendingTasks: overview.humanTasks.length,
      };
    },
  });

  const approve = defineCapability<
    { projectId: string; stageRunId: string; outputId: string },
    StageFacts
  >({
    meta: { name: 'stage.approve', klass: 'T2', area: 'project', write: true },
    tool: CAPABILITY_TOOLS['stage.approve'],
    params: z.object({ projectId: uuid, stageRunId: uuid, outputId: uuid }),
    projectOf: (params) => params.projectId,
    prepare: (context, params) =>
      waitingStage(context, params.projectId, params.stageRunId, params.outputId),
    describe: (params, locale, facts) => ({
      summary: t(
        locale,
        `تأیید خروجی مرحلهٔ ${facts?.stage ?? params.stageRunId} در پروژهٔ ${facts?.project ?? params.projectId}؛ گردش‌کار ادامه می‌یابد و کار و هزینهٔ مدل از سر گرفته می‌شود`,
        `Approve the output of stage ${facts?.stage ?? params.stageRunId} in project ${facts?.project ?? params.projectId}; the workflow continues and model work and cost start again`,
      ),
    }),
    execute: async ({ context, actionId }, params) => {
      const result = await workflow.review(
        context,
        params.projectId,
        params.stageRunId,
        params.outputId,
        { action: 'approve', idempotencyKey: `live-${actionId}` },
      );
      return {
        stageRunId: params.stageRunId,
        outputId: params.outputId,
        action: 'approve',
        result,
      };
    },
  });

  const reject = defineCapability<
    { projectId: string; stageRunId: string; outputId: string; feedback: string },
    StageFacts
  >({
    meta: { name: 'stage.reject', klass: 'T2', area: 'project', write: true },
    tool: CAPABILITY_TOOLS['stage.reject'],
    params: z.object({
      projectId: uuid,
      stageRunId: uuid,
      outputId: uuid,
      // The back office refuses a rejection without feedback for the next attempt; so does this.
      feedback: z.string().trim().min(1).max(2000),
    }),
    projectOf: (params) => params.projectId,
    prepare: (context, params) =>
      waitingStage(context, params.projectId, params.stageRunId, params.outputId),
    describe: (params, locale, facts) => ({
      // The owner hears the feedback word for word: it is what the next attempt will be told.
      summary: t(
        locale,
        `رد خروجی مرحلهٔ ${facts?.stage ?? params.stageRunId} در پروژهٔ ${facts?.project ?? params.projectId} با این بازخورد: «${params.feedback}»؛ مرحله دوباره اجرا می‌شود و هزینهٔ مدل دارد`,
        `Reject the output of stage ${facts?.stage ?? params.stageRunId} in project ${facts?.project ?? params.projectId} with this feedback: "${params.feedback}"; the stage runs again and costs model work`,
      ),
    }),
    execute: async ({ context, actionId }, params) => {
      const result = await workflow.review(
        context,
        params.projectId,
        params.stageRunId,
        params.outputId,
        { action: 'reject', comment: params.feedback, idempotencyKey: `live-${actionId}` },
      );
      return { stageRunId: params.stageRunId, outputId: params.outputId, action: 'reject', result };
    },
  });

  const answer = defineCapability<
    { projectId: string; questionId: string; answer: string | null },
    QuestionFacts
  >({
    meta: { name: 'question.answer', klass: 'T2', area: 'project', write: true },
    tool: CAPABILITY_TOOLS['question.answer'],
    // `null` is "decline to answer", which the agent is told as such.
    params: z.object({
      projectId: uuid,
      questionId: uuid,
      // An empty answer reaches here as nothing at all (the executor drops empty fields): decline.
      answer: z.string().trim().min(1).max(2000).nullable().default(null),
    }),
    projectOf: (params) => params.projectId,
    prepare: async (context, params) => {
      const overview = await overviewOf(context, params.projectId);
      const question = overview.agentQuestions.find(
        (item) => item.id === params.questionId && item.status === 'open',
      );
      if (!question) {
        throw notFound('LIVE_QUESTION_NOT_OPEN', 'This question is not waiting for an answer.');
      }
      return {
        project: await nameOf(context, params.projectId),
        role: question.role,
        question: clip(question.question, 300),
      };
    },
    describe: (params, locale, facts) => ({
      summary:
        params.answer === null
          ? t(
              locale,
              `نپذیرفتن پاسخ به پرسش عامل ${facts?.role ?? ''} در پروژهٔ ${facts?.project ?? params.projectId}: «${facts?.question ?? ''}»؛ مرحله بدون پاسخ دوباره اجرا می‌شود`,
              `Decline to answer the ${facts?.role ?? ''} agent's question in project ${facts?.project ?? params.projectId}: "${facts?.question ?? ''}"; the stage runs again without an answer`,
            )
          : t(
              locale,
              `پاسخ به پرسش عامل ${facts?.role ?? ''} در پروژهٔ ${facts?.project ?? params.projectId}: «${facts?.question ?? ''}» با این پاسخ: «${params.answer}»؛ مرحله دوباره اجرا می‌شود و هزینهٔ مدل دارد`,
              `Answer the ${facts?.role ?? ''} agent's question in project ${facts?.project ?? params.projectId}: "${facts?.question ?? ''}" with: "${params.answer}"; the stage runs again and costs model work`,
            ),
    }),
    execute: async ({ context, actionId }, params) => {
      const result = await workflow.answerAgentQuestion(
        context,
        params.projectId,
        params.questionId,
        {
          answer: params.answer,
          idempotencyKey: `live-${actionId}`,
        },
      );
      return { questionId: params.questionId, declined: params.answer === null, result };
    },
  });

  return [waiting, approve, reject, answer];
}
