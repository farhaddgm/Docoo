import { useSyncExternalStore } from 'react';

/**
 * The owner's controls over the monitor windows (ADR-0056 §5-4): black the screens out, bring them
 * back, stop the broadcast. They are kept in the browser's local storage, so every window of this
 * browser sees a change at once and a window that is reloaded still knows the state. Nothing
 * here touches the server; the back office only records that a control was used.
 */

export interface MonitorControlState {
  /** The screens show a plain black page instead of their content. */
  readonly blackout: boolean;
  /** Windows opened before this moment close themselves (0: never stopped). */
  readonly stopAt: number;
}

export type MonitorCommand = 'blackout' | 'resume' | 'stop';

export const MONITOR_CONTROL_KEY = 'docoo.monitor.control';

export const initialControl: MonitorControlState = { blackout: false, stopAt: 0 };

/** Reads the stored text; anything that is not a valid state is the quiet initial one. */
export function parseControl(raw: string | null): MonitorControlState {
  if (!raw) return initialControl;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof MonitorControlState, unknown>>;
    const stopAt =
      typeof value.stopAt === 'number' && Number.isFinite(value.stopAt) ? value.stopAt : 0;
    return { blackout: value.blackout === true, stopAt: Math.max(0, stopAt) };
  } catch {
    return initialControl;
  }
}

export function reduceControl(
  state: MonitorControlState,
  command: MonitorCommand,
  now: number,
): MonitorControlState {
  switch (command) {
    case 'blackout':
      return { ...state, blackout: true };
    case 'resume':
      return { ...state, blackout: false };
    case 'stop':
      // A stopped broadcast starts again from a clean page, not from a black one.
      return { blackout: false, stopAt: now };
  }
}

/** A window that was opened before the last stop must close. */
export const stoppedSince = (state: MonitorControlState, openedAt: number): boolean =>
  state.stopAt > 0 && openedAt <= state.stopAt;

// ---- the browser store ---------------------------------------------------------------------

const listeners = new Set<() => void>();
let cached: { raw: string | null; state: MonitorControlState } = {
  raw: null,
  state: initialControl,
};

const readRaw = (): string | null => {
  try {
    return window.localStorage.getItem(MONITOR_CONTROL_KEY);
  } catch {
    return null;
  }
};

/** The state, the same object while the stored text is unchanged (what the React store needs). */
export function currentControl(): MonitorControlState {
  const raw = readRaw();
  if (raw !== cached.raw) cached = { raw, state: parseControl(raw) };
  return cached.state;
}

export function sendCommand(command: MonitorCommand, now = Date.now()): MonitorControlState {
  const next = reduceControl(currentControl(), command, now);
  try {
    window.localStorage.setItem(MONITOR_CONTROL_KEY, JSON.stringify(next));
  } catch {
    // Storage can be blocked; the change then only reaches this window's listeners.
  }
  cached = { raw: readRaw(), state: next };
  for (const listener of listeners) listener();
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another window of the same browser changed the state: the storage event tells this one.
  const onStorage = (event: StorageEvent) => {
    if (event.key === MONITOR_CONTROL_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The live control state; before the page is in the browser it is the quiet initial one. */
export function useMonitorControl(): MonitorControlState {
  return useSyncExternalStore(subscribe, currentControl, () => initialControl);
}
