import type { Pool, PoolClient } from 'pg';

/**
 * One transaction under the workspace RLS context. Workers act without a user (actor
 * empty); the API passes the signed-in actor.
 */
export async function inWorkspace<T>(
  pool: Pool,
  context: { workspaceId: string; actorId?: string | null; correlationId?: string | null },
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('app.workspace_id', $1, true), set_config('app.actor_id', $2, true),
              set_config('app.correlation_id', $3, true)`,
      [context.workspaceId, context.actorId ?? '', context.correlationId ?? ''],
    );
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface AuditInput {
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly projectId?: string | null;
  readonly actorId?: string | null;
  readonly reason?: string | null;
  readonly severity?: 'info' | 'warning' | 'critical';
  readonly securityRelevant?: boolean;
  readonly after?: Record<string, unknown> | null;
  readonly correlationId?: string | null;
}

/** Workflow events go to the audit log with the project id, so they appear on its timeline. */
export async function audit(
  client: PoolClient,
  workspaceId: string,
  entry: AuditInput,
): Promise<void> {
  await client.query(
    `insert into audit_events (workspace_id, actor_id, action, target_type, target_id, project_id, reason,
                               after, correlation_id, severity, security_relevant)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, coalesce($9::uuid, gen_random_uuid()), $10, $11)`,
    [
      workspaceId,
      entry.actorId ?? null,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      entry.projectId ?? null,
      entry.reason ?? null,
      JSON.stringify(entry.after ?? null),
      entry.correlationId || null,
      entry.severity ?? 'info',
      entry.securityRelevant ?? false,
    ],
  );
}
