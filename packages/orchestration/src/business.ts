import {
  businessPrompt,
  clampBusinessBudget,
  type AgentRole,
  type BusinessContent,
  type BusinessPrompt,
} from '@docoo/domain';
import type { PoolClient } from 'pg';

/**
 * The business a run or a writing reads (ADR-0021): the snapshot pinned when it started, so a
 * change in Contenter never alters work that is already running.
 */
export interface PinnedBusiness {
  readonly snapshotId: string;
  readonly content: BusinessContent;
}

/** What one role is given from it, with the snapshot to record on the calls that carried it. */
export interface RoleBusiness {
  readonly snapshotId: string;
  readonly prompt: BusinessPrompt;
}

export async function loadSnapshot(
  client: PoolClient,
  snapshotId: string | null,
): Promise<PinnedBusiness | null> {
  if (!snapshotId) return null;
  const row = (
    await client.query<{ id: string; content: BusinessContent }>(
      'select id, content from business_snapshots where id = $1',
      [snapshotId],
    )
  ).rows[0];
  return row ? { snapshotId: row.id, content: row.content } : null;
}

export async function loadRunBusiness(
  client: PoolClient,
  runId: string,
): Promise<PinnedBusiness | null> {
  const row = (
    await client.query<{ business_snapshot_id: string | null }>(
      'select business_snapshot_id from workflow_runs where id = $1',
      [runId],
    )
  ).rows[0];
  return loadSnapshot(client, row?.business_snapshot_id ?? null);
}

export async function loadWritingBusiness(
  client: PoolClient,
  writingId: string,
): Promise<PinnedBusiness | null> {
  const row = (
    await client.query<{ business_snapshot_id: string | null }>(
      'select business_snapshot_id from document_writings where id = $1',
      [writingId],
    )
  ).rows[0];
  return loadSnapshot(client, row?.business_snapshot_id ?? null);
}

/** The part of the business this role reads, within the character budget; null when there is none. */
export function businessForRole(
  pinned: PinnedBusiness | null,
  role: AgentRole,
  budgetChars: unknown,
): RoleBusiness | null {
  if (!pinned) return null;
  const prompt = businessPrompt(pinned.content, {
    role,
    budgetChars: clampBusinessBudget(budgetChars),
  });
  return prompt ? { snapshotId: pinned.snapshotId, prompt } : null;
}
