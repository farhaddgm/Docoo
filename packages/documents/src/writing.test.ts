import { describe, expect, it } from 'vitest';

import { DEFAULT_LEVEL_BOUNDS, countDocument } from './count.js';
import { scoreChartBlock, scoreTableBlock, DOCUMENT_TEMPLATES } from './templates.js';
import { scoreSolution, DEFAULT_CRITERIA } from './scoring.js';
import {
  OUTLINE_SCHEMA,
  SECTION_SCHEMA,
  SUBSECTION_TARGET_LETTERS,
  applyOutline,
  assembleDocument,
  countBlocks,
  draftToBlocks,
  fitAdjustments,
  fitStatus,
  planWriting,
  subsectionVerdict,
  type DraftBlock,
  type WritingPlan,
} from './writing.js';

const base = (kind: string, patch: Partial<DraftBlock> = {}): DraftBlock => ({
  kind,
  text: '',
  ordered: false,
  items: [],
  caption: '',
  columns: [],
  rows: [],
  tone: 'info',
  citations: [],
  ...patch,
});

const plan = (level: 1 | 2 | 3 | 4 | 5, template: keyof typeof DOCUMENT_TEMPLATES = 'standard') =>
  planWriting({
    template: DOCUMENT_TEMPLATES[template],
    language: 'en',
    level,
    bounds: DEFAULT_LEVEL_BOUNDS[level],
    fixedLetters: 200,
  });

const subs = (value: WritingPlan) => value.sections.flatMap((section) => section.subsections);

describe('planWriting', () => {
  it('aims at the middle of the bounds and shares the writable letters over the sections', () => {
    const result = plan(3);
    expect(result.targetTotal).toBe(10000);
    const total = subs(result).reduce((sum, item) => sum + item.budget.target, 0);
    expect(Math.abs(total + 200 - 10000)).toBeLessThanOrEqual(subs(result).length);
    const weights = Object.fromEntries(
      result.sections.map((section) => [
        section.source,
        section.subsections.reduce((sum, item) => sum + item.budget.target, 0),
      ]),
    );
    // The plan and the evidence get more than the summary (SECTION_WEIGHTS).
    expect(weights['plan']).toBeGreaterThan(weights['summary']!);
    expect(weights['evidence']).toBeGreaterThan(weights['summary']!);
  });

  it('keeps short documents in one subsection per section and long ones in several', () => {
    expect(plan(1, 'brief').sections.every((section) => section.subsections.length === 1)).toBe(
      true,
    );
    const long = plan(5);
    expect(long.sections.some((section) => section.subsections.length > 1)).toBe(true);
    for (const section of long.sections) {
      expect(section.subsections.length).toBeLessThanOrEqual(6);
      for (const item of section.subsections)
        expect(item.budget.target).toBeLessThanOrEqual(SUBSECTION_TARGET_LETTERS * 1.6);
    }
  });

  it('gives every subsection a budget with room on both sides', () => {
    for (const item of subs(plan(4))) {
      expect(item.budget.min).toBeLessThan(item.budget.target);
      expect(item.budget.max).toBeGreaterThan(item.budget.target);
    }
  });

  it('numbers subsections by section so ids stay stable', () => {
    const ids = subs(plan(5)).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('summary-1');
  });
});

describe('applyOutline', () => {
  const long = plan(5);
  const section = long.sections.find((item) => item.subsections.length >= 3)!;

  it('uses the headings the model chose and keeps the budget of the section', () => {
    const before = section.subsections.reduce((sum, item) => sum + item.budget.target, 0);
    const result = applyOutline(long, {
      sections: [
        {
          key: section.key,
          subsections: [
            { heading: '  First   part ', focus: 'a' },
            { heading: 'Second part', focus: 'b' },
            { heading: 'Third part', focus: 'c' },
          ],
        },
      ],
    });
    const changed = result.sections.find((item) => item.key === section.key)!;
    expect(changed.subsections.map((item) => item.heading)).toEqual([
      'First part',
      'Second part',
      'Third part',
    ]);
    const after = changed.subsections.reduce((sum, item) => sum + item.budget.target, 0);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(changed.subsections.length);
  });

  it('cuts extra subsections and merges budgets into fewer ones', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ heading: `H${index}`, focus: 'x' }));
    const result = applyOutline(long, { sections: [{ key: section.key, subsections: many }] });
    expect(result.sections.find((item) => item.key === section.key)!.subsections).toHaveLength(
      section.subsections.length,
    );
    const few = applyOutline(long, {
      sections: [{ key: section.key, subsections: [{ heading: 'Only', focus: 'x' }] }],
    });
    const only = few.sections.find((item) => item.key === section.key)!;
    expect(only.subsections).toHaveLength(1);
    expect(only.subsections[0]!.heading).toBeNull();
    expect(only.subsections[0]!.budget.target).toBeGreaterThan(
      section.subsections[0]!.budget.target,
    );
  });

  it('leaves the plan as it is for an unusable answer', () => {
    for (const answer of [null, 'text', { sections: 'x' }, { sections: [null, { key: 1 }] }]) {
      const result = applyOutline(long, answer);
      expect(result.sections.map((item) => item.subsections.length)).toEqual(
        long.sections.map(() => 1),
      );
    }
  });
});

describe('draftToBlocks', () => {
  const options = {
    idPrefix: 'plan-1',
    fallbackCaption: 'Table',
    tablesAllowed: true,
    resolve: (citation: { ref: string; quote: string }) => (citation.ref === 'K1' ? 'B1' : null),
  };

  it('keeps a verified citation and drops one the knowledge does not back', () => {
    const { blocks } = draftToBlocks(
      {
        blocks: [
          base('paragraph', {
            text: 'Claim.',
            citations: [
              { ref: 'K1', quote: 'real quote' },
              { ref: 'K9', quote: 'made up' },
            ],
          }),
        ],
      },
      options,
    );
    expect(blocks).toEqual([
      { type: 'paragraph', id: 'plan-1-b1', runs: [{ text: 'Claim.', citations: ['B1'] }] },
    ]);
  });

  it('does not cite twice for the same reference', () => {
    const { blocks } = draftToBlocks(
      {
        blocks: [
          base('paragraph', {
            text: 'A',
            citations: [
              { ref: 'K1', quote: 'one' },
              { ref: 'K1', quote: 'two' },
            ],
          }),
        ],
      },
      options,
    );
    expect(blocks[0]).toMatchObject({ runs: [{ citations: ['B1'] }] });
  });

  it('builds lists, tables, callouts and drops what it cannot use, with the reason', () => {
    const { blocks, discarded } = draftToBlocks(
      {
        blocks: [
          base('list', { ordered: true, items: [' a ', '', 'b'] }),
          base('table', { columns: ['x', 'y'], rows: [['1'], ['2', '3', '4'], ['', '']] }),
          base('callout', { text: 'Careful', tone: 'warning' }),
          base('callout', { text: 'Odd', tone: 'loud' }),
          base('paragraph', { text: '   ' }),
          base('chart'),
          base('table', { columns: [], rows: [] }),
          base('list', { items: [] }),
        ],
      },
      options,
    );
    expect(blocks.map((block) => block.type)).toEqual(['list', 'table', 'callout', 'callout']);
    expect(blocks[0]).toMatchObject({ ordered: true, items: ['a', 'b'] });
    expect(blocks[1]).toMatchObject({
      caption: 'Table',
      columns: ['x', 'y'],
      rows: [
        ['1', ''],
        ['2', '3'],
      ],
    });
    expect(blocks[3]).toMatchObject({ tone: 'info' });
    expect(discarded.map((item) => item.reason)).toEqual([
      'empty',
      'unknown_kind',
      'table_invalid',
      'empty',
    ]);
  });

  it('drops tables when the role may not produce them', () => {
    const { blocks, discarded } = draftToBlocks(
      { blocks: [base('table', { columns: ['x'], rows: [['1']] })] },
      { ...options, tablesAllowed: false },
    );
    expect(blocks).toEqual([]);
    expect(discarded).toEqual([{ index: 0, reason: 'table_not_allowed' }]);
  });

  it('caps the blocks of one subsection and survives a malformed answer', () => {
    const many = Array.from({ length: 60 }, () => base('paragraph', { text: 'x' }));
    const result = draftToBlocks({ blocks: many }, options);
    expect(result.blocks).toHaveLength(40);
    expect(result.discarded.every((item) => item.reason === 'too_many_blocks')).toBe(true);
    expect(draftToBlocks(null, options).blocks).toEqual([]);
    expect(draftToBlocks({ blocks: 'x' }, options).blocks).toEqual([]);
  });
});

describe('subsection budgets', () => {
  const budget = { min: 700, target: 1000, max: 1300 };
  it('writes a subsection again only when it is far from its budget', () => {
    expect(subsectionVerdict(1000, budget)).toBe('ok');
    expect(subsectionVerdict(650, budget)).toBe('ok');
    expect(subsectionVerdict(599, budget)).toBe('short');
    expect(subsectionVerdict(1600, budget)).toBe('ok');
    expect(subsectionVerdict(1601, budget)).toBe('long');
  });
});

describe('assembleDocument', () => {
  const result = plan(2);

  it('lays out headings, built blocks, written blocks and the cited references', () => {
    const written = Object.fromEntries(
      subs(result).map((item) => [
        item.id,
        [
          {
            type: 'paragraph' as const,
            id: `${item.id}-p`,
            runs: [{ text: 'Text', citations: item.id === 'summary-1' ? ['B1'] : [] }],
          },
        ],
      ]),
    );
    const document = assembleDocument({
      title: 'Doc',
      language: 'en',
      plan: result,
      written,
      built: {},
      references: [{ id: 'B1', text: 'Source one' }],
    });
    expect(document.blocks[0]).toMatchObject({ type: 'heading', id: 'summary', level: 1 });
    expect(document.blocks.at(-1)).toMatchObject({ type: 'bibliography' });
    expect(countDocument(document).count).toBeGreaterThan(0);
  });

  it('leaves out an empty bibliography and rejects a citation without a reference', () => {
    const none = assembleDocument({
      title: 'Doc',
      language: 'en',
      plan: result,
      written: {},
      built: {},
      references: [],
    });
    expect(none.blocks.some((block) => block.type === 'bibliography')).toBe(false);
    expect(() =>
      assembleDocument({
        title: 'Doc',
        language: 'en',
        plan: result,
        written: {
          'summary-1': [{ type: 'paragraph', id: 'p', runs: [{ text: 'x', citations: ['B7'] }] }],
        },
        built: {},
        references: [],
      }),
    ).toThrow(/B7/u);
  });

  it('adds a level-2 heading only to sections that have several subsections', () => {
    const outlined = applyOutline(plan(5), {
      sections: plan(5).sections.map((section) => ({
        key: section.key,
        subsections: section.subsections.map((_, index) => ({
          heading: `${section.key} part ${index + 1}`,
          focus: 'f',
        })),
      })),
    });
    const document = assembleDocument({
      title: 'Doc',
      language: 'en',
      plan: outlined,
      written: {},
      built: {},
      references: [],
    });
    const level2 = document.blocks.filter((block) => block.type === 'heading' && block.level === 2);
    const multi = outlined.sections.filter((section) => section.subsections.length > 1);
    expect(level2.length).toBe(multi.reduce((sum, section) => sum + section.subsections.length, 0));
  });
});

describe('length fitting', () => {
  const result = plan(3);
  const letters = (value: number) =>
    Object.fromEntries(subs(result).map((item) => [item.id, value]));

  it('reports where a count falls against the bounds', () => {
    expect(fitStatus(8999, result.bounds)).toBe('short');
    expect(fitStatus(9000, result.bounds)).toBe('within');
    expect(fitStatus(11000, result.bounds)).toBe('within');
    expect(fitStatus(11001, result.bounds)).toBe('long');
  });

  it('changes nothing for a document inside the bounds', () => {
    expect(fitAdjustments({ plan: result, letters: letters(100), total: 10000 })).toEqual([]);
  });

  it('expands the subsections furthest below their budget and aims for the middle', () => {
    const written = letters(500);
    const adjustments = fitAdjustments({ plan: result, letters: written, total: 5000 });
    expect(adjustments.length).toBeGreaterThan(0);
    expect(adjustments.length).toBeLessThanOrEqual(4);
    for (const item of adjustments) {
      expect(item.action).toBe('expand');
      expect(item.targetLetters).toBeGreaterThan(item.currentLetters);
    }
    const gained = adjustments.reduce(
      (sum, item) => sum + item.targetLetters - item.currentLetters,
      0,
    );
    expect(gained).toBeGreaterThanOrEqual(5000 - 5);
    expect(gained).toBeLessThanOrEqual(5000 + 5);
  });

  it('condenses the subsections that overshot most but never below 40% of a budget', () => {
    const written = letters(5000);
    const adjustments = fitAdjustments({ plan: result, letters: written, total: 20000 });
    expect(adjustments.length).toBeGreaterThan(0);
    for (const item of adjustments) {
      const budget = subs(result).find((sub) => sub.id === item.subsectionId)!.budget;
      expect(item.action).toBe('condense');
      expect(item.targetLetters).toBeLessThan(item.currentLetters);
      expect(item.targetLetters).toBeGreaterThanOrEqual(Math.round(budget.target * 0.4));
    }
  });
});

describe('what the code builds itself', () => {
  const score = scoreSolution({ impact: 5, feasibility: 3 }, DEFAULT_CRITERIA);

  it('draws the chart from the same numbers as the score table', () => {
    const chart = scoreChartBlock(score, 'en', 'chart');
    const table = scoreTableBlock(score, 'en', 'table');
    expect(chart.labels).toEqual(score.criteria.map((criterion) => criterion.label));
    expect(chart.values).toEqual(score.criteria.map((criterion) => criterion.weighted));
    expect(table.rows.map((row) => row[0])).toEqual(chart.labels);
    expect(chart.source).toBe(score.formula);
    expect(countBlocks([chart, table], 'en')).toBeGreaterThan(0);
  });
});

describe('schemas', () => {
  /** The strictest providers need closed objects with every property required. */
  const problems = (schema: unknown, path = '$'): string[] => {
    if (!schema || typeof schema !== 'object') return [];
    const node = schema as Record<string, unknown>;
    const found: string[] = [];
    if (node['type'] === 'object') {
      const properties = Object.keys((node['properties'] as object) ?? {});
      const required = (node['required'] as string[] | undefined) ?? [];
      if (node['additionalProperties'] !== false) found.push(`${path}: not closed`);
      if (properties.some((key) => !required.includes(key)))
        found.push(`${path}: optional property`);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties')
        for (const [name, child] of Object.entries(value as object))
          found.push(...problems(child, `${path}.${name}`));
      else if (key === 'items') found.push(...problems(value, `${path}[]`));
    }
    return found;
  };

  it('are closed with every property required', () => {
    expect(problems(OUTLINE_SCHEMA)).toEqual([]);
    expect(problems(SECTION_SCHEMA)).toEqual([]);
  });
});
