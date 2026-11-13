/**
 * The independent web search port (ADR-0026 §1 and addendum 1.2). The model's own search always
 * runs; this one runs beside it when its service is reachable. A connection problem is therefore
 * an expected outcome, not an exception: `search` never throws, it returns the reason, and the
 * caller carries on with the model's search alone.
 *
 * Nothing from a provider's answer crosses this boundary except normalized hits. The key is kept
 * in the adapter and never appears in an outcome or an error, and the query is never logged here.
 */

export interface WebSearchQuery {
  readonly query: string;
  /** How many hits the caller wants at most (1 to 20). */
  readonly maxResults: number;
}

export interface WebSearchHit {
  /** An absolute http or https address. */
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  /** 1 for the first hit the provider returned that passed normalization. */
  readonly rank: number;
}

/** Why a search did not return hits. `rejected` is a request the provider refused as malformed. */
export type WebSearchFailure =
  | 'unauthorized'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable'
  | 'bad_response'
  | 'rejected'
  | 'aborted'
  | 'network';

export type WebSearchOutcome =
  | {
      readonly ok: true;
      readonly provider: string;
      readonly hits: readonly WebSearchHit[];
      readonly latencyMs: number;
    }
  | {
      readonly ok: false;
      readonly provider: string;
      readonly code: WebSearchFailure;
      /** The HTTP status when there was an answer; null when there was none. */
      readonly status: number | null;
      readonly latencyMs: number;
    };

export interface WebSearchPort {
  readonly id: string;
  search(query: WebSearchQuery, signal?: AbortSignal): Promise<WebSearchOutcome>;
}

export interface WebSearchOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** For tests: a fetch that does not touch the network. */
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

const MAX_TITLE = 300;
const MAX_SNIPPET = 1000;
const MIN_RESULTS = 1;
const MAX_RESULTS = 20;

const text = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, limit) : '';

/** Keeps only absolute http(s) addresses; anything else from a provider is dropped. */
function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Turns a provider's list of results into hits: bad entries are dropped, the rest is capped. */
function toHits(
  items: unknown,
  pick: (item: Record<string, unknown>) => { url: unknown; title: unknown; snippet: unknown },
  limit: number,
): WebSearchHit[] | null {
  if (!Array.isArray(items)) return null;
  const hits: WebSearchHit[] = [];
  for (const item of items) {
    if (hits.length >= limit) break;
    if (typeof item !== 'object' || item === null) continue;
    const { url, title, snippet } = pick(item as Record<string, unknown>);
    const address = httpUrl(url);
    if (address === null) continue;
    hits.push({
      url: address,
      title: text(title, MAX_TITLE),
      snippet: text(snippet, MAX_SNIPPET),
      rank: hits.length + 1,
    });
  }
  return hits;
}

function failureFor(status: number): WebSearchFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 402) return 'quota_exhausted';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'unavailable';
  return 'rejected';
}

interface Call {
  readonly id: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly parse: (json: unknown, limit: number) => WebSearchHit[] | null;
}

async function run(
  call: Call,
  query: WebSearchQuery,
  signal: AbortSignal | undefined,
  options: Required<Pick<WebSearchOptions, 'timeoutMs' | 'fetch' | 'now'>>,
): Promise<WebSearchOutcome> {
  const started = options.now();
  const failed = (code: WebSearchFailure, status: number | null): WebSearchOutcome => ({
    ok: false,
    provider: call.id,
    code,
    status,
    latencyMs: Math.max(0, options.now() - started),
  });
  const limit = Math.min(MAX_RESULTS, Math.max(MIN_RESULTS, Math.trunc(query.maxResults)));
  if (query.query.trim() === '') return failed('rejected', null);

  const timeout = AbortSignal.timeout(options.timeoutMs);
  try {
    const response = await options.fetch(call.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...call.headers },
      body: JSON.stringify(call.body),
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    if (!response.ok) return failed(failureFor(response.status), response.status);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return failed('bad_response', response.status);
    }
    const hits = call.parse(json, limit);
    if (hits === null) return failed('bad_response', response.status);
    return {
      ok: true,
      provider: call.id,
      hits,
      latencyMs: Math.max(0, options.now() - started),
    };
  } catch {
    if (signal?.aborted) return failed('aborted', null);
    return failed(timeout.aborted ? 'timeout' : 'network', null);
  }
}

const resolved = (options: WebSearchOptions) => ({
  timeoutMs: options.timeoutMs ?? 15_000,
  fetch: options.fetch ?? fetch,
  now: options.now ?? Date.now,
});

/** Exa: `POST /search` with the key in `x-api-key` (SPK-001 checked this against a real answer). */
export class ExaWebSearch implements WebSearchPort {
  readonly id = 'exa';

  constructor(
    private readonly apiKey: string,
    private readonly options: WebSearchOptions = {},
  ) {}

  search(query: WebSearchQuery, signal?: AbortSignal): Promise<WebSearchOutcome> {
    const base = (this.options.baseUrl ?? 'https://api.exa.ai').replace(/\/$/u, '');
    return run(
      {
        id: this.id,
        url: `${base}/search`,
        headers: { 'x-api-key': this.apiKey },
        body: {
          query: query.query,
          numResults: Math.min(MAX_RESULTS, Math.max(MIN_RESULTS, Math.trunc(query.maxResults))),
          contents: { text: { maxCharacters: MAX_SNIPPET } },
        },
        parse: (json, limit) =>
          toHits(
            (json as { results?: unknown } | null)?.results,
            (item) => ({ url: item['url'], title: item['title'], snippet: item['text'] }),
            limit,
          ),
      },
      query,
      signal,
      resolved(this.options),
    );
  }
}

/** Tavily: `POST /search` with `Authorization: Bearer` (SPK-001 checked this against a real answer). */
export class TavilyWebSearch implements WebSearchPort {
  readonly id = 'tavily';

  constructor(
    private readonly apiKey: string,
    private readonly options: WebSearchOptions = {},
  ) {}

  search(query: WebSearchQuery, signal?: AbortSignal): Promise<WebSearchOutcome> {
    const base = (this.options.baseUrl ?? 'https://api.tavily.com').replace(/\/$/u, '');
    return run(
      {
        id: this.id,
        url: `${base}/search`,
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: {
          query: query.query,
          max_results: Math.min(MAX_RESULTS, Math.max(MIN_RESULTS, Math.trunc(query.maxResults))),
          search_depth: 'basic',
        },
        parse: (json, limit) =>
          toHits(
            (json as { results?: unknown } | null)?.results,
            (item) => ({ url: item['url'], title: item['title'], snippet: item['content'] }),
            limit,
          ),
      },
      query,
      signal,
      resolved(this.options),
    );
  }
}
