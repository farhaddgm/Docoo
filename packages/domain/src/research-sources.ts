/**
 * How far a source of the research can be trusted, decided by code from its address, never by a
 * model (ADR-0040). A web page is `official` when it belongs to a government, a university, a
 * standards or an international body, or to a domain the administrator listed in
 * `research.official_domains`; every other page is `public`. Approved knowledge is a class of its
 * own: it was reviewed inside the workspace.
 */

export type WebSourceClass = 'official' | 'public';
export type SourceClass = WebSourceClass | 'knowledge';

/** Address endings that mark an institution: `.gov`, `.gov.xx`, `.edu`, `.edu.xx`, `.ac.xx`, `.mil`, `.int`. */
const OFFICIAL_PATTERNS: readonly RegExp[] = [
  /\.gov(\.[a-z]{2})?$/u,
  /\.edu(\.[a-z]{2})?$/u,
  /\.ac\.[a-z]{2}$/u,
  /\.mil(\.[a-z]{2})?$/u,
  /\.int$/u,
];

/** International and standards bodies whose address does not end like an institution's. */
const OFFICIAL_DOMAINS: readonly string[] = [
  'europa.eu',
  'worldbank.org',
  'imf.org',
  'oecd.org',
  'un.org',
  'unesco.org',
  'unicef.org',
  'ilo.org',
  'fao.org',
  'wto.org',
  'bis.org',
  'iso.org',
  'ieee.org',
  'ietf.org',
  'w3.org',
];

export const MAX_OFFICIAL_DOMAINS = 50;

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/u;

/**
 * The domains of the `research.official_domains` setting, cleaned: lower case, a pasted address
 * reduced to its host, a leading `www.` or `*.` dropped, anything that is not a host left out.
 */
export function normalizeOfficialDomains(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const domains = new Set<string>();
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const host = entry
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//u, '')
      .replace(/[/?#].*$/u, '')
      .replace(/:\d+$/u, '')
      .replace(/^(\*\.|www\.)/u, '');
    if (HOSTNAME.test(host)) domains.add(host);
    if (domains.size >= MAX_OFFICIAL_DOMAINS) break;
  }
  return [...domains];
}

const hostOf = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.hostname.toLowerCase().replace(/\.$/u, '')
      : null;
  } catch {
    return null;
  }
};

const underDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);

/** `official` or `public` for a page address; an address that is not a web address is `public`. */
export function classifyWebSource(
  url: string,
  extraOfficial: readonly string[] = [],
): WebSourceClass {
  const host = hostOf(url);
  if (!host) return 'public';
  if (OFFICIAL_PATTERNS.some((pattern) => pattern.test(host))) return 'official';
  if (OFFICIAL_DOMAINS.some((domain) => underDomain(host, domain))) return 'official';
  if (extraOfficial.some((domain) => underDomain(host, domain))) return 'official';
  return 'public';
}

/**
 * A short stable identity for a conflict the research reported, so a decision of the
 * administrator stays attached to it when the output is joined with a follow-up round
 * (ADR-0039). Two 32-bit FNV-1a passes over the normalised description and the sorted refs.
 */
export function conflictFingerprint(description: string, refs: readonly string[]): string {
  const text = `${description.replace(/\s+/g, ' ').trim().toLowerCase()}|${[...refs]
    .map((ref) => ref.toUpperCase())
    .sort()
    .join(',')}`;
  const pass = (seed: number) => {
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  return pass(0x811c9dc5) + pass(0x9e3779b1);
}

export const CONFLICT_DECISIONS = ['trust', 'dismiss'] as const;
export type ConflictDecision = (typeof CONFLICT_DECISIONS)[number];

export const isConflictDecision = (value: unknown): value is ConflictDecision =>
  CONFLICT_DECISIONS.some((decision) => decision === value);

export const CONFLICT_NOTE_MAX = 500;

/** Added to the stages after the research when the administrator decided a conflict. */
export const RESEARCH_DECISION_RULES: readonly string[] = [
  'conflictDecisions (inside the research output) holds what the administrator decided about conflicts the research reported. "trust": treat the named trustedSource as correct and the other sources of that conflict as superseded. "dismiss": the conflict is not real; ignore it. These decisions are binding; do not reopen them or present the other side as equally likely.',
];

/** What a stage after the research is told about one decided conflict. */
export interface PromptConflictDecision {
  readonly conflict: string;
  readonly decision: ConflictDecision;
  readonly trustedSource?: string;
  readonly note?: string;
}

/** Rules about the class of web pages, added to the research stage beside the web-search rules. */
export const WEB_SOURCE_CLASS_RULES: readonly string[] = [
  'Every web page has a sourceClass: "official" (government, university, standards or international bodies, or a domain the administrator listed) or "public" (anything else). Prefer official pages for facts and figures.',
  'When a claim rests only on public pages, or on a single source, say so in its source field instead of presenting it as settled.',
];
