import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as { method: string; path: string }[]);

vi.mock('../api-client', () => ({
  apiGet: (path: string) => {
    calls.push({ method: 'GET', path });
    return Promise.resolve({});
  },
  apiSend: (method: string, path: string) => {
    calls.push({ method, path });
    return Promise.resolve({});
  },
}));

import { liveBackendFor, liveReadApi } from './live-api';

/**
 * The web server sends `/api/x` to the API's `/v1/x`, so a client path starts with `/workspaces`,
 * never with `/v1` (which would reach the API as `/v1/v1/...` and answer 404, as it once did for the
 * whole live assistant: "the state could not be read (HTTP_404)").
 */
describe('live assistant API paths', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('every read goes to the workspace route the API serves', async () => {
    const signal = new AbortController().signal;
    await liveReadApi.config('w1', signal);
    await liveReadApi.cost('w1', signal);
    await liveReadApi.costReport('w1', 30, signal);
    await liveReadApi.executorCheck('w1');
    await liveReadApi.sessions('w1', signal);
    await liveReadApi.session('w1', 's1', signal);
    await liveReadApi.deleteTranscript('w1', 's1');
    expect(calls).toEqual([
      { method: 'GET', path: '/workspaces/w1/live-assistant/config' },
      { method: 'GET', path: '/workspaces/w1/live-assistant/cost' },
      { method: 'GET', path: '/workspaces/w1/live-assistant/cost/report?days=30' },
      { method: 'POST', path: '/workspaces/w1/live-assistant/executor-check' },
      { method: 'GET', path: '/workspaces/w1/live-assistant/sessions' },
      { method: 'GET', path: '/workspaces/w1/live-assistant/sessions/s1' },
      { method: 'DELETE', path: '/workspaces/w1/live-assistant/sessions/s1/messages' },
    ]);
  });

  it('every session and action call goes to the workspace route the API serves', async () => {
    const backend = liveBackendFor('w1');
    await backend.startSession('text');
    await backend.ask('s1', { text: 'hi', context: [] });
    await backend.reportUsage('s1', { inputTokens: 1, outputTokens: 1, costUsd: 0 });
    await backend.appendMessages('s1', []);
    await backend.endSession('s1', 'user');
    await backend.proposeAction({ sessionId: 's1', capability: 'x', params: {}, tainted: false });
    await backend.confirmAction('a1', { via: 'click' });
    await backend.cancelAction('a1');
    await backend.getAction('a1');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /workspaces/w1/live-assistant/sessions',
      'POST /workspaces/w1/live-assistant/sessions/s1/ask',
      'POST /workspaces/w1/live-assistant/sessions/s1/usage',
      'POST /workspaces/w1/live-assistant/sessions/s1/messages',
      'POST /workspaces/w1/live-assistant/sessions/s1/end',
      'POST /workspaces/w1/live-assistant/actions',
      'POST /workspaces/w1/live-assistant/actions/a1/confirm',
      'POST /workspaces/w1/live-assistant/actions/a1/cancel',
      'GET /workspaces/w1/live-assistant/actions/a1',
    ]);
  });

  it('no path carries the version prefix the rewrite adds', async () => {
    await liveReadApi.config('w1');
    await liveBackendFor('w1').startSession();
    expect(calls.every((call) => !call.path.startsWith('/v1'))).toBe(true);
  });
});
