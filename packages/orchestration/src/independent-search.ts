import {
  checkSearchQuery,
  classifyWebSource,
  type PromptResearchQuestion,
  type SearchQueryBlock,
} from '@docoo/domain';
import type { WebSearchFailure, WebSearchHit, WebSearchPort } from '@docoo/ingestion';
import { findPrivateValues, type PrivacyPolicy } from '@docoo/providers';

import { MERGED_TEXT_MAX_CHARS, normalizePageUrl } from './research-dual.js';
import type { WebPassage, WebRun } from './research.js';
import type { ConnectedSearchPort } from './runtime.js';

/**
 * The independent web search of the research stage (ADR-0060, ADR-0026 addendum 1.2). It runs
 * beside the model's own search, through one or both of the connected search services (Exa,
 * Tavily). Everything here is pure or takes its ports as arguments, so it is tested without a
 * network.
 *
 * Three rules shape it. A search service is an extra: it never throws, a failing one is reported
 * and the stage carries on with what the model's search found. Only a query that passed the
 * deterministic privacy check leaves the system. And a page found here is a numbered `W` page like
 * any other web page: it is not approved knowledge, its quotes are checked against its text, and
 * it reaches the knowledge base only through the administrator's "save to knowledge" choice
 * (ADR-0053) and the Brain audit that follows.
 */

/** How the independent search is bounded (`research.independent_*`). */
export interface IndependentPolicy {
  /** Queries sent to each service in one research attempt. */
  readonly maxQueries: number;
  /** Results asked of a service per query. */
  readonly resultsPerQuery: number;
}

export const INDEPENDENT_DEFAULTS: IndependentPolicy = { maxQueries: 5, resultsPerQuery: 8 };
export const INDEPENDENT_LIMITS = {
  maxQueries: { min: 1, max: 12 },
  resultsPerQuery: { min: 1, max: 20 },
} as const;

/** The provider label a page carries; the model's own search is `native`. */
export const NATIVE_VIA = 'native';
export const independentVia = (providerId: string): string => `independent:${providerId}`;

/** Why a candidate query was not sent: the privacy check of the text, or the project's own policy. */
export type QueryBlock = SearchQueryBlock | 'project_policy';

export interface BuiltQueries {
  readonly queries: readonly string[];
  /** Candidates the privacy check refused, by reason; their text is never kept. */
  readonly blocked: readonly { readonly reason: QueryBlock; readonly count: number }[];
}

const queryKey = (query: string): string => query.toLowerCase().replace(/\s+/gu, ' ').trim();

/**
 * The queries one research attempt sends out. They are the confirmed questions that need the web
 * (the administrator already read and approved their wording, ADR-0038); without a plan, the
 * problem statement and the project title. Each passes the privacy check; a refused one is
 * counted, never repeated.
 */
export function buildIndependentQueries(input: {
  readonly questions: readonly Pick<PromptResearchQuestion, 'question' | 'channel'>[];
  readonly problem: string;
  readonly projectTitle: string;
  readonly max: number;
  /**
   * The project's own policy (ADR-0059 privacy layer): a query it refuses is not sent, whatever the
   * text check says. A word the owner listed as never to leave is the usual reason.
   */
  readonly refuse?: ((query: string) => boolean) | undefined;
}): BuiltQueries {
  const planned = input.questions
    .filter((question) => question.channel !== 'knowledge')
    .map((question) => question.question);
  const candidates = planned.length > 0 ? planned : [input.problem, input.projectTitle];
  const seen = new Set<string>();
  const queries: string[] = [];
  const blocked = new Map<QueryBlock, number>();
  for (const candidate of candidates) {
    if (queries.length >= input.max) break;
    const checked = checkSearchQuery(candidate);
    if (!checked.ok) {
      blocked.set(checked.reason, (blocked.get(checked.reason) ?? 0) + 1);
      continue;
    }
    if (input.refuse?.(checked.query)) {
      blocked.set('project_policy', (blocked.get('project_policy') ?? 0) + 1);
      continue;
    }
    const key = queryKey(checked.query);
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(checked.query);
  }
  return {
    queries,
    blocked: [...blocked].map(([reason, count]) => ({ reason, count })),
  };
}

export interface IndependentProviderInfo {
  readonly id: string;
  /** `used`: at least one query answered · `failed`: none did · `skipped`: not asked. */
  readonly status: 'used' | 'failed' | 'skipped';
  /** The first failure the service reported, kept even when later queries worked. */
  readonly code: WebSearchFailure | null;
  readonly queries: number;
  readonly failedQueries: number;
  readonly hits: number;
  readonly latencyMs: number;
}

export interface IndependentPage {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  /** The services that returned the page (provider ids). */
  readonly providers: readonly string[];
  /** In how many queries it appeared. */
  readonly queryCount: number;
  /** Its best rank in any answer. */
  readonly bestRank: number;
}

export interface IndependentRun {
  readonly queries: readonly string[];
  readonly blocked: BuiltQueries['blocked'];
  readonly providers: readonly IndependentProviderInfo[];
  readonly pages: readonly IndependentPage[];
}

export const EMPTY_INDEPENDENT_RUN: IndependentRun = {
  queries: [],
  blocked: [],
  providers: [],
  pages: [],
};

/** Failures after which asking the same service again in this attempt would only waste a call. */
const STOPPING_FAILURES: ReadonlySet<WebSearchFailure> = new Set([
  'unauthorized',
  'quota_exhausted',
  'rate_limited',
  'aborted',
]);

interface Gathered {
  /** The first spelling of the address that was seen. */
  url: string;
  title: string;
  snippets: string[];
  providers: string[];
  queries: Set<number>;
  bestRank: number;
  firstSeen: number;
}

/**
 * Asks every port every query. The ports work side by side; one port's queries go one after the
 * other, which keeps a rate-limited service (Tavily allows 20 a minute) well inside its limit. A
 * port that is refused, out of credit or rate-limited is not asked again in this attempt.
 */
export async function runIndependentSearch(input: {
  readonly ports: readonly WebSearchPort[];
  readonly queries: BuiltQueries;
  readonly policy: IndependentPolicy;
  readonly signal?: AbortSignal | undefined;
}): Promise<IndependentRun> {
  const { queries } = input.queries;
  if (input.ports.length === 0 || queries.length === 0) {
    return { ...EMPTY_INDEPENDENT_RUN, queries, blocked: input.queries.blocked };
  }
  const perPort = await Promise.all(
    input.ports.map(async (port) => {
      const hits: { queryIndex: number; hit: WebSearchHit }[] = [];
      let answered = 0;
      let failed = 0;
      let firstFailure: WebSearchFailure | null = null;
      let latencyMs = 0;
      let asked = 0;
      for (const [queryIndex, query] of queries.entries()) {
        asked += 1;
        const outcome = await port.search(
          { query, maxResults: input.policy.resultsPerQuery },
          input.signal,
        );
        latencyMs += outcome.latencyMs;
        if (outcome.ok) {
          answered += 1;
          for (const hit of outcome.hits) hits.push({ queryIndex, hit });
          continue;
        }
        failed += 1;
        firstFailure ??= outcome.code;
        if (STOPPING_FAILURES.has(outcome.code)) break;
      }
      const info: IndependentProviderInfo = {
        id: port.id,
        status: answered > 0 ? 'used' : 'failed',
        code: firstFailure,
        queries: asked,
        failedQueries: failed,
        hits: hits.length,
        latencyMs,
      };
      return { port, hits, info };
    }),
  );

  const byKey = new Map<string, Gathered>();
  let order = 0;
  // Query by query, service by service, rank by rank: the same answers always give the same order.
  for (const queryIndex of queries.keys()) {
    for (const { port, hits } of perPort) {
      for (const { queryIndex: at, hit } of hits) {
        if (at !== queryIndex) continue;
        const key = normalizePageUrl(hit.url);
        const known = byKey.get(key);
        if (known) {
          if (!known.providers.includes(port.id)) known.providers.push(port.id);
          known.queries.add(queryIndex);
          known.bestRank = Math.min(known.bestRank, hit.rank);
          if (hit.snippet && !known.snippets.includes(hit.snippet))
            known.snippets.push(hit.snippet);
          if (known.title === '' && hit.title !== '') known.title = hit.title;
          continue;
        }
        order += 1;
        byKey.set(key, {
          url: hit.url,
          title: hit.title,
          snippets: hit.snippet ? [hit.snippet] : [],
          providers: [port.id],
          queries: new Set([queryIndex]),
          bestRank: hit.rank,
          firstSeen: order,
        });
      }
    }
  }
  const pages = [...byKey.values()]
    .sort(
      (a, b) =>
        b.providers.length - a.providers.length ||
        b.queries.size - a.queries.size ||
        a.bestRank - b.bestRank ||
        a.firstSeen - b.firstSeen,
    )
    .map((page): IndependentPage => ({
      url: page.url,
      title: page.title,
      text: page.snippets.join('\n\n').slice(0, MERGED_TEXT_MAX_CHARS),
      providers: page.providers,
      queryCount: page.queries.size,
      bestRank: page.bestRank,
    }));
  return {
    queries,
    blocked: input.queries.blocked,
    providers: perPort.map((entry) => entry.info),
    pages,
  };
}

/** How the independent search went, as the stored output and the page show it. */
export interface IndependentInfo {
  readonly queries: readonly string[];
  readonly blocked: BuiltQueries['blocked'];
  readonly providers: readonly IndependentProviderInfo[];
  /** Pages the services found; how many reached the research prompt is in the sources. */
  readonly pages: number;
  /**
   * Which side the research rests on: `both` the model's search and a service, `independent` only
   * a service (the model's search failed or found nothing), `native` only the model's search (every
   * service failed, found nothing or was refused), `none` neither.
   */
  readonly outcome: 'both' | 'independent' | 'native' | 'none';
}

/** The share of the kept pages kept free for pages only the services found. */
const INDEPENDENT_RESERVE_SHARE = 3;

const refNumber = (ref: string): number => {
  const parsed = Number(ref.slice(1));
  return Number.isInteger(parsed) ? parsed : 0;
};

/**
 * Joins what the services found to what the model's own search found. A page both found keeps
 * its place and gains the service's text (so a quote from either verifies) and its label. A page
 * only a service found gets the next `W` ref. At most `limit` pages stay; a third of them, at
 * least one, is kept free for service-only pages when there are any, so a model search that fills
 * the list does not hide what the services add.
 */
export function mergeIndependent(
  native: WebRun,
  independent: IndependentRun,
  options: {
    readonly limit: number;
    readonly refOffset: number;
    readonly officialDomains: readonly string[];
  },
): WebRun {
  const providersUsed = independent.providers.filter((provider) => provider.status === 'used');
  const info = (outcome: IndependentInfo['outcome']): IndependentInfo => ({
    queries: independent.queries,
    blocked: independent.blocked,
    providers: independent.providers,
    pages: independent.pages.length,
    outcome,
  });

  const nativePages: WebPassage[] = native.sources.map((source) => ({
    ...source,
    via: source.via ?? [NATIVE_VIA],
  }));
  const nativeByKey = new Map(
    nativePages.map((page, index) => [normalizePageUrl(page.url), index]),
  );
  const merged: WebPassage[] = [...nativePages];
  const extra: IndependentPage[] = [];
  for (const page of independent.pages) {
    const at = nativeByKey.get(normalizePageUrl(page.url));
    const labels = page.providers.map(independentVia);
    if (at === undefined) {
      extra.push(page);
      continue;
    }
    const base = merged[at]!;
    const text =
      page.text && !base.text.includes(page.text)
        ? `${base.text}\n\n${page.text}`.slice(0, MERGED_TEXT_MAX_CHARS)
        : base.text;
    merged[at] = { ...base, text, via: [...new Set([...(base.via ?? [NATIVE_VIA]), ...labels])] };
  }

  const reserve =
    extra.length > 0 ? Math.max(1, Math.floor(options.limit / INDEPENDENT_RESERVE_SHARE)) : 0;
  const nativeRoom = Math.max(0, options.limit - Math.min(reserve, extra.length));
  const keptNative = merged.slice(0, nativeRoom);
  const room = Math.max(0, options.limit - keptNative.length);
  let next = Math.max(options.refOffset, ...merged.map((page) => refNumber(page.ref))) + 1;
  const added: WebPassage[] = extra.slice(0, room).map((page) => ({
    ref: `W${next++}`,
    url: page.url,
    title: page.title,
    text: page.text,
    sourceClass: classifyWebSource(page.url, options.officialDomains),
    via: page.providers.map(independentVia),
  }));
  const sources = [...keptNative, ...added];

  const fromNative = sources.some((page) => page.via?.includes(NATIVE_VIA) === true);
  const fromServices = sources.some((page) =>
    page.via?.some((label) => label.startsWith('independent:')),
  );
  const outcome: IndependentInfo['outcome'] =
    fromNative && fromServices
      ? 'both'
      : fromServices
        ? 'independent'
        : fromNative
          ? 'native'
          : 'none';

  const status: WebRun['status'] =
    sources.length > 0
      ? 'used'
      : native.status === 'failed' && providersUsed.length === 0
        ? 'failed'
        : native.status === 'denied'
          ? 'denied'
          : 'none';
  return {
    ...native,
    status,
    code: sources.length > 0 ? null : native.code,
    sources,
    independent: info(outcome),
  };
}

/** What the independent step needs from its surroundings; the activity supplies it, tests fake it. */
export interface IndependentStepDeps {
  /** `research.web_enabled` and `research.independent_enabled`: both must be on. */
  readonly enabled: boolean;
  /** The role may not use the web search tool; the model's own search already recorded the refusal. */
  readonly denied: boolean;
  readonly policy: IndependentPolicy;
  readonly questions: readonly Pick<PromptResearchQuestion, 'question' | 'channel'>[];
  readonly problem: string;
  readonly projectTitle: string;
  /** The project's privacy policy (ADR-0059); absent leaves only the text check of the query. */
  readonly privacy?: (() => Promise<PrivacyPolicy>) | undefined;
  readonly loadPorts: () => Promise<{
    ports: readonly ConnectedSearchPort[];
    unavailable: readonly { connectionId: string; brand: string; code: string }[];
  }>;
  /** Whether the run can still afford `extra` more dollars (the services' queries). */
  readonly affordable: (extra: number) => Promise<boolean>;
  /** One row of the tool ledger per service; it never carries the text of a query. */
  readonly record: (entry: {
    readonly source: string;
    readonly queries: number;
    readonly failedQueries: number;
    readonly hits: number;
    readonly pages: number;
    readonly blocked: number;
    readonly costUsd: number;
    readonly latencyMs: number;
    readonly errorCode: string | null;
  }) => Promise<void>;
  readonly progress: (data: Record<string, unknown>) => Promise<void>;
  readonly now?: () => number;
}

/** The cost of the queries a service was asked, rounded to a millionth of a dollar. */
export const queryCostUsd = (perQuery: number, queries: number): number =>
  Math.round(perQuery * queries * 1e6) / 1e6;

/**
 * The independent search of one research attempt (ADR-0060). It returns null when it did not run
 * (off, refused to the role, over the cost limit, or an unexpected failure) and a run, possibly
 * with no pages, when it did. It never throws: the stage must go on with the model's search.
 */
export async function runIndependentStep(
  deps: IndependentStepDeps,
): Promise<IndependentRun | null> {
  if (!deps.enabled || deps.denied) return null;
  const now = deps.now ?? Date.now;
  try {
    const { ports, unavailable } = await deps.loadPorts();
    // A project that switched its privacy layer off is not held to its blocked words here; every
    // other project is: a word it lists as never to leave stops the query that holds it.
    const policy = deps.privacy ? await deps.privacy() : null;
    const refuse =
      policy && policy.mode !== 'off' && policy.blockedWords.length > 0
        ? (query: string) => findPrivateValues(query, policy.blockedWords).length > 0
        : undefined;
    const built = buildIndependentQueries({
      questions: deps.questions,
      problem: deps.problem,
      projectTitle: deps.projectTitle,
      max: deps.policy.maxQueries,
      refuse,
    });
    // A connection whose key cannot be read is reported as a service that did not answer.
    const unreadable: IndependentProviderInfo[] = unavailable.map((item) => ({
      id: item.brand,
      status: 'failed',
      code: 'unavailable',
      queries: 0,
      failedQueries: 0,
      hits: 0,
      latencyMs: 0,
    }));
    if (ports.length === 0 || built.queries.length === 0) {
      return { queries: built.queries, blocked: built.blocked, providers: unreadable, pages: [] };
    }
    // What the queries would cost is held against the run's cost limit before any is sent.
    const estimate = ports.reduce(
      (sum, item) => sum + queryCostUsd(item.costPerQueryUsd, built.queries.length),
      0,
    );
    if (!(await deps.affordable(estimate))) {
      await deps.progress({ skipped: 'cost_limit' });
      return null;
    }
    const started = now();
    const done = await runIndependentSearch({
      ports: ports.map((item) => item.port),
      queries: built,
      policy: deps.policy,
    });
    const blocked = done.blocked.reduce((sum, item) => sum + item.count, 0);
    for (const info of done.providers) {
      const price = ports.find((item) => item.port.id === info.id)?.costPerQueryUsd ?? 0;
      await deps.record({
        source: independentVia(info.id),
        queries: info.queries,
        failedQueries: info.failedQueries,
        hits: info.hits,
        pages: done.pages.filter((page) => page.providers.includes(info.id)).length,
        blocked,
        // A query that failed was still asked, and the service may have billed it.
        costUsd: queryCostUsd(price, info.queries),
        latencyMs: info.latencyMs,
        errorCode: info.status === 'failed' ? info.code : null,
      });
    }
    await deps.progress({
      services: done.providers.map((info) => info.id),
      pages: done.pages.length,
      tookMs: now() - started,
    });
    return { ...done, providers: [...done.providers, ...unreadable] };
  } catch {
    return null;
  }
}
