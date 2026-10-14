import { fileURLToPath } from 'node:url';

import {
  extractInSandbox,
  PgIngestionStore,
  S3ObjectStore,
  s3ConfigFromEnv,
  scannerFromEnv,
  TesseractOcr,
  transcriberFromEnv,
} from '@docoo/ingestion';
import {
  startTelemetry,
  logCorrelation,
  correlatedActivities,
  correlatedWorkerLogger,
  type CorrelationEvent,
} from '@docoo/observability';
import { Context } from '@temporalio/activity';
import { NativeConnection, Runtime, Worker } from '@temporalio/worker';
import { Pool } from 'pg';

import { createActivities } from './activities.js';

export const TASK_QUEUE = 'docoo.ingestion';

function log(level: 'info' | 'error', event: CorrelationEvent): void {
  logCorrelation(event, { service: 'worker-ingestion', logLevel: level });
}

async function main(): Promise<void> {
  const telemetry = startTelemetry({
    serviceName: 'docoo-worker-ingestion',
    serviceVersion: process.env['npm_package_version'] ?? '0.0.0',
    ...(process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
      ? { endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] }
      : {}),
  });
  const databaseUrl = process.env['DATABASE_URL'];
  const s3 = s3ConfigFromEnv();
  if (!databaseUrl || !s3) throw new Error('DATABASE_URL and S3_* settings are required.');
  if (!process.env['CLAMD_HOST']) {
    log('error', 'worker.scanner.missing');
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const objects = new S3ObjectStore(s3);
  await objects.ensureBucket();
  const activities = createActivities({
    store: new PgIngestionStore(pool),
    objects,
    scanner: scannerFromEnv(),
    extract: (bytes, mime) => extractInSandbox(bytes, mime),
    ocr: new TesseractOcr(),
    transcriber: transcriberFromEnv(),
  });

  // Workflow and queue SLIs (SRE-001): schedule-to-start latency, failures and completions
  // are scraped by Prometheus from this address; names match infra/prometheus/rules.
  const metricsAddress = process.env['TEMPORAL_METRICS_ADDRESS'];
  Runtime.install({
    logger: correlatedWorkerLogger('worker-ingestion'),
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
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL('./workflows.js', import.meta.url)),
    activities: correlatedActivities(
      activities,
      () => {
        const info = Context.current().info;
        return {
          workflowId: info.workflowExecution?.workflowId,
          temporalRunId: info.workflowExecution?.runId,
        };
      },
      'worker-ingestion',
    ),
    maxConcurrentActivityTaskExecutions: Number(process.env['INGESTION_CONCURRENCY'] ?? 4),
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
