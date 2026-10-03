import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { register } from 'node:module';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export interface TelemetryOptions {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly endpoint?: string;
}

/**
 * Installs the OpenTelemetry ESM loader hook. Must run before the application imports
 * Fastify, pg or http, which is why services load an `--import` entry (instrumentation.ts).
 */
export function registerInstrumentationHook(): void {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
}

export function startTelemetry(options: TelemetryOptions): NodeSDK | undefined {
  if (!options.endpoint) {
    return undefined;
  }

  // Stable HTTP semantic conventions: `http.server.request.duration` in seconds with the
  // route template, which the SLO recording rules in infra/prometheus/rules expect.
  process.env['OTEL_SEMCONV_STABILITY_OPT_IN'] ??= 'http';
  const endpoint = options.endpoint.replace(/\/$/, '');
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: 15_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // SQL text is parameterized; values (which may hold problem content) are never recorded.
        '@opentelemetry/instrumentation-pg': { enhancedDatabaseReporting: false },
      }),
    ],
  });

  sdk.start();
  return sdk;
}
