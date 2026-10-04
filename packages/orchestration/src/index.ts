export * from './activities.js';
export * from './analysis-activities.js';
export * from './analysis.js';
export * from './fake-analyst.js';
export * from './db.js';
export * from './runtime.js';
export * from './stages.js';
export {
  answersSignal,
  attemptDecisionSignal,
  cancelSignal,
  gateSignal,
  pauseSignal,
  resumeSignal,
  stateQuery,
  type AnswersSignal,
  type AttemptDecisionSignal,
  type GateSignal,
} from './workflows.js';

/** Temporal task queue of project workflows. */
export const AGENT_TASK_QUEUE = 'docoo.agent';

export function projectWorkflowId(projectId: string, runNo: number): string {
  return `project-${projectId}-run-${runNo}`;
}
