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

async function failure(response: Response): Promise<ApiError> {
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

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

export async function apiPost(path: string, body: unknown): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
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
  const response = await fetch(`/api${path}`, {
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
  if (!response.ok) throw await failure(response);
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
