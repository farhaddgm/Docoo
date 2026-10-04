export interface RunRef {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly runId: string;
}

export interface StageRef extends RunRef {
  readonly stageRunId: string;
}
