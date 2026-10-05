import { normalizeForSearch } from '@docoo/knowledge';

import type { RetrievedPassage } from './knowledge-retrieval.js';

/**
 * Pure rules of the research stage with approved knowledge (ADR-0017): which queries the
 * stage runs, how retrieved passages become numbered references, and how the citations of the
 * model's answer are verified against the passages it was given. Nothing here touches the
 * database or the provider, and the Temporal workflow bundle imports only its types.
 */

export const RESEARCH_LIMITS = {
  /** Characters of one query sent to retrieval. */
  maxQueryLength: 400,
  /** Characters of one passage placed in the prompt. */
  maxPassageChars: 1800,
  /** Quotes are short excerpts, not copies of the passage. */
  maxQuoteLength: 400,
  /** A quote shorter than this (normalized) proves nothing. */
  minQuoteLength: 8,
  maxFindings: 60,
  maxEvidencePerFinding: 5,
  maxGaps: 40,
  maxConflicts: 20,
  maxTextLength: 2000,
} as const;

/** Defaults of the three `research.*` settings (the migration seeds the same values). */
export const RESEARCH_DEFAULTS = {
  maxQueries: 5,
  knowledgeLimit: 12,
  allowRestricted: false,
  maxSources: 30,
  minAuditScore: 0.7,
} as const;

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asTextList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(asText).filter((item) => item !== '') : [];

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The queries the research stage asks the knowledge base: the approved problem statement, then
 * the objectives, then what the project itself says. The approved analysis is the best
 * description of the problem; the project's own words are the fallback when there is none.
 */
export function buildResearchQueries(input: {
  readonly projectTitle: string;
  readonly problem: string;
  readonly topics: readonly string[];
  /** The content of the approved analysis output, if the analysis stage produced one. */
  readonly analysis: unknown;
  readonly max: number;
}): string[] {
  const analysis =
    input.analysis !== null && typeof input.analysis === 'object'
      ? (input.analysis as Record<string, unknown>)
      : {};
  const candidates = [
    asText(analysis['problemStatement']),
    ...asTextList(analysis['objectives']),
    asText(analysis['needStatement']),
    asText(input.problem),
    asText(input.projectTitle),
    ...input.topics.map(asText),
  ];
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const candidate of candidates) {
    if (queries.length >= input.max) break;
    const query = clip(candidate, RESEARCH_LIMITS.maxQueryLength);
    const key = normalizeForSearch(query);
    // A query of no real word retrieves nothing useful and only costs a snapshot.
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
  }
  return queries;
}

/** One passage the model may cite, with the reference it is cited by. */
export interface KnowledgePassage {
  /** `K1`, `K2`, … in rank order; the only way the model can point at a passage. */
  readonly ref: string;
  readonly chunkId: string;
  readonly knowledgeId: string;
  readonly versionId: string;
  readonly versionNo: number;
  readonly title: string;
  readonly confidentiality: string;
  /** The text shown to the model; quotes are checked against exactly this. */
  readonly text: string;
  readonly approval: 'audit' | 'override';
  readonly auditScore: number | null;
  /** The snapshot of the retrieval that first returned the passage. */
  readonly snapshotId: string;
  /** Claims in open conflict with a claim of this knowledge, as warned by retrieval. */
  readonly conflicts: readonly { readonly conflictId: string; readonly other: string }[];
}

/**
 * Merges the results of every query into one ranked list. A passage found by several queries
 * keeps its best score; ties break on the chunk id so the same snapshots always give the same
 * references. The list is cut to `limit` passages.
 */
export function assignReferences(
  retrievals: readonly {
    readonly snapshotId: string;
    readonly results: readonly RetrievedPassage[];
  }[],
  limit: number,
  /** `research.max_sources`: at most this many distinct knowledge items (sources) are used. */
  maxSources: number = Number.POSITIVE_INFINITY,
): KnowledgePassage[] {
  const best = new Map<string, { passage: RetrievedPassage; snapshotId: string }>();
  for (const retrieval of retrievals) {
    for (const passage of retrieval.results) {
      const current = best.get(passage.chunkId);
      if (!current || passage.score > current.passage.score) {
        best.set(passage.chunkId, { passage, snapshotId: retrieval.snapshotId });
      }
    }
  }
  const ranked = [...best.values()].sort(
    (a, b) =>
      b.passage.score - a.passage.score ||
      (a.passage.chunkId < b.passage.chunkId ? -1 : a.passage.chunkId > b.passage.chunkId ? 1 : 0),
  );
  // The best passages decide which sources stay: a source ranks by its best passage.
  const sources = new Set<string>();
  return ranked
    .filter(({ passage }) => {
      if (sources.has(passage.knowledgeId)) return true;
      if (sources.size >= maxSources) return false;
      sources.add(passage.knowledgeId);
      return true;
    })
    .slice(0, Math.max(0, limit))
    .map(({ passage, snapshotId }, index) => ({
      ref: `K${index + 1}`,
      chunkId: passage.chunkId,
      knowledgeId: passage.knowledgeId,
      versionId: passage.versionId,
      versionNo: passage.versionNo,
      title: passage.title,
      confidentiality: passage.confidentiality,
      text: clip(passage.text, RESEARCH_LIMITS.maxPassageChars),
      approval: passage.effectiveDecision === 'approved_by_override' ? 'override' : 'audit',
      auditScore: passage.auditScore,
      snapshotId,
      conflicts: passage.conflictWarnings.map((warning) => ({
        conflictId: warning.conflictId,
        other: clip(warning.conflictingClaim.text, 300),
      })),
    }));
}

/** What the model sees of a passage: no ids, no scores, only what it needs to cite. */
export interface KnowledgePromptItem {
  readonly ref: string;
  readonly title: string;
  readonly version: number;
  readonly approval: string;
  readonly text: string;
  readonly openConflicts?: readonly string[];
}

export function knowledgePromptItems(passages: readonly KnowledgePassage[]): KnowledgePromptItem[] {
  return passages.map((passage) => ({
    ref: passage.ref,
    title: passage.title,
    version: passage.versionNo,
    approval: passage.approval === 'override' ? 'approved by administrator override' : 'approved',
    text: passage.text,
    ...(passage.conflicts.length > 0
      ? { openConflicts: passage.conflicts.map((conflict) => conflict.other) }
      : {}),
  }));
}

export type CitationProblem =
  'unknown_ref' | 'quote_missing' | 'quote_too_short' | 'quote_not_found' | 'verifier_not_allowed';

export interface ResearchEvidence {
  readonly ref: string;
  readonly knowledgeId: string | null;
  readonly versionId: string | null;
  readonly versionNo: number | null;
  readonly title: string | null;
  readonly quote: string;
  readonly verified: boolean;
  readonly problem: CitationProblem | null;
}

export interface ResearchFinding {
  readonly claim: string;
  readonly source: string;
  /** `knowledge` only when at least one citation was found verbatim in an approved passage. */
  readonly support: 'knowledge' | 'unverified';
  readonly evidence: readonly ResearchEvidence[];
}

export interface ResearchVerification {
  readonly findings: number;
  readonly supported: number;
  readonly unverified: number;
  readonly citations: number;
  readonly verified: number;
  readonly rejected: number;
}

/** The knowledge side of a stored research output: what was asked, offered and cited. */
export interface ResearchKnowledgeInfo {
  readonly queries: readonly string[];
  readonly snapshots: readonly {
    readonly id: string;
    readonly query: string;
    readonly results: number;
  }[];
  readonly offered: readonly {
    readonly ref: string;
    readonly knowledgeId: string;
    readonly versionId: string;
    readonly versionNo: number;
    readonly title: string;
    readonly snapshotId: string;
    readonly cited: boolean;
  }[];
  /** True when `restricted` knowledge was left out of retrieval (the default). */
  readonly excludedRestricted: boolean;
  readonly retrieveTool: 'allowed' | 'denied';
  readonly verifierTool: 'allowed' | 'denied';
  readonly conflictWarnings: readonly {
    readonly conflictId: string;
    readonly refs: readonly string[];
  }[];
}

export interface ResearchContent {
  readonly findings: readonly ResearchFinding[];
  readonly gaps: readonly string[];
  readonly conflicts: readonly { readonly description: string; readonly refs: readonly string[] }[];
  readonly knowledge: ResearchKnowledgeInfo;
  readonly verification: ResearchVerification;
}

/**
 * Whether `quote` is a verbatim excerpt of `text` (after the search normalization: letter
 * forms, digits, whitespace and case). A quote may skip words with `…` or `...`; each piece
 * must then appear, in order. A quote that normalizes to almost nothing proves nothing.
 */
export function quoteInText(quote: string, text: string): 'ok' | 'too_short' | 'not_found' {
  const haystack = normalizeForSearch(text);
  const pieces = quote
    .split(/…|\.{3}/u)
    .map((piece) =>
      normalizeForSearch(piece).replace(/^[\s.,;:!?"'«»()[\]-]+|[\s.,;:!?"'«»()[\]-]+$/gu, ''),
    )
    .filter((piece) => piece !== '');
  if (
    pieces.length === 0 ||
    pieces.every((piece) => piece.length < RESEARCH_LIMITS.minQuoteLength)
  ) {
    return 'too_short';
  }
  let from = 0;
  for (const piece of pieces) {
    const at = haystack.indexOf(piece, from);
    if (at < 0) return 'not_found';
    from = at + piece.length;
  }
  return 'ok';
}

function conflictRefs(passages: readonly KnowledgePassage[]) {
  const refsByConflict = new Map<string, string[]>();
  for (const passage of passages) {
    for (const conflict of passage.conflicts) {
      const refs = refsByConflict.get(conflict.conflictId) ?? [];
      refs.push(passage.ref);
      refsByConflict.set(conflict.conflictId, refs);
    }
  }
  return [...refsByConflict.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([conflictId, refs]) => ({ conflictId, refs }));
}

/**
 * Turns the model's research answer into the stored output. Every citation is checked against
 * the passages the model was given (FR-AGT-005, the `citation_verifier` tool): the reference
 * must exist and the quote must appear in that passage. A finding with no verified citation is
 * kept, but marked `unverified` so nobody mistakes it for approved knowledge; a citation that
 * fails stays visible with the reason instead of being dropped silently.
 */
export function verifyResearch(input: {
  /** The parsed JSON of the model; anything malformed degrades to empty parts, never throws. */
  readonly output: unknown;
  readonly passages: readonly KnowledgePassage[];
  readonly queries: readonly string[];
  readonly snapshots: readonly {
    readonly id: string;
    readonly query: string;
    readonly results: number;
  }[];
  readonly excludedRestricted: boolean;
  readonly retrieveTool: 'allowed' | 'denied';
  readonly verifierTool: 'allowed' | 'denied';
}): { content: ResearchContent; cited: readonly KnowledgePassage[] } {
  const raw =
    input.output !== null && typeof input.output === 'object'
      ? (input.output as Record<string, unknown>)
      : {};
  const byRef = new Map(input.passages.map((passage) => [passage.ref, passage]));
  const citedRefs = new Set<string>();
  const verifierAllowed = input.verifierTool === 'allowed';

  const findings: ResearchFinding[] = [];
  const rawFindings = Array.isArray(raw['findings']) ? raw['findings'] : [];
  for (const item of rawFindings.slice(0, RESEARCH_LIMITS.maxFindings)) {
    const entry =
      item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const claim = clip(asText(entry['claim']), RESEARCH_LIMITS.maxTextLength);
    if (claim === '') continue;
    const evidence: ResearchEvidence[] = [];
    const seen = new Set<string>();
    const rawEvidence = Array.isArray(entry['evidence']) ? entry['evidence'] : [];
    for (const citation of rawEvidence.slice(0, RESEARCH_LIMITS.maxEvidencePerFinding)) {
      const cite =
        citation !== null && typeof citation === 'object'
          ? (citation as Record<string, unknown>)
          : {};
      const ref = asText(cite['ref']).toUpperCase();
      const quote = clip(asText(cite['quote']), RESEARCH_LIMITS.maxQuoteLength);
      const key = `${ref}\u0000${quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const passage = byRef.get(ref);
      let problem: CitationProblem | null = null;
      if (!passage) problem = 'unknown_ref';
      else if (quote === '') problem = 'quote_missing';
      else if (!verifierAllowed) problem = 'verifier_not_allowed';
      else {
        const found = quoteInText(quote, passage.text);
        if (found === 'too_short') problem = 'quote_too_short';
        else if (found === 'not_found') problem = 'quote_not_found';
      }
      const verified = problem === null;
      if (verified && passage) citedRefs.add(passage.ref);
      evidence.push({
        ref,
        knowledgeId: passage?.knowledgeId ?? null,
        versionId: passage?.versionId ?? null,
        versionNo: passage?.versionNo ?? null,
        title: passage?.title ?? null,
        quote,
        verified,
        problem,
      });
    }
    findings.push({
      claim,
      source: clip(asText(entry['source']), RESEARCH_LIMITS.maxTextLength),
      support: evidence.some((cite) => cite.verified) ? 'knowledge' : 'unverified',
      evidence,
    });
  }

  const conflicts: { description: string; refs: string[] }[] = [];
  const rawConflicts = Array.isArray(raw['conflicts']) ? raw['conflicts'] : [];
  for (const item of rawConflicts.slice(0, RESEARCH_LIMITS.maxConflicts)) {
    const entry =
      item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const description = clip(asText(entry['description']), RESEARCH_LIMITS.maxTextLength);
    if (description === '') continue;
    const refs = [...new Set(asTextList(entry['refs']).map((ref) => ref.toUpperCase()))].filter(
      (ref) => byRef.has(ref),
    );
    conflicts.push({ description, refs });
  }

  const citations = findings.reduce((sum, finding) => sum + finding.evidence.length, 0);
  const verified = findings.reduce(
    (sum, finding) => sum + finding.evidence.filter((cite) => cite.verified).length,
    0,
  );
  const supported = findings.filter((finding) => finding.support === 'knowledge').length;
  const cited = input.passages.filter((passage) => citedRefs.has(passage.ref));

  return {
    cited,
    content: {
      findings,
      gaps: asTextList(raw['gaps'])
        .slice(0, RESEARCH_LIMITS.maxGaps)
        .map((gap) => clip(gap, RESEARCH_LIMITS.maxTextLength)),
      conflicts,
      knowledge: {
        queries: input.queries,
        snapshots: input.snapshots,
        offered: input.passages.map((passage) => ({
          ref: passage.ref,
          knowledgeId: passage.knowledgeId,
          versionId: passage.versionId,
          versionNo: passage.versionNo,
          title: passage.title,
          snapshotId: passage.snapshotId,
          cited: citedRefs.has(passage.ref),
        })),
        excludedRestricted: input.excludedRestricted,
        retrieveTool: input.retrieveTool,
        verifierTool: input.verifierTool,
        conflictWarnings: conflictRefs(input.passages),
      },
      verification: {
        findings: findings.length,
        supported,
        unverified: findings.length - supported,
        citations,
        verified,
        rejected: citations - verified,
      },
    },
  };
}

/**
 * What a later stage sees of the research: the claims with how well each is supported and the
 * titles it rests on. Quotes, ids and the retrieval details stay in the stored output; they
 * would only crowd the next prompt.
 */
export function compactResearchForPrompt(content: unknown): unknown {
  if (content === null || typeof content !== 'object') return content;
  const raw = content as Record<string, unknown>;
  if (!Array.isArray(raw['findings'])) return content;
  return {
    findings: raw['findings'].map((item) => {
      const entry =
        item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const evidence = Array.isArray(entry['evidence']) ? entry['evidence'] : [];
      const sources = evidence
        .filter(
          (cite): cite is Record<string, unknown> =>
            cite !== null &&
            typeof cite === 'object' &&
            (cite as Record<string, unknown>)['verified'] === true,
        )
        .map(
          (cite) =>
            `${asText(cite['title'])} (v${typeof cite['versionNo'] === 'number' ? cite['versionNo'] : '?'})`,
        );
      return {
        claim: entry['claim'],
        source: entry['source'],
        // Older outputs carry no support field; they were never checked against knowledge.
        support: entry['support'] ?? 'unverified',
        ...(sources.length > 0 ? { approvedKnowledge: [...new Set(sources)] } : {}),
      };
    }),
    gaps: raw['gaps'],
    ...(Array.isArray(raw['conflicts']) && raw['conflicts'].length > 0
      ? { conflicts: raw['conflicts'] }
      : {}),
  };
}
