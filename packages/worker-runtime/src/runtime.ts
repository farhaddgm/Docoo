import { startTelemetry } from '@docoo/observability';

export interface WorkerRuntimeOptions {
  readonly workerName: string;
  readonly taskQueue: string;
}

export function runWorkerRuntime(options: WorkerRuntimeOptions): void {
  const telemetry = startTelemetry({
    serviceName: options.workerName,
    serviceVersion: '0.1.0',
    ...(process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
      ? { endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] }
      : {}),
  });

  const log = (event: string): void => {
    process.stdout.write(
      `${JSON.stringify({
        level: 'info',
        event,
        worker: options.workerName,
        taskQueue: options.taskQueue,
        timestamp: new Date().toISOString(),
      })}\n`,
    );
  };

  log('worker.scaffold.ready');

  const heartbeat = setInterval(() => log('worker.scaffold.heartbeat'), 60_000);

  const shutdown = async (): Promise<void> => {
    clearInterval(heartbeat);
    log('worker.scaffold.stopping');
    await telemetry?.shutdown();
    process.exitCode = 0;
  };

  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
