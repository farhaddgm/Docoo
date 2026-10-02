// Loaded with `node --import` before main.js so OpenTelemetry can patch http, Fastify and
// pg under ESM (ENG-007). Without an OTLP endpoint this is a no-op.
import { existsSync } from 'node:fs';
import { parseEnvironment } from '@docoo/config';
import { registerInstrumentationHook, startTelemetry } from '@docoo/observability';

const localEnv = new URL('../../../.env', import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const config = parseEnvironment(process.env);
if (config.OTEL_EXPORTER_OTLP_ENDPOINT) {
  registerInstrumentationHook();
  const telemetry = startTelemetry({
    serviceName: config.OTEL_SERVICE_NAME,
    serviceVersion: process.env['npm_package_version'] ?? '0.0.0',
    endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  });
  const flush = (): void => void telemetry?.shutdown();
  process.once('SIGTERM', flush);
  process.once('SIGINT', flush);
}
