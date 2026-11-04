import type { LiveActionView, LiveSessionView } from '@docoo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveBackend } from './live-api';
import { initialLiveState, reduceLive } from './state';
import { createLiveStore, type LiveStoreDeps } from './store';
import { createFakeTransport, type LiveTransport, type LiveTransportHandlers } from './transport';

const SESSION = '11111111-1111-4111-8111-111111111111';
const caps = {
  idleSleepS: 120,
  sessionMaxMinutes: 30,
  sessionCostCapUsd: 5,
  dailyCostCapUsd: 20,
  taskCostCapUsd: 1,
  maxActionsPerTask: 8,
  confirmTimeoutS: 300,
};
const session = (): LiveSessionView => ({
  id: SESSION,
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
});

let counter = 0;
const action = (over: Partial<LiveActionView> = {}): LiveActionView => {
  counter += 1;
  const n = String(counter).padStart(2, '0');
  return {
    id: `00000000-0000-4000-8000-0000000000${n}`,
    sessionId: SESSION,
    capability: 'project.pause',
    projectId: null,
    tier: 'T1',
    steps: ['preview', 'voice_or_click'],
    status: 'proposed',
    summary: `Change ${n}`,
    targetName: null,
    refusalReason: null,
    cancelReason: null,
    result: null,
    errorCode: null,
    proposedAt: `2026-11-04T10:00:${n}.000000Z`,
    expiresAt: `2026-11-04T10:05:${n}.000000Z`,
    firstConfirmedAt: null,
    confirmedAt: null,
    finishedAt: null,
    nextStep: 'confirm',
    ...over,
  };
};
const T2 = ['preview', 'readback', 'voice_or_click'];
const T3 = ['preview', 'readback', 'voice_or_click', 'target_echo_or_click'];
/** The real backend is read-only; the tests swap one call at a time. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const problem = (code: string) => Object.assign(new Error(code), { code });
const done = (view: LiveActionView): LiveActionView => ({
  ...view,
  status: 'executed',
  nextStep: null,
  finishedAt: '2026-11-04T10:01:00.000000Z',
  result: { ok: true },
});

interface Calls {
  proposed: unknown[];
  confirmed: { id: string; via: string; transcript?: string | undefined }[];
  cancelled: string[];
  fetched: string[];
}

function backendWith(over: Partial<LiveBackend> = {}) {
  const calls: Calls = { proposed: [], confirmed: [], cancelled: [], fetched: [] };
  const store = new Map<string, LiveActionView>();
  const backend: Mutable<LiveBackend> = {
    startSession: () => Promise.resolve(session()),
    reportUsage: () =>
      Promise.resolve({ session: session(), capStatus: 'ok' as const, capsReached: [] }),
    ask: () => Promise.reject(new Error('not used here')),
    appendMessages: () => Promise.resolve({ saved: 0 }),
    endSession: () => Promise.resolve(session()),
    proposeAction: (input) => {
      calls.proposed.push(input);
      const view = action();
      store.set(view.id, view);
      return Promise.resolve(view);
    },
    confirmAction: (id, input) => {
      calls.confirmed.push({ id, via: input.via, transcript: input.transcript });
      const current = store.get(id);
      if (!current) return Promise.reject(problem('LIVE_ACTION_NOT_FOUND'));
      const next = done(current);
      store.set(id, next);
      return Promise.resolve(next);
    },
    cancelAction: (id) => {
      calls.cancelled.push(id);
      const current = store.get(id);
      if (!current) return Promise.reject(problem('LIVE_ACTION_NOT_FOUND'));
      const next: LiveActionView = {
        ...current,
        status: 'cancelled',
        cancelReason: 'cancelled_by_user',
        nextStep: null,
        finishedAt: 'x',
      };
      store.set(id, next);
      return Promise.resolve(next);
    },
    getAction: (id) => {
      calls.fetched.push(id);
      const current = store.get(id);
      return current ? Promise.resolve(current) : Promise.reject(problem('LIVE_ACTION_NOT_FOUND'));
    },
    ...over,
  };
  return { backend, calls, store };
}

describe('changes proposed during a live session', () => {
  let clock: number;
  let handlers: LiveTransportHandlers | undefined;
  let reported: LiveActionView[];
  let stopped: number;

  const deps = (): LiveStoreDeps => ({
    storage: null,
    acquireLock: () => Promise.resolve({ release: () => undefined }),
    now: () => clock,
  });
  const transport = (): LiveTransport => ({
    start: (h) => {
      handlers = h;
      return Promise.resolve();
    },
    stop: () => {
      stopped += 1;
      return Promise.resolve();
    },
    reportAction: (view) => {
      reported.push(view);
    },
  });
  async function running(backend: LiveBackend) {
    const store = createLiveStore(deps());
    store.setBackend(backend);
    store.setTransportFactory(transport);
    await store.start();
    return store;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1_000_000;
    handlers = undefined;
    reported = [];
    stopped = 0;
    counter = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('can only be proposed while the session runs, and carry the session and the taint flag', async () => {
    const { backend, calls } = backendWith();
    const store = createLiveStore(deps());
    store.setBackend(backend);
    store.setTransportFactory(transport);
    await expect(store.propose('project.pause', {})).rejects.toThrow(/not running/u);
    await store.start();
    expect(store.getSnapshot().sessionId).toBe(SESSION);
    const view = await store.propose('project.pause', { projectId: 'p' }, true);
    expect(calls.proposed).toEqual([
      {
        sessionId: SESSION,
        capability: 'project.pause',
        params: { projectId: 'p' },
        tainted: true,
      },
    ]);
    expect(store.getSnapshot().actions).toEqual([view]);
    // The model's own tool call goes the same way, through the handler the store gave the transport.
    await handlers?.propose('project.pause', {});
    expect(store.getSnapshot().actions).toHaveLength(2);
    await store.stop();
    expect(store.getSnapshot()).toMatchObject({ actions: [], sessionId: null, hint: null });
    await expect(store.propose('project.pause', {})).rejects.toThrow(/not running/u);
  });

  it('keeps a refusal on the list but never tells the model it ended after a person decided', async () => {
    const refused = action({
      status: 'refused',
      refusalReason: 'read_only',
      tier: null,
      steps: [],
      nextStep: null,
    });
    const { backend } = backendWith({ proposeAction: () => Promise.resolve(refused) });
    const store = await running(backend);
    expect(await store.propose('project.pause', {})).toEqual(refused);
    expect(store.getSnapshot().actions).toEqual([refused]);
    expect(reported).toEqual([]);
  });

  it('closes the session when the server says it is over, and leaves a plain failure to the caller', async () => {
    for (const [code, error] of [
      ['LIVE_CAP_REACHED', 'cap_reached'],
      ['LIVE_ASSISTANT_UNAVAILABLE', 'switched_off'],
      ['LIVE_SESSION_ENDED', 'connection_lost'],
    ] as const) {
      const { backend } = backendWith({ proposeAction: () => Promise.reject(problem(code)) });
      const store = await running(backend);
      await expect(store.propose('x', {})).rejects.toThrow(code);
      expect(store.getSnapshot(), code).toMatchObject({ status: 'error', error });
    }
    const { backend } = backendWith({ proposeAction: () => Promise.reject(new Error('offline')) });
    const store = await running(backend);
    await expect(store.propose('x', {})).rejects.toThrow('offline');
    expect(store.getSnapshot().status).toBe('awake');
  });

  it('confirms by click, shows what became of it, and tells the model once', async () => {
    const { backend, calls } = backendWith();
    const store = await running(backend);
    const view = await store.propose('project.pause', {});
    const result = await store.confirm(view.id, { via: 'click' });
    expect(result).toMatchObject({ ok: true, view: { status: 'executed' } });
    expect(calls.confirmed).toEqual([{ id: view.id, via: 'click', transcript: undefined }]);
    expect(store.getSnapshot().actions[0]?.status).toBe('executed');
    expect(store.getSnapshot().timing[view.id]?.settledAt).toBe(clock);
    expect(reported.map((item) => item.status)).toEqual(['executed']);
  });

  it('says what to do when the answer was not clear, and forgets it once the change moves', async () => {
    const { backend } = backendWith({
      confirmAction: () => Promise.reject(problem('LIVE_CONFIRMATION_UNCLEAR')),
    });
    const store = await running(backend);
    const view = await store.propose('project.pause', {});
    expect(await store.confirm(view.id, { via: 'voice', transcript: 'hmm' })).toEqual({
      ok: false,
      reason: 'unclear',
    });
    expect(store.getSnapshot().hint).toEqual({ actionId: view.id, reason: 'unclear' });
    expect(store.getSnapshot().actions[0]?.status).toBe('proposed');
    expect(reported).toEqual([]);
    for (const [code, reason] of [
      ['LIVE_CONFIRMATION_ECHO_MISMATCH', 'echo_mismatch'],
      ['LIVE_CONFIRMATION_TOO_SOON', 'too_soon'],
    ] as const) {
      const again = backendWith({ confirmAction: () => Promise.reject(problem(code)) });
      const other = await running(again.backend);
      const seen = await other.propose('x', {});
      expect((await other.confirm(seen.id, { via: 'click' })).ok).toBe(false);
      expect(other.getSnapshot().hint?.reason).toBe(reason);
    }
    // The hint belongs to that change: when it moves, the hint goes.
    expect(
      reduceLive(store.getSnapshot(), { type: 'action', view: done(view), at: clock }).hint,
    ).toBeNull();
  });

  it('looks the change up again when it is no longer waiting, so the card shows the truth', async () => {
    const mine = backendWith();
    const store = await running(mine.backend);
    const view = await store.propose('project.pause', {});
    mine.store.set(view.id, { ...view, status: 'expired', nextStep: null, finishedAt: 'x' });
    mine.backend.confirmAction = () => Promise.reject(problem('LIVE_ACTION_EXPIRED'));
    expect(await store.confirm(view.id, { via: 'click' })).toEqual({ ok: false, reason: 'closed' });
    expect(mine.calls.fetched).toEqual([view.id]);
    expect(store.getSnapshot().actions[0]?.status).toBe('expired');
    expect(reported.map((item) => item.status)).toEqual(['expired']);
  });

  it('reports a failure it cannot name as "not recorded", and closes down if the session is over', async () => {
    const flaky = backendWith({ confirmAction: () => Promise.reject(new Error('offline')) });
    const store = await running(flaky.backend);
    const view = await store.propose('project.pause', {});
    expect(await store.confirm(view.id, { via: 'click' })).toEqual({ ok: false, reason: 'failed' });
    expect(store.getSnapshot().hint?.reason).toBe('failed');
    expect(store.getSnapshot().status).toBe('awake');

    const over = backendWith({ confirmAction: () => Promise.reject(problem('LIVE_CAP_REACHED')) });
    const ended = await running(over.backend);
    const other = await ended.propose('x', {});
    expect(await ended.confirm(other.id, { via: 'click' })).toEqual({
      ok: false,
      reason: 'closed',
    });
    expect(ended.getSnapshot()).toMatchObject({ status: 'error', error: 'cap_reached' });
  });

  it('cancels a change on request', async () => {
    const { backend, calls } = backendWith();
    const store = await running(backend);
    const view = await store.propose('project.pause', {});
    expect(await store.cancel(view.id)).toMatchObject({ ok: true, view: { status: 'cancelled' } });
    expect(calls.cancelled).toEqual([view.id]);
    expect(reported.map((item) => item.status)).toEqual(['cancelled']);
  });

  it('confirms the simple changes together with one click, and stops at the first that fails', async () => {
    const { backend, calls, store: server } = backendWith();
    const store = await running(backend);
    const a = await store.propose('a', {});
    const b = await store.propose('b', {});
    const c = await store.propose('c', {});
    const costly = action({ tier: 'T2', steps: T2 });
    server.set(costly.id, costly);
    backend.proposeAction = () => Promise.resolve(costly);
    await store.propose('d', {});
    await store.confirmGroup();
    expect(calls.confirmed.map((item) => [item.id, item.via])).toEqual([
      [a.id, 'click'],
      [b.id, 'click'],
      [c.id, 'click'],
    ]);
    expect(store.getSnapshot().actions.find((item) => item.id === costly.id)?.status).toBe(
      'proposed',
    );

    // A failure in the middle stops the rest: nothing is confirmed that the person did not see go through.
    const second = backendWith();
    const again = await running(second.backend);
    await again.propose('x', {});
    const y = await again.propose('y', {});
    await again.propose('z', {});
    second.backend.confirmAction = (id) =>
      id === y.id
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(done(second.store.get(id) as LiveActionView));
    await again.confirmGroup();
    expect(again.getSnapshot().actions.map((item) => item.status)).toEqual([
      'executed',
      'proposed',
      'proposed',
    ]);
  });

  describe('answered by voice', () => {
    it('is only conversation while nothing waits', async () => {
      const { backend, calls } = backendWith();
      const store = await running(backend);
      await store.answerByVoice('what is the weather');
      handlers?.onSpeech('hello');
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.confirmed).toEqual([]);
      await store.answerByVoice('   ');
      expect(calls.confirmed).toEqual([]);
    });

    it('goes to the server as it was said, for one change', async () => {
      const { backend, calls } = backendWith();
      const store = await running(backend);
      const view = await store.propose('a', {});
      handlers?.onSpeech('بله، تأیید');
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.confirmed).toEqual([{ id: view.id, via: 'voice', transcript: 'بله، تأیید' }]);
      expect(store.getSnapshot().actions[0]?.status).toBe('executed');
    });

    it('is one answer to a plan of simple changes', async () => {
      const { backend, calls } = backendWith();
      const store = await running(backend);
      const a = await store.propose('a', {});
      const b = await store.propose('b', {});
      await store.answerByVoice('تأیید');
      expect(calls.confirmed.map((item) => item.id)).toEqual([a.id, b.id]);
    });

    it('goes to the oldest alone when a costly or irreversible change waits too', async () => {
      const { backend, calls, store: server } = backendWith();
      const store = await running(backend);
      const a = await store.propose('a', {});
      const costly = action({ tier: 'T2', steps: T2 });
      server.set(costly.id, costly);
      backend.proposeAction = () => Promise.resolve(costly);
      await store.propose('b', {});
      await store.answerByVoice('تأیید');
      expect(calls.confirmed.map((item) => item.id)).toEqual([a.id]);
      expect(store.getSnapshot().actions.find((item) => item.id === costly.id)?.status).toBe(
        'proposed',
      );
      // The next answer is the costly one's own.
      await store.answerByVoice('تأیید');
      expect(calls.confirmed.map((item) => item.id)).toEqual([a.id, costly.id]);
    });

    it('stops at an answer that did not count, and leaves the hint for the card', async () => {
      const tries: string[] = [];
      const { backend } = backendWith({
        confirmAction: (id) => {
          tries.push(id);
          return Promise.reject(problem('LIVE_CONFIRMATION_UNCLEAR'));
        },
      });
      const store = await running(backend);
      await store.propose('a', {});
      await store.propose('b', {});
      await store.answerByVoice('هوم');
      expect(tries).toHaveLength(1);
      expect(store.getSnapshot().hint?.reason).toBe('unclear');
      expect(store.getSnapshot().actions.map((item) => item.status)).toEqual([
        'proposed',
        'proposed',
      ]);
    });

    it('asks for the name of the thing at the second step of an irreversible change', async () => {
      const first = action({ tier: 'T3', steps: T3, targetName: 'Spring plan' });
      const {
        backend,
        calls,
        store: server,
      } = backendWith({
        proposeAction: () => Promise.resolve(first),
      });
      server.set(first.id, first);
      backend.confirmAction = (id, input) => {
        calls.confirmed.push({ id, via: input.via, transcript: input.transcript });
        const half: LiveActionView = { ...first, status: 'first_confirmed', nextStep: 'echo' };
        server.set(id, half);
        return Promise.resolve(half);
      };
      const store = await running(backend);
      await store.propose('delete', {});
      await store.answerByVoice('بله');
      expect(store.getSnapshot().actions[0]).toMatchObject({
        status: 'first_confirmed',
        nextStep: 'echo',
      });
      // Still waiting, so the next thing said is the answer to it.
      await store.answerByVoice('Spring plan');
      expect(calls.confirmed.map((item) => item.transcript)).toEqual(['بله', 'Spring plan']);
    });

    it('ignores speech from a transport that was stopped', async () => {
      const { backend, calls } = backendWith();
      const store = await running(backend);
      await store.propose('a', {});
      const old = handlers;
      await store.stop();
      old?.onSpeech('تأیید');
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.confirmed).toEqual([]);
      await expect(old?.propose('x', {})).rejects.toThrow();
    });
  });

  it('counts the time to confirm on its own clock, and stops listening for a change whose time is over', async () => {
    const { backend, calls } = backendWith();
    const store = await running(backend);
    const view = await store.propose('a', {});
    expect(store.secondsLeft(view)).toBe(300);
    clock += 100_000;
    expect(store.secondsLeft(view)).toBe(200);
    clock += 200_500;
    expect(store.secondsLeft(view)).toBe(0);
    await store.answerByVoice('تأیید');
    await store.confirmGroup();
    expect(calls.confirmed).toEqual([]);
    await store.refresh(view.id);
    expect(calls.fetched).toEqual([view.id]);
  });

  it('the stand-in model proposes on its own schedule, and stops when the session does', async () => {
    const { backend, calls } = backendWith();
    const store = createLiveStore(deps());
    store.setBackend(backend);
    store.setTransportFactory(() =>
      createFakeTransport({
        tickMs: 100_000,
        proposals: [
          { capability: 'project.pause', afterMs: 100 },
          { capability: 'project.archive', params: { projectId: 'p' }, afterMs: 5_000 },
        ],
      }),
    );
    await store.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.proposed).toHaveLength(1);
    await store.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.proposed).toHaveLength(1);
    expect(stopped).toBe(0);
  });
});

describe('the state kept for the card', () => {
  const at = 1_000;
  const open = (state = reduceLive(initialLiveState(), { type: 'start' })) => state;
  const running = reduceLive(open(), { type: 'started', now: 1 });

  it('remembers the session id only while it runs', () => {
    expect(reduceLive(initialLiveState(), { type: 'session', id: SESSION }).sessionId).toBeNull();
    const withId = reduceLive(running, { type: 'session', id: SESSION });
    expect(withId.sessionId).toBe(SESSION);
    expect(reduceLive(withId, { type: 'failed', error: 'connection_lost' }).sessionId).toBeNull();
    expect(
      reduceLive(reduceLive(withId, { type: 'stop' }), { type: 'stopped' }).sessionId,
    ).toBeNull();
  });

  it('keeps changes oldest first, updates one in place, and stamps when it first saw and settled them', () => {
    counter = 0;
    const a = action();
    const b = action();
    let state = reduceLive(running, { type: 'action', view: b, at });
    state = reduceLive(state, { type: 'action', view: a, at: at + 10 });
    expect(state.actions.map((view) => view.id)).toEqual([a.id, b.id]);
    expect(state.timing[a.id]).toEqual({ firstAt: at + 10, settledAt: null });
    const settled = reduceLive(state, { type: 'action', view: done(a), at: at + 500 });
    expect(settled.timing[a.id]).toEqual({ firstAt: at + 10, settledAt: at + 500 });
    expect(settled.actions[0]?.status).toBe('executed');
    // The same view again changes nothing, so nobody is woken for it.
    expect(reduceLive(settled, { type: 'action', view: done(a), at: at + 900 })).toBe(settled);
  });

  it('drops a late answer after the end, and clears everything with the session', () => {
    const view = action();
    const off = initialLiveState();
    expect(reduceLive(off, { type: 'action', view, at })).toBe(off);
    const withOne = reduceLive(running, { type: 'action', view, at });
    const closing = reduceLive(withOne, { type: 'stop' });
    expect(reduceLive(closing, { type: 'action', view: done(view), at }).actions[0]?.status).toBe(
      'executed',
    );
    const stopped = reduceLive(closing, { type: 'stopped' });
    expect(stopped).toMatchObject({ actions: [], timing: {}, hint: null });
    expect(reduceLive(stopped, { type: 'action', view, at })).toBe(stopped);
    expect(reduceLive(withOne, { type: 'start' })).toBe(withOne);
    expect(
      reduceLive(reduceLive(withOne, { type: 'failed', error: 'cap_reached' }), { type: 'start' })
        .actions,
    ).toEqual([]);
  });

  it('keeps at most thirty, dropping the oldest finished ones and never one still waiting', () => {
    let state = running;
    const waitingOne = action();
    state = reduceLive(state, { type: 'action', view: waitingOne, at });
    for (let i = 0; i < 40; i += 1) {
      state = reduceLive(state, { type: 'action', view: done(action()), at: at + i });
    }
    expect(state.actions).toHaveLength(30);
    expect(state.actions.some((view) => view.id === waitingOne.id)).toBe(true);
    expect(Object.keys(state.timing)).toHaveLength(30);
  });

  it('holds a hint only for a running session, and never twice the same', () => {
    const hint = { actionId: 'a', reason: 'unclear' as const };
    expect(reduceLive(initialLiveState(), { type: 'hint', hint })).toEqual(initialLiveState());
    const withHint = reduceLive(running, { type: 'hint', hint });
    expect(withHint.hint).toEqual(hint);
    expect(reduceLive(withHint, { type: 'hint', hint: { ...hint } })).toBe(withHint);
    expect(reduceLive(withHint, { type: 'hint', hint: null }).hint).toBeNull();
  });
});
