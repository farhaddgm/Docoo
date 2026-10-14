import type { Attributes, SpanContext } from '@opentelemetry/api';
import { isSpanContextValid } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

import { correlationFields, correlationKeys, type CorrelationInput } from './correlation.js';

function identifierContext(value: SpanContext): SpanContext {
  return {
    traceId: value.traceId,
    spanId: value.spanId,
    traceFlags: value.traceFlags & 1,
    ...(value.isRemote === undefined ? {} : { isRemote: value.isRemote }),
  };
}

function safeAttributes(attributes: Attributes): Attributes {
  const input: CorrelationInput = {};
  for (const key of correlationKeys) input[key] = attributes[`docoo.${key}`];
  const result: Attributes = {};
  for (const [key, value] of Object.entries(correlationFields(input)))
    if (value !== null) result[`docoo.${key}`] = value;
  for (const key of ['http.request.method', 'http.method']) {
    const value = attributes[key];
    if (
      typeof value === 'string' &&
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(value)
    )
      result[key] = value;
  }
  for (const key of ['http.response.status_code', 'http.status_code']) {
    const value = attributes[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599)
      result[key] = value;
  }
  return result;
}

function safeVersion(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value)
    ? value
    : undefined;
}

/** Auto-instrumentation may capture URLs, SQL or exception text; only identifiers leave the process. */
export function privateSpan(span: ReadableSpan): ReadableSpan {
  const resource: Attributes = {};
  const service = span.resource.attributes['service.name'];
  if (
    typeof service === 'string' &&
    /^docoo-(?:api|web|worker-agent|worker-ingestion|worker-document|worker-maintenance|document-renderer)$/u.test(
      service,
    )
  )
    resource['service.name'] = service;
  const version = safeVersion(span.resource.attributes['service.version']);
  if (version) resource['service.version'] = version;
  const scopeName = span.instrumentationScope.name;
  const scopeVersion = safeVersion(span.instrumentationScope.version);
  const attributes = safeAttributes(span.attributes);
  return {
    name: ['api.request', 'workflow.activity', 'provider.invoke'].includes(span.name)
      ? span.name
      : 'instrumentation.operation',
    kind: span.kind,
    spanContext: () => identifierContext(span.spanContext()),
    ...(span.parentSpanContext && isSpanContextValid(span.parentSpanContext)
      ? { parentSpanContext: identifierContext(span.parentSpanContext) }
      : {}),
    startTime: span.startTime,
    endTime: span.endTime,
    duration: span.duration,
    ended: span.ended,
    status: { code: span.status.code },
    attributes,
    links: span.links
      .filter((link) => isSpanContextValid(link.context))
      .map((link) => ({ context: identifierContext(link.context) })),
    events: [],
    resource: resourceFromAttributes(resource),
    instrumentationScope: {
      name:
        scopeName === 'docoo.correlated' ||
        /^@opentelemetry\/instrumentation-[a-z-]+$/u.test(scopeName)
          ? scopeName
          : 'docoo.redacted',
      ...(scopeVersion ? { version: scopeVersion } : {}),
    },
    droppedAttributesCount:
      span.droppedAttributesCount +
      Object.keys(span.attributes).length -
      Object.keys(attributes).length,
    droppedEventsCount: span.droppedEventsCount + span.events.length,
    droppedLinksCount:
      span.droppedLinksCount +
      span.links.filter((link) => !isSpanContextValid(link.context)).length,
  };
}

/** Keeps SDK metrics unchanged; the trace exporter receives a fresh, bounded metadata projection. */
export class PrivateTraceExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}
  export(spans: ReadableSpan[], callback: Parameters<SpanExporter['export']>[1]): void {
    this.delegate.export(
      spans.filter((span) => isSpanContextValid(span.spanContext())).map(privateSpan),
      callback,
    );
  }
  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
  async forceFlush(): Promise<void> {
    await this.delegate.forceFlush?.();
  }
}
