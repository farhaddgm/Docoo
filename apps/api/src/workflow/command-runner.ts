import { createHash } from 'node:crypto';

import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { conflict } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { canonicalJson } from '../config/setting-value.js';
import {
  WORKFLOW_ENGINE,
  WorkflowEngineUnavailableError,
  type WorkflowEngine,
  type WorkflowSignal,
} from './workflow.engine.js';

export function engineUnavailable(): HttpException {
  return new HttpException(
    {
      status: 503,
      title: 'Service Unavailable',
      code: 'WORKFLOW_ENGINE_UNAVAILABLE',
      detail:
        'The change is saved; the workflow engine could not be reached. Use workflow/sync to retry.',
    },
    503,
  );
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export interface PendingSignal {
  readonly workflowId: string;
  readonly name: WorkflowSignal;
  readonly payload: unknown;
}

/**
 * Runs a command once per Idempotency-Key (WF-002): a repeat returns the stored response
 * without touching state or signalling again; the same key with a different body is 409.
 * The workflow is signalled only after the transaction committed.
 */
@Injectable()
export class CommandRunner {
  constructor(
    private readonly database: WorkspaceDatabase,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEngine,
  ) {}

  async run<T>(
    context: WorkspaceRequestContext,
    key: string | undefined,
    command: string,
    request: unknown,
    work: (client: PoolClient) => Promise<{ signal: PendingSignal | null; result: T }>,
  ): Promise<T & { replayed: boolean }> {
    const hash = requestHash({ command, request });
    if (key) {
      const stored = await this.database.run(
        context,
        async (client) =>
          (
            await client.query<{ request_hash: string; response: T }>(
              'select request_hash, response from command_receipts where idempotency_key = $1',
              [key],
            )
          ).rows[0],
      );
      if (stored) {
        if (stored.request_hash !== hash) {
          throw conflict(
            'IDEMPOTENCY_KEY_REUSED',
            'This Idempotency-Key was used for a different request.',
          );
        }
        return { ...stored.response, replayed: true };
      }
    }
    const outcome = await this.database.run(context, async (client) => {
      const done = await work(client);
      if (key) {
        await client.query<Record<string, unknown>>(
          `insert into command_receipts (workspace_id, idempotency_key, command, request_hash, response, created_by)
           values ($1, $2, $3, $4, $5::jsonb, $6)`,
          [context.workspaceId, key, command, hash, JSON.stringify(done.result), context.actorId],
        );
      }
      return done;
    });
    if (outcome.signal) {
      await this.send(outcome.signal.workflowId, outcome.signal.name, outcome.signal.payload);
    }
    return { ...outcome.result, replayed: false };
  }

  async send(workflowId: string, name: WorkflowSignal, payload?: unknown): Promise<void> {
    try {
      await this.engine.signal(workflowId, name, payload);
    } catch (error) {
      if (error instanceof WorkflowEngineUnavailableError) throw engineUnavailable();
      throw error;
    }
  }
}
