import { ProviderError } from './contract.js';

export interface HttpResult {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
  readonly latencyMs: number;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function retryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** Maps HTTP status to the error taxonomy; the response body is never put in the message. */
export function errorForStatus(status: number, headers: Headers, provider: string): ProviderError {
  if (status === 401 || status === 403)
    return new ProviderError('auth', `${provider}_unauthorized`, status);
  if (status === 408) return new ProviderError('timeout', `${provider}_timeout`, status);
  if (status === 429)
    return new ProviderError(
      'rate_limited',
      `${provider}_rate_limited`,
      status,
      retryAfter(headers),
    );
  if (status >= 500)
    return new ProviderError('transient', `${provider}_unavailable`, status, retryAfter(headers));
  return new ProviderError('invalid_request', `${provider}_bad_request_${status}`, status);
}

export async function requestJson(
  fetchImpl: FetchLike,
  provider: string,
  url: string,
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: unknown;
    timeoutMs: number;
  },
): Promise<HttpResult> {
  const started = performance.now();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method,
      headers: {
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError')
      throw new ProviderError('timeout', `${provider}_timeout`);
    throw new ProviderError('transient', `${provider}_unreachable`);
  }
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw errorForStatus(response.status, response.headers, provider);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ProviderError('transient', `${provider}_invalid_json`, response.status);
  }
  return { status: response.status, headers: response.headers, body, latencyMs };
}

export function parseStructured(text: string, provider: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('invalid_output', `${provider}_structured_output_invalid`);
  }
}
