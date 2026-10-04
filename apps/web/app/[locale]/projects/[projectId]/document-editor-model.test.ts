import { describe, expect, it } from 'vitest';

import type { DocBlock, DocContent } from './document-content';
import {
  addColumn,
  addPoint,
  addRow,
  citedIds,
  cleanForSave,
  collectIds,
  dropDanglingCitations,
  freshId,
  insertAt,
  itemsToText,
  moveAt,
  newBlock,
  nextReferenceId,
  outlineOf,
  removeAt,
  removeColumn,
  removePoint,
  removeRow,
  sameContent,
  setCell,
  stripCitation,
  textToItems,
  toggleCitation,
  INSERTABLE_TYPES,
} from './document-editor-model';

const placeholder = {
  heading: 'Heading',
  caption: 'Caption',
  column: 'Column',
  label: 'Label',
  source: 'Source',
  alt: 'Alt',
};

const blocks: DocBlock[] = [
  { type: 'heading', id: 'h1', level: 1, text: 'Summary' },
  { type: 'paragraph', id: 'p1', runs: [{ text: 'A', citations: ['B1'] }, { text: 'B' }] },
  {
    type: 'appendix',
    id: 'a1',
    title: 'Appendix',
    blocks: [
      { type: 'heading', id: 'h2', level: 2, text: 'Inner' },
      { type: 'paragraph', id: 'p2', runs: [{ text: 'C', citations: ['B1', 'B2'] }] },
    ],
  },
  {
    type: 'bibliography',
    id: 'bib',
    entries: [
      { id: 'B1', text: 'One' },
      { id: 'B2', text: 'Two' },
    ],
  },
];

describe('ids', () => {
  it('collects the ids of nested blocks and picks one that is free', () => {
    expect([...collectIds(blocks)].sort()).toEqual(['a1', 'bib', 'h1', 'h2', 'p1', 'p2']);
    expect(freshId(blocks, 'paragraph')).toBe('paragraph-1');
    expect(freshId([{ type: 'pageBreak', id: 'pageBreak-1' }], 'pageBreak')).toBe('pageBreak-2');
  });

  it('gives every new block valid minimal content', () => {
    for (const type of [...INSERTABLE_TYPES, 'figure', 'bibliography'] as const) {
      const block = newBlock(type, blocks, { placeholder });
      expect(block.type).toBe(type);
      expect(collectIds(blocks).has(block.id)).toBe(false);
    }
    const table = newBlock('table', [], { placeholder });
    expect(table).toMatchObject({ columns: ['Column 1', 'Column 2'], rows: [['', '']] });
    const chart = newBlock('chart', [], { placeholder });
    expect(chart).toMatchObject({ labels: ['Label'], values: [0] });
  });
});

describe('moving, inserting and removing', () => {
  it('does not change a list at its ends and never mutates its input', () => {
    const list = ['a', 'b', 'c'];
    expect(moveAt(list, 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveAt(list, 2, 1)).toEqual(['a', 'b', 'c']);
    expect(moveAt(list, 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveAt(list, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(list).toEqual(['a', 'b', 'c']);
    expect(insertAt(list, 1, 'x')).toEqual(['a', 'x', 'b', 'c']);
    expect(insertAt(list, 99, 'x')).toEqual(['a', 'b', 'c', 'x']);
    expect(removeAt(list, 1)).toEqual(['a', 'c']);
  });
});

describe('tables', () => {
  const table = newBlock('table', [], { placeholder }) as Extract<DocBlock, { type: 'table' }>;

  it('keeps every row as wide as the columns', () => {
    const wider = addColumn(addRow(table), 'Third');
    expect(wider.columns).toHaveLength(3);
    expect(wider.rows.every((row) => row.length === 3)).toBe(true);
    const narrower = removeColumn(wider, 0);
    expect(narrower.columns).toEqual(['Column 2', 'Third']);
    expect(narrower.rows.every((row) => row.length === 2)).toBe(true);
  });

  it('keeps at least one row and one column', () => {
    expect(removeRow(table, 0).rows).toHaveLength(1);
    const one = removeColumn(removeColumn(table, 0), 0);
    expect(one.columns).toHaveLength(1);
    expect(removeRow(addRow(table), 0).rows).toHaveLength(1);
  });

  it('sets one cell', () => {
    const changed = setCell(addRow(table), 1, 0, 'x');
    expect(changed.rows).toEqual([
      ['', ''],
      ['x', ''],
    ]);
    expect(table.rows).toEqual([['', '']]);
  });
});

describe('charts', () => {
  const chart = newBlock('chart', [], { placeholder }) as Extract<DocBlock, { type: 'chart' }>;
  it('keeps labels and values in step and at least one point', () => {
    const grown = addPoint(chart, 'B');
    expect(grown.labels).toEqual(['Label', 'B']);
    expect(grown.values).toEqual([0, 0]);
    expect(removePoint(grown, 0)).toMatchObject({ labels: ['B'], values: [0] });
    expect(removePoint(chart, 0)).toBe(chart);
  });
});

describe('lists', () => {
  it('goes between items and text one per line, keeping blank lines while typing', () => {
    expect(itemsToText(['a', 'b'])).toBe('a\nb');
    expect(textToItems('a\n\nb')).toEqual(['a', '', 'b']);
  });
});

describe('references and citations', () => {
  it('numbers the next reference and lists the cited ones in reading order', () => {
    expect(nextReferenceId([])).toBe('B1');
    expect(nextReferenceId([{ id: 'B1' }, { id: 'B3' }])).toBe('B2');
    expect(citedIds(blocks)).toEqual(['B1', 'B2']);
  });

  it('removes a deleted reference from every run, including inside appendices', () => {
    const stripped = stripCitation(blocks, 'B1');
    expect(citedIds(stripped)).toEqual(['B2']);
    const first = stripped[1] as Extract<DocBlock, { type: 'paragraph' }>;
    expect(first.runs[0]).toEqual({ text: 'A' });
    expect(citedIds(blocks)).toEqual(['B1', 'B2']);
  });

  it('turns a citation of a run on and off without leaving an empty list', () => {
    const run = { text: 'A' };
    const on = toggleCitation(run, 'B1', true);
    expect(on.citations).toEqual(['B1']);
    expect(toggleCitation(on, 'B1', true).citations).toEqual(['B1']);
    expect(toggleCitation(on, 'B1', false)).toEqual({ text: 'A' });
  });
});

describe('dangling citations', () => {
  it('drops the citations of references that no longer exist', () => {
    const withoutB1: DocBlock[] = blocks.map((block) =>
      block.type === 'bibliography'
        ? { ...block, entries: block.entries.filter((entry) => entry.id !== 'B1') }
        : block,
    );
    expect(citedIds(dropDanglingCitations(withoutB1))).toEqual(['B2']);
    const withoutList = blocks.filter((block) => block.type !== 'bibliography');
    expect(citedIds(dropDanglingCitations(withoutList))).toEqual([]);
    expect(citedIds(dropDanglingCitations(blocks))).toEqual(['B1', 'B2']);
  });
});

describe('outline', () => {
  it('lists headings of the document and of its appendices', () => {
    expect(outlineOf(blocks)).toEqual([
      { id: 'h1', level: 1, text: 'Summary' },
      { id: 'h2', level: 2, text: 'Inner' },
    ]);
  });
});

describe('cleanForSave', () => {
  it('drops what the writer left blank and keeps the rest', () => {
    const content: DocContent = {
      title: 'T',
      language: 'en',
      blocks: [
        { type: 'paragraph', id: 'p', runs: [{ text: ' ' }, { text: 'kept' }] },
        { type: 'paragraph', id: 'q', runs: [{ text: '' }] },
        { type: 'list', id: 'l', ordered: false, items: [' a ', '', 'b'] },
        { type: 'list', id: 'l2', ordered: false, items: ['', ' '] },
        { type: 'table', id: 't', caption: 'c', columns: ['x'], rows: [[''], ['1']] },
        { type: 'table', id: 't2', caption: 'c', columns: ['x'], rows: [['']] },
        { type: 'callout', id: 'c', tone: 'info', text: '' },
        {
          type: 'appendix',
          id: 'a',
          title: 'A',
          blocks: [{ type: 'list', id: 'l3', ordered: true, items: [''] }],
        },
        { type: 'bibliography', id: 'b', entries: [] },
        { type: 'pageBreak', id: 'pb' },
      ],
    };
    const cleaned = cleanForSave(content);
    expect(cleaned.blocks.map((block) => block.id)).toEqual(['p', 'l', 't', 'a', 'pb']);
    expect(cleaned.blocks[0]).toMatchObject({ runs: [{ text: 'kept' }] });
    expect(cleaned.blocks[1]).toMatchObject({ items: ['a', 'b'] });
    expect(cleaned.blocks[2]).toMatchObject({ rows: [['1']] });
    expect(cleaned.blocks[3]).toMatchObject({ blocks: [] });
  });

  it('compares content by value', () => {
    const a: DocContent = { title: 'T', language: 'en', blocks: [] };
    expect(sameContent(a, { ...a })).toBe(true);
    expect(sameContent(a, { ...a, title: 'U' })).toBe(false);
  });
});
