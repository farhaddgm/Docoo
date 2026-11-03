import { parsePosition } from './drag';
import { acquireSingleTabLock, type LockHandle, type LocksApi } from './lock';
import {
  initialLiveState,
  isLiveActive,
  reduceLive,
  type LiveAction,
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

  /** The status right now; a function so a check made before an await is not assumed to still hold. */
  const currentStatus = (): LiveStatus => state.status;

  function dispatch(action: LiveAction): void {
    const next = reduceLive(state, action);
    if (next === state) return;
    state = next;
    if (action.type === 'move') savePosition(deps.storage, next.position);
    for (const listener of listeners) listener();
  }

  /** Frees the connection and the lock. Safe to call twice; a failing stop never keeps the lock. */
  async function teardown(): Promise<void> {
    const current = transport;
    const held = lock;
    transport = null;
    lock = null;
    try {
      await current?.stop();
    } catch {
      /* best effort: the browser releases the microphone with the page at the latest */
    }
    held?.release();
  }

  /** Events from a transport that was already replaced or stopped are dropped. */
  function handlersFor(owner: LiveTransport): LiveTransportHandlers {
    const live = (act: () => void) => () => {
      if (transport === owner) act();
    };
    return {
      onUsage: (tokens) => {
        if (transport === owner) dispatch({ type: 'usage', tokens });
      },
      onSleep: live(() => dispatch({ type: 'sleep' })),
      onWake: live(() => dispatch({ type: 'wake' })),
      onLost: live(() => {
        if (!isLiveActive(state.status)) return;
        dispatch({ type: 'failed', error: 'connection_lost' });
        void teardown();
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
    const created = factory();
    transport = created;
    try {
      await created.start(handlersFor(created));
    } catch {
      // Read afresh: stop() may have been pressed while the connection was opening.
      if (currentStatus() === 'closing') return;
      await teardown();
      dispatch({ type: 'failed', error: 'start_failed' });
      return;
    }
    dispatch({ type: 'started', now: deps.now() });
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
