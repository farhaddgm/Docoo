import { smartBus } from './smart/bus';

/** Thin same-origin client for the API behind the `/api` rewrite; errors keep the problem code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

async function failure(response: Response, method: string, path: string): Promise<ApiError> {
  if (response.status >= 500) {
    smartBus.emit({ type: 'server-error', status: response.status, method, path });
  }
  try {
    const body = (await response.json()) as { code?: unknown };
    return new ApiError(response.status, typeof body.code === 'string' ? body.code : undefined);
  } catch {
    return new ApiError(response.status, undefined);
  }
}

/** One place for `fetch`, so a network failure reaches Smart's error tracker (SMT-001). */
async function send(
  method: string,
  path: string,
  options: { body?: unknown; signal?: AbortSignal | undefined } = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      ...(options.body !== undefined
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(options.body),
          }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      smartBus.emit({
        type: 'client-error',
        kind: 'api',
        message: error instanceof Error ? error.message : 'Network request failed',
        method,
        path,
      });
    }
    throw error;
  }
  if (!response.ok) throw await failure(response, method, path);
  return response;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return (await (await send('GET', path, { signal })).json()) as T;
}

export async function apiPost(path: string, body: unknown): Promise<Response> {
  return send('POST', path, { body });
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return (await (await send('PATCH', path, { body })).json()) as T;
}

export async function apiDelete(path: string): Promise<void> {
  await send('DELETE', path);
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
