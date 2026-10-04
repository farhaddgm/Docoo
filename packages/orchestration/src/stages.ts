import { STAGE_ROLE, composeInstructions, type AgentDefinitionContent } from '@docoo/domain';
import type { JsonSchema } from '@docoo/providers';

import type { AnalysisContext } from './analysis.js';

/** Fixed stage order (FR-WF-001). */
export const STAGES = ['analysis', 'research', 'ideation', 'documentation', 'evaluation'] as const;
export type Stage = (typeof STAGES)[number];

/** Hard ceiling of output correction attempts per stage (FR-WF-007). */
export const MAX_ATTEMPTS = 10;

const text = { type: 'string' } as const;
const textList = { type: 'array', items: text } as const;

/** Structured output of each stage; every provider returns exactly this shape. */
export const STAGE_SCHEMAS: Record<Stage, JsonSchema> = {
  // The problem definition the administrator approves (FR-ANL-005). `assumptions` and
  // `unresolved` are shown prominently in the final report (FR-ANL-006).
  analysis: {
    type: 'object',
    properties: {
      problemStatement: text,
      needStatement: text,
      objectives: textList,
      constraints: textList,
      stakeholders: textList,
      successCriteria: textList,
      assumptions: textList,
      unresolved: textList,
      glossary: {
        type: 'array',
        items: {
          type: 'object',
          properties: { term: text, meaning: text },
          required: ['term', 'meaning'],
          additionalProperties: false,
        },
      },
      recommendedScope: text,
      outOfScope: textList,
    },
    required: [
      'problemStatement',
      'needStatement',
      'objectives',
      'constraints',
      'stakeholders',
      'successCriteria',
      'assumptions',
      'unresolved',
      'glossary',
      'recommendedScope',
      'outOfScope',
    ],
    additionalProperties: false,
  },
  research: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: { claim: text, source: text },
          required: ['claim', 'source'],
          additionalProperties: false,
        },
      },
      gaps: textList,
    },
    required: ['findings', 'gaps'],
    additionalProperties: false,
  },
  ideation: {
    type: 'object',
    properties: {
      ideas: {
        type: 'array',
        items: {
          type: 'object',
          properties: { title: text, description: text },
          required: ['title', 'description'],
          additionalProperties: false,
        },
      },
    },
    required: ['ideas'],
    additionalProperties: false,
  },
  documentation: {
    type: 'object',
    properties: {
      outline: {
        type: 'array',
        items: {
          type: 'object',
          properties: { heading: text, summary: text },
          required: ['heading', 'summary'],
          additionalProperties: false,
        },
      },
    },
    required: ['outline'],
    additionalProperties: false,
  },
  evaluation: {
    type: 'object',
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            criterion: text,
            score: { type: 'integer', minimum: 1, maximum: 5 },
            evidence: text,
          },
          required: ['criterion', 'score', 'evidence'],
          additionalProperties: false,
        },
      },
      summary: text,
    },
    required: ['scores', 'summary'],
    additionalProperties: false,
  },
};

export interface StageContext {
  readonly stage: Stage;
  /** The role definition this attempt runs with (principles, duties, task); pinned per project. */
  readonly definition: AgentDefinitionContent;
  readonly language: 'fa' | 'en';
  readonly projectTitle: string;
  readonly problem: string;
  readonly topics: readonly string[];
  /** Approved outputs of earlier stages, in order. */
  readonly previous: readonly { readonly stage: Stage; readonly content: unknown }[];
  /** Reviewer feedback from rejected earlier attempts of this stage. */
  readonly feedback: readonly string[];
  /** The analyst's questions and answers; present when the analysis stage writes its definition. */
  readonly analysis?: AnalysisContext | undefined;
}

/**
 * Builds the provider request of one stage attempt. Content and instructions stay in
 * separate channels: project data is quoted as data, never as instructions.
 */
export function stagePrompt(context: StageContext): { instructions: string; message: string } {
  const instructions = composeInstructions({
    role: STAGE_ROLE[context.stage],
    content: context.definition,
    language: context.language,
    task: context.definition.promptTemplate,
  });
  const data = {
    project: context.projectTitle,
    problem: context.problem,
    topics: context.topics,
    previousStages: context.previous,
    reviewerFeedback: context.feedback,
    ...(context.analysis
      ? {
          questionsAndAnswers: context.analysis.transcript,
          coverage: context.analysis.coverage,
          coverageGaps: context.analysis.coverageGaps,
          openContradictions: context.analysis.openContradictions,
          earlierUnderstanding: context.analysis.summaries,
          approvedDefinitionOfEarlierRun: context.analysis.priorDefinition,
        }
      : {}),
  };
  return { instructions, message: `<data>${JSON.stringify(data)}</data>` };
}
