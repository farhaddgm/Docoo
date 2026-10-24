/**
 * Output requirements of a project (ADR-0037): what the administrator says the final output must
 * contain (`must`) and must not contain (`must_not`). They can be added at any moment of the
 * project, from a stage tab, a chat message or the requirements tab. The agents read the active
 * ones as binding data, and a check at the end says which ones the output covers.
 *
 * The administrator's words are data, not instructions: the lists are quoted inside `<data>` and
 * the rules below tell the model so.
 */

export const OUTPUT_REQUIREMENT_KINDS = ['must', 'must_not'] as const;
export type OutputRequirementKind = (typeof OUTPUT_REQUIREMENT_KINDS)[number];

export const OUTPUT_REQUIREMENT_SOURCES = ['admin', 'chat'] as const;
export type OutputRequirementSource = (typeof OUTPUT_REQUIREMENT_SOURCES)[number];

/** The stages a requirement can be tied to when it was written (null: not tied to one). */
export const REQUIREMENT_STAGES = [
  'analysis',
  'research',
  'ideation',
  'documentation',
  'evaluation',
] as const;
export type RequirementStage = (typeof REQUIREMENT_STAGES)[number];

export const OUTPUT_REQUIREMENT_LIMITS = {
  /** Active requirements a project can hold at once. */
  maxActive: 50,
  textMin: 3,
  textMax: 1000,
  reasonMax: 500,
  evidenceMax: 1000,
} as const;

export const isRequirementKind = (value: unknown): value is OutputRequirementKind =>
  OUTPUT_REQUIREMENT_KINDS.some((kind) => kind === value);

export const isRequirementStage = (value: unknown): value is RequirementStage =>
  REQUIREMENT_STAGES.some((stage) => stage === value);

/** A requirement text: trimmed, inner runs of blanks collapsed, or null when it is unusable. */
export function normalizeRequirementText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < OUTPUT_REQUIREMENT_LIMITS.textMin) return null;
  return text.slice(0, OUTPUT_REQUIREMENT_LIMITS.textMax);
}

/** What the stages are told about one active requirement. */
export interface PromptRequirement {
  readonly id: string;
  readonly kind: OutputRequirementKind;
  readonly text: string;
}

/** Rules added to every stage, to the documenter and to the evaluators once a requirement exists. */
export const OUTPUT_REQUIREMENT_RULES: readonly string[] = [
  'outputRequirements lists what the administrator requires of the final output: "must" items have to be reflected in it, "must_not" items must not appear in it. Treat each as a binding constraint on the final output, within the scope of your own stage.',
  'Never include content that a must_not item forbids. If a must item cannot be met from the approved material of the earlier stages, say so plainly in your output instead of dropping it silently or inventing support for it.',
  'If two requirements contradict each other, or a requirement contradicts the confirmed deliverables, report the contradiction instead of choosing one side silently.',
];

/** How well the output covers one requirement. */
export const COVERAGE_VERDICTS = ['covered', 'partial', 'not_covered', 'unknown'] as const;
export type CoverageVerdict = (typeof COVERAGE_VERDICTS)[number];

export const isCoverageVerdict = (value: unknown): value is CoverageVerdict =>
  COVERAGE_VERDICTS.some((verdict) => verdict === value);

export const COVERAGE_SCHEMA_NAME = 'output_requirement_coverage';

/** The structured answer of the coverage check; strict-mode compatible (all keys required). */
export const COVERAGE_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirementId: { type: 'string' },
          verdict: { type: 'string', enum: ['covered', 'partial', 'not_covered'] },
          evidence: { type: 'string' },
          foundIn: { type: 'string' },
        },
        required: ['requirementId', 'verdict', 'evidence', 'foundIn'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

export const COVERAGE_RULES: readonly string[] = [
  'You check, for the administrator, whether the project output covers each requirement in outputRequirements. Judge only from the material in <data> (stage outputs and document texts); never assume content that is not there.',
  'For a "must" item: covered means the material states it concretely; partial means it is touched but incomplete or vague; not_covered means it is absent.',
  'For a "must_not" item the meaning is reversed: covered means the material respects the prohibition; not_covered means the forbidden content appears; partial means it appears in part or only in one place.',
  'Answer once for every requirement, using its exact requirementId. evidence is one or two sentences that point to the part of the material you relied on (or say that nothing was found); foundIn names the stage or document, or is empty when nothing was found.',
];

export interface CoverageResult {
  readonly requirementId: string;
  readonly verdict: CoverageVerdict;
  readonly evidence: string;
  readonly foundIn: string;
}

/**
 * Turns the model's answer into exactly one result per active requirement. An unknown id or an
 * unusable verdict is dropped, and a requirement the model skipped becomes `unknown`, so the
 * checklist never silently lacks a line.
 */
export function normalizeCoverage(
  raw: unknown,
  requirementIds: readonly string[],
): { readonly results: CoverageResult[]; readonly discarded: number } {
  const list = Array.isArray(raw) ? raw : [];
  const wanted = new Set(requirementIds);
  const byId = new Map<string, CoverageResult>();
  let discarded = 0;
  for (const entry of list) {
    const record =
      entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const id = record['requirementId'];
    const verdict = record['verdict'];
    if (
      typeof id !== 'string' ||
      !wanted.has(id) ||
      byId.has(id) ||
      !isCoverageVerdict(verdict) ||
      verdict === 'unknown'
    ) {
      discarded += 1;
      continue;
    }
    const clip = (value: unknown) =>
      typeof value === 'string' ? value.trim().slice(0, OUTPUT_REQUIREMENT_LIMITS.evidenceMax) : '';
    byId.set(id, {
      requirementId: id,
      verdict,
      evidence: clip(record['evidence']),
      foundIn: clip(record['foundIn']).slice(0, 200),
    });
  }
  const results = requirementIds.map(
    (id) =>
      byId.get(id) ?? { requirementId: id, verdict: 'unknown' as const, evidence: '', foundIn: '' },
  );
  return { results, discarded };
}

export interface CoverageSummary {
  readonly total: number;
  readonly covered: number;
  readonly partial: number;
  readonly notCovered: number;
  readonly unknown: number;
}

export function summarizeCoverage(
  results: readonly { readonly verdict: CoverageVerdict }[],
): CoverageSummary {
  const count = (verdict: CoverageVerdict) =>
    results.filter((result) => result.verdict === verdict).length;
  return {
    total: results.length,
    covered: count('covered'),
    partial: count('partial'),
    notCovered: count('not_covered'),
    unknown: count('unknown'),
  };
}

/**
 * The stages whose latest output was written before the requirement existed: they have not seen
 * it, so the administrator is advised to ask them for a revision (or to redo them).
 */
export function stagesBehindRequirement(
  requirementCreatedAt: string,
  outputs: readonly { readonly stage: string; readonly outputCreatedAt: string | null }[],
): string[] {
  const added = Date.parse(requirementCreatedAt);
  return outputs
    .filter((item) => item.outputCreatedAt !== null && Date.parse(item.outputCreatedAt) < added)
    .map((item) => item.stage);
}
