import {
  countBlocks,
  DEFAULT_LEVEL_BOUNDS,
  DOCUMENT_TEMPLATES,
  draftToBlocks,
  OUTLINE_SCHEMA_NAME,
  planWriting,
  SECTION_SCHEMA_NAME,
  type Block,
} from '@docoo/documents';
import { defaultDefinition } from '@docoo/domain';
import type { NormalizedModelRequest } from '@docoo/providers';
import { describe, expect, it } from 'vitest';

import { fakeDocumenterResponder } from './fake-responders.js';
import type { KnowledgePassage } from './research.js';
import {
  buildWritingQueries,
  CitationRegistry,
  citedReferences,
  houseStyle,
  outlinePrompt,
  resolveWritingSettings,
  sectionPrompt,
  type WritingMaterial,
  writingSettingsFromRow,
} from './writing.js';

const passage = (ref: string, versionId: string, text: string): KnowledgePassage => ({
  ref,
  chunkId: `chunk-${ref}`,
  knowledgeId: `k-${ref}`,
  versionId,
  versionNo: 2,
  title: `Knowledge ${ref}`,
  confidentiality: 'internal',
  text,
  approval: 'audit',
  auditScore: 90,
  snapshotId: 's1',
  conflicts: [],
});

const knowledge = [
  passage('K1', 'v1', 'Churn fell by a fifth after onboarding calls were introduced in the pilot.'),
  passage('K2', 'v2', 'Customers who receive a reminder within a week come back more often.'),
];

const material = (overrides: Partial<WritingMaterial> = {}): WritingMaterial => ({
  project: 'Churn programme',
  language: 'en',
  problem: { problemStatement: 'Reduce repeat-customer churn.', objectives: ['Cut churn by 20%'] },
  solution: {
    title: 'Onboarding calls',
    summary: 'Call every new customer in their first week.',
    plan: ['Hire two agents', 'Script the call'],
    assumptions: ['Customers answer'],
    evidence: ['Pilot results'],
    risks: ['Agents quit'],
  },
  research: [{ claim: 'Calls help', support: 'knowledge' }],
  stageOutline: [],
  notes: null,
  knowledge,
  ...overrides,
});

const plan = (level: 1 | 2 | 3 | 4 | 5 = 3) =>
  planWriting({
    template: DOCUMENT_TEMPLATES.standard,
    language: 'en',
    level,
    bounds: DEFAULT_LEVEL_BOUNDS[level],
    fixedLetters: 300,
  });

const definition = defaultDefinition('documenter');

interface PromptData {
  budget: { targetLetters: number };
  approvedKnowledge: { ref: string }[];
  solution: { title: string };
  part: { section: string };
  alreadyWritten: { opening: string }[];
  notesFromTheAdministrator: string;
  existing: unknown[];
  sections: { key: string; subsectionCount: number }[];
}

const parse = (message: string): PromptData =>
  JSON.parse(/<data>([\s\S]*)<\/data>/u.exec(message)![1]!) as PromptData;

describe('house style', () => {
  it('ignores the default outline task and passes on a changed one', () => {
    expect(houseStyle(definition)).toBeNull();
    expect(
      houseStyle({ ...definition, promptTemplate: 'Write formally, in short sentences.' }),
    ).toBe('Write formally, in short sentences.');
  });
});

describe('prompts', () => {
  const written = plan(3);
  const section = written.sections[0]!;
  const subsection = section.subsections[0]!;

  it('keeps instructions and data apart and states the budget in letters', () => {
    const prompt = sectionPrompt({
      definition,
      material: material(),
      plan: written,
      section,
      subsection,
      call: 'section',
      written: {},
      tablesAllowed: true,
    });
    expect(prompt.instructions).toContain('letters and digits only');
    expect(prompt.instructions).toContain('Your role: documenter');
    expect(prompt.instructions).not.toContain('Tables and charts are not allowed');
    const data = parse(prompt.message);
    expect(data.budget.targetLetters).toBe(subsection.budget.target);
    expect(data.approvedKnowledge.map((item) => item.ref)).toEqual(['K1', 'K2']);
    expect(data.solution.title).toBe('Onboarding calls');
    expect(data.part.section).toBe(section.label);
  });

  it('says so when tables are not allowed and leaves out knowledge it does not have', () => {
    const prompt = sectionPrompt({
      definition,
      material: material({ knowledge: [] }),
      plan: written,
      section,
      subsection,
      call: 'section',
      written: {},
      tablesAllowed: false,
    });
    expect(prompt.instructions).toContain('Tables and charts are not allowed');
    expect(prompt.message).not.toContain('approvedKnowledge');
  });

  it('shows what is already written by its opening only, and the administrator notes as data', () => {
    const earlier = written.sections[1]!.subsections[0]!;
    const blocks: Block[] = [
      { type: 'paragraph', id: 'p', runs: [{ text: 'An opening sentence. '.repeat(30) }] },
    ];
    const prompt = sectionPrompt({
      definition,
      material: material({ notes: 'Mention the pilot.' }),
      plan: written,
      section,
      subsection,
      call: 'section',
      written: { [earlier.id]: blocks },
      tablesAllowed: true,
    });
    const data = parse(prompt.message);
    expect(data.alreadyWritten).toHaveLength(1);
    expect(data.alreadyWritten[0]!.opening.length).toBeLessThanOrEqual(161);
    expect(data.notesFromTheAdministrator).toBe('Mention the pilot.');
    expect(prompt.instructions).not.toContain('Mention the pilot');
  });

  it('asks an expand call for the whole subsection again with the length it must reach', () => {
    const prompt = sectionPrompt({
      definition,
      material: material(),
      plan: written,
      section,
      subsection,
      call: 'expand',
      written: {},
      tablesAllowed: true,
      existing: [{ type: 'paragraph', id: 'p', runs: [{ text: 'Short.' }] }],
      targetLetters: 2000,
    });
    expect(prompt.instructions).toContain('return the whole subsection again, longer');
    const data = parse(prompt.message);
    expect(data.existing).toEqual([{ kind: 'paragraph', text: 'Short.' }]);
    expect(data.budget.targetLetters).toBe(2000);
  });

  it('plans the outline with the number of subsections the code wants', () => {
    const prompt = outlinePrompt({
      definition,
      material: material(),
      plan: plan(5),
      tablesAllowed: true,
    });
    const data = parse(prompt.message);
    expect(data.sections.map((item) => item.key)).toContain('plan');
    expect(data.sections.every((item) => item.subsectionCount >= 1)).toBe(true);
  });
});

describe('queries', () => {
  it('starts from the solution, then the problem and its objectives, without duplicates', () => {
    const queries = buildWritingQueries({
      solution: {
        title: 'Onboarding calls',
        summary: 'Call new customers.',
        plan: ['Hire agents', 'Hire agents'],
      },
      problem: {
        problemStatement: 'Reduce churn.',
        objectives: ['Cut churn by 20%', 'Cut churn by 20%'],
      },
    });
    expect(queries[0]).toBe('Onboarding calls. Call new customers.');
    expect(queries).toContain('Reduce churn.');
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries.length).toBeLessThanOrEqual(4);
  });
});

describe('CitationRegistry', () => {
  it('verifies a quote against its passage and reuses one reference per knowledge version', () => {
    const registry = new CitationRegistry(knowledge, true);
    const quote = 'Churn fell by a fifth after onboarding calls';
    expect(registry.resolve({ ref: 'K1', quote })).toBe('B1');
    expect(
      registry.resolve({ ref: 'k1', quote: 'onboarding calls were introduced in the pilot' }),
    ).toBe('B1');
    expect(registry.resolve({ ref: 'K2', quote: 'reminder within a week come back' })).toBe('B2');
    expect(registry.state().stats).toMatchObject({ proposed: 3, verified: 3, discarded: [] });
  });

  it('discards what the knowledge does not back, with the reason', () => {
    const registry = new CitationRegistry(knowledge, true);
    expect(registry.resolve({ ref: 'K9', quote: 'anything at all here' })).toBeNull();
    expect(registry.resolve({ ref: 'K1', quote: '' })).toBeNull();
    expect(registry.resolve({ ref: 'K1', quote: 'fell' })).toBeNull();
    expect(registry.resolve({ ref: 'K1', quote: 'Churn doubled after the pilot' })).toBeNull();
    expect(registry.state().stats.discarded.map((item) => item.reason)).toEqual([
      'unknown_ref',
      'quote_missing',
      'quote_too_short',
      'quote_not_found',
    ]);
    expect(registry.state().references).toEqual([]);
  });

  it('verifies nothing when the role may not use the verifier', () => {
    const registry = new CitationRegistry(knowledge, false);
    expect(
      registry.resolve({ ref: 'K1', quote: 'Churn fell by a fifth after onboarding' }),
    ).toBeNull();
    expect(registry.state().stats.discarded).toEqual([
      { ref: 'K1', reason: 'verifier_not_allowed' },
    ]);
  });

  it('carries its state from one call to the next', () => {
    const first = new CitationRegistry(knowledge, true);
    first.resolve({ ref: 'K2', quote: 'reminder within a week come back' });
    const second = new CitationRegistry(knowledge, true, first.state());
    expect(second.resolve({ ref: 'K1', quote: 'Churn fell by a fifth after onboarding' })).toBe(
      'B2',
    );
    expect(second.resolve({ ref: 'K2', quote: 'reminder within a week come back' })).toBe('B1');
  });

  it('lists only the references the final blocks still cite, in reading order', () => {
    const registry = new CitationRegistry(knowledge, true);
    registry.resolve({ ref: 'K1', quote: 'Churn fell by a fifth after onboarding' });
    registry.resolve({ ref: 'K2', quote: 'reminder within a week come back' });
    const blocks: Block[] = [
      { type: 'paragraph', id: 'a', runs: [{ text: 'x', citations: ['B2'] }] },
      { type: 'paragraph', id: 'b', runs: [{ text: 'y' }] },
    ];
    expect(citedReferences(blocks, registry.state().references, 'en')).toEqual([
      { id: 'B2', text: 'Knowledge K2 (approved knowledge, version 2)' },
    ]);
  });
});

describe('settings of a writing', () => {
  it('reads the effective values with bounds and defaults', () => {
    expect(
      resolveWritingSettings({
        'ai.connection_id': 'c',
        'ai.model': 'm',
        'document.writing.knowledge_limit': 99,
        'document.writing.fit_rounds': -2,
        'research.allow_restricted_knowledge': true,
      }),
    ).toMatchObject({
      connectionId: 'c',
      model: 'm',
      knowledgeLimit: 30,
      fitRounds: 0,
      allowRestricted: true,
    });
    expect(resolveWritingSettings({})).toMatchObject({
      knowledgeLimit: 12,
      fitRounds: 3,
      costLimitUsd: 20,
    });
  });

  it('survives a malformed stored value', () => {
    expect(writingSettingsFromRow(null)).toMatchObject({ knowledgeLimit: 12, fitRounds: 3 });
    expect(writingSettingsFromRow({ knowledgeLimit: 'x', costLimitUsd: -1 })).toMatchObject({
      knowledgeLimit: 12,
      costLimitUsd: 20,
    });
  });
});

describe('the fake documenter', () => {
  const request = (
    schema: string,
    data: unknown,
    language: 'fa' | 'en' = 'en',
    tables = true,
  ): NormalizedModelRequest => ({
    model: 'fake',
    instructions: `Write in ${language === 'fa' ? 'Persian' : 'English'}.${tables ? '' : ' Tables and charts are not allowed for this document.'}`,
    messages: [{ role: 'user', content: `<data>${JSON.stringify(data)}</data>` }],
    responseSchema: { name: schema, schema: {} },
  });

  it('answers only its own schemas', () => {
    expect(fakeDocumenterResponder(request('research_output', {}))).toBeNull();
  });

  it('gives each section the number of subsections it was asked for', () => {
    const answer = fakeDocumenterResponder(
      request(OUTLINE_SCHEMA_NAME, {
        sections: [
          { key: 'plan', label: 'Plan', subsectionCount: 3 },
          { key: 'risks', label: 'Risks', subsectionCount: 1 },
        ],
      }),
    ) as { sections: { key: string; subsections: unknown[] }[] };
    expect(answer.sections.map((item) => [item.key, item.subsections.length])).toEqual([
      ['plan', 3],
      ['risks', 1],
    ]);
  });

  for (const language of ['en', 'fa'] as const) {
    it(`writes a subsection close to its target in ${language}, with a verbatim citation`, () => {
      for (const target of [300, 1200, 2500, 4000]) {
        const answer = fakeDocumenterResponder(
          request(
            SECTION_SCHEMA_NAME,
            {
              call: 'section',
              part: { section: 'Plan', covers: 'plan', heading: 'Delivery', focus: 'f' },
              budget: { targetLetters: target, minLetters: target * 0.7, maxLetters: target * 1.3 },
              solution: { title: 'Onboarding calls', summary: 'Call.', plan: ['Hire agents'] },
              approvedKnowledge: [{ ref: 'K1', title: 'T', text: knowledge[0]!.text }],
            },
            language,
          ),
        );
        const registry = new CitationRegistry(knowledge, true);
        const { blocks, discarded } = draftToBlocks(answer, {
          idPrefix: 'x',
          fallbackCaption: 'c',
          tablesAllowed: true,
          resolve: (citation) => registry.resolve(citation),
        });
        expect(discarded).toEqual([]);
        const letters = countBlocks(blocks, language);
        expect(letters).toBeGreaterThan(target * 0.6);
        expect(letters).toBeLessThan(target * 1.4);
        expect(registry.state().references).toHaveLength(1);
      }
    });
  }

  it('leaves out tables when the instructions do not allow them, and shrinks on condense', () => {
    const data = {
      call: 'section',
      part: { section: 'Plan', covers: 'plan', heading: 'Delivery', focus: 'f' },
      budget: { targetLetters: 2000 },
      solution: { title: 'S', summary: 'x', plan: ['Hire agents'] },
    };
    const withTables = fakeDocumenterResponder(request(SECTION_SCHEMA_NAME, data)) as {
      blocks: { kind: string }[];
    };
    const without = fakeDocumenterResponder(request(SECTION_SCHEMA_NAME, data, 'en', false)) as {
      blocks: { kind: string }[];
    };
    expect(withTables.blocks.some((item) => item.kind === 'table')).toBe(true);
    expect(without.blocks.some((item) => item.kind === 'table')).toBe(false);
    const shorter = fakeDocumenterResponder(
      request(SECTION_SCHEMA_NAME, { ...data, call: 'condense', budget: { targetLetters: 500 } }),
    ) as { blocks: unknown[] };
    expect(shorter.blocks.length).toBeLessThan(without.blocks.length);
  });
});
