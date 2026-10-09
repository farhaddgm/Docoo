import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';

import type { OrchestrationActivities, RunRef, StageRef } from './activities.js';
import { STAGES, type Stage } from './stages.js';
import type {
  DecisionResearchRef,
  createDecisionResearchActivities,
} from './decision-research-activities.js';
import type { WritingActivities, WritingRef } from './writing-activities.js';

export interface GateSignal {
  readonly stageRunId: string;
  readonly decision: 'approved' | 'rejected';
}

export interface AttemptDecisionSignal {
  readonly stageRunId: string;
  readonly decision: 'extend' | 'pass';
}

/** A batch of analyst questions was fully answered (sent by the API after the commit). */
export interface AnswersSignal {
  readonly stageRunId: string;
  readonly batchId: string;
}

/** The administrator answered (or declined) a question an agent asked in a stage (ADR-0023). */
export interface AgentInputSignal {
  readonly stageRunId: string;
}

/** Answer attachments are polled every 15 s for up to 10 minutes before the round goes on without. */
const ATTACHMENT_POLL_SECONDS = 15;
const ATTACHMENT_POLL_LIMIT = 40;

export const pauseSignal = defineSignal('pause');
export const resumeSignal = defineSignal('resume');
export const cancelSignal = defineSignal<[{ reason: string | null }]>('cancel');
export const gateSignal = defineSignal<[GateSignal]>('gate');
export const attemptDecisionSignal = defineSignal<[AttemptDecisionSignal]>('attemptDecision');
export const answersSignal = defineSignal<[AnswersSignal]>('answers');
export const agentInputSignal = defineSignal<[AgentInputSignal]>('agentInput');
export const stateQuery = defineQuery<{
  stage: Stage | null;
  paused: boolean;
  waiting: string | null;
  attemptNo: number;
}>('state');

const activities = proxyActivities<OrchestrationActivities>({
  startToCloseTimeout: '10 minutes',
  // Activities are idempotent; infrastructure failures retry here, provider failures follow
  // the approved schedule inside the workflow.
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '1 minute',
    maximumAttempts: 20,
  },
});

/**
 * ProjectWorkflow (WF-001..006): analysis → research → ideation → documentation →
 * evaluation. State lives in Temporal history and the database, so a worker restart
 * resumes at the last safe boundary. Pause stops before the next attempt; cancel keeps
 * outputs and stops downstream use.
 */
export async function projectWorkflow(ref: RunRef): Promise<{ status: 'completed' | 'cancelled' }> {
  let paused = false;
  let cancelled: { reason: string | null } | null = null;
  let gate: GateSignal | null = null;
  let decision: AttemptDecisionSignal | null = null;
  const answered = new Set<string>();
  const agentInputs = new Set<string>();
  let currentStage: Stage | null = null;
  let waiting: string | null = null;
  let currentAttempt = 0;

  setHandler(pauseSignal, () => {
    paused = true;
  });
  setHandler(resumeSignal, () => {
    paused = false;
  });
  setHandler(cancelSignal, (input) => {
    cancelled = input;
  });
  setHandler(gateSignal, (input) => {
    gate = input;
  });
  setHandler(attemptDecisionSignal, (input) => {
    decision = input;
  });
  setHandler(answersSignal, (input) => {
    answered.add(input.batchId);
  });
  setHandler(agentInputSignal, (input) => {
    agentInputs.add(input.stageRunId);
  });
  setHandler(stateQuery, () => ({
    stage: currentStage,
    paused,
    waiting,
    attemptNo: currentAttempt,
  }));

  const cancel = async (): Promise<{ status: 'cancelled' }> => {
    await activities.cancelRun({
      ...ref,
      reason: cancelled?.reason ?? null,
    });
    return { status: 'cancelled' };
  };

  /** Waits while paused; returns false when the run was cancelled meanwhile. */
  const whileActive = async (): Promise<boolean> => {
    if (paused) {
      waiting = 'resume';
      await activities.setRunStatus({ ...ref, status: 'paused' });
      await condition(() => !paused || cancelled !== null);
      waiting = null;
      if (cancelled) return false;
      await activities.setRunStatus({ ...ref, status: 'running' });
    }
    return cancelled === null;
  };

  /**
   * The analyst's question-and-answer phase (ANL-*): rounds of questions, each followed by the
   * administrator's answers, until the analyst can define the problem. Returns false when the
   * run was cancelled. `state.roundNo` is the next round to run and survives a rejected
   * definition, which sends the analysis back here.
   */
  const analysisPhase = async (
    stageRef: StageRef,
    state: { roundNo: number },
  ): Promise<boolean> => {
    for (;;) {
      if (!(await whileActive())) return false;
      let retryNo = 0;
      let attachmentPolls = 0;
      let result = await activities.runAnalysisRound({
        ...stageRef,
        roundNo: state.roundNo,
        retryNo,
        attachmentWaitExhausted: false,
      });
      while (
        result.status === 'retry' ||
        result.status === 'blocked' ||
        result.status === 'waiting_attachments'
      ) {
        if (result.status === 'retry') {
          retryNo += 1;
          await sleep(result.delaySeconds * 1000);
        } else if (result.status === 'blocked') {
          await activities.blockRun({
            ...ref,
            stageRunId: stageRef.stageRunId,
            code: result.code,
            reason: result.reason,
          });
          paused = true;
          retryNo = 0;
        } else {
          attachmentPolls += 1;
          await sleep(ATTACHMENT_POLL_SECONDS * 1000);
        }
        if (!(await whileActive())) return false;
        result = await activities.runAnalysisRound({
          ...stageRef,
          roundNo: state.roundNo,
          retryNo,
          attachmentWaitExhausted: attachmentPolls >= ATTACHMENT_POLL_LIMIT,
        });
      }
      if (result.status === 'definition') {
        state.roundNo += 1;
        return true;
      }
      if (result.status === 'batch') state.roundNo += 1;
      // `batch`: waiting for the first answers · `waiting_answers`: a batch was already open
      // (restart, or a signal ahead of the commit). The activity re-checks before going on.
      waiting = 'answers';
      await condition(() => answered.has(result.batchId) || cancelled !== null);
      waiting = null;
      if (cancelled) return false;
      answered.delete(result.batchId);
    }
  };

  const started = await activities.startRun(ref);
  if (started.paused) paused = true;

  for (const stage of STAGES) {
    currentStage = stage;
    const stageStart = await activities.startStage({ ...ref, stage });
    if (stageStart.status === 'completed') continue;
    const stageRef = { ...ref, stageRunId: stageStart.stageRunId };
    let attemptLimit = stageStart.attemptLimit;
    let attemptNo = Math.max(1, stageStart.attemptsUsed);
    let resumeIntoGate = stageStart.pendingGate;
    const analysisState = { roundNo: stageStart.roundsUsed + 1 };
    // A definition already attempted means the questions are over (restart after the phase).
    let questionsOver = stageStart.attemptsUsed > 0;

    for (;;) {
      if (!resumeIntoGate) {
        if (!(await whileActive())) return cancel();
        if (stage === 'analysis' && !questionsOver) {
          if (!(await analysisPhase(stageRef, analysisState))) return cancel();
        }
        // A rejected definition goes back to the analyst, who may ask more or redefine.
        questionsOver = false;
        currentAttempt = attemptNo;
        let retryNo = 0;
        let outputReady = false;
        while (!outputReady) {
          const result = await activities.runAttempt({ ...stageRef, attemptNo, retryNo });
          if (result.status === 'succeeded') {
            outputReady = true;
          } else if (result.status === 'needs_input') {
            // An agent asked the administrator something: wait for the answer, then run the same
            // attempt again with it. A signal that came early is already in the set.
            waiting = 'agent_input';
            await condition(() => agentInputs.has(stageStart.stageRunId) || cancelled !== null);
            waiting = null;
            if (cancelled) return cancel();
            agentInputs.delete(stageStart.stageRunId);
            if (!(await whileActive())) return cancel();
          } else if (result.status === 'retry') {
            retryNo += 1;
            await sleep(result.delaySeconds * 1000);
            if (!(await whileActive())) return cancel();
          } else {
            // Retries exhausted, permanent error, missing configuration or cost ceiling:
            // pause the project and wait for the administrator. Fallback stays off.
            await activities.blockRun({
              ...ref,
              stageRunId: stageStart.stageRunId,
              code: result.code,
              reason: result.reason,
            });
            paused = true;
            if (!(await whileActive())) return cancel();
            retryNo = 0;
          }
        }
        const opened = await activities.openGate(stageRef);
        if (opened.mode === 'automatic') {
          await activities.completeStage({ ...stageRef, passedByDecision: false });
          break;
        }
      }
      resumeIntoGate = false;
      // A decision that arrived while the gate was being opened is kept, not dropped.
      waiting = 'gate';
      await condition(
        () => (gate !== null && gate.stageRunId === stageStart.stageRunId) || cancelled !== null,
      );
      waiting = null;
      if (cancelled) return cancel();
      const gateDecision = gate as GateSignal | null;
      gate = null;
      if (gateDecision?.decision === 'approved') {
        await activities.completeStage({ ...stageRef, passedByDecision: false });
        break;
      }
      if (attemptNo >= attemptLimit) {
        await activities.requestAttemptDecision({ ...stageRef, attemptsUsed: attemptNo });
        waiting = 'attempt_decision';
        await condition(
          () =>
            (decision !== null && decision.stageRunId === stageStart.stageRunId) ||
            cancelled !== null,
        );
        waiting = null;
        if (cancelled) return cancel();
        const limitDecision = decision as AttemptDecisionSignal | null;
        decision = null;
        if (limitDecision?.decision === 'pass') {
          await activities.completeStage({ ...stageRef, passedByDecision: true });
          break;
        }
        attemptLimit = await activities.extendAttemptLimit(stageRef);
      }
      attemptNo += 1;
    }
  }
  await activities.completeRun(ref);
  return { status: 'completed' };
}

/** Fit rounds are capped by the `document.writing.fit_rounds` setting (at most this many). */
const MAX_FIT_ROUNDS = 3;

const writing = proxyActivities<WritingActivities>({
  startToCloseTimeout: '15 minutes',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '1 minute',
    maximumAttempts: 20,
  },
});

/**
 * DocumentWritingWorkflow (ADR-0019): the documenter writes the whole document of a solution,
 * one subsection at a time, then brings its length into the level's bounds and saves it as a new
 * version. Every step is an idempotent activity, so a worker restart resumes at the last finished
 * subsection. A provider failure that outlasts the approved retry schedule, missing configuration,
 * a missing tool or the cost limit pauses the writing for the administrator; fallback to another
 * model stays off.
 */
export async function documentWritingWorkflow(
  ref: WritingRef,
): Promise<{ status: 'succeeded' | 'failed' | 'cancelled' }> {
  let paused = false;
  let cancelled: { reason: string | null } | null = null;
  setHandler(pauseSignal, () => {
    paused = true;
  });
  setHandler(resumeSignal, () => {
    paused = false;
  });
  setHandler(cancelSignal, (input) => {
    cancelled = input;
  });

  /** Waits while paused; false when the writing was cancelled meanwhile. */
  const whileActive = async (): Promise<boolean> => {
    if (paused && cancelled === null) {
      await writing.writingBlock({ ...ref, code: 'paused_by_administrator', reason: 'pause' });
      await condition(() => !paused || cancelled !== null);
      if (cancelled === null) await writing.writingResume(ref);
    }
    return cancelled === null;
  };

  /** Runs a step through the retry schedule and the administrator pauses. */
  const drive = async <T extends { status: string }>(
    call: (retryNo: number) => Promise<T>,
  ): Promise<Exclude<T, { status: 'retry' } | { status: 'blocked' }> | { status: 'cancelled' }> => {
    let retryNo = 0;
    for (;;) {
      if (!(await whileActive())) return { status: 'cancelled' };
      const result = await call(retryNo);
      if (result.status === 'retry') {
        retryNo += 1;
        const delay = (result as unknown as { delaySeconds: number }).delaySeconds;
        await condition(() => cancelled !== null, delay * 1000);
        continue;
      }
      if (result.status === 'blocked') {
        const blocked = result as unknown as { code: string; reason: string };
        await writing.writingBlock({ ...ref, code: blocked.code, reason: blocked.reason });
        paused = true;
        retryNo = 0;
        continue;
      }
      return result as Exclude<T, { status: 'retry' } | { status: 'blocked' }>;
    }
  };

  const cancel = async (): Promise<{ status: 'cancelled' }> => {
    await writing.writingCancel({
      ...ref,
      reason: cancelled?.reason ?? null,
    });
    return { status: 'cancelled' };
  };
  const fail = async (code: string): Promise<{ status: 'failed' }> => {
    await writing.writingFail({ ...ref, code });
    return { status: 'failed' };
  };

  const started = await writing.writingStart(ref);
  if (started.finished) return { status: 'failed' };

  const prepared = await drive(() => writing.writingPrepare(ref));
  if (prepared.status === 'cancelled') return cancel();
  if (prepared.status === 'failed') return fail(prepared.code);

  const outline = await drive((retryNo) => writing.writingOutline({ ...ref, retryNo }));
  if (outline.status === 'cancelled') return cancel();
  if (outline.status === 'failed') return fail(outline.code);

  for (const subsectionId of outline.subsectionIds) {
    const written = await drive((retryNo) =>
      writing.writingWrite({ ...ref, subsectionId, retryNo }),
    );
    if (written.status === 'cancelled') return cancel();
    if (written.status === 'failed') return fail(written.code);
  }

  for (let round = 1; round <= MAX_FIT_ROUNDS; round += 1) {
    const fitted = await drive((retryNo) => writing.writingFit({ ...ref, round, retryNo }));
    if (fitted.status === 'cancelled') return cancel();
    if (fitted.status === 'failed') return fail(fitted.code);
    if (fitted.done) break;
  }

  const finished = await drive(() => writing.writingFinish(ref));
  if (finished.status === 'cancelled') return cancel();
  if (finished.status === 'failed') return { status: 'failed' };
  return { status: 'succeeded' };
}

// Separate workflow keeps existing project histories and their command sequence unchanged.
export async function decisionResearchWorkflow(ref: DecisionResearchRef) {
  const research = proxyActivities<ReturnType<typeof createDecisionResearchActivities>>({
    startToCloseTimeout: '2 minutes',
    retry: { maximumAttempts: 5 },
  });
  try {
    return await research.runDecisionResearch(ref);
  } catch {
    await research.failDecisionResearch(ref);
    throw new Error('Decision research failed');
  }
}
