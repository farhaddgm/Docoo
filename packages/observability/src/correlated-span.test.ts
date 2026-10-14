import { context, trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { expect, it } from 'vitest';

import { captureWorkflowCorrelation, correlatedSpan, workflowParent } from './correlated-span.js';
import { correlationRecord, withCorrelation } from './correlation.js';

it('exports one connected request/activity/provider trace and preserves failure without exporting its content', async () => {
  const spans: Record<string, unknown>[] = [];
  const sdk = new NodeSDK({
    autoDetectResources: false,
    traceExporter: {
      export(batch, done) {
        for (const span of batch)
          spans.push({
            name: span.name,
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId,
            parentSpanId: span.parentSpanContext?.spanId,
            attributes: span.attributes,
            events: span.events,
            status: span.status,
          });
        done({ code: 0 });
      },
      async shutdown() {},
    },
  });
  sdk.start();
  const canary = 'PRIVATE_PROMPT_AND_API_KEY_CANARY';
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const projectId = '22222222-2222-4222-8222-222222222222';
  const requestId = '33333333-3333-4333-8333-333333333333';
  let log: Record<string, unknown> | undefined;
  try {
    await trace.getTracer('fixture.api').startActiveSpan('api.request', async (span) => {
      try {
        await withCorrelation({ tenantId, projectId, requestId }, async () => {
          const carrier = captureWorkflowCorrelation(requestId);
          expect(carrier.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u);
          await expect(
            correlatedSpan(
              'workflow.activity',
              { tenantId, projectId },
              async () => {
                await correlatedSpan('provider.invoke', {}, async () => {
                  await Promise.resolve();
                  log = correlationRecord('provider.invoke.failed', {
                    prompt: canary,
                    error: new Error(canary),
                  });
                  throw new Error(canary);
                });
              },
              carrier,
            ),
          ).rejects.toThrow(canary);
        });
      } finally {
        span.end();
      }
    });
  } finally {
    await sdk.shutdown();
    trace.disable();
    context.disable();
  }
  expect(spans).toHaveLength(3);
  const request = spans.find((span) => span['name'] === 'api.request')!;
  const activity = spans.find((span) => span['name'] === 'workflow.activity')!;
  const provider = spans.find((span) => span['name'] === 'provider.invoke')!;
  expect(new Set(spans.map((span) => span['traceId'])).size).toBe(1);
  expect(activity['parentSpanId']).toBe(request['spanId']);
  expect(provider['parentSpanId']).toBe(activity['spanId']);
  expect(log).toMatchObject({
    tenantId,
    projectId,
    requestId,
    traceId: provider['traceId'],
    spanId: provider['spanId'],
  });
  expect(JSON.stringify({ spans, log })).not.toContain(canary);
  expect(provider['status']).toEqual({ code: 2 });
  expect(provider['events']).toEqual([]);
});

it('rejects malformed and zero-valued durable trace parents without accepting arbitrary baggage', () => {
  for (const traceparent of [
    'secret prompt',
    '00-' + '0'.repeat(32) + '-0123456789abcdef-01',
    '00-0123456789abcdef0123456789abcdef-' + '0'.repeat(16) + '-01',
  ]) {
    expect(
      trace.getSpanContext(workflowParent({ requestId: 'fixture', traceparent })),
    ).toBeUndefined();
  }
});
