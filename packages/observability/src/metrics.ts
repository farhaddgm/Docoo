import { metrics, type Counter, type Histogram } from '@opentelemetry/api';

/**
 * Application SLIs that HTTP and database instrumentation cannot see (SRE-001,
 * docs/06-delivery/03-observability-and-sre.md §2). Labels stay low-cardinality: no
 * workspace, project or document identifiers.
 *
 * Instruments are created on first use: the metrics API has no proxy provider, so a meter
 * taken before `startTelemetry` registers the SDK would stay a no-op forever.
 */
let instruments: { exports: Counter; auditWrites: Counter; auditLatency: Histogram } | undefined;

function meter() {
  if (!instruments) {
    const docoo = metrics.getMeter('docoo');
    instruments = {
      exports: docoo.createCounter('docoo.document.exports', {
        description: 'Artifact export requests by format and result (export reliability SLI).',
      }),
      auditWrites: docoo.createCounter('docoo.audit.writes', {
        description: 'Mandatory audit writes by result (audit completeness SLI).',
      }),
      auditLatency: docoo.createHistogram('docoo.audit.write.duration', {
        description: 'Time to persist a mandatory audit event.',
        unit: 's',
      }),
    };
  }
  return instruments;
}

export function recordDocumentExport(format: string, result: 'succeeded' | 'failed'): void {
  meter().exports.add(1, { format, result });
}

export function recordAuditWrite(result: 'succeeded' | 'failed', seconds: number): void {
  meter().auditWrites.add(1, { result });
  meter().auditLatency.record(seconds, { result });
}
