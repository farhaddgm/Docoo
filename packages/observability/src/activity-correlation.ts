import { correlatedSpan, type WorkflowCorrelation } from './correlated-span.js';
import { logCorrelation } from './correlation.js';

/** Instrument activities rather than deterministic workflow code; existing histories stay compatible. */
export function correlatedActivities<T extends object>(
  activities: T,
  metadata: () => { workflowId?: string | undefined; temporalRunId?: string | undefined },
  service: 'worker-agent' | 'worker-ingestion',
): T {
  return Object.fromEntries(
    Object.entries(activities).map(([name, handler]) => [
      name,
      async (...args: unknown[]) => {
        const ref = (args[0] && typeof args[0] === 'object' ? args[0] : {}) as Record<
          string,
          unknown
        >;
        const carrier = ref['correlation'] as WorkflowCorrelation | undefined;
        return correlatedSpan(
          'workflow.activity',
          {
            tenantId: ref['workspaceId'],
            projectId: ref['projectId'],
            runId: ref['runId'],
            stageRunId: ref['stageRunId'],
            requestId: ref['correlationId'],
            ...metadata(),
          },
          async () => {
            const started = performance.now();
            logCorrelation('workflow.activity.started', { service });
            try {
              const result = await (handler as (...values: unknown[]) => Promise<unknown>)(...args);
              logCorrelation('workflow.activity.completed', {
                service,
                outcome: 'succeeded',
                durationMs: performance.now() - started,
              });
              return result;
            } catch (error) {
              logCorrelation('workflow.activity.failed', {
                service,
                outcome: 'failed',
                durationMs: performance.now() - started,
              });
              throw error;
            }
          },
          carrier,
        );
      },
    ]),
  ) as T;
}

export function correlatedWorkerLogger(service: 'worker-agent' | 'worker-ingestion') {
  const write = (logLevel: string): void => logCorrelation('worker.sdk', { service, logLevel });
  return {
    log: (level: string): void => write(level === 'TRACE' ? 'debug' : level.toLowerCase()),
    trace: (): void => write('debug'),
    debug: (): void => write('debug'),
    info: (): void => write('info'),
    warn: (): void => write('warn'),
    error: (): void => write('error'),
  };
}
