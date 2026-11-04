import { parsePosition } from './drag';
import type { LiveBackend } from './live-api';
import { acquireSingleTabLock, type LockHandle, type LocksApi } from './lock';
import {
  initialLiveState,
  isLiveActive,
  reduceLive,
  type LiveAction,
  type LiveError,
  type LiveState,
  type LiveStatus,
  type PillPosition,
} from './state';
import type { LiveTransport, LiveTransportFactory, LiveTransportHandlers } from './transport';

/**
 * The live assistant's session, kept outside React like the "AI is working" notice
 * (`ai-activity-store.ts`): it is mounted once in the root layout, so changing page neither closes
 * nor restarts it, and it does not depend on whether the Smart window is open (ADR-0055 §4-11).
 */

export const PILL_STORAGE_KEY = 'docoo.live.pill';

export interface LiveStoreDeps {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Resolves with a handle when this tab may run the session, null when another tab does. */
  readonly acquireLock: () => Promise<LockHandle | null>;
  readonly now: () => number;
  /** How often the open session reports its usage to the server (also its heartbeat). */
  readonly heartbeatMs?: number;
  readonly timers?: {
    readonly every: (work: () => void, ms: number) => () => void;
  };
}

export const HEARTBEAT_MS = 15_000;
/** Without an answer from the server for this many reports in a row the session is closed. */
export const MAX_MISSED_HEARTBEATS = 3;
/** The transcript lines waiting to be sent; the oldest are dropped past this, never the newest. */
const MAX_PENDING_LINES = 200;
const LINES_PER_REQUEST = 20;

type PendingLine = { role: 'user' | 'assistant'; content: string };

/** Why a start was refused, from the problem code the server gave. */
function startErrorOf(error: unknown): LiveError {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'LIVE_CAP_REACHED') return 'cap_reached';
  if (code === 'LIVE_ASSISTANT_UNAVAILABLE') return 'switched_off';
  return 'start_failed';
}

/** Why the server ended a session that was running, from the end reason it recorded. */
function endedErrorOf(reason: string | null): LiveError {
  if (reason === 'cap_cost' || reason === 'cap_time' || reason === 'cap_daily')
    return 'cap_reached';
  if (reason === 'disabled') return 'switched_off';
  if (reason === 'superseded') return 'other_tab';
  return 'connection_lost';
}

function readPosition(storage: LiveStoreDeps['storage']): PillPosition | null {
  try {
    return parsePosition(storage?.getItem(PILL_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

function savePosition(storage: LiveStoreDeps['storage'], position: PillPosition | null): void {
  try {
    if (position) storage?.setItem(PILL_STORAGE_KEY, JSON.stringify(position));
  } catch {
    /* private mode or full storage: the pill simply starts at its default place next time */
  }
}

export function createLiveStore(deps: LiveStoreDeps) {
  let state = initialLiveState(readPosition(deps.storage));
  const serverState = initialLiveState();
  const listeners = new Set<() => void>();
  let factory: LiveTransportFactory | null = null;
  let transport: LiveTransport | null = null;
  let lock: LockHandle | null = null;
  let starting: Promise<void> | null = null;
  // The server side of the session (ADR-0055 §4-5). Without a backend the store runs on its own,
  // which is how the tests and the development stand-in use it.
  let backend: LiveBackend | null = null;
  let sessionId: string | null = null;
  let costUsd = 0;
  let pending: PendingLine[] = [];
  let missed = 0;
  let stopBeating: (() => void) | null = null;
  let beating = false;
  const every =
    deps.timers?.every ??
    ((work: () => void, ms: number) => {
      const id = setInterval(work, ms);
      return () => clearInterval(id);
    });

  /** The status right now; a function so a check made before an await is not assumed to still hold. */
  const currentStatus = (): LiveStatus => state.status;

  function dispatch(action: LiveAction): void {
    const next = reduceLive(state, action);
    if (next === state) return;
    state = next;
    if (action.type === 'move') savePosition(deps.storage, next.position);
    for (const listener of listeners) listener();
  }

  /** Sends the waiting transcript lines; what could not be sent stays for the next report. */
  async function flushLines(): Promise<void> {
    const id = sessionId;
    if (!backend || !id) return;
    while (pending.length > 0) {
      const batch = pending.slice(0, LINES_PER_REQUEST);
      try {
        await backend.appendMessages(id, batch);
      } catch {
        return;
      }
      pending = pending.slice(batch.length);
    }
  }

  /** The session is over at the server; keep nothing that would report to it again. */
  function forgetServerSession(): void {
    stopBeating?.();
    stopBeating = null;
    sessionId = null;
    pending = [];
  }

  /** Frees the connection, the lock and the server session. Safe to call twice; a failing stop never keeps the lock. */
  async function teardown(reason: 'user' | 'error' = 'user'): Promise<void> {
    const current = transport;
    const held = lock;
    const id = sessionId;
    stopBeating?.();
    stopBeating = null;
    transport = null;
    lock = null;
    try {
      await current?.stop();
    } catch {
      /* best effort: the browser releases the microphone with the page at the latest */
    }
    if (backend && id) {
      try {
        await flushLines();
        await backend.endSession(id, reason);
      } catch {
        /* the server ends a session it no longer hears from; the next start also replaces it */
      }
    }
    sessionId = null;
    pending = [];
    held?.release();
  }

  /** What the browser reports: the totals of this session, which only grow. */
  function totals() {
    // Rounded to a millionth of a dollar: adding many small prices leaves floating-point dust.
    return { inputTokens: state.tokens, outputTokens: 0, costUsd: Math.round(costUsd * 1e6) / 1e6 };
  }

  /** The server ended the session (a cap, the owner's switch, another start): close down here. */
  function endedByServer(reason: string | null): void {
    if (!isLiveActive(state.status)) return;
    forgetServerSession();
    dispatch({ type: 'failed', error: endedErrorOf(reason) });
    void teardown();
  }

  async function beat(): Promise<void> {
    const id = sessionId;
    if (!backend || !id || beating || !isLiveActive(state.status)) return;
    beating = true;
    try {
      await flushLines();
      const answer = await backend.reportUsage(id, totals());
      missed = 0;
      if (answer.session.status === 'ended') endedByServer(answer.session.endReason);
      else dispatch({ type: 'warning', on: answer.capStatus === 'warn' });
    } catch {
      missed += 1;
      if (missed >= MAX_MISSED_HEARTBEATS && isLiveActive(state.status)) {
        dispatch({ type: 'failed', error: 'connection_lost' });
        void teardown('error');
      }
    } finally {
      beating = false;
    }
  }

  /** Events from a transport that was already replaced or stopped are dropped. */
  function handlersFor(owner: LiveTransport): LiveTransportHandlers {
    const live = (act: () => void) => () => {
      if (transport === owner) act();
    };
    return {
      onUsage: (tokens, cost) => {
        if (transport !== owner) return;
        dispatch({ type: 'usage', tokens });
        if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) costUsd += cost;
      },
      onMessage: (role, content) => {
        if (transport !== owner || !sessionId || content.trim() === '') return;
        pending.push({ role, content: content.trim().slice(0, 4000) });
        if (pending.length > MAX_PENDING_LINES) pending = pending.slice(-MAX_PENDING_LINES);
      },
      onSleep: live(() => dispatch({ type: 'sleep' })),
      onWake: live(() => dispatch({ type: 'wake' })),
      onLost: live(() => {
        if (!isLiveActive(state.status)) return;
        dispatch({ type: 'failed', error: 'connection_lost' });
        void teardown('error');
      }),
    };
  }

  async function open(): Promise<void> {
    if (!factory) {
      dispatch({ type: 'failed', error: 'unavailable' });
      return;
    }
    const handle = await deps.acquireLock();
    if (!handle) {
      dispatch({ type: 'failed', error: 'other_tab' });
      return;
    }
    lock = handle;
    // stop() was pressed while waiting for the lock: it tears everything down.
    if (state.status !== 'starting') return;
    costUsd = 0;
    missed = 0;
    pending = [];
    if (backend) {
      // The server first: it checks that the assistant is on and no cap is reached before the
      // microphone or any connection to a provider is opened.
      try {
        sessionId = (await backend.startSession()).id;
      } catch (error) {
        if (currentStatus() === 'closing') return;
        await teardown('error');
        dispatch({ type: 'failed', error: startErrorOf(error) });
        return;
      }
      if (currentStatus() !== 'starting') return;
    }
    const created = factory();
    transport = created;
    try {
      await created.start(handlersFor(created));
    } catch {
      // Read afresh: stop() may have been pressed while the connection was opening.
      if (currentStatus() === 'closing') return;
      await teardown('error');
      dispatch({ type: 'failed', error: 'start_failed' });
      return;
    }
    dispatch({ type: 'started', now: deps.now() });
    if (backend && sessionId) {
      stopBeating = every(() => void beat(), deps.heartbeatMs ?? HEARTBEAT_MS);
    }
  }

  function start(): Promise<void> {
    if (state.status !== 'off' && state.status !== 'error') return starting ?? Promise.resolve();
    dispatch({ type: 'start' });
    starting = open().finally(() => {
      starting = null;
    });
    return starting;
  }

  async function stop(): Promise<void> {
    if (state.status === 'error') {
      dispatch({ type: 'stop' });
      return;
    }
    if (!isLiveActive(state.status)) return;
    dispatch({ type: 'stop' });
    await starting?.catch(() => undefined);
    await teardown();
    dispatch({ type: 'stopped' });
  }

  return {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: (): LiveState => state,
    getServerSnapshot: (): LiveState => serverState,
    start,
    stop,
    move: (position: PillPosition | null): void => dispatch({ type: 'move', position }),
    /**
     * Tells the store which workspace's server to report to. A session already running keeps the
     * backend it started with, so opening the Smart tab of another workspace changes nothing.
     */
    setBackend: (next: LiveBackend | null): void => {
      if (!isLiveActive(state.status) && state.status !== 'closing') backend = next;
    },
    /** Tells the store how to reach the provider; without one, starting reports "unavailable". */
    setTransportFactory: (next: LiveTransportFactory | null): void => {
      factory = next;
      dispatch({ type: 'availability', available: next !== null });
    },
  };
}

export type LiveStore = ReturnType<typeof createLiveStore>;

function browserDeps(): LiveStoreDeps {
  const granted: LockHandle = { release: () => undefined };
  if (typeof window === 'undefined') {
    return { storage: null, acquireLock: () => Promise.resolve(granted), now: () => Date.now() };
  }
  let storage: Storage | null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    storage,
    acquireLock: () => acquireSingleTabLock((navigator as unknown as { locks?: LocksApi }).locks),
    now: () => Date.now(),
  };
}

/** The one store of this page. The root layout mounts its pill; nothing else owns a session. */
export const liveAssistant: LiveStore = createLiveStore(browserDeps());
