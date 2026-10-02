import { Inject, Injectable, type OnModuleDestroy, type Provider } from '@nestjs/common';
import type { Environment } from '@docoo/config';
import {
  S3ObjectStore,
  s3ConfigFromEnv,
  type IngestionInput,
  type ObjectStore,
} from '@docoo/ingestion';
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import { API_CONFIG } from '../tokens.js';

export const OBJECT_STORE = Symbol('OBJECT_STORE');
export const INGESTION_DISPATCHER = Symbol('INGESTION_DISPATCHER');

/** Starts the ingestion workflow of a source version (idempotent per version). */
export interface IngestionDispatcher {
  start(input: IngestionInput): Promise<void>;
}

export class IngestionUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export const INGESTION_TASK_QUEUE = 'docoo.ingestion';

@Injectable()
export class TemporalIngestionDispatcher implements IngestionDispatcher, OnModuleDestroy {
  private client: Promise<{ client: Client; connection: Connection }> | null = null;

  constructor(@Inject(API_CONFIG) private readonly config: Environment) {}

  private connect(): Promise<{ client: Client; connection: Connection }> {
    this.client ??= Connection.connect({
      address: this.config.TEMPORAL_ADDRESS,
      connectTimeout: '5 seconds',
    })
      .then((connection) => ({
        connection,
        client: new Client({ connection, namespace: this.config.TEMPORAL_NAMESPACE }),
      }))
      .catch((error: unknown) => {
        this.client = null;
        throw error;
      });
    return this.client;
  }

  async start(input: IngestionInput): Promise<void> {
    let client: Client;
    try {
      ({ client } = await this.connect());
    } catch {
      throw new IngestionUnavailableError('temporal_unreachable');
    }
    try {
      await client.workflow.start('ingestSourceVersion', {
        taskQueue: INGESTION_TASK_QUEUE,
        workflowId: `ingest-${input.versionId}`,
        args: [input],
      });
    } catch (error) {
      // A running or finished workflow for this version already owns it.
      if (error instanceof WorkflowExecutionAlreadyStartedError) return;
      throw new IngestionUnavailableError('temporal_start_failed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    const current = this.client;
    this.client = null;
    if (current) await (await current.catch(() => null))?.connection.close();
  }
}

/** Object storage is optional at boot so the API can start without it; uploads then fail 503. */
export const objectStoreProvider: Provider = {
  provide: OBJECT_STORE,
  useFactory: (): ObjectStore | null => {
    const config = s3ConfigFromEnv();
    return config ? new S3ObjectStore(config) : null;
  },
};

export const dispatcherProvider: Provider = {
  provide: INGESTION_DISPATCHER,
  useClass: TemporalIngestionDispatcher,
};
