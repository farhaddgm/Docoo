import {
  liveActionStatuses,
  liveAssistantUnavailableReasons,
  liveSessionEndReasons,
} from '@docoo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clampPosition, isDrag, parsePosition } from './drag';
import { acquireSingleTabLock, LIVE_LOCK_NAME, type LocksApi } from './lock';
import { fill, liveMessagesFor } from './messages';
import { initialLiveState, reduceLive, type LiveState } from './state';
import { createLiveStore, PILL_STORAGE_KEY, type LiveStoreDeps } from './store';
import { createFakeTransport, type LiveTransport } from './transport';

const apply = (state: LiveState, ...actions: Parameters<typeof reduceLive>[1][]) =>
  actions.reduce(reduceLive, state);

describe('the live state machine', () => {
  const started = apply(initialLiveState(), { type: 'start' }, { type: 'started', now: 1000 });

  it('starts off, unavailable and empty', () => {
    expect(initialLiveState()).toMatchObject({ status: 'off', available: false, tokens: 0 });
  });

  it('goes off, starting, awake, and remembers when it started', () => {
    expect(apply(initialLiveState(), { type: 'start' }).status).toBe('starting');
    expect(started).toMatchObject({ status: 'awake', startedAt: 1000, tokens: 0 });
  });

  it('a second start while running changes nothing (no second session)', () => {
    expect(reduceLive(started, { type: 'start' })).toBe(started);
    expect(reduceLive(apply(initialLiveState(), { type: 'start' }), { type: 'start' }).status).toBe(
      'starting',
    );
  });

  it('counts tokens while the session is live and closing, never when off', () => {
    const used = apply(started, { type: 'usage', tokens: 120 }, { type: 'usage', tokens: 30 });
    expect(used.tokens).toBe(150);
    expect(apply(used, { type: 'stop' }, { type: 'usage', tokens: 10 }).tokens).toBe(160);
    expect(reduceLive(initialLiveState(), { type: 'usage', tokens: 50 }).tokens).toBe(0);
  });

  it('ignores usage that is not a positive finite number, and rounds fractions down', () => {
    for (const tokens of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(reduceLive(started, { type: 'usage', tokens })).toBe(started);
    }
    expect(reduceLive(started, { type: 'usage', tokens: 7.9 }).tokens).toBe(7);
  });

  it('sleeps and wakes only from the right state', () => {
    const asleep = reduceLive(started, { type: 'sleep' });
    expect(asleep.status).toBe('asleep');
    expect(reduceLive(asleep, { type: 'sleep' })).toBe(asleep);
    expect(reduceLive(asleep, { type: 'wake' }).status).toBe('awake');
    expect(reduceLive(started, { type: 'wake' })).toBe(started);
    expect(reduceLive(initialLiveState(), { type: 'sleep' }).status).toBe('off');
  });

  it('stop closes, stopped switches off and keeps the session total for the card', () => {
    const closed = apply(started, { type: 'usage', tokens: 99 }, { type: 'stop' });
    expect(closed.status).toBe('closing');
    const off = reduceLive(closed, { type: 'stopped' });
    expect(off).toMatchObject({ status: 'off', tokens: 99, startedAt: null });
    expect(apply(off, { type: 'start' }).tokens).toBe(0);
  });

  it('a failure ends the session with its reason and a second failure changes nothing', () => {
    const failed = reduceLive(started, { type: 'failed', error: 'connection_lost' });
    expect(failed).toMatchObject({ status: 'error', error: 'connection_lost', startedAt: null });
    expect(reduceLive(failed, { type: 'failed', error: 'start_failed' })).toBe(failed);
    expect(reduceLive(initialLiveState(), { type: 'failed', error: 'unavailable' }).status).toBe(
      'off',
    );
  });

  it('stop on an error dismisses it, and a new start clears it', () => {
    const failed = reduceLive(started, { type: 'failed', error: 'connection_lost' });
    expect(reduceLive(failed, { type: 'stop' })).toMatchObject({ status: 'off', error: null });
    expect(reduceLive(failed, { type: 'start' })).toMatchObject({
      status: 'starting',
      error: null,
    });
  });

  it('a near-cap warning shows only while the session runs, and ends with it', () => {
    const warned = reduceLive(started, { type: 'warning', on: true });
    expect(warned.warning).toBe(true);
    expect(reduceLive(warned, { type: 'warning', on: true })).toBe(warned);
    expect(reduceLive(warned, { type: 'warning', on: false }).warning).toBe(false);
    // Nothing to be close to when off, and a late answer after the end changes nothing.
    expect(reduceLive(initialLiveState(), { type: 'warning', on: true })).toEqual(
      initialLiveState(),
    );
    const closed = apply(warned, { type: 'stop' }, { type: 'stopped' });
    expect(closed.warning).toBe(false);
    expect(reduceLive(closed, { type: 'warning', on: true })).toBe(closed);
    expect(reduceLive(warned, { type: 'failed', error: 'cap_reached' }).warning).toBe(false);
    expect(apply(closed, { type: 'start' }).warning).toBe(false);
  });

  it('availability and position are tracked without waking anyone for the same value', () => {
    const ready = reduceLive(initialLiveState(), { type: 'availability', available: true });
    expect(ready.available).toBe(true);
    expect(reduceLive(ready, { type: 'availability', available: true })).toBe(ready);
    const moved = reduceLive(ready, { type: 'move', position: { x: 10, y: 20 } });
    expect(moved.position).toEqual({ x: 10, y: 20 });
    expect(reduceLive(moved, { type: 'move', position: { x: 10, y: 20 } })).toBe(moved);
  });
});

describe('dragging the pill', () => {
  const size = { width: 200, height: 40 };
  const viewport = { width: 1000, height: 700 };

  it('keeps the whole pill inside the window with a margin', () => {
    expect(clampPosition({ x: -50, y: -50 }, size, viewport)).toEqual({ x: 8, y: 8 });
    expect(clampPosition({ x: 5000, y: 5000 }, size, viewport)).toEqual({ x: 792, y: 652 });
    expect(clampPosition({ x: 300, y: 300 }, size, viewport)).toEqual({ x: 300, y: 300 });
  });

  it('copes with a window smaller than the pill', () => {
    expect(clampPosition({ x: 100, y: 100 }, size, { width: 150, height: 30 })).toEqual({
      x: 8,
      y: 8,
    });
  });

  it('a press that barely moves is a click', () => {
    expect(isDrag(1, 1)).toBe(false);
    expect(isDrag(3, 3)).toBe(true);
  });

  it('reads a stored position defensively', () => {
    expect(parsePosition('{"x":10,"y":20}')).toEqual({ x: 10, y: 20 });
    for (const bad of [
      null,
      '',
      'nope',
      '[]',
      '{"x":"1","y":2}',
      '{"x":-1,"y":2}',
      '{"x":1e9,"y":2}',
    ]) {
      expect(parsePosition(bad)).toBeNull();
    }
  });
});

describe('the one-tab lock', () => {
  function locks(holder: { busy: boolean }): LocksApi {
    return {
      request(name, options, callback) {
        expect(name).toBe(LIVE_LOCK_NAME);
        expect(options).toEqual({ ifAvailable: true });
        if (holder.busy) return Promise.resolve(callback(null));
        holder.busy = true;
        const held = callback({ name });
        return Promise.resolve(held).finally(() => {
          holder.busy = false;
        });
      },
    };
  }

  it('is granted when free, refused while held, and free again after release', async () => {
    const holder = { busy: false };
    const api = locks(holder);
    const first = await acquireSingleTabLock(api);
    expect(first).not.toBeNull();
    expect(await acquireSingleTabLock(api)).toBeNull();
    first?.release();
    await vi.waitFor(() => expect(holder.busy).toBe(false));
    expect(await acquireSingleTabLock(api)).not.toBeNull();
  });

  it('a browser without Web Locks, or one that refuses them, still runs the session', async () => {
    expect(await acquireSingleTabLock(undefined)).not.toBeNull();
    const broken: LocksApi = { request: () => Promise.reject(new Error('SecurityError')) };
    expect(await acquireSingleTabLock(broken)).not.toBeNull();
  });
});

describe('the session store', () => {
  let stored: Record<string, string>;
  let lockFree: boolean;
  let releases: number;

  const deps = (): LiveStoreDeps => ({
    storage: {
      getItem: (key) => stored[key] ?? null,
      setItem: (key, value) => {
        stored[key] = value;
      },
    },
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

  beforeEach(() => {
    vi.useFakeTimers();
    stored = {};
    lockFree = true;
    releases = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('without a way to reach the provider, starting says "unavailable" and opens nothing', async () => {
    const store = createLiveStore(deps());
    await store.start();
    expect(store.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'unavailable',
      available: false,
    });
    expect(lockFree).toBe(true);
  });

  it('runs a session: counts tokens while live and stops completely', async () => {
    const store = createLiveStore(deps());
    store.setTransportFactory(() => createFakeTransport({ tokensPerTick: 25, tickMs: 1000 }));
    await store.start();
    expect(store.getSnapshot()).toMatchObject({ status: 'awake', startedAt: 5000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getSnapshot().tokens).toBe(75);

    await store.stop();
    expect(store.getSnapshot().status).toBe('off');
    expect(releases).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.getSnapshot().tokens).toBe(75);
  });

  it('pressing start twice opens one transport', async () => {
    const store = createLiveStore(deps());
    let created = 0;
    store.setTransportFactory(() => {
      created += 1;
      return createFakeTransport();
    });
    await Promise.all([store.start(), store.start()]);
    expect(created).toBe(1);
    await store.stop();
  });

  it('a second tab is refused while the first holds the lock, and can start once it is released', async () => {
    const first = createLiveStore(deps());
    const second = createLiveStore(deps());
    first.setTransportFactory(() => createFakeTransport());
    second.setTransportFactory(() => createFakeTransport());
    await first.start();
    await second.start();
    expect(second.getSnapshot()).toMatchObject({ status: 'error', error: 'other_tab' });
    await first.stop();
    await second.stop();
    await second.start();
    expect(second.getSnapshot().status).toBe('awake');
    await second.stop();
  });

  it('a transport that cannot start leaves nothing behind', async () => {
    const store = createLiveStore(deps());
    store.setTransportFactory(() => createFakeTransport({ failOnStart: true }));
    await store.start();
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'start_failed' });
    expect(releases).toBe(1);
    expect(lockFree).toBe(true);
  });

  it('pressing stop while still connecting wins: nothing stays open', async () => {
    const store = createLiveStore(deps());
    let release: () => void = () => undefined;
    let stopped = 0;
    const slow: LiveTransport = {
      start: () => new Promise<void>((resolve) => (release = resolve)),
      stop: () => {
        stopped += 1;
        return Promise.resolve();
      },
    };
    store.setTransportFactory(() => slow);
    const starting = store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().status).toBe('starting');
    const stopping = store.stop();
    release();
    await Promise.all([starting, stopping]);
    expect(store.getSnapshot().status).toBe('off');
    expect(stopped).toBe(1);
    expect(releases).toBe(1);
  });

  it('a connection that drops by itself ends the session and frees the lock', async () => {
    const store = createLiveStore(deps());
    let lose: () => void = () => undefined;
    store.setTransportFactory(() => ({
      start: (handlers) => {
        lose = handlers.onLost;
        return Promise.resolve();
      },
      stop: () => Promise.resolve(),
    }));
    await store.start();
    lose();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'connection_lost' });
    expect(releases).toBe(1);
  });

  it('events from a transport that was stopped are dropped', async () => {
    const store = createLiveStore(deps());
    let usage: (tokens: number) => void = () => undefined;
    store.setTransportFactory(() => ({
      start: (handlers) => {
        usage = handlers.onUsage;
        return Promise.resolve();
      },
      stop: () => Promise.resolve(),
    }));
    await store.start();
    usage(10);
    await store.stop();
    usage(999);
    expect(store.getSnapshot().tokens).toBe(10);
  });

  it('sleep and wake from the transport move the state', async () => {
    const store = createLiveStore(deps());
    let handlers: Parameters<LiveTransport['start']>[0] | undefined;
    store.setTransportFactory(() => ({
      start: (h) => {
        handlers = h;
        return Promise.resolve();
      },
      stop: () => Promise.resolve(),
    }));
    await store.start();
    handlers?.onSleep();
    expect(store.getSnapshot().status).toBe('asleep');
    handlers?.onWake();
    expect(store.getSnapshot().status).toBe('awake');
    await store.stop();
  });

  it('remembers where the pill was put and starts there next time', () => {
    const store = createLiveStore(deps());
    store.move({ x: 40, y: 60 });
    expect(JSON.parse(stored[PILL_STORAGE_KEY] ?? 'null')).toEqual({ x: 40, y: 60 });
    expect(createLiveStore(deps()).getSnapshot().position).toEqual({ x: 40, y: 60 });
  });

  it('works without any storage', () => {
    const store = createLiveStore({ ...deps(), storage: null });
    expect(() => store.move({ x: 1, y: 2 })).not.toThrow();
    expect(store.getSnapshot().position).toEqual({ x: 1, y: 2 });
  });

  it('notifies subscribers only on real changes and stops after unsubscribe', () => {
    const store = createLiveStore(deps());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setTransportFactory(() => createFakeTransport());
    expect(listener).toHaveBeenCalledTimes(1);
    store.setTransportFactory(() => createFakeTransport());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.move({ x: 1, y: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('the words', () => {
  it('both languages say the same things', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
        : [prefix];
    expect(keys(liveMessagesFor('fa')).sort()).toEqual(keys(liveMessagesFor('en')).sort());
  });

  it('every status and every error has a text in both languages', () => {
    for (const locale of ['fa', 'en'] as const) {
      const text = liveMessagesFor(locale);
      for (const status of ['off', 'starting', 'awake', 'asleep', 'closing', 'error'] as const) {
        expect(text.status[status].length).toBeGreaterThan(0);
      }
      for (const error of [
        'unavailable',
        'other_tab',
        'start_failed',
        'connection_lost',
        'cap_reached',
        'switched_off',
      ] as const) {
        expect(text.card.errors[error].length).toBeGreaterThan(0);
      }
    }
  });

  it('every reason, session state, end reason and change state of the list has a text in both languages', () => {
    for (const locale of ['fa', 'en'] as const) {
      const text = liveMessagesFor(locale);
      for (const reason of liveAssistantUnavailableReasons) {
        expect(text.card.notReady[reason].length, reason).toBeGreaterThan(0);
      }
      expect(text.card.notReady.no_provider.length).toBeGreaterThan(0);
      for (const reason of liveSessionEndReasons) {
        expect(text.history.endReasons[reason].length, reason).toBeGreaterThan(0);
      }
      for (const status of liveActionStatuses) {
        expect(text.history.actionStatus[status].length, status).toBeGreaterThan(0);
      }
      for (const status of ['active', 'ended'] as const) {
        expect(text.history.sessionStatus[status].length).toBeGreaterThan(0);
      }
      expect(fill(text.history.roles.assistant, { name: text.name })).toBe(text.name);
      expect(fill(text.history.minutes, { n: '3' })).not.toMatch(/\{/u);
      expect(fill(text.history.cost, { n: '1.5' })).toContain('1.5');
    }
  });

  it('the name is filled into the card, and no placeholder is left over', () => {
    for (const locale of ['fa', 'en'] as const) {
      const text = liveMessagesFor(locale);
      expect(fill(text.card.title, { name: text.name })).toContain(text.name);
      expect(fill(text.card.intro, { name: text.name })).not.toMatch(/\{/u);
    }
  });
});
