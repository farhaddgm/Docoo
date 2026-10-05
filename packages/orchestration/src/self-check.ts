import {
  charterItems,
  composeInstructions,
  coverageGaps,
  coverageReport,
  defaultDefinition,
  evaluationPromptData,
  normalizeEvaluation,
  ROLE_EVALUATION_RULES,
  ROLE_EVALUATION_SCHEMA,
  ROLE_EVALUATION_SCHEMA_NAME,
  STAGE_ROLE,
  type EvaluationSample,
} from '@docoo/domain';
import {
  DEFAULT_LEVEL_BOUNDS,
  draftToBlocks,
  OUTLINE_SCHEMA,
  OUTLINE_SCHEMA_NAME,
  planWriting,
  SECTION_SCHEMA,
  SECTION_SCHEMA_NAME,
  templateFor,
} from '@docoo/documents';
import { ProviderError, type JsonSchema } from '@docoo/providers';

import {
  ANALYSIS_ROUND_SCHEMA,
  ANALYSIS_ROUND_SCHEMA_NAME,
  parseRoundOutput,
  roundPrompt,
} from './analysis.js';
import { assignReferences, knowledgePromptItems } from './research.js';
import type { ProviderRuntime } from './runtime.js';
import { STAGE_SCHEMAS, stagePrompt, STAGES, type Stage } from './stages.js';
import { outlinePrompt, sectionPrompt, type WritingMaterial } from './writing.js';

/**
 * A one-click check that a model can do what the platform asks of it (the provider acceptance
 * tests, but run by the server with the key the administrator already entered). Each step sends
 * the platform's real prompt and schema for one kind of call, with a small made-up case, and
 * reads the answer with the same code the pipeline uses. Steps run one at a time so no request
 * is long and the page can show progress.
 */
export const SELF_CHECK_STEPS = [
  'analysis_round',
  'stage_analysis',
  'stage_research',
  'stage_ideation',
  'stage_documentation',
  'stage_evaluation',
  'document_outline',
  'document_section',
  'role_evaluation',
] as const;
export type SelfCheckStep = (typeof SELF_CHECK_STEPS)[number];

export const isSelfCheckStep = (value: unknown): value is SelfCheckStep =>
  SELF_CHECK_STEPS.some((step) => step === value);

export interface PreparedCall {
  readonly instructions: string;
  readonly message: string;
  readonly schemaName: string;
  readonly schema: JsonSchema;
  /** What is wrong with an answer that arrived, or null when the platform can use it. */
  readonly judge: (json: unknown) => string | null;
}

const PROBLEM = 'Reduce repeat-customer churn by 20% within a year.';
const KNOWLEDGE_TEXT =
  'Repeat customer churn falls when support answers within one hour, because customers who wait leave.';

const requiredKeys = (schema: JsonSchema): string[] =>
  Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];

function missingKeys(json: unknown, schema: JsonSchema): string | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return 'not_an_object';
  const missing = requiredKeys(schema).filter((key) => !(key in json));
  return missing.length > 0 ? `missing: ${missing.join(', ')}` : null;
}

function material(language: 'fa' | 'en'): WritingMaterial {
  return {
    project: 'Churn programme',
    language,
    problem: { statement: PROBLEM },
    solution: {
      title: 'Faster support answers',
      summary: 'Answer repeat customers within one hour.',
      plan: ['Set a one-hour answer target', 'Staff the support desk for it'],
    },
    research: [
      { claim: 'Customers who wait longer than an hour are likelier to leave.', support: 'cited' },
    ],
    stageOutline: [],
    notes: null,
    knowledge: [],
  };
}

export function prepareSelfCheck(step: SelfCheckStep, language: 'fa' | 'en'): PreparedCall {
  if (step === 'analysis_round') {
    const report = coverageReport([]);
    const prompt = roundPrompt({
      language,
      projectTitle: 'Churn programme',
      problem: PROBLEM,
      topics: ['Retail'],
      feedback: [],
      definition: defaultDefinition('analyst'),
      analysis: {
        round: 1,
        asked: 0,
        capacity: 10,
        transcript: [],
        coverage: report,
        coverageGaps: coverageGaps(report),
        openContradictions: [],
        summaries: [],
        priorDefinition: null,
      },
    });
    return {
      ...prompt,
      schemaName: ANALYSIS_ROUND_SCHEMA_NAME,
      schema: ANALYSIS_ROUND_SCHEMA,
      judge: (json) => {
        try {
          parseRoundOutput(json, new Set<number>());
          return null;
        } catch (error) {
          return error instanceof ProviderError ? error.code : 'analysis_round_invalid';
        }
      },
    };
  }

  if (step.startsWith('stage_')) {
    const stage = step.slice('stage_'.length) as Stage;
    if (!STAGES.includes(stage)) throw new Error(`unknown step ${step}`);
    const knowledge =
      stage === 'research'
        ? knowledgePromptItems(
            assignReferences(
              [
                {
                  snapshotId: 'self-check',
                  results: [
                    {
                      chunkId: 'c1',
                      knowledgeId: 'k1',
                      versionId: 'v1',
                      versionNo: 1,
                      title: 'Support response and churn',
                      confidentiality: 'internal',
                      chunkOrdinal: 0,
                      text: KNOWLEDGE_TEXT,
                      score: 0.05,
                      lexicalRank: 1,
                      vectorRank: 1,
                      similarity: 0.6,
                      reviewId: 'r1',
                      auditScore: 92,
                      effectiveDecision: 'approved',
                      conflictWarnings: [],
                    },
                  ],
                },
              ],
              5,
            ),
          )
        : undefined;
    const prompt = stagePrompt({
      stage,
      definition: defaultDefinition(STAGE_ROLE[stage]),
      language,
      projectTitle: 'Churn programme',
      problem: PROBLEM,
      topics: ['Retail'],
      previous: [],
      feedback: [],
      knowledge,
    });
    const schema = STAGE_SCHEMAS[stage];
    return {
      ...prompt,
      schemaName: `${stage}_output`,
      schema,
      judge: (json) => missingKeys(json, schema),
    };
  }

  if (step === 'document_outline' || step === 'document_section') {
    const mat = material(language);
    const plan = planWriting({
      template: templateFor('brief'),
      language,
      level: 1,
      bounds: DEFAULT_LEVEL_BOUNDS[1],
      fixedLetters: 200,
    });
    const definition = defaultDefinition('documenter');
    if (step === 'document_outline') {
      const prompt = outlinePrompt({ definition, material: mat, plan, tablesAllowed: true });
      return {
        ...prompt,
        schemaName: OUTLINE_SCHEMA_NAME,
        schema: OUTLINE_SCHEMA,
        judge: (json) => {
          const problem = missingKeys(json, OUTLINE_SCHEMA);
          if (problem) return problem;
          // The pipeline plans from the sections it asked about; at least one must come back with a
          // subsection that has a heading and a focus.
          const keys = new Set(plan.sections.map((section) => section.key));
          const given = (json as { sections?: unknown }).sections;
          const usable =
            Array.isArray(given) &&
            given.some((section: unknown) => {
              const item = section as { key?: unknown; subsections?: unknown } | null;
              return (
                typeof item?.key === 'string' &&
                keys.has(item.key) &&
                Array.isArray(item.subsections) &&
                item.subsections.some((sub: unknown) => {
                  const entry = sub as { heading?: unknown; focus?: unknown } | null;
                  return (
                    typeof entry?.heading === 'string' &&
                    entry.heading.trim() !== '' &&
                    typeof entry.focus === 'string' &&
                    entry.focus.trim() !== ''
                  );
                })
              );
            });
          return usable ? null : 'no_usable_outline';
        },
      };
    }
    const section = plan.sections[0]!;
    const subsection = section.subsections[0]!;
    const prompt = sectionPrompt({
      definition,
      material: mat,
      plan,
      section,
      subsection,
      call: 'section',
      written: {},
      tablesAllowed: true,
    });
    return {
      ...prompt,
      schemaName: SECTION_SCHEMA_NAME,
      schema: SECTION_SCHEMA,
      judge: (json) => {
        const problem = missingKeys(json, SECTION_SCHEMA);
        if (problem) return problem;
        const { blocks } = draftToBlocks(json, {
          idPrefix: 'check',
          fallbackCaption: 'Table',
          tablesAllowed: true,
          resolve: () => null,
        });
        return blocks.length > 0 ? null : 'no_usable_blocks';
      },
    };
  }

  // role_evaluation: the Brain judging the researcher against its charter.
  const charter = charterItems(defaultDefinition('researcher'));
  const samples: EvaluationSample[] = [
    {
      ref: 'S1',
      outputId: 'o1',
      projectId: 'p1',
      createdAt: '2026-10-01T00:00:00.000Z',
      content: JSON.stringify({
        findings: [{ claim: 'Churn is a problem.', source: 'general knowledge', evidence: [] }],
        gaps: [],
        conflicts: [],
      }),
      reviews: [{ action: 'reject', comment: 'No sources were cited.' }],
    },
  ];
  const instructions = composeInstructions({
    role: 'brain',
    content: defaultDefinition('brain'),
    language,
    task: defaultDefinition('brain').promptTemplate,
    rules: ROLE_EVALUATION_RULES,
  });
  const data = evaluationPromptData({
    role: 'researcher',
    stage: 'research',
    charter,
    samples,
    knownDeviations: [],
  });
  return {
    instructions,
    message: `<data>${JSON.stringify(data)}</data>`,
    schemaName: ROLE_EVALUATION_SCHEMA_NAME,
    schema: ROLE_EVALUATION_SCHEMA,
    judge: (json) => (normalizeEvaluation(json, { charter, samples }).ok ? null : 'invalid_output'),
  };
}

export interface SelfCheckResult {
  readonly step: SelfCheckStep;
  readonly status: 'passed' | 'failed';
  /** What is wrong with a call that answered (an unfinished answer, a missing field). */
  readonly problem: string | null;
  readonly errorCode: string | null;
  /** The provider's own reason for a refusal, sanitised. */
  readonly errorDetail: string | null;
  readonly errorKind: string | null;
  readonly finishReason: string | null;
  readonly latencyMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly costUsd: number | null;
  readonly invocationId: string | null;
}

const empty = (step: SelfCheckStep): SelfCheckResult => ({
  step,
  status: 'failed',
  problem: null,
  errorCode: null,
  errorDetail: null,
  errorKind: null,
  finishReason: null,
  latencyMs: null,
  inputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  costUsd: null,
  invocationId: null,
});

/**
 * Runs one step against a connection and model. The call is recorded like any other (so its cost
 * shows on the costs page and is counted); a refusal is returned as a failed step with the
 * provider's reason, never thrown.
 */
export async function runSelfCheckStep(
  runtime: ProviderRuntime,
  input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly model: string;
    readonly step: SelfCheckStep;
    readonly language: 'fa' | 'en';
  },
): Promise<SelfCheckResult> {
  const call = prepareSelfCheck(input.step, input.language);
  try {
    const { response, invocationId, costUsd } = await runtime.invoke(
      {
        workspaceId: input.workspaceId,
        projectId: null,
        stageRunId: null,
        attemptId: null,
        purpose: `selfcheck:${input.step}`,
        retryNo: 0,
      },
      input.connectionId,
      {
        model: input.model,
        instructions: call.instructions,
        messages: [{ role: 'user', content: call.message }],
        responseSchema: { name: call.schemaName, schema: call.schema },
      },
    );
    const base = {
      ...empty(input.step),
      finishReason: response.finishReason,
      latencyMs: response.latencyMs,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      reasoningTokens: response.usage.reasoningTokens,
      costUsd,
      invocationId,
    };
    if (response.finishReason !== 'stop') {
      return {
        ...base,
        problem:
          response.finishReason === 'length'
            ? 'cut_off_at_the_output_limit'
            : `finished_with_${response.finishReason}`,
      };
    }
    const problem = call.judge(response.json);
    return problem === null ? { ...base, status: 'passed' } : { ...base, problem };
  } catch (error) {
    if (error instanceof ProviderError) {
      return {
        ...empty(input.step),
        errorCode: error.code,
        errorDetail: error.detail,
        errorKind: error.kind,
      };
    }
    return { ...empty(input.step), errorCode: 'self_check_failed' };
  }
}
