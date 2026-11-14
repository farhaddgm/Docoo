import type { LiveSessionView, LiveUsageAnswer } from '@docoo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveBackend } from './live-api';
import { initialLiveState, reduceLive, type LiveAction, type LiveState } from './state';
import { createLiveStore, IDLE_CHECK_MS, type LiveStoreDeps } from './store';
import type { LiveTransport, LiveTransportHandlers, LiveTransportSession } from './transport';
import type { WakeDetector } from './wake-detector';

const apply = (state: LiveState, ...actions: LiveAction[]) => actions.reduce(reduceLive, state);

describe('the state of listening (push to talk, sleep)', () => {
  const started = apply(initialLiveState(), { type: 'start' }, { type: 'started', now: 1 });

  it('takes the way of listening only before a session runs', () => {
    const chosen = reduceLive(initialLiveState(), { type: 'listening', pushToTalk: true });
    expect(chosen.pushToTalk).toBe(true);
    expect(reduceLive(chosen, { type: 'listening', pushToTalk: true })).toBe(chosen);
    const running = apply(chosen, { type: 'start' });
    expect(reduceLive(running, { type: 'listening', pushToTalk: false }).pushToTalk).toBe(true);
  });

  it('can be talked to only when awake, and a sleeping assistant is not talking', () => {
    expect(reduceLive(initialLiveState(), { type: 'talking', on: true }).talking).toBe(false);
    const talking = reduceLive(started, { type: 'talking', on: true });
    expect(talking.talking).toBe(true);
    expect(reduceLive(talking, { type: 'talking', on: false }).talking).toBe(false);
    expect(reduceLive(talking, { type: 'sleep' })).toMatchObject({
      status: 'asleep',
      talking: false,
    });
  });

  it('wakes only from sleep, and waking ends with the wake', () => {
    expect(reduceLive(started, { type: 'waking', on: true }).waking).toBe(false);
    const asleep = reduceLive(started, { type: 'sleep' });
    const waking = reduceLive(asleep, { type: 'waking', on: true });
    expect(waking.waking).toBe(true);
    expect(reduceLive(waking, { type: 'wake' })).toMatchObject({ status: 'awake', waking: false });
  });

  it('forgets talking and waking when the session ends or fails', () => {
    const talking = reduceLive(started, { type: 'talking', on: true });
    expect(apply(talking, { type: 'stop' }, { type: 'stopped' })).toMatchObject({
      talking: false,
      waking: false,
    });
    expect(reduceLive(talking, { type: 'failed', error: 'connection_lost' }).talking).toBe(false);
  });
});

const caps = {
  idleSleepS: 60,
  sessionMaxMinutes: 30,
  sessionCostCapUsd: 5,
  dailyCostCapUsd: 20,
  taskCostCapUsd: 1,
  maxActionsPerTask: 8,
  confirmTimeoutS: 300,
};

const sessionView = (over: Partial<LiveSessionView> = {}): LiveSessionView => ({
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

class FakeDetector implements WakeDetector {
  started = 0;
  stopped = 0;
  onWake: (() => void) | null = null;
  constructor(
    readonly phrase: string,
    private readonly fails: boolean,
  ) {}
  start(onWake: () => void): Promise<void> {
    if (this.fails) return Promise.reject(new Error('not allowed'));
    this.started += 1;
    this.onWake = onWake;
    return Promise.resolve();
  }
  stop(): void {
    this.stopped += 1;
    this.onWake = null;
  }
}

interface Link {
  readonly session: LiveTransportSession | undefined;
  handlers: LiveTransportHandlers;
  stopped: number;
  talking: boolean[];
}

describe('sleeping and waking the assistant', () => {
  let now: number;
  let links: Link[];
  let endCalls: { id: string; reason: string }[];
  let usage: { activity?: string | undefined }[];
  let failStart: boolean;
  let ticketError: Error | null;
  let detectors: FakeDetector[];
  let detectorFails: boolean;
  let detectorAvailable: boolean;

  const backend = (): LiveBackend => ({
    startSession: () => Promise.resolve(sessionView()),
    reportUsage: (_id, totals) => {
      usage.push({ activity: totals.activity });
      return Promise.resolve({
        session: sessionView(),
        capStatus: 'ok',
        capsReached: [],
      } satisfies LiveUsageAnswer);
    },
    appendMessages: (_id, lines) => Promise.resolve({ saved: lines.length }),
    endSession: (id, reason) => {
      endCalls.push({ id, reason });
      return Promise.resolve(sessionView({ status: 'ended', endReason: 'user' }));
    },
    voiceTicket: () => {
      if (ticketError) return Promise.reject(ticketError);
      return Promise.resolve({ ticket: 'T'.repeat(43), path: '/p', expiresInMs: 30000 });
    },
    ask: () => Promise.reject(new Error('not used here')),
    proposeAction: () => Promise.reject(new Error('not used here')),
    confirmAction: () => Promise.reject(new Error('not used here')),
    cancelAction: () => Promise.reject(new Error('not used here')),
    getAction: () => Promise.reject(new Error('not used here')),
  });

  const transportFactory = (): LiveTransport => {
    const link: Link = {
      session: undefined,
      handlers: undefined as never,
      stopped: 0,
      talking: [],
    };
    links.push(link);
    return {
      start: async (handlers, session) => {
        // The real transport asks for a one-time ticket first, so an ended session shows up here.
        if (session?.voiceTicket) await session.voiceTicket(session.sessionId);
        if (failStart && links.length > 1) throw new Error('refused');
        link.handlers = handlers;
        (link as { session: LiveTransportSession | undefined }).session = session;
      },
      stop: () => {
        link.stopped += 1;
        return Promise.resolve();
      },
      setTalking: (on) => {
        link.talking.push(on);
      },
    };
  };

  const deps = (): LiveStoreDeps => ({
    storage: null,
    acquireLock: () => Promise.resolve({ release: () => undefined }),
    now: () => now,
    heartbeatMs: 3_600_000,
    idleCheckMs: IDLE_CHECK_MS,
    wakeDetector: (phrase) => {
      if (!detectorAvailable) return null;
      const made = new FakeDetector(phrase, detectorFails);
      detectors.push(made);
      return made;
    },
  });

  async function started(
    options: {
      pushToTalk?: boolean;
      idleSleepS?: number;
      wakeEnabled?: boolean;
      wakePhrase?: string;
    } = {},
  ) {
    const store = createLiveStore(deps());
    store.setBackend(backend());
    store.setTransportFactory(transportFactory);
    store.setListening({
      pushToTalk: options.pushToTalk ?? false,
      idleSleepS: options.idleSleepS ?? 60,
      ...(options.wakeEnabled === undefined ? {} : { wakeEnabled: options.wakeEnabled }),
      ...(options.wakePhrase === undefined ? {} : { wakePhrase: options.wakePhrase }),
    });
    await store.start();
    return store;
  }

  /** Time passes: the clock and the timers move together, as they do in a real browser. */
  const pass = async (seconds: number) => {
    now += seconds * 1000;
    await vi.advanceTimersByTimeAsync(seconds * 1000);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
    links = [];
    endCalls = [];
    usage = [];
    failStart = false;
    ticketError = null;
    detectors = [];
    detectorFails = false;
    detectorAvailable = true;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tells the transport how the owner listens when a session starts', async () => {
    const store = await started({ pushToTalk: true });
    expect(links[0]?.session).toMatchObject({ pushToTalk: true });
    await store.stop();
  });

  it('goes to sleep after the quiet time: the link and microphone are let go, the session stays', async () => {
    const store = await started({ idleSleepS: 60 });
    await pass(30);
    expect(store.getSnapshot().status).toBe('awake');
    await pass(40);
    expect(store.getSnapshot().status).toBe('asleep');
    expect(links[0]?.stopped).toBe(1);
    // The session is open at the server: nothing ended it, and the server is told it sleeps.
    expect(endCalls).toEqual([]);
    expect(usage.at(-1)?.activity).toBe('asleep');
    await store.stop();
    expect(endCalls).toEqual([{ id: sessionView().id, reason: 'user' }]);
  });

  it('never sleeps when the owner set no quiet time', async () => {
    const store = await started({ idleSleepS: 0 });
    await pass(3600);
    expect(store.getSnapshot().status).toBe('awake');
    await store.stop();
  });

  it('stays awake while the assistant is busy, and counts the quiet from the last thing that happened', async () => {
    const store = await started({ idleSleepS: 60 });
    const handlers = links[0]!.handlers;
    handlers.onActivity?.('speaking');
    await pass(200);
    expect(store.getSnapshot().status).toBe('awake'); // speaking for a long time is not quiet
    handlers.onActivity?.('listening');
    await pass(50);
    expect(store.getSnapshot().status).toBe('awake'); // the quiet starts from here
    handlers.onSpeech('سلام');
    await pass(50);
    expect(store.getSnapshot().status).toBe('awake'); // and again after the person spoke
    await pass(20);
    expect(store.getSnapshot().status).toBe('asleep');
    await store.stop();
  });

  it('stays awake while the push-to-talk key is held', async () => {
    const store = await started({ pushToTalk: true, idleSleepS: 60 });
    store.talk(true);
    await pass(300);
    expect(store.getSnapshot()).toMatchObject({ status: 'awake', talking: true });
    expect(links[0]?.talking).toEqual([true]);
    store.talk(false);
    expect(links[0]?.talking).toEqual([true, false]);
    await store.stop();
  });

  it('puts itself to sleep when asked, and a click wakes it with a fresh voice link for the same session', async () => {
    const store = await started();
    await store.sleep();
    expect(store.getSnapshot().status).toBe('asleep');
    expect(links).toHaveLength(1);
    // Events of the closed link are dropped.
    links[0]!.handlers.onUsage(500);
    expect(store.getSnapshot().tokens).toBe(0);
    await store.wake();
    expect(links).toHaveLength(2);
    expect(links[1]?.session).toMatchObject({ sessionId: sessionView().id });
    expect(typeof links[1]?.session?.voiceTicket).toBe('function');
    expect(store.getSnapshot()).toMatchObject({ status: 'awake', waking: false });
    // The new link counts, and the quiet time starts again from the wake.
    links[1]!.handlers.onUsage(40);
    expect(store.getSnapshot().tokens).toBe(40);
    await pass(30);
    expect(store.getSnapshot().status).toBe('awake');
    await store.stop();
    expect(endCalls).toHaveLength(1);
  });

  it('does not sleep while a typed conversation or no session runs', async () => {
    const store = createLiveStore(deps());
    store.setBackend(backend());
    store.setTransportFactory(transportFactory);
    await store.sleep();
    expect(store.getSnapshot().status).toBe('off');
    await store.start({ channel: 'text' });
    await pass(600);
    expect(store.getSnapshot().status).toBe('awake');
    await store.sleep();
    expect(store.getSnapshot().status).toBe('awake');
    await store.stop();
  });

  it('pressing the push-to-talk key on a sleeping assistant wakes it and carries the press through', async () => {
    const store = await started({ pushToTalk: true });
    await store.sleep();
    store.talk(true); // wakes first
    await vi.advanceTimersByTimeAsync(0);
    expect(links).toHaveLength(2);
    expect(store.getSnapshot()).toMatchObject({ status: 'awake', talking: true });
    expect(links[1]?.talking).toEqual([true]);
    await store.stop();
  });

  it('a key let go before the assistant woke does not start listening', async () => {
    const store = await started({ pushToTalk: true });
    await store.sleep();
    store.talk(true);
    store.talk(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot()).toMatchObject({ status: 'awake', talking: false });
    expect(links[1]?.talking).toEqual([]);
    await store.stop();
  });

  it('ignores the key when the owner chose always listening', async () => {
    const store = await started({ pushToTalk: false });
    store.talk(true);
    expect(store.getSnapshot().talking).toBe(false);
    expect(links[0]?.talking).toEqual([]);
    await store.stop();
  });

  it('a link that cannot be opened again ends the session like a failed start', async () => {
    const store = await started();
    await store.sleep();
    failStart = true;
    await store.wake();
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'start_failed' });
    expect(endCalls).toEqual([{ id: sessionView().id, reason: 'error' }]);
  });

  it('a session the server already ended is reported as such when the assistant is woken', async () => {
    const store = await started();
    await store.sleep();
    ticketError = Object.assign(new Error('ended'), { code: 'LIVE_CAP_REACHED' });
    await store.wake();
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'cap_reached' });
  });

  it('pressing stop while it sleeps ends the session and frees everything', async () => {
    const store = await started();
    await store.sleep();
    await store.stop();
    expect(store.getSnapshot().status).toBe('off');
    expect(endCalls).toHaveLength(1);
    await pass(600);
    expect(links).toHaveLength(1);
  });
  it('listens for the wake phrase on the device only while asleep, and a call wakes it', async () => {
    const store = await started({ idleSleepS: 60, wakeEnabled: true, wakePhrase: 'Hi Docoo' });
    // Awake: the voice link has the microphone, nothing else listens.
    expect(detectors).toHaveLength(0);
    await pass(70);
    expect(store.getSnapshot()).toMatchObject({ status: 'asleep', wakeWord: true });
    expect(detectors).toHaveLength(1);
    expect(detectors[0]).toMatchObject({ phrase: 'Hi Docoo', started: 1 });
    // Heard: the listener lets go of the microphone first, then the voice link opens again.
    detectors[0]!.onWake?.();
    await pass(1);
    expect(detectors[0]?.stopped).toBeGreaterThan(0);
    expect(store.getSnapshot()).toMatchObject({ status: 'awake', wakeWord: false });
    expect(links).toHaveLength(2);
    await store.stop();
  });

  it('does not listen when the owner did not switch it on, or the browser cannot do it on the device', async () => {
    const off = await started({ idleSleepS: 60, wakeEnabled: false, wakePhrase: 'Hi Docoo' });
    await pass(70);
    expect(detectors).toHaveLength(0);
    expect(off.getSnapshot().wakeWord).toBe(false);
    await off.stop();

    detectorAvailable = false;
    const unsupported = await started({
      idleSleepS: 60,
      wakeEnabled: true,
      wakePhrase: 'Hi Docoo',
    });
    await pass(70);
    expect(unsupported.getSnapshot()).toMatchObject({ status: 'asleep', wakeWord: false });
    // A click still wakes it.
    await unsupported.wake();
    expect(unsupported.getSnapshot().status).toBe('awake');
    await unsupported.stop();

    detectorAvailable = true;
    const blank = await started({ idleSleepS: 60, wakeEnabled: true, wakePhrase: '  ' });
    await pass(70);
    expect(detectors).toHaveLength(0);
    await blank.stop();
  });

  it('stays asleep, and says nothing is listening, when the microphone is refused', async () => {
    detectorFails = true;
    const store = await started({ idleSleepS: 60, wakeEnabled: true, wakePhrase: 'Hi Docoo' });
    await pass(70);
    expect(store.getSnapshot()).toMatchObject({ status: 'asleep', wakeWord: false });
    await store.wake();
    expect(store.getSnapshot().status).toBe('awake');
    await store.stop();
  });

  it('stops listening for the phrase when the session ends, or a click wakes it first', async () => {
    const ended = await started({ idleSleepS: 60, wakeEnabled: true, wakePhrase: 'Hi Docoo' });
    await pass(70);
    await ended.stop();
    expect(detectors[0]?.stopped).toBeGreaterThan(0);
    expect(ended.getSnapshot().wakeWord).toBe(false);

    detectors = [];
    const clicked = await started({ idleSleepS: 60, wakeEnabled: true, wakePhrase: 'Hi Docoo' });
    await pass(70);
    await clicked.wake();
    expect(detectors[0]?.stopped).toBeGreaterThan(0);
    expect(clicked.getSnapshot()).toMatchObject({ status: 'awake', wakeWord: false });
    await clicked.stop();
  });

  it('listens again each time it falls asleep, and ignores a call that comes after it woke', async () => {
    const store = await started({ idleSleepS: 60, wakeEnabled: true, wakePhrase: 'Hi Docoo' });
    await pass(70);
    const stale = detectors[0]!.onWake;
    detectors[0]!.onWake?.();
    await pass(1);
    expect(store.getSnapshot().status).toBe('awake');
    // A late call from the stopped listener does nothing.
    stale?.();
    await pass(1);
    expect(links).toHaveLength(2);
    await pass(70);
    expect(store.getSnapshot().status).toBe('asleep');
    expect(detectors).toHaveLength(2);
    expect(store.getSnapshot().wakeWord).toBe(true);
    await store.stop();
  });
});
