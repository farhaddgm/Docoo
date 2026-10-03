/** Thin same-origin client for the API behind the `/api` rewrite; errors keep the problem code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

async function failure(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return new ApiError(response.status, typeof body.code === 'string' ? body.code : undefined);
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
