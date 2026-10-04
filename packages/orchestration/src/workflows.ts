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

/** Answer attachments are polled every 15 s for up to 10 minutes before the round goes on without. */
const ATTACHMENT_POLL_SECONDS = 15;
const ATTACHMENT_POLL_LIMIT = 40;

export const pauseSignal = defineSignal('pause');
export const resumeSignal = defineSignal('resume');
export const cancelSignal = defineSignal<[{ reason: string | null }]>('cancel');
export const gateSignal = defineSignal<[GateSignal]>('gate');
export const attemptDecisionSignal = defineSignal<[AttemptDecisionSignal]>('attemptDecision');
export const answersSignal = defineSignal<[AnswersSignal]>('answers');
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
