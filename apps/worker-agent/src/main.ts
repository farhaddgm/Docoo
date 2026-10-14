import { fileURLToPath } from 'node:url';

import {
  startTelemetry,
  logCorrelation,
  correlatedActivities,
  correlatedWorkerLogger,
  type CorrelationEvent,
} from '@docoo/observability';
import { Context } from '@temporalio/activity';
import {
  AGENT_TASK_QUEUE,
  createOrchestrationActivities,
  createDecisionResearchActivities,
  ProviderRuntime,
} from '@docoo/orchestration';
import { masterKeyFromEnv } from '@docoo/providers';
import { NativeConnection, Runtime, Worker } from '@temporalio/worker';
import { Pool } from 'pg';

function log(_level: 'info' | 'error', event: CorrelationEvent): void {
  logCorrelation(event, { service: 'worker-agent' });
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
  if (!masterKey) log('error', 'worker.secret_key.missing');

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 8,
    application_name: 'docoo-worker-agent',
  });
  // Workflow and queue SLIs (SRE-001): schedule-to-start latency, failures and completions
  // are scraped by Prometheus from this address; names match infra/prometheus/rules.
  const metricsAddress = process.env['TEMPORAL_METRICS_ADDRESS'];
  Runtime.install({
    logger: correlatedWorkerLogger('worker-agent'),
    telemetryOptions: {
      logging: { forward: {} },
      ...(metricsAddress
        ? {
            metrics: {
              prometheus: {
                bindAddress: metricsAddress,
                countersTotalSuffix: true,
                unitSuffix: true,
                useSecondsForDurations: true,
              },
            },
          }
        : {}),
    },
  });
  const connection = await NativeConnection.connect({
    address: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
  });
  const worker = await Worker.create({
    connection,
    namespace: process.env['TEMPORAL_NAMESPACE'] ?? 'default',
    maxConcurrentActivityTaskExecutions: Number(process.env['AGENT_CONCURRENCY'] ?? 4),
    taskQueue: AGENT_TASK_QUEUE,
    workflowsPath: fileURLToPath(import.meta.resolve('@docoo/orchestration/workflows')),
    activities: correlatedActivities(
      {
        ...createOrchestrationActivities(pool, new ProviderRuntime(pool, masterKey)),
        ...createDecisionResearchActivities(pool),
      },
      () => {
        const info = Context.current().info;
        return {
          workflowId: info.workflowExecution?.workflowId,
          temporalRunId: info.workflowExecution?.runId,
        };
      },
      'worker-agent',
    ),
  });
  log('info', 'worker.ready');
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

main().catch(() => {
  log('error', 'worker.failed');
  process.exitCode = 1;
});
