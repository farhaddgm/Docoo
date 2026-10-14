import type { WorkflowCorrelation } from '@docoo/observability';

export interface RunRef {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly correlation?: WorkflowCorrelation;
}

export interface StageRef extends RunRef {
  readonly stageRunId: string;
}
