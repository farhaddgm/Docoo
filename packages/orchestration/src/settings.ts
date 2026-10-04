import type { PoolClient } from 'pg';

import { MAX_ATTEMPTS } from './stages.js';

export interface Settings {
  connectionId: string;
  model: string;
  manualGate: boolean;
  attemptLimit: number;
  costLimitUsd: number;
}

/** The effective configuration the run was started with (FR-CFG-005). */
export async function loadSettings(client: PoolClient, runId: string): Promise<Settings> {
  const row = (
    await client.query<{ resolved: Record<string, unknown> | null }>(
      `select s.resolved from workflow_runs r left join config_snapshots s on s.id = r.config_snapshot_id where r.id = $1`,
      [runId],
    )
  ).rows[0];
  const values = row?.resolved ?? {};
  const limit = Number(values['workflow.max_attempts_per_stage'] ?? MAX_ATTEMPTS);
  return {
    connectionId: typeof values['ai.connection_id'] === 'string' ? values['ai.connection_id'] : '',
    model: typeof values['ai.model'] === 'string' ? values['ai.model'] : '',
    manualGate: values['workflow.require_human_approval'] !== false,
    attemptLimit: Math.max(
      1,
      Math.min(MAX_ATTEMPTS, Number.isFinite(limit) ? limit : MAX_ATTEMPTS),
    ),
    costLimitUsd: Number(values['ai.max_cost_usd_per_run'] ?? 20),
  };
}
