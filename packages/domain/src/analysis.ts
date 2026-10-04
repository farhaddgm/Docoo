/**
 * Rules of the analyst's question-and-answer phase (FR-ANL-001..006). Everything here is
 * deterministic: the model proposes questions and judgements, these functions decide what is
 * kept, how far the analysis has come and when it may move on to the problem definition.
 */

/** Hard limits of the phase (FR-ANL-001, FR-ANL-002). */
export const ANALYSIS_LIMITS = {
  minimumQuestions: 30,
  maximumQuestions: 300,
  batchSize: 40,
} as const;

/**
 * Coverage dimensions. The first eight are those FR-ANL-004 names; risk and out-of-scope come
 * from the analyst's charter (docs/03-ai/02-agent-charters.md §1).
 */
export const questionCategories = [
  'goal',
  'constraint',
  'context',
  'stakeholder',
  'time',
  'budget',
  'data',
  'success_criteria',
  'risk',
  'out_of_scope',
] as const;

export type QuestionCategory = (typeof questionCategories)[number];

/** Categories without at least one question block the analyst from declaring itself done. */
export const requiredQuestionCategories: readonly QuestionCategory[] = [
  'goal',
  'constraint',
  'context',
  'stakeholder',
  'time',
  'budget',
  'data',
  'success_criteria',
];

export function isQuestionCategory(value: unknown): value is QuestionCategory {
  return questionCategories.some((category) => category === value);
}

/** What the administrator did with a question (FR-ANL-003). */
export const answerStatuses = ['answered', 'unanswered', 'irrelevant', 'later'] as const;
export type AnswerStatus = (typeof answerStatuses)[number];
export type QuestionStatus = 'open' | AnswerStatus;

export const ANSWER_LIMITS = {
  textMaxLength: 8000,
  attachmentsPerAnswer: 5,
  answersPerSubmission: ANALYSIS_LIMITS.batchSize,
} as const;

// ------------------------------------------------------------------ duplicates

const ARABIC_FORMS: Readonly<Record<string, string>> = {
  ي: 'ی',
  ى: 'ی',
  ك: 'ک',
  ة: 'ه',
  ؤ: 'و',
  أ: 'ا',
  إ: 'ا',
};

/**
 * Comparison form of a question: Persian letter forms, ASCII digits, no diacritics, no
 * punctuation, collapsed spaces, lower case. Display text is never replaced by it.
 */
export function normalizeQuestionText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[يىكةؤأإ]/gu, (letter) => ARABIC_FORMS[letter] ?? letter)
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[ً-ٰٟـ]/gu, '')
    .replace(/‌|‍|‎|‏/gu, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en');
}

function tokens(text: string): Set<string> {
  return new Set((normalizeQuestionText(text).match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).filter(Boolean));
}

/** Share of words two questions have in common (Jaccard), 1 when they are the same words. */
export function questionSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const word of left) if (right.has(word)) common += 1;
  return common / (left.size + right.size - common);
}

/** Questions at or above this similarity count as the same question reworded. */
export const DUPLICATE_THRESHOLD = 0.85;

export interface DedupeResult<T> {
  readonly kept: T[];
  readonly dropped: { readonly candidate: T; readonly of: 'earlier' | 'same_batch' }[];
}

/**
 * Drops proposed questions that repeat an earlier question or another one in the same
 * proposal; filling the count with rewordings is forbidden (analyst charter, principle 5).
 */
export function dedupeQuestions<T extends { readonly text: string }>(
  candidates: readonly T[],
  earlier: readonly string[],
): DedupeResult<T> {
  const kept: T[] = [];
  const dropped: DedupeResult<T>['dropped'][number][] = [];
  for (const candidate of candidates) {
    if (normalizeQuestionText(candidate.text) === '') {
      dropped.push({ candidate, of: 'same_batch' });
      continue;
    }
    if (earlier.some((text) => questionSimilarity(text, candidate.text) >= DUPLICATE_THRESHOLD)) {
      dropped.push({ candidate, of: 'earlier' });
    } else if (
      kept.some((item) => questionSimilarity(item.text, candidate.text) >= DUPLICATE_THRESHOLD)
    ) {
      dropped.push({ candidate, of: 'same_batch' });
    } else {
      kept.push(candidate);
    }
  }
  return { kept, dropped };
}

/** How many new questions the next batch may hold (FR-ANL-001, FR-ANL-002). */
export function batchCapacity(
  asked: number,
  limits: typeof ANALYSIS_LIMITS = ANALYSIS_LIMITS,
): number {
  return Math.max(0, Math.min(limits.batchSize, limits.maximumQuestions - asked));
}

// ------------------------------------------------------------------ progress and coverage

export interface AnalysisProgress {
  readonly asked: number;
  readonly answered: number;
  readonly unanswered: number;
  readonly irrelevant: number;
  readonly later: number;
  readonly open: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly minimumReached: boolean;
  readonly maximumReached: boolean;
}

/** `answered / asked / minimum / maximum` of the analysis (UX §7). */
export function analysisProgress(
  questions: readonly { readonly status: QuestionStatus }[],
): AnalysisProgress {
  const count = (status: QuestionStatus) =>
    questions.filter((question) => question.status === status).length;
  const asked = questions.length;
  return {
    asked,
    answered: count('answered'),
    unanswered: count('unanswered'),
    irrelevant: count('irrelevant'),
    later: count('later'),
    open: count('open'),
    minimum: ANALYSIS_LIMITS.minimumQuestions,
    maximum: ANALYSIS_LIMITS.maximumQuestions,
    minimumReached: asked >= ANALYSIS_LIMITS.minimumQuestions,
    maximumReached: asked >= ANALYSIS_LIMITS.maximumQuestions,
  };
}

/**
 * none: no question yet · pending: waiting for the administrator · not_applicable: every
 * question was marked irrelevant · gap: nothing answered · partial: some answered, some
 * left for later or unanswered · covered: answered with nothing left over.
 */
export type CoverageLevel = 'none' | 'pending' | 'not_applicable' | 'gap' | 'partial' | 'covered';

export interface CategoryCoverage {
  readonly category: QuestionCategory;
  readonly required: boolean;
  readonly asked: number;
  readonly answered: number;
  readonly unanswered: number;
  readonly irrelevant: number;
  readonly later: number;
  readonly open: number;
  readonly level: CoverageLevel;
}

export function coverageLevel(
  counts: Omit<CategoryCoverage, 'category' | 'required' | 'level'>,
): CoverageLevel {
  if (counts.asked === 0) return 'none';
  if (counts.open > 0) return 'pending';
  if (counts.irrelevant === counts.asked) return 'not_applicable';
  if (counts.answered === 0) return 'gap';
  return counts.later + counts.unanswered > 0 ? 'partial' : 'covered';
}

/** Coverage of the questions over the dimensions of FR-ANL-004, in a fixed order. */
export function coverageReport(
  questions: readonly { readonly category: QuestionCategory; readonly status: QuestionStatus }[],
): CategoryCoverage[] {
  return questionCategories.map((category) => {
    const own = questions.filter((question) => question.category === category);
    const count = (status: QuestionStatus) =>
      own.filter((question) => question.status === status).length;
    const counts = {
      asked: own.length,
      answered: count('answered'),
      unanswered: count('unanswered'),
      irrelevant: count('irrelevant'),
      later: count('later'),
      open: count('open'),
    };
    return {
      category,
      required: requiredQuestionCategories.includes(category),
      ...counts,
      level: coverageLevel(counts),
    };
  });
}

/** Required dimensions that still have no question at all. */
export function coverageGaps(report: readonly CategoryCoverage[]): QuestionCategory[] {
  return report
    .filter((entry) => entry.required && entry.asked === 0)
    .map((entry) => entry.category);
}

/** Questions the final report must name as unresolved (FR-ANL-006). */
export function isUnresolved(status: QuestionStatus): boolean {
  return status === 'later' || status === 'unanswered';
}

// ------------------------------------------------------------------ next step

export interface RoundFacts {
  readonly asked: number;
  readonly finishRequested: boolean;
  /** The analyst's own judgement; null when no model call was made. */
  readonly modelSufficient: boolean | null;
  /** New questions left after removing repeats and applying the batch capacity. */
  readonly newQuestionCount: number;
  readonly coverageGaps: readonly QuestionCategory[];
}

export type RoundDecision =
  | {
      readonly action: 'define';
      readonly reason: 'finish_requested' | 'maximum_reached' | 'sufficient' | 'nothing_new';
    }
  | { readonly action: 'ask'; readonly reason: 'minimum' | 'coverage' | 'analyst' }
  | { readonly action: 'stalled' };

/**
 * What a round of the analysis does next. The problem definition is only produced when at
 * least thirty questions were asked, whatever the model says (FR-ANL-002), and the model's
 * "enough" is not accepted while a required dimension has no question (FR-ANL-004).
 */
export function decideRound(facts: RoundFacts): RoundDecision {
  const { minimumQuestions, maximumQuestions } = ANALYSIS_LIMITS;
  if (facts.asked >= minimumQuestions && facts.finishRequested) {
    return { action: 'define', reason: 'finish_requested' };
  }
  if (facts.asked >= maximumQuestions) return { action: 'define', reason: 'maximum_reached' };
  if (
    facts.modelSufficient === true &&
    facts.asked >= minimumQuestions &&
    facts.coverageGaps.length === 0
  ) {
    return { action: 'define', reason: 'sufficient' };
  }
  if (facts.newQuestionCount > 0) {
    if (facts.asked < minimumQuestions) return { action: 'ask', reason: 'minimum' };
    return { action: 'ask', reason: facts.coverageGaps.length > 0 ? 'coverage' : 'analyst' };
  }
  if (facts.asked >= minimumQuestions) return { action: 'define', reason: 'nothing_new' };
  return { action: 'stalled' };
}

// ------------------------------------------------------------------ contradictions

export type ContradictionStatus = 'open' | 'resolved';

/** Stable key of a contradiction between two questions, whichever order they were named in. */
export function contradictionKey(first: number, second: number): string {
  return `${Math.min(first, second)}-${Math.max(first, second)}`;
}

export interface ContradictionChanges {
  readonly toOpen: string[];
  readonly toReopen: string[];
  readonly toResolve: string[];
}

/**
 * The analyst reports the contradictions it sees in the answers so far. A new one is logged,
 * one it no longer reports is resolved and one that comes back is reopened; nothing is
 * deleted (docs/03-ai/02-agent-charters.md: contradiction log).
 */
export function reconcileContradictions(
  existing: readonly { readonly key: string; readonly status: ContradictionStatus }[],
  reported: readonly string[],
): ContradictionChanges {
  const known = new Map(existing.map((entry) => [entry.key, entry.status]));
  const current = new Set(reported);
  return {
    toOpen: [...current].filter((key) => !known.has(key)),
    toReopen: [...current].filter((key) => known.get(key) === 'resolved'),
    toResolve: existing
      .filter((entry) => entry.status === 'open' && !current.has(entry.key))
      .map((entry) => entry.key),
  };
}

// ------------------------------------------------------------------ answers

export type AnswerProblem =
  | 'ANSWER_EMPTY'
  | 'ANSWER_TOO_LONG'
  | 'ANSWER_TOO_MANY_ATTACHMENTS'
  | 'ANSWER_STATUS_HAS_ATTACHMENTS';

/**
 * An answer needs text or a file; the three special statuses carry no file, only an optional
 * note (FR-ANL-003).
 */
export function checkAnswer(input: {
  readonly status: AnswerStatus;
  readonly text?: string | undefined;
  readonly attachmentCount: number;
}): AnswerProblem | null {
  const text = input.text?.trim() ?? '';
  if (text.length > ANSWER_LIMITS.textMaxLength) return 'ANSWER_TOO_LONG';
  if (input.attachmentCount > ANSWER_LIMITS.attachmentsPerAnswer)
    return 'ANSWER_TOO_MANY_ATTACHMENTS';
  if (input.status === 'answered') {
    return text === '' && input.attachmentCount === 0 ? 'ANSWER_EMPTY' : null;
  }
  return input.attachmentCount > 0 ? 'ANSWER_STATUS_HAS_ATTACHMENTS' : null;
}

/** A batch is complete when no question is waiting for the administrator any more. */
export function isBatchComplete(statuses: readonly QuestionStatus[]): boolean {
  return statuses.length > 0 && statuses.every((status) => status !== 'open');
}
