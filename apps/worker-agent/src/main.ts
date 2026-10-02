import { fileURLToPath } from 'node:url';

import { startTelemetry } from '@docoo/observability';
import {
  AGENT_TASK_QUEUE,
  createOrchestrationActivities,
  ProviderRuntime,
} from '@docoo/orchestration';
import { masterKeyFromEnv } from '@docoo/providers';
import { NativeConnection, Worker } from '@temporalio/worker';
import { Pool } from 'pg';

function log(level: 'info' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ level, event, worker: 'docoo-worker-agent', timestamp: new Date().toISOString(), ...fields })}\n`,
  );
}

/** Runs project workflows (WF-*) and their provider calls (AI-*) on the `docoo.agent` queue. */
async function main(): Promise<void> {
  const telemetry = startTelemetry({
    serviceName: 'docoo-worker-agent',
    serviceVersion: process.env['npm_package_version'] ?? '0.0.0',
    ...(process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
      ? { endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] }
      : {}),
  });
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const masterKey = masterKeyFromEnv();
  if (!masterKey)
    log('error', 'agent.secret_key.missing', {
      detail: 'SECRET_MASTER_KEY is not set; only the fake provider can run.',
    });

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 8,
    application_name: 'docoo-worker-agent',
  });
  const connection = await NativeConnection.connect({
    address: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
  });
  const worker = await Worker.create({
    connection,
    namespace: process.env['TEMPORAL_NAMESPACE'] ?? 'default',
    taskQueue: AGENT_TASK_QUEUE,
    workflowsPath: fileURLToPath(import.meta.resolve('@docoo/orchestration/workflows')),
    activities: createOrchestrationActivities(pool, new ProviderRuntime(pool, masterKey)),
  });
  log('info', 'worker.ready', { taskQueue: AGENT_TASK_QUEUE });
  const stop = (): void => {
    log('info', 'worker.stopping');
    worker.shutdown();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await worker.run();
  } finally {
    await connection.close();
    await pool.end();
    await telemetry?.shutdown();
  }
}

main().catch((error: unknown) => {
  log('error', 'worker.failed', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
