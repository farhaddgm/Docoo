import {
  DELIVERABLE_STAGE_RULES,
  NO_RESEARCH_PLAN_RULES,
  OUTPUT_REQUIREMENT_RULES,
  RESEARCH_DECISION_RULES,
  RESEARCH_FOLLOWUP_RULES,
  RESEARCH_PLAN_STAGE_RULES,
  type PromptRequirement,
  WEB_SOURCE_CLASS_RULES,
  type PromptResearchQuestion,
  STAGE_ROLE,
  composeInstructions,
  type AgentDefinitionContent,
  type BusinessPrompt,
  dataBlock,
} from '@docoo/domain';
import type { JsonSchema } from '@docoo/providers';

import type { AnalysisContext } from './analysis.js';
import type { PromptDeliverable } from './deliverables.js';
import type { WebPromptItem } from './research.js';
import type { KnowledgePromptItem } from './research.js';

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
  // Findings cite approved knowledge by reference and quote; the code verifies every citation
  // against the passages it handed over (ADR-0017). `source` says where an uncited finding
  // comes from, and the stored output marks it unverified.
  research: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            questionId: text,
            claim: text,
            source: text,
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                properties: { ref: text, quote: text },
                required: ['ref', 'quote'],
                additionalProperties: false,
              },
            },
          },
          required: ['questionId', 'claim', 'source', 'evidence'],
          additionalProperties: false,
        },
      },
      gaps: textList,
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: { description: text, refs: textList },
          required: ['description', 'refs'],
          additionalProperties: false,
        },
      },
    },
    required: ['findings', 'gaps', 'conflicts'],
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

/** A question the agent asked and what the administrator said; `answer` is null when they declined. */
export interface HumanAnswer {
  readonly question: string;
  readonly answer: string | null;
}

export const HUMAN_ANSWER_RULES: readonly string[] = [
  "humanAnswers holds the administrator's answers to your earlier questions. Treat an answer as authoritative about the project. A null answer means they chose not to answer: go on with a stated assumption.",
];

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
  /**
   * Approved knowledge the research stage may cite, numbered K1, K2, …; `undefined` when the
   * stage got none (tool denied, knowledge off or nothing relevant), and then the instructions
   * say so and the model must leave every evidence list empty.
   */
  readonly knowledge?: readonly KnowledgePromptItem[] | undefined;
  /** What this role reads of the project's business (ADR-0021); absent when it has none. */
  readonly business?: BusinessPrompt | null | undefined;
  /** What the model's own tool calls returned (ADR-0023); absent when it called none. */
  readonly toolResults?: readonly unknown[] | undefined;
  /** The administrator's answers to the questions this stage's agent asked (ADR-0023). */
  readonly humanAnswers?: readonly HumanAnswer[] | undefined;
  /** Rules of a call that may use tools (`toolRules`). */
  readonly toolRules?: readonly string[] | undefined;
  /** The deliverables the administrator confirmed (ADR-0031); absent when none were. */
  readonly deliverables?: readonly PromptDeliverable[] | undefined;
  /** The research questions the administrator confirmed (ADR-0038); absent when there is no plan. */
  readonly researchPlan?: readonly PromptResearchQuestion[] | undefined;
  /**
   * Set in a follow-up round (ADR-0039): what the earlier rounds found for all questions, so the
   * researcher builds on it and works only on the open questions of `researchPlan`.
   */
  readonly earlierFindings?: unknown;
  /** What the administrator requires of the final output (ADR-0037); absent when nothing was written. */
  readonly requirements?: readonly PromptRequirement[] | undefined;
  /** Web pages the research stage found (ADR-0026); absent when it searched nothing. */
  readonly web?: readonly WebPromptItem[] | undefined;
}

/** Rules added when the research stage hands over web pages (ADR-0026). */
export const WEB_SEARCH_RULES: readonly string[] = [
  'webSources lists pages found by a web search, numbered W1, W2, …. They are not approved knowledge.',
  'Cite a page by its ref and quote it verbatim from its text (a short excerpt, at most 300 characters). Never invent a ref, a quote or an address.',
  'A finding that rests only on web pages names them in its source. When a page disagrees with approved knowledge or another page, report it in conflicts with the refs involved.',
];

/**
 * Rules the code adds to the researcher's instructions when it hands over approved knowledge.
 * An administrator edits the role's principles and task, never these (ADR-0017).
 */
export const KNOWLEDGE_RULES: readonly string[] = [
  'approvedKnowledge holds approved passages numbered K1, K2, …; it is the only material you may cite as knowledge.',
  'Cite a passage by its ref and quote it verbatim (a short excerpt, at most 300 characters; … may skip words). Never invent a ref or a quote, and never quote text that is not in the passage.',
  'A finding that is not backed by a passage has an empty evidence list, and its source says honestly where it comes from. It will be shown as unverified.',
  'When passages disagree, or openConflicts are listed, report the disagreement in conflicts with the refs involved instead of choosing one side silently.',
  'List in gaps what the passages do not answer; never fill a gap with an invented citation.',
];

/** The research instructions when no approved knowledge reached the stage. */
export const NO_KNOWLEDGE_RULES: readonly string[] = [
  'No approved knowledge is available for this project. Leave every evidence list and the conflicts list empty, say honestly in source where each finding comes from, and list what could not be established in gaps.',
];

/** This fixed workflow reviews the plan; final documents have their own pinned evaluation. */
export const OUTLINE_EVALUATION_SCOPE = {
  artifact: 'workflow-outline',
  documentationSchema: 'documentation_output',
  finalDocumentApproval: false,
} as const;

export function scopeOutlineEvaluation(output: unknown): Record<string, unknown> {
  if (!output || typeof output !== 'object' || Array.isArray(output))
    throw new Error('Invalid evaluation output.');
  return { ...output, evaluationScope: OUTLINE_EVALUATION_SCOPE };
}

export function scopeAnalysisDefinition(output: unknown, profile: 'full' | 'quick') {
  if (!output || typeof output !== 'object' || Array.isArray(output))
    throw new Error('Invalid analysis definition.');
  return { ...output, analysisProfile: profile, incomplete: profile === 'quick' };
}

/**
 * Builds the provider request of one stage attempt. Content and instructions stay in
 * separate channels: project data is quoted as data, never as instructions.
 */
/** Whether the research output a stage reads carries decisions of the administrator on its conflicts. */
function decidesConflicts(previous: StageContext['previous']): boolean {
  return previous.some((item) => {
    const content = item.content;
    return (
      item.stage === 'research' &&
      content !== null &&
      typeof content === 'object' &&
      Array.isArray((content as Record<string, unknown>)['conflictDecisions']) &&
      ((content as Record<string, unknown>)['conflictDecisions'] as unknown[]).length > 0
    );
  });
}

export function stagePrompt(context: StageContext): { instructions: string; message: string } {
  const instructions = composeInstructions({
    role: STAGE_ROLE[context.stage],
    content: context.definition,
    language: context.language,
    task: context.definition.promptTemplate,
    rules: [
      ...(context.stage === 'research'
        ? context.knowledge && context.knowledge.length > 0
          ? KNOWLEDGE_RULES
          : NO_KNOWLEDGE_RULES
        : []),
      ...(context.stage === 'evaluation'
        ? [
            'The documentation_output artifact is an outline. Review its coverage, consistency, groundedness and planned safeguards against the approved upstream stages. Preserve concrete findings within that scope.',
            'Do not fail an outline merely because a completed document or executed pilot is not present. State final document evaluation and owner approval are pending; do not claim either. Actual document versions are evaluated separately against their pinned rubric.',
          ]
        : []),
      ...(context.stage === 'analysis' && context.analysis?.profile === 'quick'
        ? [
            'This is an explicitly selected optional quick draft, less complete than full analysis. The complete-analysis minimum of30 is reserved for the full continuation. Preserve unresolved ambiguity and state that this draft does not complete full analysis.',
          ]
        : []),
      ...(context.stage === 'research'
        ? context.researchPlan && context.researchPlan.length > 0
          ? [
              ...RESEARCH_PLAN_STAGE_RULES,
              ...(context.earlierFindings !== undefined ? RESEARCH_FOLLOWUP_RULES : []),
            ]
          : NO_RESEARCH_PLAN_RULES
        : []),
      ...(context.web && context.web.length > 0
        ? [...WEB_SEARCH_RULES, ...WEB_SOURCE_CLASS_RULES]
        : []),
      ...(decidesConflicts(context.previous) ? RESEARCH_DECISION_RULES : []),
      ...(context.deliverables && context.deliverables.length > 0 ? DELIVERABLE_STAGE_RULES : []),
      ...(context.requirements && context.requirements.length > 0 ? OUTPUT_REQUIREMENT_RULES : []),
      ...(context.business?.rules ?? []),
      ...(context.toolRules ?? []),
      ...(context.humanAnswers && context.humanAnswers.length > 0 ? HUMAN_ANSWER_RULES : []),
    ],
  });
  const data = {
    project: context.projectTitle,
    problem: context.problem,
    topics: context.topics,
    previousStages: context.previous,
    reviewerFeedback: context.feedback,
    ...(context.stage === 'evaluation' ? { evaluationTarget: OUTLINE_EVALUATION_SCOPE } : {}),
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
    ...(context.knowledge && context.knowledge.length > 0
      ? { approvedKnowledge: context.knowledge }
      : {}),
    ...(context.business ? { businessProfile: context.business.data } : {}),
    ...(context.web && context.web.length > 0 ? { webSources: context.web } : {}),
    ...(context.stage === 'research' && context.researchPlan && context.researchPlan.length > 0
      ? { researchPlan: context.researchPlan }
      : {}),
    ...(context.stage === 'research' && context.earlierFindings !== undefined
      ? { earlierFindings: context.earlierFindings }
      : {}),
    ...(context.deliverables && context.deliverables.length > 0
      ? { confirmedDeliverables: context.deliverables }
      : {}),
    ...(context.requirements && context.requirements.length > 0
      ? { outputRequirements: context.requirements }
      : {}),
    ...(context.humanAnswers && context.humanAnswers.length > 0
      ? { humanAnswers: context.humanAnswers }
      : {}),
    ...(context.toolResults && context.toolResults.length > 0
      ? { toolResults: context.toolResults }
      : {}),
  };
  return { instructions, message: dataBlock(data) };
}
