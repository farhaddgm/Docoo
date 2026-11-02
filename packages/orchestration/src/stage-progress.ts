import type { PoolClient } from 'pg';

/**
 * What a running stage reports about itself (ADR-0049): one small append-only row per step, read by
 * the project page while the stage runs. Best-effort by design: callers swallow its failures.
 */

export interface ProgressScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly stageRunId: string;
  readonly attemptId: string;
}

export type ProgressKind = 'start' | 'round' | 'gaps' | 'judge' | 'reading' | 'writing';

/** A row stays small; long text is cut and a payload that is still too big is dropped. */
const TEXT_MAX = 160;
const PAYLOAD_MAX = 3000;

export function boundedProgress(data: Record<string, unknown>): Record<string, unknown> {
  const cut = (value: unknown): unknown =>
    typeof value === 'string'
      ? value.slice(0, TEXT_MAX)
      : Array.isArray(value)
        ? value.slice(0, 30).map(cut)
        : value;
  const bounded = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, cut(value)]));
  return JSON.stringify(bounded).length > PAYLOAD_MAX ? {} : bounded;
}

export async function recordProgress(
  client: PoolClient,
  scope: ProgressScope,
  kind: ProgressKind,
  data: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `insert into stage_progress (workspace_id, project_id, stage_run_id, attempt_id, kind, data)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      scope.workspaceId,
      scope.projectId,
      scope.stageRunId,
      scope.attemptId,
      kind,
      JSON.stringify(boundedProgress(data)),
    ],
  );
}
