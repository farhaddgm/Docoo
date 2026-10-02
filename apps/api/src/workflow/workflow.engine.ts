import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Environment } from '@docoo/config';
import { AGENT_TASK_QUEUE, type RunRef } from '@docoo/orchestration';
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import { API_CONFIG } from '../tokens.js';

export const WORKFLOW_ENGINE = Symbol('WORKFLOW_ENGINE');

export type WorkflowSignal = 'pause' | 'resume' | 'cancel' | 'gate' | 'attemptDecision';

/** Starts and signals project workflows. */
export interface WorkflowEngine {
  start(workflowId: string, ref: RunRef): Promise<void>;
  signal(workflowId: string, signal: WorkflowSignal, payload?: unknown): Promise<void>;
}

export class WorkflowEngineUnavailableError extends Error {}

@Injectable()
export class TemporalWorkflowEngine implements WorkflowEngine, OnModuleDestroy {
  private connection: Promise<{ client: Client; connection: Connection }> | null = null;

  constructor(@Inject(API_CONFIG) private readonly config: Environment) {}

  private connect(): Promise<{ client: Client; connection: Connection }> {
    this.connection ??= Connection.connect({
      address: this.config.TEMPORAL_ADDRESS,
      connectTimeout: '5 seconds',
    })
      .then((connection) => ({
        connection,
        client: new Client({ connection, namespace: this.config.TEMPORAL_NAMESPACE }),
      }))
      .catch((error: unknown) => {
        this.connection = null;
        throw error;
      });
    return this.connection;
  }

  private async client(): Promise<Client> {
    try {
      return (await this.connect()).client;
    } catch {
      throw new WorkflowEngineUnavailableError('temporal_unreachable');
    }
  }

  async start(workflowId: string, ref: RunRef): Promise<void> {
    const client = await this.client();
    try {
      await client.workflow.start('projectWorkflow', {
        taskQueue: AGENT_TASK_QUEUE,
        workflowId,
        args: [ref],
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return;
      throw new WorkflowEngineUnavailableError('temporal_start_failed');
    }
  }

  async signal(workflowId: string, signal: WorkflowSignal, payload?: unknown): Promise<void> {
    const client = await this.client();
    try {
      await client.workflow
        .getHandle(workflowId)
        .signal(signal, ...(payload === undefined ? [] : [payload]));
    } catch {
      throw new WorkflowEngineUnavailableError('temporal_signal_failed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    const current = this.connection;
    this.connection = null;
    if (current) await (await current.catch(() => null))?.connection.close();
  }
}
