import { asOfYear, freshnessOf, FRESH_YEARS } from './research-freshness.js';

/**
 * Research memory (ADR-0053): a verified finding the administrator chooses to keep becomes a draft
 * item of the organization's knowledge, so later projects start from it instead of searching again.
 * The rules here are pure: which findings may be kept, what they become, and what stops a second copy.
 * The draft still goes through the normal knowledge audit before anything can rely on it.
 */

export type MemoryConfidentiality = 'internal' | 'confidential' | 'restricted';
const RANK: Record<MemoryConfidentiality, number> = { internal: 0, confidential: 1, restricted: 2 };

/** The more confidential of two; a kept finding is never less confidential than what it was built from. */
export function maxConfidentiality(
  a: MemoryConfidentiality,
  b: MemoryConfidentiality,
): MemoryConfidentiality {
  return RANK[a] >= RANK[b] ? a : b;
}

/** The parts of a stored finding the rules read. */
export interface MemoryFinding {
  readonly claim?: unknown;
  readonly source?: unknown;
  readonly level?: unknown;
  readonly support?: unknown;
  readonly asOf?: unknown;
  readonly asOfYear?: unknown;
  readonly agesFast?: unknown;
  readonly figures?: unknown;
  readonly evidence?: unknown;
}

export interface MemoryCitation {
  readonly url: string;
  readonly title: string;
  readonly quote: string;
}

export type MemoryBlock = 'not_verified' | 'disputed' | 'knowledge_only' | 'stale' | 'no_claim';

export type MemoryEligibility =
  | {
      readonly ok: true;
      /** Verified web pages behind the finding. */
      readonly pages: readonly MemoryCitation[];
      /** Approved knowledge items it also cites (their confidentiality sets the floor). */
      readonly knowledgeIds: readonly string[];
      /** When the kept finding stops being current; null when its date is unknown. */
      readonly validUntil: string | null;
    }
  | { readonly ok: false; readonly reason: MemoryBlock };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object' && !Array.isArray(item),
      )
    : [];

/**
 * Whether a finding may be kept, and from what. It needs a verified web page (a finding that rests
 * only on approved knowledge already is knowledge), must not be disputed or stale, and a finding with
 * no verified citation at all is refused. A finding whose date is unknown can be kept, without an expiry.
 */
export function memoryEligibility(finding: MemoryFinding, nowYear: number): MemoryEligibility {
  if (text(finding.claim) === '') return { ok: false, reason: 'no_claim' };
  const verified = records(finding.evidence).filter((cite) => cite['verified'] === true);
  if (verified.length === 0) return { ok: false, reason: 'not_verified' };
  if (finding.level === 'disputed') return { ok: false, reason: 'disputed' };
  const pages: MemoryCitation[] = [];
  const seen = new Set<string>();
  for (const cite of verified) {
    const url = text(cite['url']);
    if (url === '' || seen.has(url)) continue;
    seen.add(url);
    pages.push({ url, title: text(cite['title']), quote: text(cite['quote']) });
  }
  if (pages.length === 0) return { ok: false, reason: 'knowledge_only' };
  const asOf = text(finding.asOf);
  const year =
    typeof finding.asOfYear === 'number' ? finding.asOfYear : asOf === '' ? null : asOfYear(asOf);
  const agesFast = finding.agesFast === true;
  if (freshnessOf(year, agesFast, nowYear) === 'stale') return { ok: false, reason: 'stale' };
  const knowledgeIds = [
    ...new Set(verified.map((cite) => text(cite['knowledgeId'])).filter((id) => id !== '')),
  ];
  const limit = agesFast ? FRESH_YEARS.fast : FRESH_YEARS.slow;
  // Current information lives until its own freshness limit ends; ageing information until the
  // end of this year, so it is reviewed soon rather than trusted for years.
  const validUntil =
    year === null
      ? null
      : new Date(Date.UTC(Math.max(nowYear, year + limit), 11, 31, 23, 59, 59)).toISOString();
  return { ok: true, pages, knowledgeIds, validUntil };
}

const squash = (value: string): string => value.replace(/\s+/gu, ' ').trim().toLowerCase();

/**
 * What makes two kept findings the same: the claim and the verified pages behind it, however
 * they are ordered. Hashed by the caller; nothing about the date, so a re-run of the same research
 * finds the same fingerprint.
 */
export function memoryFingerprintText(finding: MemoryFinding): string {
  const urls = records(finding.evidence)
    .filter((cite) => cite['verified'] === true)
    .map((cite) => text(cite['url']))
    .filter((url) => url !== '');
  return `${squash(text(finding.claim))}|${[...new Set(urls)].sort().join(',')}`;
}

const LABELS = {
  fa: { about: 'مربوط به', figures: 'عددها', sources: 'منبع‌ها', period: 'دوره' },
  en: { about: 'About', figures: 'Figures', sources: 'Sources', period: 'Period' },
} as const;

export interface MemoryCitationRecord {
  readonly sourceRef: string;
  readonly title: string;
  /** The site the page is on: the host of its address. */
  readonly publisher: string;
  /** January 1 of the year the information is about; absent when that year is unknown. */
  readonly publishedAt?: string;
  readonly accessedAt: string;
  readonly quote: string;
}

export interface MemoryDraft {
  readonly title: string;
  readonly content: string;
  readonly claim: {
    readonly text: string;
    readonly kind: 'numeric' | 'statement';
    readonly citations: readonly MemoryCitationRecord[];
  };
  /** True when `publishedAt` stands for the year the information is about, not a publication date. */
  readonly publishedAtIsAsOfYear: boolean;
}

/** The host of a page address without `www.`, or an empty text for anything that is not a web address. */
export function pageHost(address: string): string {
  try {
    const url = new URL(address);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.hostname.toLowerCase().replace(/^www\./u, '')
      : '';
  } catch {
    return '';
  }
}

const MAX_TITLE = 300;

/** The knowledge item a finding becomes: a title, readable content with its numbers and sources, one claim with its citations. */
export function composeMemory(
  finding: MemoryFinding,
  pages: readonly MemoryCitation[],
  language: 'fa' | 'en',
  options: { readonly title?: string; readonly accessedAt: string },
): MemoryDraft {
  const labels = LABELS[language];
  const claim = text(finding.claim);
  const supported = records(finding.figures).filter((figure) => figure['supported'] === true);
  const lines: string[] = [claim];
  const asOf = text(finding.asOf);
  if (asOf !== '') lines.push('', `${labels.about}: ${asOf}`);
  if (supported.length > 0) {
    lines.push('', `${labels.figures}:`);
    for (const figure of supported) {
      const period = text(figure['period']);
      lines.push(
        `- ${text(figure['label'])}: ${text(figure['value'])} ${text(figure['unit'])}`.trimEnd() +
          (period !== '' ? ` (${labels.period}: ${period})` : ''),
      );
    }
  }
  lines.push('', `${labels.sources}:`);
  for (const page of pages) {
    lines.push(`- ${page.title !== '' ? `${page.title} — ` : ''}${page.url}`);
    if (page.quote !== '') lines.push(`  «${page.quote}»`);
  }
  const year =
    typeof finding.asOfYear === 'number' ? finding.asOfYear : asOf === '' ? null : asOfYear(asOf);
  // A citation is complete only with a date; the only date a finding carries is the year its
  // information is about, so that stands in (and the draft says so) rather than none being invented.
  const publishedAt = year === null ? undefined : new Date(Date.UTC(year, 0, 1)).toISOString();
  return {
    title: (text(options.title) || claim).slice(0, MAX_TITLE),
    content: lines.join('\n'),
    claim: {
      text: claim,
      kind: supported.length > 0 ? 'numeric' : 'statement',
      citations: pages.slice(0, 20).map((page) => ({
        sourceRef: page.url,
        title: page.title !== '' ? page.title : pageHost(page.url),
        publisher: pageHost(page.url),
        ...(publishedAt ? { publishedAt } : {}),
        accessedAt: options.accessedAt,
        quote: page.quote,
      })),
    },
    publishedAtIsAsOfYear: publishedAt !== undefined,
  };
}

/** What the knowledge auditor reads of a machine-research item: the query it came from and when it was accessed (KNO-006). */
export function memoryProvenance(input: {
  readonly queries: readonly string[];
  readonly claim: string;
  readonly accessedAt: string;
  readonly projectId: string;
  readonly stageRunId: string;
  readonly outputId: string;
  readonly fingerprint: string;
  readonly publishedAtIsAsOfYear: boolean;
}): Record<string, string | boolean> {
  const query = input.queries
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .join('; ')
    .slice(0, 1900);
  return {
    // What was searched; the finding itself when the output kept no queries.
    query: query !== '' ? query : input.claim.slice(0, 1900),
    accessedAt: input.accessedAt,
    origin: 'research_memory',
    projectId: input.projectId,
    stageRunId: input.stageRunId,
    outputId: input.outputId,
    findingFingerprint: input.fingerprint,
    publishedAtIsAsOfYear: input.publishedAtIsAsOfYear,
  };
}
