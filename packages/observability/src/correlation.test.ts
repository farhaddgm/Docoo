import { describe, expect, it } from 'vitest';

import {
  correlationKeys,
  correlationRecord,
  currentCorrelation,
  withCorrelation,
} from './correlation.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const project = '33333333-3333-4333-8333-333333333333';
const request = '44444444-4444-4444-8444-444444444444';

describe('correlated logging privacy and isolation', () => {
  it('carries the request through asynchronous work without mixing concurrent tenants', async () => {
    const records = await Promise.all(
      [tenantA, tenantB].map((tenantId) =>
        withCorrelation({ tenantId, requestId: request }, async () => {
          await new Promise((resolve) => setTimeout(resolve, tenantId === tenantA ? 8 : 1));
          return withCorrelation({ projectId: project }, () =>
            correlationRecord('provider.invoke.started'),
          );
        }),
      ),
    );
    expect(records.map((record) => record['tenantId'])).toEqual([tenantA, tenantB]);
    for (const record of records) {
      expect(record['requestId']).toBe(request);
      expect(record['projectId']).toBe(project);
      for (const key of correlationKeys) expect(record).toHaveProperty(key);
    }
    expect(currentCorrelation().tenantId).toBeNull();
  });

  it('clears previous project, run and request identity when nested work switches tenant', () => {
    const record = withCorrelation(
      { tenantId: tenantA, projectId: project, requestId: request },
      () =>
        withCorrelation({ tenantId: tenantB }, () =>
          correlationRecord('workflow.activity.started'),
        ),
    );
    expect(record['tenantId']).toBe(tenantB);
    expect(record['projectId']).toBeNull();
    expect(record['requestId']).toBeNull();
  });

  it('never serializes problem content, prompts, keys, exception messages or arbitrary metadata', () => {
    const canary = 'PRIVATE_PROBLEM_AND_KEY_\nBearer sk-test-canary';
    const record = withCorrelation(
      { tenantId: tenantA, projectId: canary, workflowId: canary, traceId: canary },
      () =>
        correlationRecord('provider.invoke.failed', {
          prompt: canary,
          problem: canary,
          apiKey: canary,
          error: new Error(canary),
          message: canary,
          provider: canary,
          service: canary,
          durationMs: Number.POSITIVE_INFINITY,
          invocationId: canary,
        }),
    );
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('PRIVATE_PROBLEM');
    expect(serialized).not.toContain('Bearer');
    expect(record['projectId']).toBeNull();
    expect(record['workflowId']).toBeNull();
    expect(record).not.toHaveProperty('prompt');
    expect(record).not.toHaveProperty('error');
    expect(record).not.toHaveProperty('provider');
  });

  it('restores the outer context after a failure and rejects invalid or all-zero trace identifiers', () => {
    withCorrelation({ tenantId: tenantA }, () => {
      expect(() =>
        withCorrelation({ tenantId: tenantB }, () => {
          throw new Error('fixture');
        }),
      ).toThrow('fixture');
      expect(currentCorrelation().tenantId).toBe(tenantA);
    });
    const record = withCorrelation({ traceId: '0'.repeat(32), spanId: '0'.repeat(16) }, () =>
      correlationRecord('worker.ready'),
    );
    expect(record['traceId']).toBeNull();
    expect(record['spanId']).toBeNull();
  });
});
