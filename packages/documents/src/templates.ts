import type { Block, StructuredDocument } from './model.js';
import type { SolutionScore } from './scoring.js';

/**
 * Document templates (docs/04-architecture/05-document-pipeline.md, ADR-0018): which sections
 * the first draft of a solution document has, in which order. They are code-owned and
 * versioned; the `document.default_template` setting picks one per workspace, topic or
 * project. A template only shapes the skeleton: the text of every section comes from the
 * solution (and the project's problem), never from the template.
 */
export const TEMPLATE_KEYS = ['brief', 'standard', 'detailed'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type SectionSource =
  'problem' | 'summary' | 'assumptions' | 'evidence' | 'plan' | 'risks' | 'scores';

export interface TemplateSection {
  readonly key: string;
  readonly source: SectionSource;
  readonly label: { readonly fa: string; readonly en: string };
}

export interface DocumentTemplate {
  readonly key: TemplateKey;
  /** Changes whenever the sections change; stored with the version of every document draft. */
  readonly version: string;
  readonly sections: readonly TemplateSection[];
}

const SECTIONS: Readonly<Record<SectionSource, TemplateSection>> = {
  problem: { key: 'problem', source: 'problem', label: { fa: 'مسئله', en: 'Problem' } },
  summary: { key: 'summary', source: 'summary', label: { fa: 'خلاصه', en: 'Summary' } },
  assumptions: {
    key: 'assumptions',
    source: 'assumptions',
    label: { fa: 'فرض‌ها', en: 'Assumptions' },
  },
  evidence: { key: 'evidence', source: 'evidence', label: { fa: 'شواهد', en: 'Evidence' } },
  plan: { key: 'plan', source: 'plan', label: { fa: 'برنامهٔ اجرا', en: 'Implementation plan' } },
  risks: { key: 'risks', source: 'risks', label: { fa: 'ریسک‌ها', en: 'Risks' } },
  scores: {
    key: 'scores',
    source: 'scores',
    label: { fa: 'امتیازدهی', en: 'Scoring' },
  },
};

const pick = (...sources: SectionSource[]): TemplateSection[] =>
  sources.map((source) => SECTIONS[source]);

export const DOCUMENT_TEMPLATES: Readonly<Record<TemplateKey, DocumentTemplate>> = {
  // The decision in one page: what, how and what can go wrong.
  brief: { key: 'brief', version: 'brief-v1', sections: pick('summary', 'plan', 'risks') },
  // The five required parts of every solution (FR-SOL-002): the default.
  standard: {
    key: 'standard',
    version: 'standard-v1',
    sections: pick('summary', 'assumptions', 'evidence', 'plan', 'risks'),
  },
  // Adds the problem it answers and how the solution scored on the project's criteria.
  detailed: {
    key: 'detailed',
    version: 'detailed-v1',
    sections: pick('problem', 'summary', 'assumptions', 'evidence', 'plan', 'risks', 'scores'),
  },
};

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === 'string' && (TEMPLATE_KEYS as readonly string[]).includes(value);
}

/** The template for a setting value; an unknown value falls back to the standard one. */
export function templateFor(value: unknown): DocumentTemplate {
  return DOCUMENT_TEMPLATES[isTemplateKey(value) ? value : 'standard'];
}

export interface TemplateInput {
  readonly title: string;
  readonly summary: string;
  readonly assumptions: readonly string[];
  readonly evidence: readonly string[];
  readonly plan: readonly string[];
  readonly risks: readonly string[];
  /** The project's problem statement (`problem` section). */
  readonly problem: string;
  /** The weighted score of the solution (`scores` section); `null` leaves the section out. */
  readonly score: SolutionScore | null;
}

const TABLE_LABELS = {
  fa: {
    caption: 'امتیاز راه‌حل به‌ازای هر معیار',
    columns: ['معیار', 'امتیاز', 'وزن', 'سهم'] as const,
  },
  en: {
    caption: 'Score of the solution on each criterion',
    columns: ['Criterion', 'Score', 'Weight', 'Contribution'] as const,
  },
} as const;

function sectionBlocks(
  section: TemplateSection,
  input: TemplateInput,
  language: 'fa' | 'en',
): Block[] {
  const heading: Block = {
    type: 'heading',
    id: section.key,
    level: 1,
    text: section.label[language],
  };
  const list = (items: readonly string[], ordered: boolean): Block => ({
    type: 'list',
    id: `${section.key}-list`,
    ordered,
    items: [...items],
  });
  switch (section.source) {
    case 'problem':
      return [
        heading,
        { type: 'paragraph', id: `${section.key}-text`, runs: [{ text: input.problem }] },
      ];
    case 'summary':
      return [
        heading,
        { type: 'paragraph', id: `${section.key}-text`, runs: [{ text: input.summary }] },
      ];
    case 'assumptions':
      return [heading, list(input.assumptions, false)];
    case 'evidence':
      return [heading, list(input.evidence, false)];
    case 'plan':
      return [heading, list(input.plan, true)];
    case 'risks':
      return [heading, list(input.risks, false)];
    case 'scores': {
      if (!input.score) return [];
      const labels = TABLE_LABELS[language];
      return [
        heading,
        {
          type: 'table',
          id: `${section.key}-table`,
          caption: labels.caption,
          columns: [...labels.columns],
          rows: input.score.criteria.map((criterion) => [
            criterion.label,
            `${criterion.raw}/${criterion.max}`,
            String(criterion.weight),
            String(criterion.weighted),
          ]),
          notes: `${input.score.formula} = ${input.score.total}`,
        },
      ];
    }
  }
}

/** Deterministic first draft of a solution document laid out by a template. */
export function buildDocument(
  template: DocumentTemplate,
  input: TemplateInput,
  language: 'fa' | 'en',
): StructuredDocument {
  return {
    title: input.title,
    language,
    blocks: template.sections.flatMap((section) => sectionBlocks(section, input, language)),
  };
}
