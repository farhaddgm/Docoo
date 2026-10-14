import {
  context,
  isSpanContextValid,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

import { currentCorrelation, withCorrelation, type CorrelationInput } from './correlation.js';

/** Only identifiers cross the durable workflow boundary, never baggage or request bodies. */
export interface WorkflowCorrelation {
  readonly requestId: string;
  readonly traceparent?: string;
}

export function activeTraceCorrelation(): CorrelationInput {
  const span = trace.getSpan(context.active())?.spanContext();
  return span && isSpanContextValid(span) ? { traceId: span.traceId, spanId: span.spanId } : {};
}

export function captureWorkflowCorrelation(requestId: string): WorkflowCorrelation {
  const span = trace.getSpan(context.active())?.spanContext();
  return {
    requestId,
    ...(span && isSpanContextValid(span)
      ? {
          traceparent: `00-${span.traceId}-${span.spanId}-${(span.traceFlags & 1).toString(16).padStart(2, '0')}`,
        }
      : {}),
  };
}

/** A bounded W3C parent carries the trace across Temporal without carrying arbitrary headers. */
export function workflowParent(carrier?: WorkflowCorrelation) {
  const match = /^00-((?!0{32})[0-9a-f]{32})-((?!0{16})[0-9a-f]{16})-([0-9a-f]{2})$/u.exec(
    carrier?.traceparent ?? '',
  );
  return match
    ? trace.setSpanContext(ROOT_CONTEXT, {
        traceId: match[1]!,
        spanId: match[2]!,
        traceFlags: Number.parseInt(match[3]!, 16) & 1,
        isRemote: true,
      })
    : context.active();
}

/** Exceptions get a fixed status; their text, stack and prompt values are never span attributes. */
export async function correlatedSpan<T>(
  name: 'workflow.activity' | 'provider.invoke',
  fields: CorrelationInput,
  work: () => Promise<T>,
  carrier?: WorkflowCorrelation,
): Promise<T> {
  return trace
    .getTracer('docoo.correlated')
    .startActiveSpan(name, {}, workflowParent(carrier), async (span) => {
      const ids = span.spanContext();
      return withCorrelation(
        {
          ...fields,
          ...(carrier ? { requestId: carrier.requestId } : {}),
          ...(isSpanContextValid(ids) ? { traceId: ids.traceId, spanId: ids.spanId } : {}),
        },
        async () => {
          for (const [key, value] of Object.entries(currentCorrelation()))
            if (value !== null) span.setAttribute(`docoo.${key}`, value);
          try {
            const result = await work();
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (error) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        },
      );
    });
}
