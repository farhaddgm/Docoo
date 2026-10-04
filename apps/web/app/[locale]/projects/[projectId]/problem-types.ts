/** Shapes of the analysis API (docs/04-architecture/03-api-contracts.md §7). */
export type AnswerMode = 'answered' | 'unanswered' | 'irrelevant' | 'later';
export type QuestionStatus = 'open' | AnswerMode;

export const answerModes: readonly AnswerMode[] = ['answered', 'unanswered', 'irrelevant', 'later'];

export interface Attachment {
  sourceId: string;
  versionId: string;
  title: string;
}

export interface Question {
  id: string;
  batchId: string;
  batchNo: number;
  number: number;
  category: string;
  text: string;
  rationale: string;
  followUpOf: number | null;
  status: QuestionStatus;
  answer: {
    id: string;
    revisionNo: number;
    text: string | null;
    attachments: Attachment[];
    answeredAt: string | null;
  } | null;
  revisions: number;
}

export interface Batch {
  id: string;
  batchNo: number;
  status: 'open' | 'submitted';
  submittedAt: string | null;
  createdAt: string;
  round: number;
  reason: string;
  understood: string | null;
  nextAmbiguity: string | null;
  questions: Question[];
}

export interface CoverageRow {
  category: string;
  required: boolean;
  asked: number;
  answered: number;
  unanswered: number;
  irrelevant: number;
  later: number;
  open: number;
  level: string;
}

export interface Progress {
  asked: number;
  answered: number;
  unanswered: number;
  irrelevant: number;
  later: number;
  open: number;
  minimum: number;
  maximum: number;
  minimumReached: boolean;
  maximumReached: boolean;
}

export interface Contradiction {
  id: string;
  questions: [number, number];
  description: string;
  status: 'open' | 'resolved';
}

export interface Definition {
  outputId: string;
  stageRunId: string;
  versionNo: number;
  origin: string;
  createdAt: string;
  content: Record<string, unknown>;
  status: 'draft' | 'awaiting_approval' | 'approved' | 'rejected' | 'superseded';
  rejectionReason: string | null;
  approved: boolean;
  passedByDecision: boolean;
  unresolvedQuestions: {
    number: number;
    category: string;
    text: string;
    status: string;
    note: string | null;
  }[];
}

export interface DefinitionVersion {
  outputId: string;
  stageRunId: string;
  runNo: number;
  versionNo: number;
  origin: string;
  createdAt: string;
  content: Record<string, unknown>;
  current: boolean;
  approved: boolean;
  status: string;
}

export type Phase =
  'not_started' | 'answering' | 'analysing' | 'awaiting_approval' | 'approved' | 'cancelled';

export interface Analysis {
  runId: string | null;
  stageRunId: string | null;
  phase: Phase;
  limits: { minimum: number; maximum: number; batchSize: number };
  progress: Progress;
  coverage: CoverageRow[];
  coverageGaps: string[];
  openBatchId: string | null;
  finish: {
    requested: boolean;
    requestedAt: string | null;
    reason: string | null;
    available: boolean;
  };
  understanding: {
    round: number;
    understood: string;
    nextAmbiguity: string;
    sufficient: boolean;
    reason: string;
    createdAt: string;
  } | null;
  contradictions: Contradiction[];
  followUps: Question[];
  definition: Definition | null;
}

/** What the administrator is typing for one question before it is saved. */
export interface Draft {
  mode: AnswerMode | null;
  text: string;
  files: Attachment[];
  uploading: boolean;
}

export const emptyDraft: Draft = { mode: null, text: '', files: [], uploading: false };
