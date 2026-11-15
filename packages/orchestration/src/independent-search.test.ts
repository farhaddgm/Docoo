import type {
  WebSearchFailure,
  WebSearchHit,
  WebSearchOutcome,
  WebSearchPort,
} from '@docoo/ingestion';
import { describe, expect, it } from 'vitest';

import {
  buildIndependentQueries,
  mergeIndependent,
  runIndependentSearch,
  runIndependentStep,
  type IndependentRun,
  type IndependentStepDeps,
} from './independent-search.js';
import { NO_WEB, type WebRun } from './research.js';

const hit = (
  url: string,
  rank: number,
  snippet = `text of ${url}`,
  title = `T ${url}`,
): WebSearchHit => ({
  url,
  title,
  snippet,
  rank,
});

/** A port that answers each query from a table, or fails with a code; it remembers what it was asked. */
function fakePort(
  id: string,
  answers: Record<string, readonly WebSearchHit[] | WebSearchFailure>,
): WebSearchPort & { asked: string[] } {
  const asked: string[] = [];
  return {
    id,
    asked,
    search: (query): Promise<WebSearchOutcome> => {
      asked.push(query.query);
      const answer = answers[query.query] ?? [];
      return Promise.resolve(
        typeof answer === 'string'
          ? { ok: false, provider: id, code: answer, status: null, latencyMs: 5 }
          : { ok: true, provider: id, hits: answer, latencyMs: 5 },
      );
    },
  };
}

const policy = { maxQueries: 5, resultsPerQuery: 8 };

describe('buildIndependentQueries', () => {
  it('uses the confirmed questions that need the web, in order', () => {
    const built = buildIndependentQueries({
      questions: [
        { question: 'What do competitors charge per seat?', channel: 'web' },
        { question: 'Which of our contracts renew in Q3?', channel: 'knowledge' },
        { question: 'How large is the logistics software market?', channel: 'both' },
      ],
      problem: 'unused when a plan exists',
      projectTitle: 'Pricing',
      max: 5,
    });
    expect(built.queries).toEqual([
      'What do competitors charge per seat?',
      'How large is the logistics software market?',
    ]);
    expect(built.blocked).toEqual([]);
  });

  it('falls back to the problem and the title when there is no plan', () => {
    const built = buildIndependentQueries({
      questions: [],
      problem: 'Reduce churn in the SMB segment',
      projectTitle: 'Churn',
      max: 5,
    });
    expect(built.queries).toEqual(['Reduce churn in the SMB segment', 'Churn']);
  });

  it('counts refused queries by reason and never keeps their text', () => {
    const built = buildIndependentQueries({
      questions: [
        { question: 'Ask ali.rezaei@acme-corp.com about the tender', channel: 'web' },
        { question: 'What is the average SaaS churn rate?', channel: 'web' },
        { question: 'what is the average  SaaS churn rate?', channel: 'both' },
        { question: 'Is 10.0.4.17 the server that fails?', channel: 'web' },
      ],
      problem: '',
      projectTitle: '',
      max: 5,
    });
    expect(built.queries).toEqual(['What is the average SaaS churn rate?']);
    expect(built.blocked).toEqual([
      { reason: 'email', count: 1 },
      { reason: 'internal_address', count: 1 },
    ]);
    expect(JSON.stringify(built)).not.toContain('acme');
  });

  it('stops at the maximum', () => {
    const questions = Array.from({ length: 9 }, (_, index) => ({
      question: `Question number ${index + 1} about the market`,
      channel: 'web' as const,
    }));
    const built = buildIndependentQueries({ questions, problem: '', projectTitle: '', max: 3 });
    expect(built.queries).toHaveLength(3);
  });
});

describe('runIndependentSearch', () => {
  const built = { queries: ['alpha query', 'beta query'], blocked: [] };

  it('asks every service every query and merges the pages by address', async () => {
    const exa = fakePort('exa', {
      'alpha query': [
        hit('https://www.example.com/a?utm_source=x', 1, 'exa text a'),
        hit('https://only-exa.org/p', 2),
      ],
      'beta query': [hit('https://example.com/a/', 1, 'exa text a again')],
    });
    const tavily = fakePort('tavily', {
      'alpha query': [
        hit('https://example.com/a', 1, 'tavily text a'),
        hit('https://only-tavily.org/p', 2),
      ],
    });
    const run = await runIndependentSearch({ ports: [exa, tavily], queries: built, policy });
    expect(exa.asked).toEqual(['alpha query', 'beta query']);
    expect(tavily.asked).toEqual(['alpha query', 'beta query']);
    expect(run.providers.map((p) => [p.id, p.status, p.hits])).toEqual([
      ['exa', 'used', 3],
      ['tavily', 'used', 2],
    ]);
    // The page both found, in both queries, comes first; its text carries both services' words.
    const first = run.pages[0]!;
    expect(first.url).toBe('https://www.example.com/a?utm_source=x');
    expect(first.providers).toEqual(['exa', 'tavily']);
    expect(first.queryCount).toBe(2);
    expect(first.text).toContain('exa text a');
    expect(first.text).toContain('tavily text a');
    expect(run.pages.map((p) => p.url)).toHaveLength(3);
  });

  it('gives the same order for the same answers', async () => {
    const answers = { 'alpha query': [hit('https://a.org/1', 1), hit('https://b.org/1', 2)] };
    const one = await runIndependentSearch({
      ports: [fakePort('exa', answers)],
      queries: built,
      policy,
    });
    const two = await runIndependentSearch({
      ports: [fakePort('exa', answers)],
      queries: built,
      policy,
    });
    expect(two.pages).toEqual(one.pages);
  });

  it('keeps the other service when one fails, and reports the failure', async () => {
    const exa = fakePort('exa', { 'alpha query': 'quota_exhausted' });
    const tavily = fakePort('tavily', { 'alpha query': [hit('https://t.org/1', 1)] });
    const run = await runIndependentSearch({ ports: [exa, tavily], queries: built, policy });
    expect(run.providers[0]).toMatchObject({
      id: 'exa',
      status: 'failed',
      code: 'quota_exhausted',
      queries: 1,
    });
    // A service out of credit is not asked the second query.
    expect(exa.asked).toEqual(['alpha query']);
    expect(run.providers[1]?.status).toBe('used');
    expect(run.pages).toHaveLength(1);
  });

  it('keeps going after a timeout and still marks the service used when a later query worked', async () => {
    const exa = fakePort('exa', {
      'alpha query': 'timeout',
      'beta query': [hit('https://e.org/1', 1)],
    });
    const run = await runIndependentSearch({ ports: [exa], queries: built, policy });
    expect(run.providers[0]).toMatchObject({ status: 'used', code: 'timeout', failedQueries: 1 });
    expect(run.pages).toHaveLength(1);
  });

  it('returns an empty run, without calling anyone, when there is nothing to ask', async () => {
    const exa = fakePort('exa', {});
    const none = await runIndependentSearch({
      ports: [exa],
      queries: { queries: [], blocked: [{ reason: 'email', count: 2 }] },
      policy,
    });
    expect(exa.asked).toEqual([]);
    expect(none.pages).toEqual([]);
    expect(none.blocked).toEqual([{ reason: 'email', count: 2 }]);
  });

  it('passes the number of results asked for', async () => {
    const seen: number[] = [];
    const port: WebSearchPort = {
      id: 'exa',
      search: (query) => {
        seen.push(query.maxResults);
        return Promise.resolve({ ok: true, provider: 'exa', hits: [], latencyMs: 1 });
      },
    };
    await runIndependentSearch({
      ports: [port],
      queries: { queries: ['one query'], blocked: [] },
      policy: { maxQueries: 1, resultsPerQuery: 3 },
    });
    expect(seen).toEqual([3]);
  });
});

describe('mergeIndependent', () => {
  const nativePage = (n: number, url: string, text = `native ${n}`) => ({
    ref: `W${n}`,
    url,
    title: `N${n}`,
    text,
    sourceClass: 'public' as const,
  });
  const native = (...pages: ReturnType<typeof nativePage>[]): WebRun => ({
    status: pages.length ? 'used' : 'none',
    code: null,
    queries: ['q'],
    sources: pages,
  });
  const run = (
    pages: { url: string; text?: string; providers?: string[] }[],
    providers: IndependentRun['providers'] = [
      {
        id: 'exa',
        status: 'used',
        code: null,
        queries: 1,
        failedQueries: 0,
        hits: pages.length,
        latencyMs: 1,
      },
    ],
  ): IndependentRun => ({
    queries: ['q'],
    blocked: [],
    providers,
    pages: pages.map((page, index) => ({
      url: page.url,
      title: `I${index}`,
      text: page.text ?? `service ${index}`,
      providers: page.providers ?? ['exa'],
      queryCount: 1,
      bestRank: index + 1,
    })),
  });
  const opts = { limit: 12, refOffset: 0, officialDomains: [] as string[] };

  it('adds service-only pages after the native ones with the next refs', () => {
    const merged = mergeIndependent(
      native(nativePage(1, 'https://a.org/x'), nativePage(2, 'https://b.org/x')),
      run([{ url: 'https://c.gov/x' }]),
      opts,
    );
    expect(merged.sources.map((s) => [s.ref, s.via])).toEqual([
      ['W1', ['native']],
      ['W2', ['native']],
      ['W3', ['independent:exa']],
    ]);
    expect(merged.sources[2]?.sourceClass).toBe('official');
    expect(merged.independent?.outcome).toBe('both');
  });

  it('folds a page both found into the native page, keeping both texts so a quote from either verifies', () => {
    const merged = mergeIndependent(
      native(nativePage(1, 'https://a.org/x?utm_campaign=1', 'the model wrote this')),
      run([
        {
          url: 'https://www.a.org/x',
          text: 'the service wrote this',
          providers: ['exa', 'tavily'],
        },
      ]),
      opts,
    );
    expect(merged.sources).toHaveLength(1);
    expect(merged.sources[0]).toMatchObject({
      ref: 'W1',
      via: ['native', 'independent:exa', 'independent:tavily'],
    });
    expect(merged.sources[0]?.text).toContain('the model wrote this');
    expect(merged.sources[0]?.text).toContain('the service wrote this');
  });

  it('continues refs after the offset of an earlier round', () => {
    const merged = mergeIndependent(native(), run([{ url: 'https://c.org/x' }]), {
      ...opts,
      refOffset: 4,
    });
    expect(merged.sources.map((s) => s.ref)).toEqual(['W5']);
  });

  it('keeps room for service-only pages when the model search fills the list', () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      nativePage(index + 1, `https://n${index}.org/x`),
    );
    const merged = mergeIndependent(
      native(...many),
      run([{ url: 'https://s1.org/x' }, { url: 'https://s2.org/x' }, { url: 'https://s3.org/x' }]),
      { ...opts, limit: 6 },
    );
    expect(merged.sources).toHaveLength(6);
    // A third of six is two reserved places: four native pages stay, two service pages join.
    expect(merged.sources.filter((s) => s.via?.[0] === 'native')).toHaveLength(4);
    expect(merged.sources.filter((s) => s.via?.[0] === 'independent:exa')).toHaveLength(2);
    expect(new Set(merged.sources.map((s) => s.ref)).size).toBe(6);
  });

  it('does not touch the native pages when no service found anything new', () => {
    const merged = mergeIndependent(native(nativePage(1, 'https://a.org/x')), run([]), opts);
    expect(merged.sources).toHaveLength(1);
    expect(merged.independent?.outcome).toBe('native');
  });

  it('falls back to the native result when every service failed', () => {
    const failed: IndependentRun = run(
      [],
      [
        {
          id: 'exa',
          status: 'failed',
          code: 'unauthorized',
          queries: 1,
          failedQueries: 1,
          hits: 0,
          latencyMs: 1,
        },
      ],
    );
    const merged = mergeIndependent(native(nativePage(1, 'https://a.org/x')), failed, opts);
    expect(merged.status).toBe('used');
    expect(merged.independent?.outcome).toBe('native');
    expect(merged.independent?.providers[0]?.code).toBe('unauthorized');
  });

  it('uses the services alone when the model search failed', () => {
    const merged = mergeIndependent(
      { ...NO_WEB, status: 'failed', code: 'web_search_failed' },
      run([{ url: 'https://c.org/x' }]),
      opts,
    );
    expect(merged.status).toBe('used');
    expect(merged.code).toBeNull();
    expect(merged.independent?.outcome).toBe('independent');
  });

  it('stays failed when both sides failed', () => {
    const merged = mergeIndependent(
      { ...NO_WEB, status: 'failed', code: 'web_search_failed' },
      run(
        [],
        [
          {
            id: 'exa',
            status: 'failed',
            code: 'timeout',
            queries: 1,
            failedQueries: 1,
            hits: 0,
            latencyMs: 1,
          },
        ],
      ),
      opts,
    );
    expect(merged.status).toBe('failed');
    expect(merged.code).toBe('web_search_failed');
    expect(merged.independent?.outcome).toBe('none');
  });
});

describe('runIndependentStep', () => {
  const recorded: Parameters<IndependentStepDeps['record']>[0][] = [];
  const progressed: Record<string, unknown>[] = [];
  const base = (over: Partial<IndependentStepDeps> = {}): IndependentStepDeps => ({
    enabled: true,
    denied: false,
    policy: { maxQueries: 5, resultsPerQuery: 8 },
    questions: [
      { question: 'What do competitors charge per seat?', channel: 'web' },
      { question: 'Ask ali.rezaei@acme-corp.com for the quote', channel: 'web' },
    ],
    problem: 'Pricing',
    projectTitle: 'Pricing project',
    loadPorts: () =>
      Promise.resolve({
        ports: [
          {
            connectionId: 'c1',
            costPerQueryUsd: 0.007,
            port: fakePort('exa', {
              'What do competitors charge per seat?': [hit('https://a.org/x', 1)],
            }),
          },
          {
            connectionId: 'c2',
            costPerQueryUsd: 0.008,
            port: fakePort('tavily', {
              'What do competitors charge per seat?': [hit('https://b.org/x', 1)],
            }),
          },
        ],
        unavailable: [],
      }),
    affordable: () => Promise.resolve(true),
    record: (entry) => {
      recorded.push(entry);
      return Promise.resolve();
    },
    progress: (data) => {
      progressed.push(data);
      return Promise.resolve();
    },
    ...over,
  });
  const reset = () => {
    recorded.length = 0;
    progressed.length = 0;
  };

  it('does nothing when it is off or the role may not search', async () => {
    reset();
    expect(await runIndependentStep(base({ enabled: false }))).toBeNull();
    expect(await runIndependentStep(base({ denied: true }))).toBeNull();
    expect(recorded).toEqual([]);
  });

  it('asks every connected service, drops the query that fails the privacy check, and records the cost of each', async () => {
    reset();
    const done = await runIndependentStep(base());
    expect(done?.queries).toEqual(['What do competitors charge per seat?']);
    expect(done?.blocked).toEqual([{ reason: 'email', count: 1 }]);
    expect(done?.pages.map((page) => page.url).sort()).toEqual([
      'https://a.org/x',
      'https://b.org/x',
    ]);
    expect(recorded).toEqual([
      expect.objectContaining({
        source: 'independent:exa',
        queries: 1,
        costUsd: 0.007,
        pages: 1,
        blocked: 1,
      }),
      expect.objectContaining({
        source: 'independent:tavily',
        queries: 1,
        costUsd: 0.008,
        pages: 1,
      }),
    ]);
    // The ledger rows carry counts and a price, never the text of a query.
    expect(JSON.stringify(recorded)).not.toContain('competitors');
    expect(JSON.stringify(recorded)).not.toContain('acme');
    expect(progressed[0]).toMatchObject({ services: ['exa', 'tavily'], pages: 2 });
  });

  it('holds the estimated cost against the run limit before anything is sent', async () => {
    reset();
    const asked: number[] = [];
    const port = fakePort('exa', {});
    const done = await runIndependentStep(
      base({
        loadPorts: () =>
          Promise.resolve({
            ports: [{ connectionId: 'c1', costPerQueryUsd: 0.5, port }],
            unavailable: [],
          }),
        affordable: (extra) => {
          asked.push(extra);
          return Promise.resolve(false);
        },
      }),
    );
    expect(done).toBeNull();
    expect(asked).toEqual([0.5]);
    expect(port.asked).toEqual([]);
    expect(progressed).toEqual([{ skipped: 'cost_limit' }]);
  });

  it('reports a connection whose key cannot be read as a service that did not answer', async () => {
    reset();
    const done = await runIndependentStep(
      base({
        loadPorts: () =>
          Promise.resolve({
            ports: [],
            unavailable: [{ connectionId: 'c1', brand: 'exa', code: 'ai_secret_missing' }],
          }),
      }),
    );
    expect(done?.pages).toEqual([]);
    expect(done?.providers).toEqual([
      expect.objectContaining({ id: 'exa', status: 'failed', code: 'unavailable' }),
    ]);
    expect(recorded).toEqual([]);
  });

  it('never throws: an unexpected failure leaves the stage on the model search', async () => {
    reset();
    const done = await runIndependentStep(
      base({ loadPorts: () => Promise.reject(new Error('database went away')) }),
    );
    expect(done).toBeNull();
  });

  it('records a failed service with its code and still returns what the other found', async () => {
    reset();
    const done = await runIndependentStep(
      base({
        loadPorts: () =>
          Promise.resolve({
            ports: [
              {
                connectionId: 'c1',
                costPerQueryUsd: 0.007,
                port: fakePort('exa', { 'What do competitors charge per seat?': 'unauthorized' }),
              },
              {
                connectionId: 'c2',
                costPerQueryUsd: 0.008,
                port: fakePort('tavily', {
                  'What do competitors charge per seat?': [hit('https://b.org/x', 1)],
                }),
              },
            ],
            unavailable: [],
          }),
      }),
    );
    expect(done?.pages).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ source: 'independent:exa', errorCode: 'unauthorized' });
    expect(recorded[1]).toMatchObject({ source: 'independent:tavily', errorCode: null });
  });
});

describe('runIndependentStep with the project privacy policy (ADR-0059)', () => {
  const ports = () => {
    const port = fakePort('exa', {});
    return {
      port,
      load: () =>
        Promise.resolve({
          ports: [{ connectionId: 'c1', costPerQueryUsd: 0.007, port }],
          unavailable: [],
        }),
    };
  };
  const deps = (over: Partial<IndependentStepDeps>): IndependentStepDeps => ({
    enabled: true,
    denied: false,
    policy: { maxQueries: 5, resultsPerQuery: 8 },
    questions: [
      { question: 'What does Acme Holding charge per seat?', channel: 'web' },
      { question: 'How large is the logistics software market?', channel: 'web' },
    ],
    problem: 'p',
    projectTitle: 't',
    loadPorts: () => Promise.resolve({ ports: [], unavailable: [] }),
    affordable: () => Promise.resolve(true),
    record: () => Promise.resolve(),
    progress: () => Promise.resolve(),
    ...over,
  });

  it('does not send a query that holds a word the project lists as never to leave', async () => {
    const { port, load } = ports();
    const done = await runIndependentStep(
      deps({
        loadPorts: load,
        privacy: () => Promise.resolve({ mode: 'mask', blockedWords: ['acme holding'] }),
      }),
    );
    expect(port.asked).toEqual(['How large is the logistics software market?']);
    expect(done?.blocked).toEqual([{ reason: 'project_policy', count: 1 }]);
    expect(JSON.stringify(done)).not.toContain('Acme');
  });

  it('holds a project in block mode to its words as well', async () => {
    const { port, load } = ports();
    await runIndependentStep(
      deps({
        loadPorts: load,
        privacy: () => Promise.resolve({ mode: 'block', blockedWords: ['Acme'] }),
      }),
    );
    expect(port.asked).toEqual(['How large is the logistics software market?']);
  });

  it('does not hold a project that switched the layer off, or one with no words, to anything', async () => {
    for (const policy of [
      { mode: 'off' as const, blockedWords: ['Acme'] },
      { mode: 'mask' as const, blockedWords: [] },
    ]) {
      const { port, load } = ports();
      await runIndependentStep(deps({ loadPorts: load, privacy: () => Promise.resolve(policy) }));
      expect(port.asked).toHaveLength(2);
    }
  });

  it('still applies the text check when there is no policy at all', async () => {
    const { port, load } = ports();
    await runIndependentStep(
      deps({
        loadPorts: load,
        questions: [{ question: 'ask ali.rezaei@acme-corp.com for a quote', channel: 'web' }],
      }),
    );
    expect(port.asked).toEqual([]);
  });
});
