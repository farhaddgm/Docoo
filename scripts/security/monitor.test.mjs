import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSignals } from './monitor.mjs';
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
test('healthy service with SMTP unconfigured does not create a false delivery claim or outage', async () => {
  const signals = await collectSignals('https://example.test', 'token', async (url) =>
    url.pathname.endsWith('/ready')
      ? response({ status: 'ready', checks: { database: { status: 'up' } } })
      : response({ emailConfigured: false, signals: [] }),
  );
  assert.deepEqual(signals, []);
});
test('unready database and authentication spikes are reported without leaking arbitrary data', async () => {
  const signals = await collectSignals('https://example.test', 'token', async (url) =>
    url.pathname.endsWith('/ready')
      ? response({ status: 'not_ready' }, 503)
      : response({ signals: ['repeated_login_failures', 'some-secret'] }),
  );
  assert.deepEqual(signals, ['repeated_login_failures', 'service_not_ready']);
});
test('missing monitor credential and unreachable service remain visible', async () => {
  assert.deepEqual(
    await collectSignals('https://example.test', '', async () => {
      throw new Error('offline');
    }),
    ['security_monitor_not_configured', 'service_unreachable'],
  );
});
