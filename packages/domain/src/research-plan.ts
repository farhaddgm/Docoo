/**
 * The research plan of a project (ADR-0038). Before the research stage runs, the administrator
 * confirms the questions it must answer. The stage then looks for evidence for exactly those
 * questions, files each finding under the question it answers, and the result shows which
 * questions were answered, which only weakly and which not at all.
 *
 * The channels are fixed by code, never by a model. The administrator's words are data: the
 * questions are quoted inside `<data>` and the rules below say so.
 */

export const RESEARCH_CHANNELS = ['knowledge', 'web', 'both'] as const;
export type ResearchChannel = (typeof RESEARCH_CHANNELS)[number];

export const isResearchChannel = (value: unknown): value is ResearchChannel =>
  RESEARCH_CHANNELS.some((channel) => channel === value);

export const RESEARCH_PLAN_LIMITS = {
  maxQuestions: 12,
  questionMin: 5,
  question: 400,
  why: 600,
} as const;

/** The id the stage and the model use for the question at this position (1-based). */
export const questionRef = (ordinal: number): string => `Q${ordinal}`;

export interface ResearchQuestionInput {
  readonly question: string;
  readonly why: string;
  readonly channel: ResearchChannel;
}

const clean = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';

/**
 * The questions a request or a model answer stands for. A question without usable text, or one
 * that repeats an earlier one, is dropped and counted; an unknown channel becomes `both`.
 */
export function normalizeResearchQuestions(raw: unknown): {
  readonly items: ResearchQuestionInput[];
  readonly discarded: number;
} {
  const list = Array.isArray(raw) ? raw : [];
  const items: ResearchQuestionInput[] = [];
  const seen = new Set<string>();
  let discarded = 0;
  for (const entry of list) {
    const record =
      entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const question = clean(record['question'], RESEARCH_PLAN_LIMITS.question);
    const key = question.toLowerCase();
    if (
      question.length < RESEARCH_PLAN_LIMITS.questionMin ||
      seen.has(key) ||
      items.length >= RESEARCH_PLAN_LIMITS.maxQuestions
    ) {
      discarded += 1;
      continue;
    }
    seen.add(key);
    const channel = record['channel'];
    items.push({
      question,
      why: clean(record['why'], RESEARCH_PLAN_LIMITS.why),
      channel: isResearchChannel(channel) ? channel : 'both',
    });
  }
  return { items, discarded };
}

export const RESEARCH_PLAN_SCHEMA_NAME = 'research_plan_proposal';

/** The structured answer of the proposal call; strict-mode compatible (all keys required). */
export const RESEARCH_PLAN_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          why: { type: 'string' },
          channel: { type: 'string', enum: [...RESEARCH_CHANNELS] },
        },
        required: ['question', 'why', 'channel'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

export const RESEARCH_PLAN_PROPOSAL_RULES: readonly string[] = [
  'Propose the questions the research of this project must answer, as a short list (usually 3 to 8 questions, never more than 12). Each question must be specific and answerable by evidence, not a topic.',
  'Start from the approved problem definition (objectives, constraints, success criteria, assumptions and unresolved points). Prefer questions whose answer would change a decision; put the questions that unlock others first.',
  'If outputRequirements lists a "must" item that needs facts, figures or precedents, add a question that finds them. Do not add a question for a requirement that needs no research.',
  'why is one sentence saying what decision or part of the output the answer serves.',
  'channel is knowledge (the administrator’s approved internal knowledge), web (public sources) or both. Use web or both only when sources.web is true. Use knowledge for facts that only the organization holds.',
  'Use only what the project data says; do not invent facts, names, figures or dates.',
];

/** Rules added to the research stage when a confirmed plan exists. */
export const RESEARCH_PLAN_STAGE_RULES: readonly string[] = [
  'researchPlan lists the questions the administrator confirmed, numbered Q1, Q2, …. Look for evidence for exactly these questions; do not widen the research to other questions.',
  'Set questionId of every finding to the id of the one question it answers (for example "Q2"). A finding that answers no planned question is still allowed but must have an empty questionId.',
  'When the material does not answer a question, do not invent support: list it in gaps, naming its id, and say what is missing. A question whose only findings are unverified counts as weakly answered.',
  'Questions with channel "knowledge" are answered from approvedKnowledge only, "web" from webSources only, "both" from either.',
];

/** The research rules when no plan reaches the stage: findings belong to no question. */
export const NO_RESEARCH_PLAN_RULES: readonly string[] = [
  'There is no researchPlan: set questionId of every finding to an empty string.',
];

/** What the research stage is told about one planned question. */
export interface PromptResearchQuestion {
  readonly id: string;
  readonly question: string;
  readonly why: string;
  readonly channel: ResearchChannel;
}
