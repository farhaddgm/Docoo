import { Context } from '@temporalio/activity';
import { correlatedSpan, logCorrelation, type WorkflowCorrelation } from '@docoo/observability';

/** Wrap activities, outside deterministic workflow code; old histories need no new argument. */
export function correlatedActivities<T extends object>(activities: T): T {
  return Object.fromEntries(
    Object.entries(activities).map(([name, handler]) => [
      name,
      async (...args: unknown[]) => {
        const ref = (args[0] && typeof args[0] === 'object' ? args[0] : {}) as Record<
          string,
          unknown
        >;
        const info = Context.current().info;
        const carrier = ref['correlation'] as WorkflowCorrelation | undefined;
        return correlatedSpan(
          'workflow.activity',
          {
            tenantId: ref['workspaceId'],
            projectId: ref['projectId'],
            runId: ref['runId'],
            stageRunId: ref['stageRunId'],
            workflowId: info.workflowExecution?.workflowId,
          },
          async () => {
            const started = performance.now();
            logCorrelation('workflow.activity.started', { service: 'worker-agent' });
            try {
              const result = await (handler as (...values: unknown[]) => Promise<unknown>)(...args);
              logCorrelation('workflow.activity.completed', {
                service: 'worker-agent',
                outcome: 'succeeded',
                durationMs: performance.now() - started,
              });
              return result;
            } catch (error) {
              logCorrelation('workflow.activity.failed', {
                service: 'worker-agent',
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
