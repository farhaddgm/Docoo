import { describe, expect, it } from 'vitest';

import { ExaWebSearch, TavilyWebSearch, type WebSearchPort } from './web-search.js';

const KEY = 'test-key-4471-never-in-an-outcome';
const query = { query: 'build versus buy decision framework', maxResults: 5 };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

/** A fetch that answers from `respond` and remembers what it was asked; it never uses the network. */
function stub(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >,
    });
    return Promise.resolve(respond());
  };
  return { fetchFn, calls };
}

/** A fetch that never answers; it only ends when the signal it is given aborts. */
const hanging: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('the request each provider gets', () => {
  it('sends Exa the key in x-api-key and the count and text size it supports', async () => {
    const { fetchFn, calls } = stub(() => json({ results: [] }));
    await new ExaWebSearch(KEY, { fetch: fetchFn }).search(query);
    expect(calls[0]!.url).toBe('https://api.exa.ai/search');
    expect(calls[0]!.headers['x-api-key']).toBe(KEY);
    expect(calls[0]!.body).toEqual({
      query: query.query,
      numResults: 5,
      contents: { text: { maxCharacters: 1000 } },
    });
  });

  it('sends Tavily the key as a bearer token and a basic search', async () => {
    const { fetchFn, calls } = stub(() => json({ results: [] }));
    await new TavilyWebSearch(KEY, { fetch: fetchFn }).search(query);
    expect(calls[0]!.url).toBe('https://api.tavily.com/search');
    expect(calls[0]!.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.body).toEqual({
      query: query.query,
      max_results: 5,
      search_depth: 'basic',
    });
  });

  it('keeps the count between 1 and 20', async () => {
    const { fetchFn, calls } = stub(() => json({ results: [] }));
    const exa = new ExaWebSearch(KEY, { fetch: fetchFn });
    await exa.search({ query: 'q', maxResults: 500 });
    await exa.search({ query: 'q', maxResults: 0 });
    expect(calls.map((call) => call.body['numResults'])).toEqual([20, 1]);
  });
});

const adapters: readonly [
  string,
  (fetchFn: typeof fetch, timeoutMs?: number) => WebSearchPort,
  string,
][] = [
  [
    'exa',
    (fetchFn, timeoutMs) =>
      new ExaWebSearch(KEY, { fetch: fetchFn, ...(timeoutMs ? { timeoutMs } : {}) }),
    'text',
  ],
  [
    'tavily',
    (fetchFn, timeoutMs) =>
      new TavilyWebSearch(KEY, { fetch: fetchFn, ...(timeoutMs ? { timeoutMs } : {}) }),
    'content',
  ],
];

describe.each(adapters)('%s answers', (id, make, snippetField) => {
  it('returns normalized hits with a rank, and drops what is not a web address', async () => {
    const { fetchFn } = stub(() =>
      json({
        results: [
          { url: 'https://a.example/x', title: '  A   title ', [snippetField]: 'one\n two' },
          { url: 'javascript:alert(1)', title: 'bad scheme', [snippetField]: 'x' },
          { url: 'not a url', title: 'bad', [snippetField]: 'x' },
          null,
          { title: 'no url' },
          { url: 'http://b.example/', title: 'B', [snippetField]: 'two' },
        ],
      }),
    );
    const outcome = await make(fetchFn).search(query);
    expect(outcome).toMatchObject({ ok: true, provider: id });
    if (!outcome.ok) throw new Error('expected hits');
    expect(outcome.hits).toEqual([
      { url: 'https://a.example/x', title: 'A title', snippet: 'one two', rank: 1 },
      { url: 'http://b.example/', title: 'B', snippet: 'two', rank: 2 },
    ]);
  });

  it('cuts long texts and stops at the count asked for', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      url: `https://h${i}.example/`,
      title: 't'.repeat(900),
      [snippetField]: 's'.repeat(5000),
    }));
    const { fetchFn } = stub(() => json({ results: many }));
    const outcome = await make(fetchFn).search({ query: 'q', maxResults: 3 });
    if (!outcome.ok) throw new Error('expected hits');
    expect(outcome.hits).toHaveLength(3);
    expect(outcome.hits[0]!.title).toHaveLength(300);
    expect(outcome.hits[0]!.snippet).toHaveLength(1000);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [402, 'quota_exhausted'],
    [429, 'rate_limited'],
    [408, 'timeout'],
    [504, 'timeout'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [400, 'rejected'],
    [422, 'rejected'],
  ])('reports status %i as %s and does not throw', async (status, code) => {
    const { fetchFn } = stub(() => json({ error: 'x' }, status));
    expect(await make(fetchFn).search(query)).toMatchObject({
      ok: false,
      provider: id,
      code,
      status,
    });
  });

  it('reports a body that is not JSON, or has no results list, as a bad response', async () => {
    const notJson = stub(() => new Response('<html>', { status: 200 }));
    expect(await make(notJson.fetchFn).search(query)).toMatchObject({
      ok: false,
      code: 'bad_response',
    });
    const noList = stub(() => json({ results: 'nope' }));
    expect(await make(noList.fetchFn).search(query)).toMatchObject({
      ok: false,
      code: 'bad_response',
    });
    const empty = stub(() => json(null));
    expect(await make(empty.fetchFn).search(query)).toMatchObject({
      ok: false,
      code: 'bad_response',
    });
  });

  it('reports a network error, a timeout and a caller abort as three different things', async () => {
    const lost: typeof fetch = () => Promise.reject(new TypeError('fetch failed'));
    expect(await make(lost).search(query)).toMatchObject({
      ok: false,
      code: 'network',
      status: null,
    });

    expect(await make(hanging, 20).search(query)).toMatchObject({ ok: false, code: 'timeout' });

    const controller = new AbortController();
    const pending = make(hanging, 5000).search(query, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, code: 'aborted' });
  });

  it('refuses an empty query without calling the provider', async () => {
    const { fetchFn, calls } = stub(() => json({ results: [] }));
    const outcome = await make(fetchFn).search({ query: '   ', maxResults: 5 });
    expect(outcome).toMatchObject({ ok: false, code: 'rejected', status: null });
    expect(calls).toHaveLength(0);
  });

  it('never puts the key into an outcome, success or failure', async () => {
    const good = stub(() => json({ results: [{ url: 'https://a.example/' }] }));
    const refused = stub(() => json({ error: KEY }, 401));
    const broken: typeof fetch = () => Promise.reject(new Error(`boom ${KEY}`));
    const outcomes = [
      await make(good.fetchFn).search(query),
      await make(refused.fetchFn).search(query),
      await make(broken).search(query),
    ];
    for (const outcome of outcomes) expect(JSON.stringify(outcome)).not.toContain(KEY);
  });
});

describe('timing', () => {
  it('measures how long it took with the clock it is given', async () => {
    const times = [1000, 1450];
    const { fetchFn } = stub(() => json({ results: [] }));
    const outcome = await new ExaWebSearch(KEY, {
      fetch: fetchFn,
      now: () => times.shift() ?? 1450,
    }).search(query);
    expect(outcome.latencyMs).toBe(450);
  });
});
