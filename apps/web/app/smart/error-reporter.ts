import { smartBus } from './bus';
import { smartUi } from './ui-state';

export interface ClientReport {
  readonly kind: 'runtime' | 'promise' | 'render' | 'api';
  readonly message: string;
  readonly detail?: string | undefined;
  readonly method?: string | undefined;
  readonly path?: string | undefined;
}

export interface Limiter {
  /** True when a report with this signature may be sent now. */
  allow(signature: string, now: number): boolean;
}

/**
 * Keeps a crash loop from flooding the server: the same signature is sent at most once per
 * `dedupeMs`, and at most `max` reports go out per `windowMs` in total.
 */
export function createLimiter(options: {
  windowMs: number;
  max: number;
  dedupeMs: number;
}): Limiter {
  const recent = new Map<string, number>();
  let sent: number[] = [];
  return {
    allow(signature, now) {
      const last = recent.get(signature);
      if (last !== undefined && now - last < options.dedupeMs) return false;
      sent = sent.filter((time) => now - time < options.windowMs);
      if (sent.length >= options.max) return false;
      recent.set(signature, now);
      sent.push(now);
      if (recent.size > 100) {
        for (const [key, time] of recent) {
          if (now - time >= options.dedupeMs) recent.delete(key);
        }
      }
      return true;
    },
  };
}

const limiter = createLimiter({ windowMs: 60_000, max: 5, dedupeMs: 60_000 });
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i];

let workspaceId: string | null = null;
let lookup: Promise<string | null> | null = null;

export function setReporterWorkspace(id: string | null): void {
  workspaceId = id;
}

async function resolveWorkspace(): Promise<string | null> {
  if (workspaceId) return workspaceId;
  lookup ??= fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' })
    .then(async (response) =>
      response.ok
        ? (((await response.json()) as { workspaces?: { id: string }[] }).workspaces?.[0]?.id ??
          null)
        : null,
    )
    .catch(() => null);
  workspaceId = await lookup;
  if (!workspaceId) lookup = null;
  return workspaceId;
}

/**
 * Sends a browser error to the tracker. Uses plain `fetch` (never the api-client), so a
 * failure of the report itself cannot raise another report.
 */
export async function reportClientError(report: ClientReport): Promise<void> {
  const message = report.message.trim().slice(0, 2000);
  if (!message || IGNORED.some((pattern) => pattern.test(message))) return;
  const page = typeof location === 'undefined' ? '/' : location.pathname;
  if (!limiter.allow(`${report.kind}|${page}|${message}`, Date.now())) return;
  try {
    const id = await resolveWorkspace();
    if (!id) return;
    const response = await fetch(`/api/workspaces/${id}/smart/errors`, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: report.kind,
        message,
        page,
        ...(report.detail ? { detail: report.detail.slice(0, 8000) } : {}),
        ...(report.method ? { method: report.method } : {}),
        ...(report.path ? { path: report.path.slice(0, 300) } : {}),
        ...(smartUi.getSnapshot().projectId ? { projectId: smartUi.getSnapshot().projectId } : {}),
      }),
    });
    if (!response.ok) return;
    const body = (await response.json()) as { error?: { id?: string } };
    if (body.error?.id) smartBus.emit({ type: 'error-recorded', errorId: body.error.id, message });
  } catch {
    /* the tracker is best effort */
  }
}

/** Hooks window errors and bus events; returns the cleanup. Call once per signed-in page. */
export function installErrorReporter(): () => void {
  const onError = (event: ErrorEvent) => {
    const error: unknown = event.error;
    void reportClientError({
      kind: 'runtime',
      message: event.message || (error instanceof Error ? error.message : 'Unknown error'),
      detail: error instanceof Error ? error.stack : undefined,
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    void reportClientError({
      kind: 'promise',
      message:
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'Unhandled rejection',
      detail: reason instanceof Error ? reason.stack : undefined,
    });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const off = smartBus.on((event) => {
    if (event.type === 'client-error') void reportClientError(event);
  });
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    off();
  };
}
