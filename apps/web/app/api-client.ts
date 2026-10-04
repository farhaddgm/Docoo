import { smartBus } from './smart/bus';

/** Thin same-origin client for the API behind the `/api` rewrite; errors keep the problem code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    /** Machine-readable reasons some problems carry, such as why a project is not ready. */
    readonly problems: readonly string[] = [],
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

async function failure(response: Response, method: string, path: string): Promise<ApiError> {
  if (response.status >= 500) {
    smartBus.emit({ type: 'server-error', status: response.status, method, path });
  }
  try {
    const body = (await response.json()) as { code?: unknown; problems?: unknown };
    const problems = Array.isArray(body.problems)
      ? body.problems.filter((item): item is string => typeof item === 'string')
      : [];
    return new ApiError(
      response.status,
      typeof body.code === 'string' ? body.code : undefined,
      problems,
    );
  } catch {
    return new ApiError(response.status, undefined);
  }
}

/** A network failure (no answer at all) goes to Smart's error tracker (SMT-001). */
function reportNetworkFailure(error: unknown, method: string, path: string): void {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  smartBus.emit({
    type: 'client-error',
    kind: 'api',
    message: error instanceof Error ? error.message : 'Network request failed',
    method,
    path,
  });
}

/** A reverse proxy that reuses a connection the API just closed fails once and then works. */
const RETRY_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 400;

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const request = () =>
    fetch(`/api${path}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    });
  let response: Response;
  try {
    response = await request();
    if (RETRY_STATUSES.has(response.status)) throw new TypeError('Bad gateway');
  } catch (error) {
    if (signal?.aborted) throw error;
    // Reads are safe to repeat; one retry hides a transient network or gateway failure.
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      response = await request();
    } catch (retryError) {
      reportNetworkFailure(retryError, 'GET', path);
      throw retryError;
    }
  }
  if (!response.ok) throw await failure(response, 'GET', path);
  return (await response.json()) as T;
}

export async function apiPost(path: string, body: unknown): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    reportNetworkFailure(error, 'POST', path);
    throw error;
  }
  if (!response.ok) throw await failure(response, 'POST', path);
  return response;
}

/**
 * Sends a mutation and returns the parsed JSON body (`undefined` for an empty one).
 * `version` becomes the `If-Match` header the API requires for optimistic concurrency.
 */
export async function apiSend<T = unknown>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options: { version?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.version === undefined ? {} : { 'if-match': `"${options.version}"` }),
        ...options.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    reportNetworkFailure(error, method, path);
    throw error;
  }
  if (!response.ok) throw await failure(response, method, path);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A fresh key per user action so a repeated click or retry cannot apply a command twice. */
export function idempotencyKey(): string {
  return `web-${crypto.randomUUID()}`;
}

/** Converts a `yyyy-mm-dd` date input to the UTC start (or end) of that day. */
export function dayBoundary(value: string, end = false): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  if (end) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

export function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
}
