import { questionSimilarity } from './analysis.js';

/**
 * Model-based evaluation of the analyst's questions (ADR-0024). The Brain reads the questions of a
 * project's analysis and judges them against criteria the administrator chose: does an answer
 * change a decision, does the question steer towards a solution, is it a reworded repeat, is it
 * too vague to answer, is the tone right. Like the role evaluation, a finding counts only when it
 * names the questions that prove it, so nothing the model says without evidence reaches the
 * screen. Everything here is pure; the API does the reading and the call.
 */

export const QUESTION_QUALITY_SCHEMA_NAME = 'brain_question_quality';

/** The aspects the administrator can switch on (`analysis.quality_criteria`). */
export const QUALITY_CRITERIA = [
  'decision_relevance',
  'leading',
  'duplicate',
  'vague',
  'tone',
] as const;
export type QualityCriterion = (typeof QUALITY_CRITERIA)[number];

export const isQualityCriterion = (value: unknown): value is QualityCriterion =>
  QUALITY_CRITERIA.some((criterion) => criterion === value);

/** The criteria a setting value stands for; unknown names are ignored and an empty list means all. */
export function resolveQualityCriteria(value: unknown): QualityCriterion[] {
  const chosen = Array.isArray(value)
    ? QUALITY_CRITERIA.filter((criterion) => value.includes(criterion))
    : [];
  return chosen.length > 0 ? chosen : [...QUALITY_CRITERIA];
}

export const QUALITY_LIMITS = {
  /** An analysis holds at most 300 questions (FR-ANL-002); all of them can be judged. */
  maxQuestions: 300,
  questionChars: 600,
  maxFindings: 15,
  maxTextLength: 1500,
  /** Pairs of questions the code found near-identical, handed to the judge as a hint. */
  maxKnownSimilar: 20,
  /** Below this share of shared words a pair is not worth a hint. */
  similarFrom: 0.6,
} as const;

const text = { type: 'string' } as const;

export const QUESTION_QUALITY_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 1, maximum: 5 },
    summary: text,
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['strength', 'weakness'] },
          criterion: { type: 'string', enum: [...QUALITY_CRITERIA] },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          detail: text,
          recommendation: text,
          questionRefs: { type: 'array', items: text },
        },
        required: ['kind', 'criterion', 'severity', 'detail', 'recommendation', 'questionRefs'],
        additionalProperties: false,
      },
    },
  },
  required: ['score', 'summary', 'findings'],
  additionalProperties: false,
};

/** Rules the code adds to the Brain's instructions for this call; never editable. */
export const QUESTION_QUALITY_RULES: readonly string[] = [
  'You judge the quality of the questions the analyst asked the project administrator; questions in <data> are numbered Q1, Q2, …, and criteria lists the only aspects you may judge.',
  'decision_relevance: would the answer change a decision, a scope or a requirement? leading: does the question push towards a particular solution? duplicate: is it a reworded repeat of an earlier question? vague: could the administrator not tell what is being asked? tone: is it rude, accusing or confusing for a business manager?',
  'Score from 1 to 5: 5 = every question earns its place, 3 = mixed, 1 = most questions are poor.',
  'Every finding names a criterion from criteria and the questions (questionRefs, for example "Q3") that prove it; a finding without a valid question is discarded. Use kind "weakness" for a problem and "strength" for what the questions do clearly well.',
  'knownSimilar lists pairs of questions found near-identical by a word count; build on it only where the questions really ask the same thing. Never invent a question or quote one that is not there.',
  'The recommendation tells an administrator or the analyst’s charter what to change; you cannot change anything yourself.',
];

export interface QualityQuestion {
  /** `Q1`, `Q2`, …: the number the administrator sees. */
  readonly ref: string;
  readonly id: string;
  readonly number: number;
  readonly category: string;
  readonly text: string;
  readonly status: string;
}

const clip = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

/** Pairs the word count already finds alike; the judge decides whether they really are. */
export function knownSimilarPairs(
  questions: readonly QualityQuestion[],
): { a: string; b: string; similarity: number }[] {
  const pairs: { a: string; b: string; similarity: number }[] = [];
  for (let i = 0; i < questions.length; i += 1) {
    for (let j = i + 1; j < questions.length; j += 1) {
      const similarity = questionSimilarity(questions[i]!.text, questions[j]!.text);
      if (similarity >= QUALITY_LIMITS.similarFrom) {
        pairs.push({
          a: questions[i]!.ref,
          b: questions[j]!.ref,
          similarity: Math.round(similarity * 100) / 100,
        });
      }
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity).slice(0, QUALITY_LIMITS.maxKnownSimilar);
}

/** The data block of the call. Answers are not included: the question is what is judged. */
export function questionQualityPromptData(input: {
  readonly criteria: readonly QualityCriterion[];
  readonly questions: readonly QualityQuestion[];
}) {
  return {
    criteria: input.criteria,
    questions: input.questions.map((question) => ({
      ref: question.ref,
      category: question.category,
      status: question.status,
      text: clip(question.text, QUALITY_LIMITS.questionChars),
    })),
    knownSimilar: knownSimilarPairs(input.questions),
  };
}

export type QualityFindingKind = 'strength' | 'weakness';
export type QualitySeverity = 'low' | 'medium' | 'high';

export interface QualityFinding {
  readonly kind: QualityFindingKind;
  readonly criterion: QualityCriterion;
  readonly severity: QualitySeverity;
  readonly detail: string;
  readonly recommendation: string | null;
  /** The questions that prove it, with their stored ids so the finding stands alone. */
  readonly questions: readonly {
    readonly ref: string;
    readonly id: string;
    readonly number: number;
  }[];
}

export interface NormalizedQuality {
  readonly score: number;
  readonly summary: string;
  readonly findings: readonly QualityFinding[];
  /** Findings dropped for a missing or unknown question, an unselected criterion, a repeat or the cap. */
  readonly discarded: number;
}

const asText = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const asRefs = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().toUpperCase())
            .filter((item) => item !== ''),
        ),
      ]
    : [];

/**
 * Checks the judge's answer against what it was shown: an integer score 1 to 5 and a summary, or
 * the whole evaluation is invalid. A finding must use a criterion that was asked about and point
 * at least one question it was given; unknown references are dropped, a finding left with none is
 * discarded, never repaired.
 */
export function normalizeQuestionQuality(
  raw: unknown,
  context: {
    readonly criteria: readonly QualityCriterion[];
    readonly questions: readonly QualityQuestion[];
  },
): { ok: true; quality: NormalizedQuality } | { ok: false; reason: 'invalid_output' } {
  if (raw === null || typeof raw !== 'object') return { ok: false, reason: 'invalid_output' };
  const answer = raw as Record<string, unknown>;
  const score = answer['score'];
  const summary = asText(answer['summary'], QUALITY_LIMITS.maxTextLength);
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
    return { ok: false, reason: 'invalid_output' };
  }
  if (summary === '' || !Array.isArray(answer['findings'])) {
    return { ok: false, reason: 'invalid_output' };
  }
  const byRef = new Map(context.questions.map((question) => [question.ref, question]));
  const findings: QualityFinding[] = [];
  const seen = new Set<string>();
  let discarded = 0;
  for (const item of answer['findings'] as unknown[]) {
    const entry =
      item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const detail = asText(entry['detail'], QUALITY_LIMITS.maxTextLength);
    const kind = entry['kind'];
    const criterion = entry['criterion'];
    const severity = entry['severity'];
    const proof = asRefs(entry['questionRefs'])
      .map((ref) => byRef.get(ref))
      .filter((question): question is QualityQuestion => question !== undefined);
    const key = `${detail.toLowerCase()}|${String(criterion)}|${proof.map((question) => question.ref).join(',')}`;
    if (
      detail === '' ||
      (kind !== 'strength' && kind !== 'weakness') ||
      !isQualityCriterion(criterion) ||
      !context.criteria.includes(criterion) ||
      proof.length === 0 ||
      seen.has(key) ||
      findings.length >= QUALITY_LIMITS.maxFindings
    ) {
      discarded += 1;
      continue;
    }
    seen.add(key);
    findings.push({
      kind,
      criterion,
      // A strength has no severity; a weakness without a valid one is the mildest.
      severity:
        kind === 'weakness' && (severity === 'low' || severity === 'medium' || severity === 'high')
          ? severity
          : 'low',
      detail,
      recommendation: asText(entry['recommendation'], QUALITY_LIMITS.maxTextLength) || null,
      questions: proof.map((question) => ({
        ref: question.ref,
        id: question.id,
        number: question.number,
      })),
    });
  }
  return { ok: true, quality: { score, summary, findings, discarded } };
}

export type QualityReviewStatus = 'completed' | 'failed';
export type QualityReviewReason = 'provider_failure' | 'invalid_output';
