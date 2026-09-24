import type { PoolClient } from 'pg';

export interface DatabaseRequestContext {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly correlationId: string;
}

export async function setDatabaseRequestContext(
  client: PoolClient,
  context: DatabaseRequestContext,
): Promise<void> {
  await client.query('select set_config($1, $2, true)', ['app.workspace_id', context.workspaceId]);
  await client.query('select set_config($1, $2, true)', ['app.actor_id', context.actorId]);
  await client.query('select set_config($1, $2, true)', [
    'app.correlation_id',
    context.correlationId,
  ]);
}
