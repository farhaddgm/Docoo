import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { expect, it } from 'vitest';

import { PrivateTraceExporter } from './private-trace-exporter.js';

it('filters actual SDK spans, exception events, URLs, SQL, resources and instrumentation before export', async () => {
  const canary = 'PRIVATE_PROMPT_AND_SECRET_CANARY';
  const exported: ReadableSpan[] = [];
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const sdk = new NodeSDK({
    autoDetectResources: false,
    resource: resourceFromAttributes({
      'service.name': 'docoo-api',
      'service.version': '0.27.3',
      'secret.key': canary,
    }),
    traceExporter: new PrivateTraceExporter({
      export(spans, done) {
        exported.push(...spans);
        done({ code: 0 });
      },
      async shutdown() {},
    }),
  });
  sdk.start();
  try {
    trace.getTracer(canary, canary).startActiveSpan(canary, (span) => {
      span.setAttributes({
        'docoo.tenantId': tenantId,
        'docoo.projectId': canary,
        'url.full': `https://example.test/?key=${canary}`,
        'db.statement': canary,
        prompt: canary,
        'http.request.method': 'POST',
        'http.response.status_code': 500,
      });
      span.recordException(new Error(canary));
      span.addEvent(canary, { problem: canary });
      span.setStatus({ code: SpanStatusCode.ERROR, message: canary });
      span.end();
    });
  } finally {
    await sdk.shutdown();
    trace.disable();
    context.disable();
  }
  expect(exported).toHaveLength(1);
  const span = exported[0]!;
  expect(span.attributes).toEqual({
    'docoo.tenantId': tenantId,
    'http.request.method': 'POST',
    'http.response.status_code': 500,
  });
  expect(span.events).toEqual([]);
  expect(span.status).toEqual({ code: SpanStatusCode.ERROR });
  expect(span.resource.attributes).toEqual({
    'service.name': 'docoo-api',
    'service.version': '0.27.3',
  });
  expect(span.name).toBe('instrumentation.operation');
  expect(span.instrumentationScope.name).toBe('docoo.redacted');
  expect(JSON.stringify(span)).not.toContain(canary);
});
