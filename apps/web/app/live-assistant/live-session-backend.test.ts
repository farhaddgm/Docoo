import type { LiveSessionView, LiveUsageAnswer } from '@docoo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveBackend } from './live-api';
import { HEARTBEAT_MS, MAX_MISSED_HEARTBEATS, createLiveStore, type LiveStoreDeps } from './store';
import type { LiveTransport, LiveTransportHandlers, LiveTransportSession } from './transport';

const caps = {
  idleSleepS: 120,
  sessionMaxMinutes: 30,
  sessionCostCapUsd: 5,
  dailyCostCapUsd: 20,
  taskCostCapUsd: 1,
  maxActionsPerTask: 8,
  confirmTimeoutS: 300,
};

const view = (over: Partial<LiveSessionView> = {}): LiveSessionView => ({
  id: '11111111-1111-4111-8111-111111111111',
  status: 'active',
  endReason: null,
  mode: 'realtime',
  model: 'm',
  startedAt: '2026-11-04T10:00:00.000000Z',
  lastActivityAt: '2026-11-04T10:00:00.000000Z',
  endedAt: null,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  minutes: 0,
  messageCount: 0,
  caps,
  ...over,
});

const answer = (session: LiveSessionView, capStatus: LiveUsageAnswer['capStatus'] = 'ok') => ({
  session,
  capStatus,
  capsReached: [],
});

interface Calls {
  start: number;
  usage: {
    id: string;
    totals: {
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      cachedInputTokens?: number;
      activity?: string;
    };
  }[];
  lines: { id: string; lines: { role: string; content: string }[] }[];
  end: { id: string; reason: string }[];
  order: string[];
}

function fakeBackend(over: Partial<LiveBackend> = {}) {
  const calls: Calls = { start: 0, usage: [], lines: [], end: [], order: [] };
  const backend: LiveBackend = {
    startSession: () => {
      calls.start += 1;
      calls.order.push('start');
      return Promise.resolve(view());
    },
    reportUsage: (id, totals) => {
      calls.usage.push({ id, totals });
      calls.order.push('usage');
      return Promise.resolve(answer(view()));
    },
    appendMessages: (id, lines) => {
      calls.lines.push({ id, lines: lines.map((line) => ({ ...line })) });
      calls.order.push('lines');
      return Promise.resolve({ saved: lines.length });
    },
    endSession: (id, reason) => {
      calls.end.push({ id, reason });
      calls.order.push('end');
      return Promise.resolve(view({ status: 'ended', endReason: 'user' }));
    },
    ask: () => Promise.reject(new Error('not used here')),
    proposeAction: () => Promise.reject(new Error('not used here')),
    confirmAction: () => Promise.reject(new Error('not used here')),
    cancelAction: () => Promise.reject(new Error('not used here')),
    getAction: () => Promise.reject(new Error('not used here')),
    ...over,
  };
  return { backend, calls };
}

const problem = (code: string) => Object.assign(new Error(code), { code, status: 409 });

describe('the session store with a server session (ADR-0055)', () => {
  let lockFree: boolean;
  let releases: number;
  let opened: number;
  let handlers: LiveTransportHandlers | undefined;
  let startedWith: LiveTransportSession | undefined;
  let stopped: number;

  const deps = (): LiveStoreDeps => ({
    storage: null,
    acquireLock: () => {
      if (!lockFree) return Promise.resolve(null);
      lockFree = false;
      return Promise.resolve({
        release: () => {
          releases += 1;
          lockFree = true;
        },
      });
    },
    now: () => 5000,
  });
  const transport = (): LiveTransport => ({
    start: (h, session) => {
      handlers = h;
      startedWith = session;
      opened += 1;
      return Promise.resolve();
    },
    stop: () => {
      stopped += 1;
      return Promise.resolve();
    },
  });
  const make = (backend: LiveBackend) => {
    const store = createLiveStore(deps());
    store.setBackend(backend);
    store.setTransportFactory(transport);
    return store;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    lockFree = true;
    releases = 0;
    opened = 0;
    stopped = 0;
    handlers = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts the session at the server before anything is opened, and ends it when stopped', async () => {
    const { backend, calls } = fakeBackend();
    const store = make(backend);
    await store.start();
    expect(calls.order).toEqual(['start']);
    expect(opened).toBe(1);
    expect(store.getSnapshot().status).toBe('awake');
    await store.stop();
    expect(calls.end).toEqual([{ id: view().id, reason: 'user' }]);
    expect(store.getSnapshot().status).toBe('off');
    expect(releases).toBe(1);
  });

  it('reports the totals so far on every beat, cost included, and stops reporting once off', async () => {
    const { backend, calls } = fakeBackend();
    const store = make(backend);
    await store.start();
    handlers?.onUsage(100, 0.1);
    handlers?.onUsage(50, 0.2);
    handlers?.onUsage(5, Number.NaN);
    handlers?.onUsage(5, -3);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(calls.usage).toEqual([
      {
        id: view().id,
        totals: {
          inputTokens: 160,
          outputTokens: 0,
          costUsd: 0.3,
          cachedInputTokens: 0,
          activity: 'listening',
        },
      },
    ]);
    handlers?.onUsage(40);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(calls.usage.at(-1)?.totals).toEqual({
      inputTokens: 200,
      outputTokens: 0,
      costUsd: 0.3,
      cachedInputTokens: 0,
      activity: 'listening',
    });
    await store.stop();
    const count = calls.usage.length;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(calls.usage).toHaveLength(count);
  });

  it('does not open a connection when the server refuses the start, and says why', async () => {
    const cases: [string, string][] = [
      ['LIVE_CAP_REACHED', 'cap_reached'],
      ['LIVE_ASSISTANT_UNAVAILABLE', 'switched_off'],
      ['SOMETHING_ELSE', 'start_failed'],
    ];
    for (const [code, error] of cases) {
      lockFree = true;
      opened = 0;
      const { backend } = fakeBackend({ startSession: () => Promise.reject(problem(code)) });
      const store = make(backend);
      await store.start();
      expect(store.getSnapshot(), code).toMatchObject({ status: 'error', error });
      expect(opened, code).toBe(0);
      expect(lockFree, code).toBe(true);
    }
  });

  it('closes down when the server ends the session, and does not end it a second time', async () => {
    const cases: [LiveSessionView['endReason'], string][] = [
      ['cap_cost', 'cap_reached'],
      ['cap_time', 'cap_reached'],
      ['cap_daily', 'cap_reached'],
      ['disabled', 'switched_off'],
      ['superseded', 'other_tab'],
      ['error', 'connection_lost'],
    ];
    for (const [endReason, error] of cases) {
      lockFree = true;
      stopped = 0;
      let reports = 0;
      const { backend, calls } = fakeBackend({
        reportUsage: () => {
          reports += 1;
          return Promise.resolve(answer(view({ status: 'ended', endReason }), 'exceeded'));
        },
      });
      const store = make(backend);
      await store.start();
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      expect(store.getSnapshot(), String(endReason)).toMatchObject({ status: 'error', error });
      expect(stopped, String(endReason)).toBe(1);
      expect(calls.end, String(endReason)).toEqual([]);
      expect(lockFree, String(endReason)).toBe(true);
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
      expect(reports, String(endReason)).toBe(1);
    }
  });

  it('reports cache tokens and what the assistant is doing, at once when it changes', async () => {
    const { backend, calls } = fakeBackend();
    const store = make(backend);
    await store.start();
    handlers?.onUsage(100, 0.01, 40);
    handlers?.onUsage(50, 0, 10);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(calls.usage.at(-1)?.totals).toMatchObject({
      cachedInputTokens: 50,
      activity: 'listening',
    });
    const before = calls.usage.length;
    handlers?.onActivity?.('speaking');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.usage.length).toBe(before + 1);
    expect(calls.usage.at(-1)?.totals.activity).toBe('speaking');
    // The same state again is not worth an early report.
    handlers?.onActivity?.('speaking');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.usage.length).toBe(before + 1);
    await store.stop();
  });

  it('gives the transport the session and a way to ask for a voice ticket', async () => {
    const ticket = { ticket: 'T'.repeat(43), path: '/p', expiresInMs: 30000 };
    const { backend } = fakeBackend({ voiceTicket: () => Promise.resolve(ticket) });
    const store = make(backend);
    await store.start();
    expect(startedWith?.sessionId).toBe(view().id);
    await expect(startedWith?.voiceTicket?.(view().id)).resolves.toEqual(ticket);
    await store.stop();
  });

  it('takes the answer of a request the assistant made by voice like a typed one', async () => {
    const { backend } = fakeBackend();
    const store = make(backend);
    await store.start();
    const before = store.getSnapshot().tokens;
    const used = {
      answer: 'Paused.',
      actions: [],
      screen: [],
      steps: [],
      toolCalls: 1,
      stop: 'answered' as const,
      errorCode: null,
      usage: { inputTokens: 30, outputTokens: 12, costUsd: 0.001 },
    };
    handlers?.onAnswer?.(used);
    expect(store.getSnapshot().tokens).toBe(before + 42);
    await store.stop();
  });

  it('asks the server why the link ended, at once, when the server ended the session', async () => {
    const { backend } = fakeBackend({
      reportUsage: () =>
        Promise.resolve(answer(view({ status: 'ended', endReason: 'cap_cost' }), 'exceeded')),
    });
    const store = make(backend);
    await store.start();
    handlers?.onServerEnded?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'cap_reached' });
  });

  it('shows the near-cap warning while the server says so, and clears it when it no longer does', async () => {
    let capStatus: LiveUsageAnswer['capStatus'] = 'ok';
    const { backend } = fakeBackend({
      reportUsage: () => Promise.resolve(answer(view(), capStatus)),
    });
    const store = make(backend);
    await store.start();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(store.getSnapshot().warning).toBe(false);
    capStatus = 'warn';
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(store.getSnapshot()).toMatchObject({ status: 'awake', warning: true });
    capStatus = 'ok';
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(store.getSnapshot().warning).toBe(false);
    capStatus = 'warn';
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await store.stop();
    expect(store.getSnapshot()).toMatchObject({ status: 'off', warning: false });
  });

  it('survives a missed report or two, and closes after too many in a row', async () => {
    let failing = true;
    const { backend, calls } = fakeBackend({
      reportUsage: () =>
        failing ? Promise.reject(new Error('offline')) : Promise.resolve(answer(view())),
    });
    const store = make(backend);
    await store.start();
    for (let i = 0; i < MAX_MISSED_HEARTBEATS - 1; i += 1)
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(store.getSnapshot().status).toBe('awake');
    failing = false;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    failing = true;
    for (let i = 0; i < MAX_MISSED_HEARTBEATS - 1; i += 1)
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(store.getSnapshot().status).toBe('awake');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'connection_lost' });
    expect(calls.end).toEqual([{ id: view().id, reason: 'error' }]);
    expect(releases).toBe(1);
  });

  it('keeps the transcript, sends it in small batches before the usage, and flushes the rest on stop', async () => {
    const { backend, calls } = fakeBackend();
    const store = make(backend);
    await store.start();
    for (let i = 0; i < 45; i += 1) handlers?.onMessage(i % 2 ? 'assistant' : 'user', `line ${i} `);
    handlers?.onMessage('user', '   ');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(calls.lines.map((entry) => entry.lines.length)).toEqual([20, 20, 5]);
    expect(calls.lines[0]?.lines[0]).toEqual({ role: 'user', content: 'line 0' });
    expect(calls.order.slice(0, 5)).toEqual(['start', 'lines', 'lines', 'lines', 'usage']);
    handlers?.onMessage('assistant', 'goodbye');
    await store.stop();
    expect(calls.order.slice(-2)).toEqual(['lines', 'end']);
    expect(calls.lines.at(-1)?.lines).toEqual([{ role: 'assistant', content: 'goodbye' }]);
    expect(calls.order.at(-1)).toBe('end');
  });

  it('keeps lines that could not be sent for the next report', async () => {
    let up = false;
    const { backend, calls } = fakeBackend({
      appendMessages: (id, lines) => {
        if (!up) return Promise.reject(new Error('offline'));
        calls.lines.push({ id, lines: lines.map((line) => ({ ...line })) });
        return Promise.resolve({ saved: lines.length });
      },
    });
    const store = make(backend);
    await store.start();
    handlers?.onMessage('user', 'first');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(calls.lines).toEqual([]);
    up = true;
    handlers?.onMessage('assistant', 'second');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(calls.lines.flatMap((entry) => entry.lines.map((line) => line.content))).toEqual([
      'first',
      'second',
    ]);
    await store.stop();
  });

  it('pressing stop while the server is still starting the session ends that session', async () => {
    let finish: (value: LiveSessionView) => void = () => undefined;
    const { backend, calls } = fakeBackend({
      startSession: () => new Promise<LiveSessionView>((resolve) => (finish = resolve)),
    });
    const store = make(backend);
    const starting = store.start();
    await vi.advanceTimersByTimeAsync(0);
    const stopping = store.stop();
    finish(view());
    await Promise.all([starting, stopping]);
    expect(store.getSnapshot().status).toBe('off');
    expect(opened).toBe(0);
    expect(calls.end).toEqual([{ id: view().id, reason: 'user' }]);
    expect(releases).toBe(1);
  });

  it('a connection that drops by itself ends the server session as an error', async () => {
    const { backend, calls } = fakeBackend();
    const store = make(backend);
    await store.start();
    handlers?.onLost();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'connection_lost' });
    expect(calls.end).toEqual([{ id: view().id, reason: 'error' }]);
  });

  it('a transport that cannot start ends the session it just opened at the server', async () => {
    const { backend, calls } = fakeBackend();
    const store = createLiveStore(deps());
    store.setBackend(backend);
    store.setTransportFactory(() => ({
      start: () => Promise.reject(new Error('no microphone')),
      stop: () => Promise.resolve(),
    }));
    await store.start();
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'start_failed' });
    expect(calls.end).toEqual([{ id: view().id, reason: 'error' }]);
    expect(lockFree).toBe(true);
  });

  it('a running session keeps the server it started with when another workspace is opened', async () => {
    const first = fakeBackend();
    const second = fakeBackend();
    const store = make(first.backend);
    await store.start();
    store.setBackend(second.backend);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await store.stop();
    expect(first.calls.usage).toHaveLength(1);
    expect(first.calls.end).toHaveLength(1);
    expect(second.calls.usage).toHaveLength(0);
    expect(second.calls.end).toHaveLength(0);
    // Once it is off, the new server is used.
    store.setBackend(second.backend);
    await store.start();
    expect(second.calls.start).toBe(1);
    await store.stop();
  });

  it('never calls a server it was not given', async () => {
    const store = createLiveStore(deps());
    store.setTransportFactory(transport);
    await store.start();
    handlers?.onMessage('user', 'hello');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
    await store.stop();
    expect(store.getSnapshot().status).toBe('off');
  });
});
