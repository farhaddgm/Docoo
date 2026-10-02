import { normalizeForSearch } from './normalize.js';

/** Rubric of docs/03-ai/03-knowledge-and-brain.md §5. Weights sum to 100. */
export const RUBRIC_VERSION = 'brain-rubric-v1';

export const RUBRIC_WEIGHTS = {
  credibility: 25,
  relevance: 20,
  evidence: 20,
  recency: 15,
  bias: 10,
  conflict: 10,
} as const;

export type RubricCriterion = keyof typeof RUBRIC_WEIGHTS;
export type CriterionScores = Record<RubricCriterion, number>;

export const DECISION_THRESHOLDS = {
  approveOverall: 75,
  approveCredibility: 60,
  approveEvidence: 60,
  reviseOverall: 55,
} as const;

export type BrainDecision = 'approved' | 'needs_revision' | 'rejected';

export type CriticalFlag =
  | 'missing_provenance'
  | 'prompt_injection'
  | 'source_not_clean'
  | 'empty_content'
  | 'uncited_research_claim';

export interface AuditClaim {
  readonly id: string;
  readonly text: string;
  readonly kind: string;
  readonly citations: readonly {
    readonly complete: boolean;
    readonly publishedAt?: string | null;
  }[];
}

export interface AuditSubject {
  readonly sourceType: 'admin_provided' | 'clue_guided' | 'autonomous_research';
  readonly content: string;
  readonly provenance: Readonly<Record<string, unknown>>;
  /** Clean when the backing file passed malware scan; null for text without a file. */
  readonly sourceScan: 'clean' | 'infected' | 'error' | null;
  readonly sourcePartial: boolean;
  readonly claims: readonly AuditClaim[];
  /** Words describing the scope the knowledge is meant for (topic/project titles). */
  readonly scopeTerms: readonly string[];
  readonly validUntil: string | null;
  readonly openConflicts: number;
  readonly now: Date;
}

export interface ClaimResult {
  readonly claimId: string;
  readonly supported: boolean;
  readonly reason: string;
}

export interface AuditResult {
  readonly rubricVersion: string;
  readonly auditor: string;
  readonly scores: CriterionScores;
  readonly overall: number;
  readonly decision: BrainDecision;
  readonly reasons: string[];
  readonly claimResults: ClaimResult[];
  readonly criticalFlags: CriticalFlag[];
}

/**
 * The provider contract for Brain audit (AI-002). A model-backed auditor implements the
 * same interface; CI uses the deterministic rule-based auditor so results are stable.
 */
export interface KnowledgeAuditor {
  readonly id: string;
  audit(subject: AuditSubject): Promise<AuditResult>;
}

const INJECTION_PATTERNS = [
  /ignore (all |any )?(the )?(previous|prior|above) (instructions|prompts?)/iu,
  /disregard (the )?(system|previous) (prompt|instructions)/iu,
  /you are now (a|an|the) /iu,
  /reveal (the |your )?(system prompt|secrets?|api keys?)/iu,
  /دستور(ات)? (قبلی|قبل) را (نادیده|فراموش)/u,
  /نادیده بگیر/u,
  /پرامپت سیستم/u,
];

const ABSOLUTE_WORDS = [
  'always',
  'never',
  'guaranteed',
  'best ever',
  'undeniable',
  'everyone knows',
  'همیشه',
  'هرگز',
  'تضمینی',
  'بی\u200Cنظیر',
  'بی نظیر',
  'بدون شک',
  'قطعا\u064B',
];

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function weightedOverall(scores: CriterionScores): number {
  let total = 0;
  for (const [criterion, weight] of Object.entries(RUBRIC_WEIGHTS) as [RubricCriterion, number][]) {
    total += scores[criterion] * weight;
  }
  return Math.round((total / 100) * 100) / 100;
}

/** Base decision rule of §5; a critical flag always rejects. */
export function decide(
  scores: CriterionScores,
  overall: number,
  criticalFlags: readonly CriticalFlag[],
): BrainDecision {
  if (criticalFlags.length > 0) return 'rejected';
  if (
    overall >= DECISION_THRESHOLDS.approveOverall &&
    scores.credibility >= DECISION_THRESHOLDS.approveCredibility &&
    scores.evidence >= DECISION_THRESHOLDS.approveEvidence
  ) {
    return 'approved';
  }
  if (overall >= DECISION_THRESHOLDS.reviseOverall) return 'needs_revision';
  return 'rejected';
}

function provenanceComplete(subject: AuditSubject): boolean {
  const provenance = subject.provenance;
  const has = (key: string): boolean => {
    const value = provenance[key];
    return typeof value === 'string'
      ? value.trim().length > 0
      : value !== undefined && value !== null;
  };
  switch (subject.sourceType) {
    case 'admin_provided':
      return has('actorId') && has('declaredAt') && has('declaration');
    case 'clue_guided':
      return has('clue') && has('actorId');
    case 'autonomous_research':
      return has('query') && has('accessedAt');
  }
}

/** Deterministic auditor of rubric v1 (KNO-003). */
export class RuleBasedAuditor implements KnowledgeAuditor {
  readonly id = 'rule-based-v1';

  audit(subject: AuditSubject): Promise<AuditResult> {
    return Promise.resolve(auditWithRules(subject, this.id));
  }
}

export function auditWithRules(subject: AuditSubject, auditor = 'rule-based-v1'): AuditResult {
  const reasons: string[] = [];
  const criticalFlags: CriticalFlag[] = [];
  const content = subject.content.trim();

  if (content.length === 0) criticalFlags.push('empty_content');
  const hasProvenance = provenanceComplete(subject);
  if (!hasProvenance) criticalFlags.push('missing_provenance');
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(content))) {
    criticalFlags.push('prompt_injection');
  }
  if (subject.sourceScan === 'infected' || subject.sourceScan === 'error') {
    criticalFlags.push('source_not_clean');
  }

  // Credibility: who stands behind the content and how complete its provenance is.
  const baseCredibility = { admin_provided: 85, clue_guided: 70, autonomous_research: 60 }[
    subject.sourceType
  ];
  let credibility = baseCredibility - (hasProvenance ? 0 : 40) - (subject.sourcePartial ? 15 : 0);
  if (subject.sourceType !== 'admin_provided') {
    const citations = subject.claims.flatMap((claim) => claim.citations);
    const completeShare =
      citations.length === 0
        ? 0
        : citations.filter((citation) => citation.complete).length / citations.length;
    credibility += Math.round(completeShare * 25);
  }
  reasons.push(
    `credibility: ${subject.sourceType} source, provenance ${hasProvenance ? 'complete' : 'incomplete'}${subject.sourcePartial ? ', partial extraction' : ''}`,
  );

  // Relevance: overlap of scope terms with the content.
  const normalizedContent = normalizeForSearch(content);
  const terms = [
    ...new Set(subject.scopeTerms.flatMap((term) => normalizeForSearch(term).split(' '))),
  ].filter((term) => term.length > 2);
  const matched = terms.filter((term) => normalizedContent.includes(term)).length;
  const relevance = terms.length === 0 ? 70 : 40 + Math.round((matched / terms.length) * 60);
  reasons.push(`relevance: ${matched}/${terms.length} scope terms found`);

  // Evidence: every decision-relevant claim needs a complete citation, or direct admin provenance.
  const claimResults: ClaimResult[] = subject.claims.map((claim) => {
    if (claim.citations.some((citation) => citation.complete)) {
      return { claimId: claim.id, supported: true, reason: 'complete citation' };
    }
    if (subject.sourceType === 'admin_provided' && hasProvenance) {
      return { claimId: claim.id, supported: true, reason: 'direct administrator provenance' };
    }
    return {
      claimId: claim.id,
      supported: false,
      reason: claim.citations.length > 0 ? 'citation incomplete' : 'no citation',
    };
  });
  const supported = claimResults.filter((result) => result.supported).length;
  // Citations are mandatory for machine research: an unsupported claim there is critical.
  if (subject.sourceType === 'autonomous_research' && supported < claimResults.length) {
    criticalFlags.push('uncited_research_claim');
  }
  const evidence =
    claimResults.length === 0
      ? subject.sourceType === 'admin_provided' && hasProvenance
        ? 75
        : 50
      : Math.round((supported / claimResults.length) * 100);
  reasons.push(`evidence: ${supported}/${claimResults.length} claims supported`);

  // Recency: expired validity or old publication dates lower the score.
  let recency = 90;
  if (subject.validUntil && Date.parse(subject.validUntil) <= subject.now.getTime()) {
    recency = 0;
    reasons.push('recency: validity has ended');
  } else {
    const dates = subject.claims
      .flatMap((claim) => claim.citations.map((citation) => citation.publishedAt))
      .filter(
        (value): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value)),
      );
    if (dates.length > 0) {
      const newest = Math.max(...dates.map((value) => Date.parse(value)));
      const years = (subject.now.getTime() - newest) / (365.25 * 24 * 3600 * 1000);
      recency = clamp(100 - Math.max(0, years - 1) * 15);
      reasons.push(`recency: newest cited source ${years.toFixed(1)} years old`);
    } else {
      reasons.push('recency: no dated sources');
    }
  }

  // Bias: absolute or promotional wording.
  const lowered = content.toLocaleLowerCase('en');
  const absolutes = ABSOLUTE_WORDS.filter((word) => lowered.includes(word)).length;
  const bias = clamp(95 - absolutes * 15);
  reasons.push(`bias: ${absolutes} absolute or promotional expressions`);

  // Conflict: open conflicts with existing knowledge.
  const conflict = clamp(100 - subject.openConflicts * 25);
  reasons.push(`conflict: ${subject.openConflicts} open conflicts`);

  const scores: CriterionScores = {
    credibility: clamp(credibility),
    relevance: clamp(relevance),
    evidence: clamp(evidence),
    recency: clamp(recency),
    bias,
    conflict,
  };
  const overall = weightedOverall(scores);
  for (const flag of criticalFlags) reasons.push(`critical: ${flag}`);
  return {
    rubricVersion: RUBRIC_VERSION,
    auditor,
    scores,
    overall,
    decision: decide(scores, overall, criticalFlags),
    reasons,
    claimResults,
    criticalFlags,
  };
}
