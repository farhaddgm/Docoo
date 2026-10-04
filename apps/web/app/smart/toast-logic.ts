import type { SmartError } from './api';

export interface LocalServerEvent {
  readonly method: string;
  readonly status: number;
  readonly at: number;
}

const ECHO_WINDOW_MS = 20_000;

/**
 * A 5xx this browser caused already produced an immediate toast; the feed poll must not show
 * the same error a second time. Matches by method, status and time.
 */
export function isLocalEcho(
  item: Pick<SmartError, 'source' | 'method' | 'httpStatus' | 'lastSeenAt'>,
  local: readonly LocalServerEvent[],
): boolean {
  if (item.source !== 'server') return false;
  const seen = Date.parse(item.lastSeenAt);
  return local.some(
    (event) =>
      event.method === (item.method ?? '').toUpperCase() &&
      event.status === item.httpStatus &&
      Math.abs(seen - event.at) <= ECHO_WINDOW_MS,
  );
}

/** Toasts with the same key within `windowMs` are shown once (an outage polls every 10 s). */
export function createToastGate(windowMs: number): (key: string, now: number) => boolean {
  const last = new Map<string, number>();
  return (key, now) => {
    const previous = last.get(key);
    if (previous !== undefined && now - previous < windowMs) return false;
    last.set(key, now);
    return true;
  };
}
