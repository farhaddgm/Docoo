import { countCharacters, visibleText, type Level, type LevelBounds } from './count.js';
import { validateDocument, type Block, type Run, type StructuredDocument } from './model.js';
import type { DocumentTemplate, SectionSource, TemplateSection } from './templates.js';

/**
 * Rules of the document writer (ADR-0019), kept free of the database and of any provider so the
 * API, the worker and the tests share them. The writer plans the length first, writes one
 * subsection at a time, and every number it relies on (letters, bounds, citations) is computed
 * by code from the structured document, never taken from the model's word.
 */
export const WRITING_VERSION = 'writing-v1';

/** A subsection is written in one model call; longer sections are split into several. */
export const SUBSECTION_TARGET_LETTERS = 2500;
export const MAX_SUBSECTIONS_PER_SECTION = 6;
/** The share of a budget a subsection may miss before it is written again once. */
export const SUBSECTION_TOLERANCE = { low: 0.6, high: 1.6 } as const;
/** Rounds of expanding or condensing subsections to bring the whole document into its bounds. */
export const MAX_FIT_ROUNDS = 3;
export const MAX_FIT_CALLS_PER_ROUND = 4;
export const MAX_BLOCKS_PER_SUBSECTION = 40;

/** How much of the writing budget each kind of section gets (relative). */
const SECTION_WEIGHTS: Readonly<Record<SectionSource, number>> = {
  problem: 1,
  summary: 1,
  assumptions: 1.2,
  evidence: 2,
  plan: 2.5,
  risks: 1.5,
  scores: 1,
};

export interface Budget {
  readonly min: number;
  readonly target: number;
  readonly max: number;
}

export interface SubsectionPlan {
  readonly id: string;
  readonly sectionKey: string;
  /** Shown as a level-2 heading when the section has more than one subsection. */
  readonly heading: string | null;
  /** What this subsection covers; chosen by the outline step, empty before it. */
  readonly focus: string;
  readonly budget: Budget;
}

export interface SectionPlan {
  readonly key: string;
  readonly source: SectionSource;
  readonly label: string;
  readonly subsections: readonly SubsectionPlan[];
}

export interface WritingPlan {
  readonly version: typeof WRITING_VERSION;
  readonly templateVersion: string;
  readonly level: Level;
  readonly bounds: LevelBounds;
  /** The length the writer aims for: the middle of the level's bounds. */
  readonly targetTotal: number;
  /** Letters the code adds itself (title, headings, score table and chart, references). */
  readonly fixedLetters: number;
  readonly sections: readonly SectionPlan[];
}

const budgetFor = (target: number): Budget => ({
  min: Math.max(1, Math.floor(target * 0.7)),
  target: Math.max(1, Math.round(target)),
  max: Math.max(2, Math.ceil(target * 1.3)),
});

function subsectionCount(target: number): number {
  return Math.max(
    1,
    Math.min(MAX_SUBSECTIONS_PER_SECTION, Math.round(target / SUBSECTION_TARGET_LETTERS)),
  );
}

function subsectionsOf(
  section: TemplateSection,
  target: number,
  count: number,
  outline?: readonly { readonly heading: string; readonly focus: string }[],
): SubsectionPlan[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${section.key}-${index + 1}`,
    sectionKey: section.key,
    heading: count > 1 ? (outline?.[index]?.heading ?? null) : null,
    focus: outline?.[index]?.focus ?? '',
    budget: budgetFor(target / count),
  }));
}

/**
 * Splits the length of the level over the sections of the template and cuts long sections into
 * subsections of about 2,500 letters. The target is the middle of the bounds so the first draft
 * has room on both sides; `fixedLetters` is what the code writes itself and is taken off first.
 */
export function planWriting(input: {
  readonly template: DocumentTemplate;
  readonly language: 'fa' | 'en';
  readonly level: Level;
  readonly bounds: LevelBounds;
  readonly fixedLetters: number;
}): WritingPlan {
  const { template, level, bounds } = input;
  const targetTotal = Math.round((bounds.min + bounds.max) / 2);
  const writable = Math.max(template.sections.length * 200, targetTotal - input.fixedLetters);
  const totalWeight = template.sections.reduce(
    (sum, section) => sum + SECTION_WEIGHTS[section.source],
    0,
  );
  const sections = template.sections.map((section): SectionPlan => {
    const target = (writable * SECTION_WEIGHTS[section.source]) / totalWeight;
    return {
      key: section.key,
      source: section.source,
      label: section.label[input.language],
      subsections: subsectionsOf(section, target, subsectionCount(target)),
    };
  });
  return {
    version: WRITING_VERSION,
    templateVersion: template.version,
    level,
    bounds,
    targetTotal,
    fixedLetters: input.fixedLetters,
    sections,
  };
}

/** What the outline step returns: the subsections of each section. */
export interface OutlineAnswer {
  readonly sections: readonly {
    readonly key: string;
    readonly subsections: readonly { readonly heading: string; readonly focus: string }[];
  }[];
}

const clean = (value: string, max: number): string =>
  value.replace(/\s+/gu, ' ').trim().slice(0, max);

/**
 * Applies the model's outline to the plan. The code owns how many subsections a section has: an
 * answer with fewer keeps the budget of the section (each subsection grows), one with more is cut
 * to the planned number, and a section the model skipped stays as planned without headings.
 */
export function applyOutline(plan: WritingPlan, answer: unknown): WritingPlan {
  const given = new Map<string, { heading: string; focus: string }[]>();
  const sections = (answer as { sections?: unknown } | null)?.sections;
  if (Array.isArray(sections)) {
    for (const section of sections as Partial<OutlineAnswer['sections'][number]>[]) {
      if (!section || typeof section.key !== 'string' || !Array.isArray(section.subsections))
        continue;
      const items = section.subsections as Partial<{ heading: unknown; focus: unknown }>[];
      const list = items
        .flatMap((item) =>
          item && typeof item.heading === 'string' && typeof item.focus === 'string'
            ? [{ heading: clean(item.heading, 120), focus: clean(item.focus, 600) }]
            : [],
        )
        .filter((item) => item.heading.length > 0);
      given.set(section.key, list);
    }
  }
  return {
    ...plan,
    sections: plan.sections.map((section) => {
      const target = section.subsections.reduce((sum, item) => sum + item.budget.target, 0);
      const list = given.get(section.key) ?? [];
      const count = Math.max(1, Math.min(section.subsections.length, list.length || 1));
      const template: TemplateSection = {
        key: section.key,
        source: section.source,
        label: { fa: section.label, en: section.label },
      };
      return { ...section, subsections: subsectionsOf(template, target, count, list) };
    }),
  };
}

// ---------------------------------------------------------------- the schemas the model answers

const text = { type: 'string' } as const;

/**
 * Strict structured output (closed objects, every property required) so it works on every
 * provider: OpenAI's strict mode is the narrowest. Unused fields of a block are left empty.
 */
export const OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: text,
          subsections: {
            type: 'array',
            items: {
              type: 'object',
              properties: { heading: text, focus: text },
              required: ['heading', 'focus'],
              additionalProperties: false,
            },
          },
        },
        required: ['key', 'subsections'],
        additionalProperties: false,
      },
    },
  },
  required: ['sections'],
  additionalProperties: false,
} as const;

export const OUTLINE_SCHEMA_NAME = 'document_outline';

export const SECTION_SCHEMA = {
  type: 'object',
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['paragraph', 'list', 'table', 'callout'] },
          text,
          ordered: { type: 'boolean' },
          items: { type: 'array', items: text },
          caption: text,
          columns: { type: 'array', items: text },
          rows: { type: 'array', items: { type: 'array', items: text } },
          tone: { type: 'string', enum: ['info', 'warning', 'decision'] },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              properties: { ref: text, quote: text },
              required: ['ref', 'quote'],
              additionalProperties: false,
            },
          },
        },
        required: [
          'kind',
          'text',
          'ordered',
          'items',
          'caption',
          'columns',
          'rows',
          'tone',
          'citations',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['blocks'],
  additionalProperties: false,
} as const;

export const SECTION_SCHEMA_NAME = 'document_section';

export interface DraftCitation {
  readonly ref: string;
  readonly quote: string;
}

export interface DraftBlock {
  readonly kind: string;
  readonly text: string;
  readonly ordered: boolean;
  readonly items: readonly string[];
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly tone: string;
  readonly citations: readonly DraftCitation[];
}

export type DiscardReason =
  'unknown_kind' | 'empty' | 'table_not_allowed' | 'table_invalid' | 'too_many_blocks';

export interface Discarded {
  readonly index: number;
  readonly reason: DiscardReason;
}

/**
 * Turns a draft answer into blocks. A citation goes through `resolve`, which returns the id of
 * the reference it stands for or `null` when the quote is not backed by the knowledge; a block
 * the writer should not have produced (a table when tables are not allowed, an unreadable one)
 * is dropped and counted, never repaired.
 */
export function draftToBlocks(
  draft: unknown,
  options: {
    readonly idPrefix: string;
    readonly fallbackCaption: string;
    readonly tablesAllowed: boolean;
    readonly resolve: (citation: DraftCitation) => string | null;
  },
): { blocks: Block[]; discarded: Discarded[] } {
  const list = (draft as { blocks?: unknown } | null)?.blocks;
  const blocks: Block[] = [];
  const discarded: Discarded[] = [];
  if (!Array.isArray(list)) return { blocks, discarded };
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
      : [];
  list.forEach((raw: Partial<DraftBlock> | null, index: number) => {
    if (blocks.length >= MAX_BLOCKS_PER_SUBSECTION) {
      discarded.push({ index, reason: 'too_many_blocks' });
      return;
    }
    const id = `${options.idPrefix}-b${index + 1}`;
    const body = typeof raw?.text === 'string' ? raw.text.trim() : '';
    switch (raw?.kind) {
      case 'paragraph': {
        if (!body) return void discarded.push({ index, reason: 'empty' });
        const ids = [
          ...new Set(
            (raw.citations ?? []).flatMap((citation) => {
              const resolved =
                citation && typeof citation.ref === 'string' && typeof citation.quote === 'string'
                  ? options.resolve(citation)
                  : null;
              return resolved ? [resolved] : [];
            }),
          ),
        ];
        const run: Run = ids.length > 0 ? { text: body, citations: ids } : { text: body };
        blocks.push({ type: 'paragraph', id, runs: [run] });
        return;
      }
      case 'list': {
        const items = strings(raw.items).filter(Boolean);
        if (items.length === 0) return void discarded.push({ index, reason: 'empty' });
        blocks.push({ type: 'list', id, ordered: raw.ordered === true, items });
        return;
      }
      case 'table': {
        if (!options.tablesAllowed)
          return void discarded.push({ index, reason: 'table_not_allowed' });
        const columns = strings(raw.columns).filter(Boolean).slice(0, 8);
        const rows = Array.isArray(raw.rows)
          ? raw.rows
              .map((row) => strings(row))
              .filter((row) => row.some(Boolean))
              .map((row) => columns.map((_, column) => row[column] ?? ''))
          : [];
        if (columns.length === 0 || rows.length === 0)
          return void discarded.push({ index, reason: 'table_invalid' });
        const caption = typeof raw.caption === 'string' ? raw.caption.trim() : '';
        blocks.push({
          type: 'table',
          id,
          caption: caption || options.fallbackCaption,
          columns,
          rows,
          ...(body ? { notes: body } : {}),
        });
        return;
      }
      case 'callout': {
        if (!body) return void discarded.push({ index, reason: 'empty' });
        const tone = raw.tone === 'warning' || raw.tone === 'decision' ? raw.tone : 'info';
        blocks.push({ type: 'callout', id, tone, text: body });
        return;
      }
      default:
        discarded.push({ index, reason: 'unknown_kind' });
    }
  });
  return { blocks, discarded };
}

/** Letters of a group of blocks, counted like the whole document (NFC, letters and digits). */
export function countBlocks(blocks: readonly Block[], language: 'fa' | 'en'): number {
  return countCharacters(visibleText({ title: '', language, blocks }));
}

export type SubsectionVerdict = 'ok' | 'short' | 'long';

/** Whether a written subsection is close enough to its budget not to be written again. */
export function subsectionVerdict(letters: number, budget: Budget): SubsectionVerdict {
  if (letters < budget.target * SUBSECTION_TOLERANCE.low) return 'short';
  if (letters > budget.target * SUBSECTION_TOLERANCE.high) return 'long';
  return 'ok';
}

// ---------------------------------------------------------------- assembling the document

export interface ReferenceEntry {
  readonly id: string;
  readonly text: string;
  readonly url?: string;
}

/**
 * The whole document: the title, one level-1 heading per section (a level-2 heading per
 * subsection when a section has several), what the code builds itself (score table and chart),
 * the written blocks and the references that were actually cited.
 */
export function assembleDocument(input: {
  readonly title: string;
  readonly language: 'fa' | 'en';
  readonly plan: WritingPlan;
  readonly written: Readonly<Record<string, readonly Block[]>>;
  /** Blocks placed right after the heading of a section, by section key. */
  readonly built: Readonly<Record<string, readonly Block[]>>;
  readonly references: readonly ReferenceEntry[];
}): StructuredDocument {
  const blocks: Block[] = [];
  for (const section of input.plan.sections) {
    blocks.push({ type: 'heading', id: section.key, level: 1, text: section.label });
    blocks.push(...(input.built[section.key] ?? []));
    for (const subsection of section.subsections) {
      if (subsection.heading) {
        blocks.push({
          type: 'heading',
          id: `${subsection.id}-heading`,
          level: 2,
          text: subsection.heading,
        });
      }
      blocks.push(...(input.written[subsection.id] ?? []));
    }
  }
  if (input.references.length > 0) {
    blocks.push({
      type: 'bibliography',
      id: 'references',
      entries: input.references.map((entry) => ({ ...entry })),
    });
  }
  return validateDocument({ title: input.title, language: input.language, blocks });
}

// ---------------------------------------------------------------- bringing the length into bounds

export interface FitAdjustment {
  readonly subsectionId: string;
  readonly action: 'expand' | 'condense';
  /** How long the subsection should be after the change. */
  readonly targetLetters: number;
  readonly currentLetters: number;
}

export type FitStatus = 'within' | 'short' | 'long';

export function fitStatus(count: number, bounds: LevelBounds): FitStatus {
  return count < bounds.min ? 'short' : count > bounds.max ? 'long' : 'within';
}

/**
 * The next round of changes toward the middle of the bounds. A document that is too short
 * grows in the subsections that fell furthest below their budget; one that is too long loses
 * letters where subsections overshot most. Padding is never an option: if the model cannot add
 * real content, the document stays short and the writing report says so.
 */
export function fitAdjustments(input: {
  readonly plan: WritingPlan;
  readonly letters: Readonly<Record<string, number>>;
  readonly total: number;
}): FitAdjustment[] {
  const status = fitStatus(input.total, input.plan.bounds);
  if (status === 'within') return [];
  const gap = input.plan.targetTotal - input.total;
  const all = input.plan.sections.flatMap((section) => section.subsections);
  const rows = all.map((subsection) => ({
    subsection,
    current: input.letters[subsection.id] ?? 0,
  }));
  if (status === 'short') {
    const chosen = rows
      .map((row) => ({ ...row, room: row.subsection.budget.target - row.current }))
      .sort((a, b) => b.room - a.room || a.subsection.id.localeCompare(b.subsection.id))
      .slice(0, MAX_FIT_CALLS_PER_ROUND);
    // Every chosen subsection takes a share of the gap proportional to its budget.
    const weight = chosen.reduce((sum, row) => sum + row.subsection.budget.target, 0) || 1;
    return chosen.map((row) => ({
      subsectionId: row.subsection.id,
      action: 'expand',
      currentLetters: row.current,
      targetLetters: Math.round(row.current + (gap * row.subsection.budget.target) / weight),
    }));
  }
  const excess = input.total - input.plan.targetTotal;
  const chosen = rows
    .map((row) => ({ ...row, over: row.current - row.subsection.budget.target }))
    .sort((a, b) => b.over - a.over || a.subsection.id.localeCompare(b.subsection.id))
    .slice(0, MAX_FIT_CALLS_PER_ROUND);
  const weight = chosen.reduce((sum, row) => sum + Math.max(1, row.current), 0) || 1;
  return chosen.map((row) => ({
    subsectionId: row.subsection.id,
    action: 'condense',
    currentLetters: row.current,
    // A subsection never shrinks below 40% of its budget: the section would stop making sense.
    targetLetters: Math.max(
      Math.round(row.subsection.budget.target * 0.4),
      Math.round(row.current - (excess * Math.max(1, row.current)) / weight),
    ),
  }));
}

// ---------------------------------------------------------------- the report of one writing

export interface WritingReport {
  readonly version: typeof WRITING_VERSION;
  readonly level: Level;
  readonly bounds: LevelBounds;
  readonly count: number;
  readonly withinBounds: boolean;
  /** Letters to remove (positive) or add (negative) to reach the bounds; 0 when within. */
  readonly deviation: number;
  readonly fitRounds: number;
  readonly subsections: number;
  readonly modelCalls: number;
  readonly citations: {
    readonly proposed: number;
    readonly verified: number;
    readonly discarded: readonly { readonly ref: string; readonly reason: string }[];
  };
  readonly references: number;
  readonly discardedBlocks: number;
  /** Notes the administrator should read (a tool the role lacks, a section left short, …). */
  readonly notes: readonly string[];
  /**
   * Where the text breaks the brand terminology of the project's business (ADR-0021), found by
   * code; absent when the project has no business or the report is older than that.
   */
  readonly termIssues?:
    | readonly {
        readonly kind: 'USE' | 'AVOID';
        readonly term: string;
        readonly found: string;
        readonly count: number;
      }[]
    | undefined;
}
