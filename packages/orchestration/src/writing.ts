import { createHash } from 'node:crypto';

import { composeInstructions, defaultDefinition, type AgentDefinitionContent } from '@docoo/domain';
import {
  type Block,
  type Budget,
  type DraftCitation,
  type ReferenceEntry,
  type SectionPlan,
  type SubsectionPlan,
  type WritingPlan,
} from '@docoo/documents';
import { normalizeForSearch } from '@docoo/knowledge';

import {
  quoteInText,
  type CitationProblem,
  type KnowledgePassage,
  type KnowledgePromptItem,
  knowledgePromptItems,
} from './research.js';

/**
 * Prompts and citation handling of the document writer (ADR-0019). Pure: nothing here touches
 * the database or a provider, and the Temporal workflow bundle never imports it. The rules the
 * code adds to the documenter's instructions are text in this file; an administrator edits the
 * role's principles and its task, never these.
 */

/** Queries the writer runs against the knowledge base for one document. */
export const WRITING_MAX_QUERIES = 4;
/** Letters of the opening of an earlier subsection shown to the model so it does not repeat it. */
const OPENING_LETTERS = 160;
/** Roughly how many letters make a word, for the "about N words" hint. */
const LETTERS_PER_WORD = { fa: 4.2, en: 5.4 } as const;

export const WRITING_RULES: readonly string[] = [
  'You write one part of a solution document at a time. Use only the material in <data>: the solution, the approved problem definition, the research findings and approvedKnowledge. Never invent facts, figures, names, dates, sources or results.',
  'Write real content for the reader of this document and never repeat yourself or pad to reach a length. The budget is in letters and digits only (spaces and punctuation do not count): aim at targetLetters, between minLetters and maxLetters.',
  'Blocks: paragraph (text, optional citations), list (items; ordered when the order matters), table (caption, columns, rows; only when it conveys the meaning better than prose), callout (tone and text; sparingly, for a decision, a warning or a key note). Leave the fields a block does not use empty.',
  'Cite only in paragraphs. A citation names a ref from approvedKnowledge (K1, K2, …) and a short verbatim quote from that passage (at most 300 characters; … may skip words). The system checks every quote against the passage and discards a citation it cannot find. Never cite a ref that is not listed.',
  'Do not present as established what no passage supports: call it an assumption, an estimate or a proposal. Without approvedKnowledge, write without citations.',
  'Continue from alreadyWritten without repeating it; do not write headings (the system adds them) and do not number or label the part yourself.',
  'If the material is not enough for the part, write less and say plainly what is missing; never fill the gap with invented content.',
];

const OUTLINE_RULES: readonly string[] = [
  'Plan the subsections of the document sections. For each section key in sections, return exactly the number of subsections asked for (subsectionCount) when the material supports that many distinct parts, otherwise fewer. Each subsection has a short heading and a focus: one or two sentences saying what it covers and what it must not repeat from the others.',
  'Return every section key you were given, even when it needs a single subsection.',
];

const EXPAND_RULES: readonly string[] = [
  'You are given the current blocks of one subsection (existing) and must return the whole subsection again, longer: keep what is good, add real content that the material supports (explanations, reasoning, examples, steps, conditions), and never repeat or pad.',
];

const CONDENSE_RULES: readonly string[] = [
  'You are given the current blocks of one subsection (existing) and must return the whole subsection again, shorter: keep the points that matter most, remove repetition and detail of little use, and keep the citations of what you keep.',
];

export type WritingCall = 'outline' | 'section' | 'expand' | 'condense';

/**
 * The administrator's own task text for the documenter, when it was changed from the default
 * outline task: it then works as the house style of every call. The default text describes the
 * workflow stage and would only confuse a writer.
 */
export function houseStyle(definition: AgentDefinitionContent): string | null {
  const text = definition.promptTemplate.trim();
  return text === defaultDefinition('documenter').promptTemplate.trim() ? null : text;
}

export interface WritingMaterial {
  readonly project: string;
  readonly language: 'fa' | 'en';
  /** The approved problem definition (or the project's problem when there is none). */
  readonly problem: Record<string, unknown>;
  readonly solution: Record<string, unknown>;
  /** Research findings as claims with their support; never raw evidence. */
  readonly research: readonly { readonly claim: string; readonly support: string }[];
  /** The outline of the project's documentation stage, when the administrator approved one. */
  readonly stageOutline: readonly { readonly heading: string; readonly summary: string }[];
  readonly notes: string | null;
  readonly knowledge: readonly KnowledgePassage[];
}

const approxWords = (letters: number, language: 'fa' | 'en') =>
  Math.round(letters / LETTERS_PER_WORD[language] / 10) * 10;

export const budgetData = (budget: Budget, language: 'fa' | 'en') => ({
  minLetters: budget.min,
  targetLetters: budget.target,
  maxLetters: budget.max,
  approximateWords: approxWords(budget.target, language),
});

const shared = (material: WritingMaterial) => ({
  project: material.project,
  problem: material.problem,
  solution: material.solution,
  research: material.research,
  ...(material.stageOutline.length > 0 ? { approvedOutlineOfTheStage: material.stageOutline } : {}),
  ...(material.notes ? { notesFromTheAdministrator: material.notes } : {}),
  ...(material.knowledge.length > 0
    ? { approvedKnowledge: knowledgePromptItems(material.knowledge) }
    : {}),
});

function instructionsFor(
  definition: AgentDefinitionContent,
  material: WritingMaterial,
  call: WritingCall,
  tablesAllowed: boolean,
): string {
  const style = houseStyle(definition);
  const callRules =
    call === 'outline'
      ? OUTLINE_RULES
      : call === 'expand'
        ? EXPAND_RULES
        : call === 'condense'
          ? CONDENSE_RULES
          : [];
  return composeInstructions({
    role: 'documenter',
    content: definition,
    language: material.language,
    task:
      call === 'outline'
        ? 'Plan the structure of the solution document.'
        : 'Write one part of the solution document.',
    rules: [
      ...(style ? [`House style of the administrator: ${style}`] : []),
      ...WRITING_RULES,
      ...(tablesAllowed
        ? []
        : ['Tables and charts are not allowed for this document; use paragraphs and lists only.']),
      ...callRules,
    ],
  });
}

const opening = (blocks: readonly Block[]): string => {
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      const text = block.runs.map((run) => run.text).join(' ');
      return text.length <= OPENING_LETTERS ? text : `${text.slice(0, OPENING_LETTERS)}…`;
    }
  }
  return '';
};

export function outlinePrompt(input: {
  readonly definition: AgentDefinitionContent;
  readonly material: WritingMaterial;
  readonly plan: WritingPlan;
  readonly tablesAllowed: boolean;
}): { instructions: string; message: string } {
  const data = {
    call: 'outline',
    ...shared(input.material),
    sections: input.plan.sections.map((section) => ({
      key: section.key,
      label: section.label,
      covers: section.source,
      subsectionCount: section.subsections.length,
    })),
  };
  return {
    instructions: instructionsFor(input.definition, input.material, 'outline', input.tablesAllowed),
    message: `<data>${JSON.stringify(data)}</data>`,
  };
}

/** How the blocks of a subsection are shown to the model when it must change them. */
export function blocksForPrompt(blocks: readonly Block[]): unknown[] {
  return blocks.flatMap((block): unknown[] => {
    switch (block.type) {
      case 'paragraph':
        return [{ kind: 'paragraph', text: block.runs.map((run) => run.text).join(' ') }];
      case 'list':
        return [{ kind: 'list', ordered: block.ordered, items: block.items }];
      case 'table':
        return [
          { kind: 'table', caption: block.caption, columns: block.columns, rows: block.rows },
        ];
      case 'callout':
        return [{ kind: 'callout', tone: block.tone, text: block.text }];
      default:
        return [];
    }
  });
}

export function sectionPrompt(input: {
  readonly definition: AgentDefinitionContent;
  readonly material: WritingMaterial;
  readonly plan: WritingPlan;
  readonly section: SectionPlan;
  readonly subsection: SubsectionPlan;
  readonly call: 'section' | 'expand' | 'condense';
  readonly written: Readonly<Record<string, readonly Block[]>>;
  readonly tablesAllowed: boolean;
  /** Blocks of the subsection as they are now (expand and condense). */
  readonly existing?: readonly Block[] | undefined;
  /** The length the subsection should have after an expand or a condense. */
  readonly targetLetters?: number | undefined;
  /** What went wrong with the previous try of this call, if it is being repeated. */
  readonly feedback?: string | undefined;
}): { instructions: string; message: string } {
  const { material, plan, section, subsection } = input;
  const budget =
    input.targetLetters === undefined
      ? subsection.budget
      : ({
          min: Math.floor(input.targetLetters * 0.85),
          target: input.targetLetters,
          max: Math.ceil(input.targetLetters * 1.15),
        } satisfies Budget);
  const earlier = plan.sections.flatMap((item) => item.subsections);
  const data = {
    call: input.call,
    ...shared(material),
    document: plan.sections.map((item) => ({
      key: item.key,
      label: item.label,
      subsections: item.subsections.map((sub) => ({ heading: sub.heading, focus: sub.focus })),
    })),
    part: {
      section: section.label,
      covers: section.source,
      heading: subsection.heading,
      focus: subsection.focus,
    },
    budget: budgetData(budget, material.language),
    alreadyWritten: earlier
      .filter((sub) => sub.id !== subsection.id && (input.written[sub.id]?.length ?? 0) > 0)
      .map((sub) => ({
        heading: sub.heading ?? section.label,
        opening: opening(input.written[sub.id] ?? []),
      })),
    ...(input.existing ? { existing: blocksForPrompt(input.existing) } : {}),
    ...(input.feedback ? { previousTry: input.feedback } : {}),
  };
  return {
    instructions: instructionsFor(input.definition, material, input.call, input.tablesAllowed),
    message: `<data>${JSON.stringify(data)}</data>`,
  };
}

export const promptSha256 = (prompt: { instructions: string; message: string }): string =>
  createHash('sha256').update(`${prompt.instructions}\n${prompt.message}`).digest('hex');

/** The knowledge queries of one writing: the solution first, then the problem it answers. */
export function buildWritingQueries(input: {
  readonly solution: {
    readonly title: string;
    readonly summary: string;
    readonly plan: readonly string[];
  };
  readonly problem: Record<string, unknown>;
  readonly max?: number;
}): string[] {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const objectives = Array.isArray(input.problem['objectives'])
    ? (input.problem['objectives'] as unknown[]).map(text).slice(0, 2)
    : [];
  const candidates = [
    `${input.solution.title}. ${input.solution.summary}`,
    text(input.problem['problemStatement']),
    ...objectives,
    ...input.solution.plan.slice(0, 2).map(text),
  ];
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const candidate of candidates) {
    if (queries.length >= (input.max ?? WRITING_MAX_QUERIES)) break;
    const query = candidate.length <= 400 ? candidate : `${candidate.slice(0, 399).trimEnd()}…`;
    const key = normalizeForSearch(query);
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
  }
  return queries;
}

// ---------------------------------------------------------------- citations

export interface StoredReference {
  readonly id: string;
  readonly ref: string;
  readonly knowledgeId: string;
  readonly versionId: string;
  readonly versionNo: number;
  readonly title: string;
}

export interface CitationStats {
  readonly proposed: number;
  readonly verified: number;
  readonly discarded: readonly { readonly ref: string; readonly reason: CitationProblem }[];
}

export interface CitationState {
  readonly references: readonly StoredReference[];
  readonly stats: CitationStats;
}

export const EMPTY_CITATION_STATE: CitationState = {
  references: [],
  stats: { proposed: 0, verified: 0, discarded: [] },
};

const KNOWLEDGE_LABEL = {
  fa: (version: number) => `دانش تأییدشده، نسخهٔ ${version}`,
  en: (version: number) => `approved knowledge, version ${version}`,
} as const;

/**
 * Turns the citations a model proposes into references of the document. A citation counts only
 * when its ref is one of the passages the model was given and its quote is found in that
 * passage (the `citation_verifier` gate, FR-AGT-005); the first verified citation of a knowledge
 * version creates its reference and later ones reuse it. State survives between the calls of
 * one writing, so the same version is always the same reference.
 */
export class CitationRegistry {
  private readonly byRef: Map<string, KnowledgePassage>;
  private readonly references: StoredReference[];
  private proposed: number;
  private verified: number;
  private readonly discarded: { ref: string; reason: CitationProblem }[];

  constructor(
    passages: readonly KnowledgePassage[],
    private readonly verifierAllowed: boolean,
    state: CitationState = EMPTY_CITATION_STATE,
  ) {
    this.byRef = new Map(passages.map((passage) => [passage.ref, passage]));
    this.references = [...state.references];
    this.proposed = state.stats.proposed;
    this.verified = state.stats.verified;
    this.discarded = [...state.stats.discarded];
  }

  /** The reference id a verified citation stands for, or `null` (and the reason is recorded). */
  resolve(citation: DraftCitation): string | null {
    this.proposed += 1;
    const ref = citation.ref.trim().toUpperCase();
    const fail = (reason: CitationProblem): null => {
      if (this.discarded.length < 100) this.discarded.push({ ref, reason });
      return null;
    };
    if (!this.verifierAllowed) return fail('verifier_not_allowed');
    const passage = this.byRef.get(ref);
    if (!passage) return fail('unknown_ref');
    if (citation.quote.trim() === '') return fail('quote_missing');
    const verdict = quoteInText(citation.quote, passage.text);
    if (verdict === 'too_short') return fail('quote_too_short');
    if (verdict === 'not_found') return fail('quote_not_found');
    this.verified += 1;
    const existing = this.references.find((entry) => entry.versionId === passage.versionId);
    if (existing) return existing.id;
    const id = `B${this.references.length + 1}`;
    this.references.push({
      id,
      ref,
      knowledgeId: passage.knowledgeId,
      versionId: passage.versionId,
      versionNo: passage.versionNo,
      title: passage.title,
    });
    return id;
  }

  state(): CitationState {
    return {
      references: [...this.references],
      stats: {
        proposed: this.proposed,
        verified: this.verified,
        discarded: [...this.discarded],
      },
    };
  }
}

/**
 * The references that are still cited by the final blocks, in the order they first appear. A
 * subsection that was rewritten may no longer cite what an earlier try did.
 */
export function citedReferences(
  blocks: readonly Block[],
  stored: readonly StoredReference[],
  language: 'fa' | 'en',
): ReferenceEntry[] {
  const order: string[] = [];
  const visit = (list: readonly Block[]): void => {
    for (const block of list) {
      if (block.type === 'paragraph')
        for (const run of block.runs)
          for (const id of run.citations ?? []) if (!order.includes(id)) order.push(id);
      if (block.type === 'appendix') visit(block.blocks);
    }
  };
  visit(blocks);
  return order.flatMap((id) => {
    const entry = stored.find((item) => item.id === id);
    return entry
      ? [{ id, text: `${entry.title} (${KNOWLEDGE_LABEL[language](entry.versionNo)})` }]
      : [];
  });
}

/** Re-exported so the activities need one import for what they hand to the prompt builders. */
export type { KnowledgePromptItem };

// ---------------------------------------------------------------- settings of one writing

/** The effective values a writing runs with, fixed when it starts (FR-CFG-005). */
export interface WritingSettings {
  readonly connectionId: string;
  readonly model: string;
  readonly costLimitUsd: number;
  /** Approved passages the writer may be given; 0 turns knowledge, and with it citations, off. */
  readonly knowledgeLimit: number;
  /** Rounds of expanding or condensing subsections after writing; 0 turns fitting off. */
  readonly fitRounds: number;
  readonly allowRestricted: boolean;
}

export const WRITING_DEFAULTS = { knowledgeLimit: 12, fitRounds: 3, costLimitUsd: 20 } as const;

const bounded = (value: unknown, fallback: number, min: number, max: number): number => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

/** Reads the writing's settings out of the effective values of its project. */
export function resolveWritingSettings(values: Readonly<Record<string, unknown>>): WritingSettings {
  const cost = Number(values['ai.max_cost_usd_per_run'] ?? WRITING_DEFAULTS.costLimitUsd);
  return {
    connectionId: typeof values['ai.connection_id'] === 'string' ? values['ai.connection_id'] : '',
    model: typeof values['ai.model'] === 'string' ? values['ai.model'] : '',
    costLimitUsd: Number.isFinite(cost) && cost > 0 ? cost : WRITING_DEFAULTS.costLimitUsd,
    knowledgeLimit: bounded(
      values['document.writing.knowledge_limit'],
      WRITING_DEFAULTS.knowledgeLimit,
      0,
      30,
    ),
    fitRounds: bounded(values['document.writing.fit_rounds'], WRITING_DEFAULTS.fitRounds, 0, 3),
    allowRestricted: values['research.allow_restricted_knowledge'] === true,
  };
}

/** Reads settings back from the row, tolerating anything the column might hold. */
export function writingSettingsFromRow(value: unknown): WritingSettings {
  const raw = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    connectionId: typeof raw['connectionId'] === 'string' ? raw['connectionId'] : '',
    model: typeof raw['model'] === 'string' ? raw['model'] : '',
    costLimitUsd:
      typeof raw['costLimitUsd'] === 'number' && raw['costLimitUsd'] > 0
        ? raw['costLimitUsd']
        : WRITING_DEFAULTS.costLimitUsd,
    knowledgeLimit: bounded(raw['knowledgeLimit'], WRITING_DEFAULTS.knowledgeLimit, 0, 30),
    fitRounds: bounded(raw['fitRounds'], WRITING_DEFAULTS.fitRounds, 0, 3),
    allowRestricted: raw['allowRestricted'] === true,
  };
}
