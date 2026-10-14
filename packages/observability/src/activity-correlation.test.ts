import { expect, it, vi } from 'vitest';
import { correlatedActivities, correlatedWorkerLogger } from './activity-correlation.js';
import { currentCorrelation } from './correlation.js';

it('wraps actual handler execution, preserves returned/error identity and never logs error content', async () => {
  const output: string[] = [];
  const writer = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  const error = new Error('PRIVATE_PROMPT_AND_KEY_CANARY');
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const runId = '22222222-2222-4222-8222-222222222222';
  const requestId = '33333333-3333-4333-8333-333333333333';
  const temporalRunId = '44444444-4444-4444-8444-444444444444';
  const handlers = correlatedActivities(
    {
      async successful(ref: object) {
        expect(ref).toHaveProperty('workspaceId', tenantId);
        await Promise.resolve();
        return currentCorrelation();
      },
      async failing(ref: object) {
        expect(ref).toHaveProperty('workspaceId', tenantId);
        await Promise.resolve();
        throw error;
      },
    },
    () => ({ workflowId: `project-${tenantId}-run-1`, temporalRunId }),
    'worker-agent',
  );
  try {
    const ref = { workspaceId: tenantId, runId, correlation: { requestId } };
    expect(await handlers.successful(ref)).toMatchObject({
      tenantId,
      runId,
      requestId,
      temporalRunId,
    });
    await expect(handlers.failing(ref)).rejects.toBe(error);
    expect(currentCorrelation().tenantId).toBeNull();
    expect(output.join('')).not.toContain('PRIVATE_PROMPT');
    expect(output.map((line) => (JSON.parse(line) as { event: string }).event)).toEqual([
      'workflow.activity.started',
      'workflow.activity.completed',
      'workflow.activity.started',
      'workflow.activity.failed',
    ]);
  } finally {
    writer.mockRestore();
  }
});

it('preserves SDK warning severity, drops its arbitrary message/metadata and respects the configured minimum', () => {
  const output: string[] = [];
  const writer = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  vi.stubEnv('LOG_LEVEL', 'warn');
  try {
    const logger = correlatedWorkerLogger('worker-ingestion');
    logger.debug();
    logger.info();
    logger.log('WARN');
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0]!)).toMatchObject({
      level: 'warn',
      event: 'worker.sdk',
      service: 'worker-ingestion',
      tenantId: null,
    });
  } finally {
    writer.mockRestore();
    vi.unstubAllEnvs();
  }
});
