import type { AgentDefinitionContent, AgentRole } from './agents.js';

/**
 * Model-based evaluation of a role's work against its charter (ADR-0011, ADR-0017).
 *
 * The Brain reads a few outputs of a role next to the principles and duties the role ran with
 * and judges how well the work follows them. The contract is strict: a finding counts only when
 * it names the charter items and the samples that prove it, so nothing the model says without
 * evidence reaches a report. Everything here is pure; the API does the reading and the call.
 */

export const ROLE_EVALUATION_SCHEMA_NAME = 'brain_role_evaluation';

export const EVALUATION_LIMITS = {
  /** Newest model outputs of one role placed in one evaluation. */
  samplesPerRole: 5,
  /** Characters of one sample's content; longer content is cut with a marker. */
  sampleChars: 4000,
  /** Reviews (approve/reject with a comment) shown next to a sample. */
  reviewsPerSample: 3,
  reviewCommentChars: 300,
  /** Deterministic deviations of the role handed to the judge as context. */
  knownDeviations: 10,
  maxFindings: 12,
  maxTextLength: 1500,
} as const;

const text = { type: 'string' } as const;

/** The structured answer of the judge, one per role. */
export const ROLE_EVALUATION_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 1, maximum: 5 },
    summary: text,
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['strength', 'deviation'] },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          detail: text,
          recommendation: text,
          clauseRefs: { type: 'array', items: text },
          sampleRefs: { type: 'array', items: text },
        },
        required: ['kind', 'severity', 'detail', 'recommendation', 'clauseRefs', 'sampleRefs'],
        additionalProperties: false,
      },
    },
  },
  required: ['score', 'summary', 'findings'],
  additionalProperties: false,
};

/** Rules the code adds to the Brain's instructions for this call; never editable. */
export const ROLE_EVALUATION_RULES: readonly string[] = [
  'You judge the work of the role named in <data>.role against that role’s own charter: charter lists its principles (P1, P2, …) and duties (D1, D2, …); samples are its newest outputs (S1, S2, …).',
  'Judge only against the charter. A style preference of yours is not a finding.',
  'Score from 1 to 5: 5 = every sample follows the charter, 3 = mixed, 1 = the charter is mostly ignored.',
  'Every finding names the charter items (clauseRefs, for example "P3") and the samples (sampleRefs, for example "S1") that prove it; a finding without both is discarded.',
  'Use kind "deviation" for a charter item the work breaks and "strength" for one it clearly keeps. Never invent a sample, a clause or a quote.',
  'knownDeviations come from deterministic checks; build on them only where a sample shows more.',
  'The recommendation tells an administrator what to change (charter, prompt, rubric or source policy); you cannot change anything yourself.',
];

export interface CharterItem {
  /** `P1`, `D2`, …: the way the judge points at a principle or duty. */
  readonly ref: string;
  readonly kind: 'principle' | 'duty';
  readonly text: string;
}

export function charterItems(content: AgentDefinitionContent): CharterItem[] {
  return [
    ...content.principles.map((item, index) => ({
      ref: `P${index + 1}`,
      kind: 'principle' as const,
      text: item,
    })),
    ...content.duties.map((item, index) => ({
      ref: `D${index + 1}`,
      kind: 'duty' as const,
      text: item,
    })),
  ];
}

/** One output of the role the judge may point at. */
export interface EvaluationSample {
  /** `S1`, `S2`, … in newest-first order. */
  readonly ref: string;
  readonly outputId: string;
  readonly projectId: string;
  readonly createdAt: string;
  /** Pretty-free JSON of the output, cut to `sampleChars`. */
  readonly content: string;
  readonly reviews: readonly { readonly action: string; readonly comment: string | null }[];
}

/** Cuts a JSON text to the sample budget and says so when it did. */
export function sampleContent(content: unknown): string {
  const raw = JSON.stringify(content ?? null) ?? 'null';
  return raw.length <= EVALUATION_LIMITS.sampleChars
    ? raw
    : `${raw.slice(0, EVALUATION_LIMITS.sampleChars)}…[truncated]`;
}

export interface KnownDeviation {
  readonly rule: string;
  readonly severity: string;
  readonly count: number;
  readonly detail: string;
}

/** The data block of one role's evaluation call. */
export function evaluationPromptData(input: {
  readonly role: AgentRole;
  readonly stage: string | null;
  readonly charter: readonly CharterItem[];
  readonly samples: readonly EvaluationSample[];
  readonly knownDeviations: readonly KnownDeviation[];
}) {
  return {
    role: input.role,
    stage: input.stage,
    charter: input.charter,
    samples: input.samples.map((sample) => ({
      ref: sample.ref,
      createdAt: sample.createdAt,
      reviews: sample.reviews.slice(0, EVALUATION_LIMITS.reviewsPerSample).map((review) => ({
        action: review.action,
        comment: review.comment
          ? review.comment.slice(0, EVALUATION_LIMITS.reviewCommentChars)
          : null,
      })),
      content: sample.content,
    })),
    knownDeviations: input.knownDeviations.slice(0, EVALUATION_LIMITS.knownDeviations),
  };
}

export type EvaluationFindingKind = 'strength' | 'deviation';
export type EvaluationSeverity = 'low' | 'medium' | 'high';

export interface EvaluationFinding {
  readonly kind: EvaluationFindingKind;
  readonly severity: EvaluationSeverity;
  readonly detail: string;
  readonly recommendation: string | null;
  /** The charter items the finding rests on, with their text so the report stands alone. */
  readonly clauses: readonly CharterItem[];
  /** The records that prove it: stage outputs, with the sample number the judge used. */
  readonly evidence: readonly {
    readonly type: 'stage_output';
    readonly id: string;
    readonly ref: string;
  }[];
}

export interface NormalizedEvaluation {
  readonly score: number;
  readonly summary: string;
  readonly findings: readonly EvaluationFinding[];
  /** Findings dropped for missing or unknown evidence, duplicates or the cap. */
  readonly discarded: number;
}

const FINDING_KINDS: readonly string[] = ['strength', 'deviation'];
const SEVERITIES: readonly string[] = ['low', 'medium', 'high'];

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
 * Checks the judge's answer against what it was shown. The score must be an integer 1–5 and
 * the summary present, or the evaluation is invalid as a whole. Each finding must point at
 * least one clause of the charter and one sample it was given; unknown references are dropped
 * and a finding left with none of either is discarded, never repaired.
 */
export function normalizeEvaluation(
  raw: unknown,
  context: {
    readonly charter: readonly CharterItem[];
    readonly samples: readonly EvaluationSample[];
  },
): { ok: true; evaluation: NormalizedEvaluation } | { ok: false; reason: 'invalid_output' } {
  if (raw === null || typeof raw !== 'object') return { ok: false, reason: 'invalid_output' };
  const answer = raw as Record<string, unknown>;
  const score = answer['score'];
  const summary = asText(answer['summary'], EVALUATION_LIMITS.maxTextLength);
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
    return { ok: false, reason: 'invalid_output' };
  }
  if (summary === '' || !Array.isArray(answer['findings'])) {
    return { ok: false, reason: 'invalid_output' };
  }
  const clauses = new Map(context.charter.map((item) => [item.ref, item]));
  const samples = new Map(context.samples.map((sample) => [sample.ref, sample]));
  const findings: EvaluationFinding[] = [];
  const seen = new Set<string>();
  let discarded = 0;
  for (const item of answer['findings'] as unknown[]) {
    const entry =
      item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const detail = asText(entry['detail'], EVALUATION_LIMITS.maxTextLength);
    const kind = entry['kind'];
    const severity = entry['severity'];
    const cited = asRefs(entry['clauseRefs'])
      .map((ref) => clauses.get(ref))
      .filter((clause): clause is CharterItem => clause !== undefined);
    const proof = asRefs(entry['sampleRefs'])
      .map((ref) => samples.get(ref))
      .filter((sample): sample is EvaluationSample => sample !== undefined);
    const key = `${detail.toLowerCase()}|${cited.map((clause) => clause.ref).join(',')}|${proof.map((sample) => sample.ref).join(',')}`;
    if (
      detail === '' ||
      typeof kind !== 'string' ||
      !FINDING_KINDS.includes(kind) ||
      cited.length === 0 ||
      proof.length === 0 ||
      seen.has(key) ||
      findings.length >= EVALUATION_LIMITS.maxFindings
    ) {
      discarded += 1;
      continue;
    }
    seen.add(key);
    findings.push({
      kind: kind as EvaluationFindingKind,
      // A strength has no severity; a deviation without a valid one is the mildest.
      severity:
        kind === 'deviation' && typeof severity === 'string' && SEVERITIES.includes(severity)
          ? (severity as EvaluationSeverity)
          : 'low',
      detail,
      recommendation: asText(entry['recommendation'], EVALUATION_LIMITS.maxTextLength) || null,
      clauses: cited,
      evidence: proof.map((sample) => ({
        type: 'stage_output' as const,
        id: sample.outputId,
        ref: sample.ref,
      })),
    });
  }
  return { ok: true, evaluation: { score, summary, findings, discarded } };
}

export type EvaluationStatus = 'completed' | 'skipped' | 'failed';

/** Why a role's evaluation did not produce a verdict; shown to the administrator as is. */
export type EvaluationReason =
  'no_samples' | 'ai_not_configured' | 'provider_failure' | 'invalid_output';

/** One role's entry in a Brain report (`brain_reports.evaluations`). */
export interface RoleEvaluation {
  readonly role: AgentRole;
  readonly stage: string | null;
  readonly status: EvaluationStatus;
  readonly reason: EvaluationReason | null;
  /** The charter version the role's samples ran with. */
  readonly charterVersionId: string | null;
  readonly charterSequence: number | null;
  readonly samples: readonly {
    readonly ref: string;
    readonly outputId: string;
    readonly projectId: string;
    readonly createdAt: string;
    readonly rejected: boolean;
  }[];
  readonly score: number | null;
  readonly summary: string | null;
  readonly findings: readonly EvaluationFinding[];
  readonly discarded: number;
  readonly invocationId: string | null;
  /** The provider's error code (or the unusable finish reason) when the evaluation failed. */
  readonly errorCode: string | null;
}
