import type {
  PromptConflictDecision,
  PromptResearchQuestion,
  SourceClass,
  WebSourceClass,
} from '@docoo/domain';
import { normalizeForSearch } from '@docoo/knowledge';

import type { RetrievedPassage } from './knowledge-retrieval.js';
import type { SourceCitation } from './source-citation.js';

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
  readonly sourceCitation?: SourceCitation;
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
  /** References continue after this many earlier ones, so a follow-up round never reuses `K1` (ADR-0039). */
  refOffset = 0,
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
    .map(({ passage, snapshotId }, index) =>
      toKnowledgePassage(passage, snapshotId, `K${refOffset + index + 1}`),
    );
}

function toKnowledgePassage(
  passage: RetrievedPassage,
  snapshotId: string,
  ref: string,
): KnowledgePassage {
  return {
    ref,
    chunkId: passage.chunkId,
    knowledgeId: passage.knowledgeId,
    versionId: passage.versionId,
    versionNo: passage.versionNo,
    title: passage.title,
    ...(passage.sourceCitation ? { sourceCitation: passage.sourceCitation } : {}),
    confidentiality: passage.confidentiality,
    text: clip(passage.text, RESEARCH_LIMITS.maxPassageChars),
    approval: passage.effectiveDecision === 'approved_by_override' ? 'override' : 'audit',
    auditScore: passage.auditScore,
    snapshotId,
    conflicts: passage.conflictWarnings.map((warning) => ({
      conflictId: warning.conflictId,
      other: clip(warning.conflictingClaim.text, 300),
    })),
  };
}

/**
 * Adds the passages a model-driven retrieval returned to the ones already numbered, continuing
 * the references (`K13`, `K14`, …). A passage already known keeps its reference, a passage of a
 * source beyond `maxSources` or beyond `maxPassages` is left out, and the passages this retrieval
 * returned (old and new, in rank order) come back so the model sees exactly those.
 */
export function addPassages(
  known: KnowledgePassage[],
  retrieval: {
    readonly snapshotId: string;
    readonly results: readonly RetrievedPassage[];
  },
  limits: { readonly maxPassages: number; readonly maxSources: number },
): KnowledgePassage[] {
  const returned: KnowledgePassage[] = [];
  const sources = new Set(known.map((passage) => passage.knowledgeId));
  for (const passage of retrieval.results) {
    const existing = known.find((item) => item.chunkId === passage.chunkId);
    if (existing) {
      returned.push(existing);
      continue;
    }
    if (known.length >= limits.maxPassages) continue;
    if (!sources.has(passage.knowledgeId) && sources.size >= limits.maxSources) continue;
    const added = toKnowledgePassage(passage, retrieval.snapshotId, `K${nextRef(known)}`);
    known.push(added);
    sources.add(passage.knowledgeId);
    returned.push(added);
  }
  return returned;
}

function nextRef(known: readonly KnowledgePassage[]): number {
  return known.reduce((max, passage) => Math.max(max, Number(passage.ref.slice(1)) || 0), 0) + 1;
}

/** What the model sees of a passage: no ids, no scores, only what it needs to cite. */
export interface KnowledgePromptItem {
  readonly ref: string;
  readonly title: string;
  readonly declaredSource?: SourceCitation;
  readonly version: number;
  readonly approval: string;
  readonly text: string;
  readonly openConflicts?: readonly string[];
}

export function knowledgePromptItems(passages: readonly KnowledgePassage[]): KnowledgePromptItem[] {
  return passages.map((passage) => ({
    ref: passage.ref,
    title: passage.title,
    ...(passage.sourceCitation ? { declaredSource: passage.sourceCitation } : {}),
    version: passage.versionNo,
    approval: passage.approval === 'override' ? 'approved by administrator override' : 'approved',
    text: passage.text,
    ...(passage.conflicts.length > 0
      ? { openConflicts: passage.conflicts.map((conflict) => conflict.other) }
      : {}),
  }));
}

/** A web page the provider's search used, numbered `W1`, `W2`, … like the knowledge `K` refs. */
export interface WebPassage {
  readonly ref: string;
  readonly url: string;
  readonly title: string;
  /** The part of the provider's notes that rests on the page; quotes are checked against it. */
  readonly text: string;
  /** Decided by code from the address (ADR-0040); older outputs have none and count as public. */
  readonly sourceClass?: WebSourceClass;
}

/** How the web side of one research attempt went. */
export interface WebRun {
  /** `used`: searched · `none`: searched, found nothing · `failed`: the provider call failed ·
   * `denied`: the role may not search · `off`: the setting is off. */
  readonly status: 'used' | 'none' | 'failed' | 'denied' | 'off';
  readonly code: string | null;
  readonly queries: readonly string[];
  readonly sources: readonly WebPassage[];
  /** Rounds of the search loop and why it stopped; absent in older outputs and single searches. */
  readonly rounds?: number | undefined;
  readonly stop?: string | undefined;
}

export const NO_WEB: WebRun = { status: 'off', code: null, queries: [], sources: [] };

/** What the model sees of a web page. */
export interface WebPromptItem {
  readonly ref: string;
  readonly title: string;
  readonly url: string;
  readonly sourceClass: WebSourceClass;
  readonly text: string;
}

export const webPromptItems = (web: WebRun | undefined): WebPromptItem[] =>
  (web?.sources ?? []).map((source) => ({
    ref: source.ref,
    title: source.title,
    url: source.url,
    sourceClass: source.sourceClass ?? 'public',
    text: source.text,
  }));

/** The web side of a stored research output: what was asked and which pages were cited. */
export interface ResearchWebInfo {
  readonly status: WebRun['status'];
  readonly code: string | null;
  readonly queries: readonly string[];
  readonly rounds?: number | undefined;
  readonly stop?: string | undefined;
  readonly sources: readonly {
    readonly ref: string;
    readonly url: string;
    readonly title: string;
    readonly cited: boolean;
    readonly sourceClass?: WebSourceClass;
  }[];
}

export type CitationProblem =
  'unknown_ref' | 'quote_missing' | 'quote_too_short' | 'quote_not_found' | 'verifier_not_allowed';

export interface ResearchEvidence {
  readonly ref: string;
  /** Where the cited source stands (ADR-0040); absent in older outputs. */
  readonly sourceClass?: SourceClass;
  /** The page a `W` citation points at. */
  readonly url?: string | null;
  readonly knowledgeId: string | null;
  readonly versionId: string | null;
  readonly versionNo: number | null;
  readonly title: string | null;
  readonly quote: string;
  readonly verified: boolean;
  readonly problem: CitationProblem | null;
}

/**
 * How far a finding can be trusted, in words the administrator can act on: `solid` rests on
 * approved knowledge, `limited` only on web pages, `unverified` on no verified citation, and
 * `disputed` is any of them that a reported conflict also names.
 */
export type FindingLevel = 'solid' | 'limited' | 'unverified' | 'disputed';

export function classifyFinding(
  support: 'knowledge' | 'web' | 'unverified',
  disputed: boolean,
): FindingLevel {
  if (disputed) return 'disputed';
  return support === 'knowledge' ? 'solid' : support === 'web' ? 'limited' : 'unverified';
}

export interface ResearchFinding {
  /** The planned question this finding answers (`Q1`, …); empty when it answers none (ADR-0038). */
  readonly questionId?: string;
  readonly level?: FindingLevel;
  /** The classes of the sources that verifiably back this finding (ADR-0040). */
  readonly sourceKinds?: readonly SourceClass[];
  /** How many distinct sources verifiably back it; 1 means it rests on a single source. */
  readonly verifiedSources?: number;
  readonly claim: string;
  readonly source: string;
  /** `knowledge` only when at least one citation was found verbatim in an approved passage. */
  readonly support: 'knowledge' | 'web' | 'unverified';
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

/** How well one planned question was answered, counted from its findings. */
export interface ResearchQuestionCoverage {
  readonly id: string;
  readonly question: string;
  readonly channel: string;
  readonly findings: number;
  readonly supported: number;
  /** `answered`: a supported finding · `weak`: findings, none supported · `unanswered`: none. */
  readonly status: 'answered' | 'weak' | 'unanswered';
}

export interface ResearchPlanInfo {
  readonly versionNo: number;
  readonly questions: readonly ResearchQuestionCoverage[];
}

/** The whole output at a glance (ADR-0038): counted by code from the stored findings. */
export interface ResearchSummary {
  readonly findings: number;
  readonly solid: number;
  readonly limited: number;
  readonly unverified: number;
  readonly disputed: number;
  readonly questions: {
    readonly total: number;
    readonly answered: number;
    readonly weak: number;
    readonly unanswered: number;
  };
  readonly sources: {
    readonly knowledge: number;
    readonly web: number;
    /** Of the cited web pages: those of an official body and the others (ADR-0040). */
    readonly official: number;
    readonly public: number;
  };
  /** Findings backed by exactly one verified source. */
  readonly singleSource: number;
}

export interface ResearchContent {
  readonly findings: readonly ResearchFinding[];
  readonly gaps: readonly string[];
  readonly conflicts: readonly { readonly description: string; readonly refs: readonly string[] }[];
  readonly knowledge: ResearchKnowledgeInfo;
  /** Absent in outputs written before web search existed. */
  readonly web?: ResearchWebInfo;
  readonly verification: ResearchVerification;
  /** The confirmed plan and how each question fared; absent when the stage ran without one. */
  readonly plan?: ResearchPlanInfo;
  /** Absent in outputs written before the research plan existed. */
  readonly summary?: ResearchSummary;
  /** The follow-up rounds joined onto this output, oldest first (ADR-0039). */
  readonly rounds?: readonly ResearchRound[];
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
  /** The web pages the model was given, if the attempt searched. */
  readonly web?: WebRun | undefined;
  /** The confirmed plan the stage worked to (ADR-0038); absent when it ran without one. */
  readonly plan?:
    | { readonly versionNo: number; readonly questions: readonly PromptResearchQuestion[] }
    | undefined;
}): { content: ResearchContent; cited: readonly KnowledgePassage[] } {
  const raw =
    input.output !== null && typeof input.output === 'object'
      ? (input.output as Record<string, unknown>)
      : {};
  const byRef = new Map(input.passages.map((passage) => [passage.ref, passage]));
  const web = input.web ?? NO_WEB;
  const webByRef = new Map(web.sources.map((source) => [source.ref, source]));
  const citedRefs = new Set<string>();
  const citedWeb = new Set<string>();
  const verifierAllowed = input.verifierTool === 'allowed';
  const plannedIds = new Set((input.plan?.questions ?? []).map((question) => question.id));

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
      const page = passage ? undefined : webByRef.get(ref);
      const checked = passage?.text ?? page?.text;
      let problem: CitationProblem | null = null;
      if (checked === undefined) problem = 'unknown_ref';
      else if (quote === '') problem = 'quote_missing';
      else if (!verifierAllowed) problem = 'verifier_not_allowed';
      else {
        const found = quoteInText(quote, checked);
        if (found === 'too_short') problem = 'quote_too_short';
        else if (found === 'not_found') problem = 'quote_not_found';
      }
      const verified = problem === null;
      if (verified && passage) citedRefs.add(passage.ref);
      if (verified && page) citedWeb.add(page.ref);
      evidence.push({
        ref,
        ...(passage ? { sourceClass: 'knowledge' as const } : {}),
        ...(page ? { url: page.url, sourceClass: page.sourceClass ?? ('public' as const) } : {}),
        knowledgeId: passage?.knowledgeId ?? null,
        versionId: passage?.versionId ?? null,
        versionNo: passage?.versionNo ?? null,
        title: passage?.title ?? page?.title ?? null,
        quote,
        verified,
        problem,
      });
    }
    const askedId = asText(entry['questionId']).toUpperCase();
    findings.push({
      questionId: plannedIds.has(askedId) ? askedId : '',
      claim,
      source: clip(asText(entry['source']), RESEARCH_LIMITS.maxTextLength),
      // Approved knowledge counts first; a web page alone makes the finding `web`, never `knowledge`.
      support: evidence.some((cite) => cite.verified && !cite.ref.startsWith('W'))
        ? 'knowledge'
        : evidence.some((cite) => cite.verified)
          ? 'web'
          : 'unverified',
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
      (ref) => byRef.has(ref) || webByRef.has(ref),
    );
    conflicts.push({ description, refs });
  }

  const graded = gradeFindings(findings, conflicts);

  const citations = findings.reduce((sum, finding) => sum + finding.evidence.length, 0);
  const verified = findings.reduce(
    (sum, finding) => sum + finding.evidence.filter((cite) => cite.verified).length,
    0,
  );
  const supported = findings.filter((finding) => finding.support !== 'unverified').length;
  const cited = input.passages.filter((passage) => citedRefs.has(passage.ref));

  const planInfo = coverPlan(graded, input.plan);
  const summary = summarizeResearch(
    graded,
    planInfo,
    citedRefs.size,
    web.sources.filter((source) => citedWeb.has(source.ref)),
  );

  return {
    cited,
    content: {
      findings: graded,
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
      web: {
        status: web.status,
        code: web.code,
        queries: web.queries,
        ...(web.rounds !== undefined ? { rounds: web.rounds } : {}),
        ...(web.stop !== undefined ? { stop: web.stop } : {}),
        sources: web.sources.map((source) => ({
          ref: source.ref,
          url: source.url,
          title: source.title,
          cited: citedWeb.has(source.ref),
          sourceClass: source.sourceClass ?? ('public' as const),
        })),
      },
      verification: {
        findings: findings.length,
        supported,
        unverified: findings.length - supported,
        citations,
        verified,
        rejected: citations - verified,
      },
      ...(planInfo ? { plan: planInfo } : {}),
      summary,
    },
  };
}

/** A finding is disputed when a reported conflict names a source it cites. */
function gradeFindings(
  findings: readonly ResearchFinding[],
  conflicts: readonly { readonly refs: readonly string[] }[],
): ResearchFinding[] {
  const disputedRefs = new Set(conflicts.flatMap((conflict) => conflict.refs));
  return findings.map((finding) => {
    // What verifiably backs the finding, by class; an older citation without a class is read from its ref.
    const backing = finding.evidence.filter((cite) => cite.verified);
    const kinds = new Set<SourceClass>(
      backing.map(
        (cite) => cite.sourceClass ?? (cite.ref.startsWith('W') ? 'public' : 'knowledge'),
      ),
    );
    return {
      ...finding,
      level: classifyFinding(
        finding.support,
        finding.evidence.some((cite) => disputedRefs.has(cite.ref)),
      ),
      sourceKinds: [...kinds],
      verifiedSources: new Set(backing.map((cite) => cite.ref)).size,
    };
  });
}

/** How each planned question fared, counted from the graded findings. */
function coverPlan(
  graded: readonly ResearchFinding[],
  plan:
    | { readonly versionNo: number; readonly questions: readonly PromptResearchQuestion[] }
    | undefined,
): ResearchPlanInfo | undefined {
  if (!plan) return undefined;
  return {
    versionNo: plan.versionNo,
    questions: plan.questions.map((question) => {
      const mine = graded.filter((finding) => finding.questionId === question.id);
      const supportedCount = mine.filter((finding) => finding.support !== 'unverified').length;
      return {
        id: question.id,
        question: question.question,
        channel: question.channel,
        findings: mine.length,
        supported: supportedCount,
        status: supportedCount > 0 ? 'answered' : mine.length > 0 ? 'weak' : 'unanswered',
      };
    }),
  };
}

function summarizeResearch(
  graded: readonly ResearchFinding[],
  planInfo: ResearchPlanInfo | undefined,
  citedKnowledge: number,
  citedPages: readonly { readonly sourceClass?: WebSourceClass }[],
): ResearchSummary {
  const levelCount = (level: FindingLevel) =>
    graded.filter((finding) => finding.level === level).length;
  const questionCount = (status: ResearchQuestionCoverage['status']) =>
    planInfo?.questions.filter((item) => item.status === status).length ?? 0;
  return {
    findings: graded.length,
    solid: levelCount('solid'),
    limited: levelCount('limited'),
    unverified: levelCount('unverified'),
    disputed: levelCount('disputed'),
    questions: {
      total: planInfo?.questions.length ?? 0,
      answered: questionCount('answered'),
      weak: questionCount('weak'),
      unanswered: questionCount('unanswered'),
    },
    sources: {
      knowledge: citedKnowledge,
      web: citedPages.length,
      official: citedPages.filter((page) => page.sourceClass === 'official').length,
      public: citedPages.filter((page) => page.sourceClass !== 'official').length,
    },
    singleSource: graded.filter((finding) => finding.verifiedSources === 1).length,
  };
}

const refNumber = (ref: string): number => Number(ref.slice(1)) || 0;

/** The highest `K` and `W` number an earlier output used: where a follow-up round continues from. */
export function refOffsetsOf(content: unknown): { knowledge: number; web: number } {
  const raw =
    content !== null && typeof content === 'object' ? (content as Record<string, unknown>) : {};
  const knowledge = raw['knowledge'] as { offered?: { ref?: unknown }[] } | undefined;
  const web = raw['web'] as { sources?: { ref?: unknown }[] } | undefined;
  const top = (items: { ref?: unknown }[] | undefined) =>
    (items ?? []).reduce(
      (max, item) => (typeof item.ref === 'string' ? Math.max(max, refNumber(item.ref)) : max),
      0,
    );
  return { knowledge: top(knowledge?.offered), web: top(web?.sources) };
}

/** What a follow-up round is recorded as in the output. */
export interface ResearchRound {
  readonly questions: readonly string[];
}

const mentionsAny = (text: string, ids: ReadonlySet<string>): boolean =>
  [...text.matchAll(/\bQ\d+\b/giu)].some((match) => ids.has(match[0].toUpperCase()));

/**
 * Joins a follow-up round onto the output it follows (ADR-0039). The findings of the questions
 * the round worked on are replaced by the new ones; every other finding stays exactly as it was,
 * citations included (the new references continue after the old ones, so they never collide).
 * Everything derived — grades, question coverage, summary, verification — is counted again over
 * the joined findings, so the merged output is as self-consistent as a fresh one.
 */
export function mergeFollowup(input: {
  readonly previous: ResearchContent;
  readonly fresh: ResearchContent;
  /** The ids of the questions the round worked on. */
  readonly focus: readonly string[];
  /** The whole current plan, for the coverage of every question. */
  readonly plan: {
    readonly versionNo: number;
    readonly questions: readonly PromptResearchQuestion[];
  };
}): ResearchContent {
  const { previous, fresh } = input;
  const focus = new Set(input.focus);
  const kept = previous.findings.filter((finding) => !focus.has(finding.questionId ?? ''));
  const conflicts = [...previous.conflicts, ...fresh.conflicts];
  const graded = gradeFindings([...kept, ...fresh.findings], conflicts);
  const offered = [...previous.knowledge.offered, ...fresh.knowledge.offered];
  const webSources = [...(previous.web?.sources ?? []), ...(fresh.web?.sources ?? [])];
  const planInfo = coverPlan(graded, input.plan);
  const citations = graded.reduce((sum, finding) => sum + finding.evidence.length, 0);
  const verified = graded.reduce(
    (sum, finding) => sum + finding.evidence.filter((cite) => cite.verified).length,
    0,
  );
  const supported = graded.filter((finding) => finding.support !== 'unverified').length;
  const previousWebStatus = previous.web?.status ?? 'off';
  const freshWebStatus = fresh.web?.status ?? 'off';
  return {
    findings: graded,
    gaps: [...previous.gaps.filter((gap) => !mentionsAny(gap, focus)), ...fresh.gaps],
    conflicts,
    knowledge: {
      ...fresh.knowledge,
      queries: [...previous.knowledge.queries, ...fresh.knowledge.queries],
      snapshots: [...previous.knowledge.snapshots, ...fresh.knowledge.snapshots],
      offered,
      excludedRestricted:
        previous.knowledge.excludedRestricted || fresh.knowledge.excludedRestricted,
      conflictWarnings: [
        ...previous.knowledge.conflictWarnings,
        ...fresh.knowledge.conflictWarnings,
      ],
    },
    web: {
      status: previousWebStatus === 'used' || freshWebStatus === 'used' ? 'used' : freshWebStatus,
      code: fresh.web?.code ?? previous.web?.code ?? null,
      queries: [...(previous.web?.queries ?? []), ...(fresh.web?.queries ?? [])],
      sources: webSources,
    },
    verification: {
      findings: graded.length,
      supported,
      unverified: graded.length - supported,
      citations,
      verified,
      rejected: citations - verified,
    },
    ...(planInfo ? { plan: planInfo } : {}),
    summary: summarizeResearch(
      graded,
      planInfo,
      offered.filter((item) => item.cited).length,
      webSources.filter((item) => item.cited),
    ),
    rounds: [...(previous.rounds ?? []), { questions: [...input.focus] }],
  };
}

/**
 * What a later stage sees of the research: the claims with how well each is supported and the
 * titles it rests on. Quotes, ids and the retrieval details stay in the stored output; they
 * would only crowd the next prompt.
 */
export function compactResearchForPrompt(
  content: unknown,
  decisions: readonly PromptConflictDecision[] = [],
): unknown {
  if (content === null || typeof content !== 'object') return content;
  const raw = content as Record<string, unknown>;
  if (!Array.isArray(raw['findings'])) return content;
  return {
    findings: raw['findings'].map((item) => {
      const entry =
        item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const evidence = Array.isArray(entry['evidence']) ? entry['evidence'] : [];
      const verifiedCites = evidence.filter(
        (cite): cite is Record<string, unknown> =>
          cite !== null &&
          typeof cite === 'object' &&
          (cite as Record<string, unknown>)['verified'] === true,
      );
      const sources = verifiedCites
        .filter((cite) => typeof cite['url'] !== 'string')
        .map(
          (cite) =>
            `${asText(cite['title'])} (v${typeof cite['versionNo'] === 'number' ? cite['versionNo'] : '?'})`,
        );
      const pages = verifiedCites
        .filter((cite) => typeof cite['url'] === 'string')
        .map((cite) => `${asText(cite['title'])} (${asText(cite['url'])})`);
      return {
        claim: entry['claim'],
        source: entry['source'],
        // Older outputs carry no support field; they were never checked against knowledge.
        support: entry['support'] ?? 'unverified',
        ...(typeof entry['level'] === 'string' ? { level: entry['level'] } : {}),
        ...(Array.isArray(entry['sourceKinds']) && entry['sourceKinds'].length > 0
          ? { sourceKinds: entry['sourceKinds'] }
          : {}),
        ...(entry['verifiedSources'] === 1 ? { singleSource: true } : {}),
        ...(asText(entry['questionId']) !== '' ? { questionId: entry['questionId'] } : {}),
        ...(sources.length > 0 ? { approvedKnowledge: [...new Set(sources)] } : {}),
        ...(pages.length > 0 ? { webPages: [...new Set(pages)] } : {}),
      };
    }),
    gaps: raw['gaps'],
    ...openQuestions(raw['plan']),
    ...(decisions.length > 0 ? { conflictDecisions: decisions } : {}),
    ...(Array.isArray(raw['conflicts']) && raw['conflicts'].length > 0
      ? { conflicts: raw['conflicts'] }
      : {}),
  };
}

/** The planned questions the research left weakly answered or unanswered, for the stages after it. */
function openQuestions(plan: unknown): { openQuestions?: unknown[] } {
  const questions =
    plan !== null && typeof plan === 'object'
      ? (plan as Record<string, unknown>)['questions']
      : undefined;
  if (!Array.isArray(questions)) return {};
  const open = questions.flatMap((item) => {
    const entry =
      item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return entry['status'] === 'answered' || typeof entry['id'] !== 'string'
      ? []
      : [{ id: entry['id'], question: entry['question'], status: entry['status'] }];
  });
  return open.length > 0 ? { openQuestions: open } : {};
}
