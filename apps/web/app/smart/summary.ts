import { useEffect, useSyncExternalStore } from 'react';

import { smartApi } from './api';

export interface SmartSummary {
  readonly openErrors: number;
  readonly openIssues: number;
}

const POLL_MS = 30_000;
const listeners = new Set<() => void>();
let value: SmartSummary | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let watched: string | null = null;
let users = 0;

function publish(next: SmartSummary | null): void {
  if (
    next === value ||
    (next && value && next.openErrors === value.openErrors && next.openIssues === value.openIssues)
  ) {
    return;
  }
  value = next;
  for (const listener of listeners) listener();
}

async function poll(): Promise<void> {
  if (!watched || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
    return;
  }
  try {
    publish(await smartApi.summary(watched));
  } catch {
    /* a failed poll keeps the last value */
  }
}

/** Reads the counters again now (after the admin changed an error or issue). */
export function refreshSummary(): void {
  void poll();
}

/**
 * Shared poller for the open-error badge: one request every 30 s no matter how many
 * components show it.
 */
export function useSmartSummary(workspaceId: string, active: boolean): SmartSummary | null {
  useEffect(() => {
    if (!active) return;
    if (watched !== workspaceId) {
      watched = workspaceId;
      publish(null);
    }
    users += 1;
    if (users === 1) timer = setInterval(() => void poll(), POLL_MS);
    void poll();
    return () => {
      users -= 1;
      if (users === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [workspaceId, active]);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => value,
    () => null,
  );
}
