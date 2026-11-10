import { describe, expect, it } from 'vitest';

import {
  checkRealtimeLink,
  classifyRefusal,
  realtimeUrl,
  type LinkSocket,
} from '../src/live-assistant/realtime-link.js';

function scripted(run: (socket: LinkSocket) => void): {
  factory: (url: string, headers: Record<string, string>) => LinkSocket;
  seen: { url: string; headers: Record<string, string> }[];
} {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  return {
    seen,
    factory: (url, headers) => {
      seen.push({ url, headers });
      const socket: LinkSocket = {
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        close: () => undefined,
      };
      queueMicrotask(() => run(socket));
      return socket;
    },
  };
}

describe('the realtime link check', () => {
  it('builds the address from the connection or the provider default', () => {
    expect(realtimeUrl(null, 'm 1')).toBe('wss://api.openai.com/v1/realtime?model=m%201');
    expect(realtimeUrl('http://proxy.local/v1/', 'm')).toBe('ws://proxy.local/v1/realtime?model=m');
  });

  it('passes when the provider greets with its session, and sends the key only as a header', async () => {
    const s = scripted((socket) =>
      socket.onmessage?.({ data: JSON.stringify({ type: 'session.created' }) }),
    );
    const result = await checkRealtimeLink({
      apiKey: 'sk-secret',
      baseUrl: null,
      model: 'm',
      socket: s.factory,
    });
    expect(result).toMatchObject({ ok: true, failure: null, events: ['session.created'] });
    expect(s.seen[0]?.headers.Authorization).toBe('Bearer sk-secret');
    expect(s.seen[0]?.url).not.toContain('sk-secret');
  });

  it('names a country refusal, a bad key and an unknown model apart', () => {
    expect(classifyRefusal('unsupported_country_region_territory')).toBe('region');
    expect(classifyRefusal('Unexpected server response: 401')).toBe('auth');
    expect(classifyRefusal('Unexpected server response: 404')).toBe('model');
    expect(classifyRefusal('boom')).toBe('unexpected');
  });

  it('reports a refused upgrade as its kind, and never carries the provider text out', async () => {
    const s = scripted((socket) =>
      socket.onerror?.({ message: 'Unexpected server response: 401' }),
    );
    const result = await checkRealtimeLink({
      apiKey: 'k',
      baseUrl: null,
      model: 'm',
      socket: s.factory,
    });
    expect(result).toEqual({ ok: false, failure: 'auth', events: [], latencyMs: null });
  });

  it('reports a link that says nothing as a timeout', async () => {
    const s = scripted(() => undefined);
    const result = await checkRealtimeLink({
      apiKey: 'k',
      baseUrl: null,
      model: 'm',
      socket: s.factory,
      timeoutMs: 20,
    });
    expect(result.failure).toBe('timeout');
  });

  it('reports an error event as unexpected and a failing constructor as network', async () => {
    const s = scripted((socket) => socket.onmessage?.({ data: JSON.stringify({ type: 'error' }) }));
    expect(
      (await checkRealtimeLink({ apiKey: 'k', baseUrl: null, model: 'm', socket: s.factory }))
        .failure,
    ).toBe('unexpected');
    const bad = await checkRealtimeLink({
      apiKey: 'k',
      baseUrl: null,
      model: 'm',
      socket: () => {
        throw new Error('x');
      },
    });
    expect(bad.failure).toBe('network');
  });
});
