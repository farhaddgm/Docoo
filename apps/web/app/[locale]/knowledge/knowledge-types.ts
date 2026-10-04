/** Shapes of the knowledge and source API (docs/04-architecture/03-api-contracts.md §8). */

export const knowledgeStatuses = [
  'draft',
  'pending',
  'in_review',
  'approved',
  'needs_revision',
  'rejected',
  'expired',
  'superseded',
] as const;
export type KnowledgeStatus = (typeof knowledgeStatuses)[number];

export type BrainDecision = 'approved' | 'needs_revision' | 'rejected';

/** What retrieval treats the version as: the Brain verdict, a human override, or stale. */
export type EffectiveDecision =
  'pending' | BrainDecision | 'approved_by_override' | 'rejected_by_override' | 'stale';

export const sourceTypes = ['admin_provided', 'clue_guided', 'autonomous_research'] as const;
export type SourceType = (typeof sourceTypes)[number];

export const confidentialities = ['internal', 'confidential', 'restricted'] as const;
export type Confidentiality = (typeof confidentialities)[number];

export type ScopeType = 'workspace' | 'topic' | 'project';

export const criteria = [
  'credibility',
  'relevance',
  'evidence',
  'recency',
  'bias',
  'conflict',
] as const;
export type Criterion = (typeof criteria)[number];

export const claimKinds = [
  'numeric',
  'causal',
  'comparative',
  'recommendation',
  'statement',
] as const;
export type ClaimKind = (typeof claimKinds)[number];

export interface Scope {
  type: ScopeType;
  id: string;
  role?: string | null;
  /** Title of the topic or project; a workspace has none. */
  title: string | null;
}

export interface KnowledgeRow {
  id: string;
  title: string;
  sourceType: SourceType;
  confidentiality: Confidentiality;
  language: 'fa' | 'en';
  version: number;
  versionNo: number | null;
  status: KnowledgeStatus | null;
  staleReason: string | null;
  validUntil: string | null;
  overall: number | null;
  decision: BrainDecision | null;
  effectiveDecision: EffectiveDecision;
  claimCount: number;
  openConflicts: number;
  scopes: Scope[];
  createdAt: string;
  updatedAt: string;
}

export interface ClaimRow {
  id: string;
  ordinal: number;
  text: string;
  kind: ClaimKind;
  knowledgeId: string;
  title: string;
  versionNo: number;
  status: KnowledgeStatus;
  effectiveDecision: EffectiveDecision;
  /** The Brain's verdict on this claim; null while the version has not been audited. */
  supported: boolean | null;
  supportReason: string | null;
  citations: { total: number; complete: number };
  openConflicts: number;
}

export interface Citation {
  id: string;
  sourceRef: string | null;
  title: string | null;
  publisher: string | null;
  author: string | null;
  publishedAt: string | null;
  accessedAt: string | null;
  locator: string | null;
  quoteDigest: string | null;
  complete: boolean;
  missingFields: string[];
  verificationStatus: string;
}

export interface Claim {
  id: string;
  ordinal: number;
  text: string;
  kind: ClaimKind;
  locator: Record<string, string | number> | null;
  sourceSegmentId: string | null;
  citations: Citation[];
}

export interface Review {
  id: string;
  knowledgeVersionId: string;
  rubricVersion: string;
  auditor: string;
  scores: Record<Criterion, number>;
  overall: number;
  decision: BrainDecision;
  reasons: string[];
  claimResults: { claimId: string; supported: boolean; reason: string }[];
  criticalFlags: string[];
  createdAt: string;
}

export interface Override {
  id: string;
  reviewId: string;
  decision: 'approve' | 'reject';
  reason: string;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface KnowledgeVersion {
  id: string;
  versionNo: number;
  status: KnowledgeStatus;
  contentSha256: string;
  language: 'fa' | 'en';
  sourceVersionId: string | null;
  provenance: Record<string, unknown>;
  validFrom: string | null;
  validUntil: string | null;
  staleReason: string | null;
  createdBy: string | null;
  createdAt: string;
  content?: string;
}

export interface KnowledgeDetail {
  id: string;
  title: string;
  sourceType: SourceType;
  confidentiality: Confidentiality;
  language: 'fa' | 'en';
  version: number;
  createdAt: string;
  updatedAt: string;
  scopes: Scope[];
  currentVersion:
    | (KnowledgeVersion & {
        content: string;
        claims: Claim[];
        latestReview: Review | null;
        overrides: Override[];
        effectiveDecision: EffectiveDecision;
      })
    | null;
}

export interface ListedReview extends Review {
  knowledgeId: string;
}

export interface ConflictSide {
  id: string;
  text: string;
  knowledgeId: string;
  versionId: string;
  title: string;
}

export interface Conflict {
  id: string;
  conflictType: string;
  severity: 'low' | 'medium' | 'high';
  analysis: string;
  status: 'open' | 'resolved';
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  claimA: ConflictSide;
  claimB: ConflictSide;
}

export const sourceStatuses = [
  'uploaded',
  'quarantined',
  'scanning',
  'accepted',
  'extracting',
  'indexed',
  'partial',
  'rejected',
  'failed',
] as const;
export type SourceStatus = (typeof sourceStatuses)[number];

/** The pipeline is still working on these; the screen refreshes until they settle. */
export const sourceInFlight: readonly SourceStatus[] = [
  'uploaded',
  'quarantined',
  'scanning',
  'accepted',
  'extracting',
];

export interface SourceVersion {
  id: string;
  versionNo: number;
  status: SourceStatus;
  filename: string | null;
  sniffedMime: string | null;
  sizeBytes: number | null;
  originUrl: string | null;
  extraction: { warnings?: string[]; segmentCount?: number; pageCount?: number } | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceRow {
  id: string;
  kind: 'file' | 'url' | 'text';
  title: string;
  scope: { type: ScopeType; id: string; title: string | null };
  currentVersionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  currentVersion: SourceVersion | null;
  knowledge: { id: string; title: string; status: string; stale: boolean }[];
}

export interface RetrievalResult {
  chunkId: string;
  knowledgeId: string;
  versionId: string;
  versionNo: number;
  title: string;
  confidentiality: Confidentiality;
  text: string;
  score: number;
  lexicalRank: number | null;
  vectorRank: number | null;
  similarity: number | null;
  auditScore: number | null;
  effectiveDecision: 'approved' | 'approved_by_override';
  conflictWarnings: {
    conflictId: string;
    conflictType: string;
    severity: string;
    claim: { id: string; text: string };
    conflictingClaim: { id: string; text: string; knowledgeId: string };
  }[];
}

export interface Retrieval {
  snapshotId: string;
  hash: string;
  embeddingModel: string;
  createdAt: string;
  results: RetrievalResult[];
}

export interface TopicOption {
  id: string;
  title: string;
}
export interface ProjectOption {
  id: string;
  code: string;
  title: string;
}

/** A place a source or knowledge can belong to, as chosen on a form. */
export interface ScopeChoice {
  type: ScopeType;
  id: string;
}

/** Roles a knowledge scope can be limited to (docs/03-ai/03-knowledge-and-brain.md §8). */
export const scopeRoles = [
  'analyst',
  'researcher',
  'ideator',
  'documenter',
  'evaluator',
  'brain',
] as const;
export type ScopeRole = (typeof scopeRoles)[number];

/** The rubric a review was scored with; weights and thresholds are shown next to the scores. */
export const rubrics: Record<
  string,
  {
    weights: Record<Criterion, number>;
    approveOverall: number;
    approveCredibility: number;
    approveEvidence: number;
    reviseOverall: number;
  }
> = {
  'brain-rubric-v1': {
    weights: { credibility: 25, relevance: 20, evidence: 20, recency: 15, bias: 10, conflict: 10 },
    approveOverall: 75,
    approveCredibility: 60,
    approveEvidence: 60,
    reviseOverall: 55,
  },
};

export const MIN_OVERRIDE_REASON_LENGTH = 20;
export const MIN_RESOLUTION_LENGTH = 10;
