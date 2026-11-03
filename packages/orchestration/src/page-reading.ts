import {
  fetchUrl,
  htmlToText,
  UrlFetchError,
  type FetchedUrl,
  type UrlFetchOptions,
  type UrlPolicy,
} from '@docoo/ingestion/url-fetch';
import { normalizeForSearch } from '@docoo/knowledge';

import type { WebPassage } from './research.js';

/**
 * Reading the key pages in full (ADR-0054). A web search brings back the provider's notes on each
 * page; for the few pages the research leans on most, the page itself is read so a figure or a date
 * can be quoted exactly and the quote checked against the page. It reuses the guarded fetcher of the
 * ingestion pipeline (DNS answer checked and pinned, every redirect re-checked, ports, types and size
 * limited) and obeys the owner's URL policy, so it can reach nothing the knowledge ingestion could not.
 */

export const READ_LIMITS = {
  /** The most pages one research may read, whatever the setting says. */
  maxPages: 10,
  defaultPages: 5,
  /** A page larger than this is not read. */
  maxBytes: 2_000_000,
  timeoutMs: 15_000,
  /** Pages fetched at the same time. */
  concurrency: 3,
  /** No new page is started after this long; the research does not wait on slow sites. */
  budgetMs: 45_000,
  /** Characters of a page that reach the model, chosen for relevance. */
  excerptChars: 8_000,
} as const;

export type PageReadStatus = 'read' | 'failed' | 'skipped';

export interface PageReadEntry {
  readonly ref: string;
  readonly status: PageReadStatus;
  /** Why a page was not read; a short code, never the address or the page. */
  readonly code: string | null;
}

export interface PageReadingInfo {
  /** `used`: some page was read · `none`: none could be · `denied`: the URL policy forbids it · `off`: switched off. */
  readonly status: 'used' | 'none' | 'denied' | 'off';
  readonly read: number;
  readonly failed: number;
  readonly entries: readonly PageReadEntry[];
}

export const NO_PAGE_READING: PageReadingInfo = { status: 'off', read: 0, failed: 0, entries: [] };

const isWebAddress = (address: string): boolean => /^https?:\/\//iu.test(address);

/**
 * The pages worth reading, most valuable first and at most `max`: those both search models found,
 * then official pages, then the rest in the order found. One entry per page address; an address
 * that is not http(s) is never read.
 */
export function pagesToRead(sources: readonly WebPassage[], max: number): WebPassage[] {
  const limit = Math.max(0, Math.min(max, READ_LIMITS.maxPages));
  const seen = new Set<string>();
  const unique = sources.filter((source) => {
    if (!isWebAddress(source.url) || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
  const rank = (source: WebPassage): number =>
    (source.foundBy?.length ?? 0) > 1 ? 0 : source.sourceClass === 'official' ? 1 : 2;
  return unique
    .map((source, order) => ({ source, order }))
    .sort((a, b) => rank(a.source) - rank(b.source) || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.source);
}

/** Words of the question that decide which paragraphs of a page matter. */
export function searchTerms(texts: readonly string[]): string[] {
  const words = texts.flatMap((text) => normalizeForSearch(text).split(/\s+/u));
  return [...new Set(words.filter((word) => word.length > 2))].slice(0, 80);
}

const MIN_PARAGRAPH = 30;

/**
 * The part of a page that reaches the model: paragraphs scored by how many of the question's words
 * they hold, the best ones kept (in page order) up to the budget. Menus and footers score nothing;
 * a page with no match at all gives its beginning.
 */
export function relevantExcerpt(
  text: string,
  terms: readonly string[],
  budget: number = READ_LIMITS.excerptChars,
): string {
  const clean = text.replace(/\r/gu, '').trim();
  if (clean.length <= budget) return clean;
  const paragraphs = clean
    .split(/\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length >= MIN_PARAGRAPH);
  const scored = paragraphs.map((paragraph, order) => {
    const normalized = normalizeForSearch(paragraph);
    return { paragraph, order, score: terms.filter((term) => normalized.includes(term)).length };
  });
  if (!scored.some((item) => item.score > 0)) return clean.slice(0, budget);
  const chosen: typeof scored = [];
  let used = 0;
  for (const item of [...scored].sort((a, b) => b.score - a.score || a.order - b.order)) {
    if (item.score === 0) break;
    const cost = item.paragraph.length + 2;
    if (used + cost > budget) continue;
    chosen.push(item);
    used += cost;
  }
  return chosen
    .sort((a, b) => a.order - b.order)
    .map((item) => item.paragraph)
    .join('\n\n');
}

const TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];

function decode(bytes: Uint8Array, contentType: string): string {
  const label = /charset=([\w-]+)/iu.exec(contentType)?.[1];
  try {
    return new TextDecoder(label ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** The readable text of a fetched page, or null for a type this path does not read (PDF, images). */
export function pageText(fetched: Pick<FetchedUrl, 'bytes' | 'contentType'>): string | null {
  const type = fetched.contentType.toLowerCase();
  if (type.startsWith('text/html')) return htmlToText(decode(fetched.bytes, type)).text;
  if (TEXT_TYPES.some((allowed) => type.startsWith(allowed))) return decode(fetched.bytes, type);
  return null;
}

/** Control characters other than newline and tab are dropped; page text is data, never markup. */
const cleanText = (text: string): string =>
  // eslint-disable-next-line no-control-regex
  text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');

export interface ReadPagesInput {
  readonly sources: readonly WebPassage[];
  readonly max: number;
  readonly terms: readonly string[];
  readonly policy: UrlPolicy;
  readonly allowlist: readonly string[];
  /** Replaceable in tests; the guarded fetcher by default. */
  readonly fetch?: (url: string, options: UrlFetchOptions) => Promise<FetchedUrl>;
  /** Replaceable in tests (resolver, address filter, ports). */
  readonly fetchOptions?: Partial<UrlFetchOptions>;
  readonly now?: () => number;
}

/**
 * Reads the key pages and returns the sources with their text extended by the relevant part of the
 * page (what the model said about it first, then the page), marked `read`, and how it went. A page
 * that cannot be read stays as it was; nothing here fails the research.
 */
export async function readPages(
  input: ReadPagesInput,
): Promise<{ sources: WebPassage[]; info: PageReadingInfo }> {
  if (input.policy === 'deny') {
    return { sources: [...input.sources], info: { ...NO_PAGE_READING, status: 'denied' } };
  }
  const fetcher = input.fetch ?? fetchUrl;
  const now = input.now ?? Date.now;
  const started = now();
  const chosen = pagesToRead(input.sources, input.max);
  const results = new Map<string, { entry: PageReadEntry; text: string | null }>();

  let next = 0;
  const work = async (): Promise<void> => {
    while (next < chosen.length) {
      const source = chosen[next]!;
      next += 1;
      if (now() - started > READ_LIMITS.budgetMs) {
        results.set(source.ref, {
          entry: { ref: source.ref, status: 'skipped', code: 'read_budget' },
          text: null,
        });
        continue;
      }
      try {
        const fetched = await fetcher(source.url, {
          policy: input.policy,
          allowlist: input.allowlist,
          maxBytes: READ_LIMITS.maxBytes,
          timeoutMs: READ_LIMITS.timeoutMs,
          ...input.fetchOptions,
        });
        const text = pageText(fetched);
        if (text === null || text.trim() === '') {
          results.set(source.ref, {
            entry: {
              ref: source.ref,
              status: 'skipped',
              code: text === null ? 'unsupported_type' : 'empty_page',
            },
            text: null,
          });
        } else {
          results.set(source.ref, {
            entry: { ref: source.ref, status: 'read', code: null },
            text: relevantExcerpt(cleanText(text), input.terms),
          });
        }
      } catch (error) {
        results.set(source.ref, {
          entry: {
            ref: source.ref,
            status: 'failed',
            code: error instanceof UrlFetchError ? error.code : 'read_failed',
          },
          text: null,
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(READ_LIMITS.concurrency, chosen.length) }, () => work()),
  );

  const entries = chosen.map((source) => results.get(source.ref)!.entry);
  const read = entries.filter((entry) => entry.status === 'read').length;
  const sources = input.sources.map((source): WebPassage => {
    const result = results.get(source.ref);
    if (!result?.text) return source;
    return { ...source, read: true, text: `${source.text}\n\n${result.text}`.trim() };
  });
  return {
    sources,
    info: {
      status: read > 0 ? 'used' : 'none',
      read,
      failed: entries.filter((entry) => entry.status === 'failed').length,
      entries,
    },
  };
}
