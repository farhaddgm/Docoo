// Run after the CI database has been migrated and its restricted runtime role created.
// Uses the real compiled API and its production --import entrypoint, without providers.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.env['NODE_ENV'], 'test', 'This smoke test requires NODE_ENV=test.');
assert.ok(process.env['DATABASE_URL'], 'An isolated, migrated test database is required.');
const received = [];
const collector = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (request.url === '/v1/traces') received.push(body);
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  } catch {
    response.writeHead(400).end();
  }
});
collector.listen(0, '127.0.0.1');
await once(collector, 'listening');
const portReservation = createServer();
portReservation.listen(0, '127.0.0.1');
await once(portReservation, 'listening');
const port = portReservation.address().port;
await new Promise((resolve) => portReservation.close(resolve));
const canary = 'private-smoke-' + randomUUID();
const requestId = randomUUID();
const child = spawn(process.execPath, ['--import', './dist/instrumentation.js', './dist/main.js'], {
  cwd: fileURLToPath(new URL('../../apps/api/', import.meta.url)),
  env: {
    ...process.env,
    API_PORT: String(port),
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.address().port}`,
    OTEL_SERVICE_NAME: 'docoo-api',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_BSP_SCHEDULE_DELAY: '100',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const closed = once(child, 'close');
let logs = '';
for (const output of [child.stdout, child.stderr])
  output.on('data', (chunk) => {
    logs = (logs + chunk.toString()).slice(-128 * 1024);
  });
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(
      child.exitCode,
      null,
      `Tracing-enabled API exited before readiness (${child.exitCode}).`,
    );
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/health/ready?private=${canary}`, {
        headers: { 'x-request-id': requestId, 'x-private-smoke': canary },
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        assert.equal(response.headers.get('x-request-id'), requestId);
        ready = true;
        break;
      }
    } catch {
      /* Boot may still be establishing its listener. */
    }
    await delay(250);
  }
  assert.ok(ready, 'Tracing-enabled API must pass database readiness.');
  const spans = () =>
    received
      .flatMap((batch) => batch.resourceSpans ?? [])
      .flatMap((resource) => resource.scopeSpans ?? [])
      .flatMap((scope) => scope.spans ?? []);
  const attributes = (span) =>
    Object.fromEntries(
      (span.attributes ?? []).map((item) => [
        item.key,
        item.value.stringValue ?? item.value.intValue,
      ]),
    );
  let incoming;
  for (let attempt = 0; attempt < 80; attempt++) {
    incoming = spans().find((span) => {
      const values = attributes(span);
      // Public readiness has no authenticated project context. Its native HTTP
      // span still proves the loader patches transport modules after the fix.
      return (
        (values['http.request.method'] ?? values['http.method']) === 'GET' &&
        String(values['http.response.status_code'] ?? values['http.status_code']) === '200'
      );
    });
    if (incoming) break;
    await delay(100);
  }
  assert.ok(
    incoming,
    'Real incoming HTTP instrumentation must still export a successful GET span.',
  );
  assert.ok(!JSON.stringify(received).includes(canary), 'Private URL/header must not reach OTLP.');
  assert.ok(!logs.includes(canary), 'Private URL/header must not reach logs.');
  console.log(
    JSON.stringify({
      actualApiBootWithTelemetry: true,
      databaseReadiness: true,
      incomingHttpInstrumentation: true,
      requestIdPreserved: true,
      privateCanaryAbsent: true,
    }),
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  const finished = await Promise.race([closed.then(() => true), delay(5000).then(() => false)]);
  if (!finished) {
    child.kill('SIGKILL');
    await closed;
  }
  await new Promise((resolve) => collector.close(resolve));
}
