import type { DocBlock, DocContent, DocRun } from './document-content';

/**
 * Pure helpers of the structured document editor (UX §10, ADR-0019). The editor changes blocks
 * only through these functions, so every edit is a new array and the rules (unique ids, table
 * shape, citations that point at a reference) can be tested without a browser. The server
 * validates again when the document is saved; nothing here is a security boundary.
 */

export type BlockType = DocBlock['type'];

/** A copy of the object without one key (an optional field that is switched off). */
export function omitKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<T, K>;
}

/** The blocks an editor can add; a bibliography exists at most once and is added on its own. */
export const INSERTABLE_TYPES: readonly BlockType[] = [
  'paragraph',
  'heading',
  'list',
  'table',
  'callout',
  'chart',
  'pageBreak',
  'appendix',
];

export const MAX_APPENDIX_DEPTH = 2;

/** Every id used in the blocks, including those inside appendices. */
export function collectIds(blocks: readonly DocBlock[]): Set<string> {
  const ids = new Set<string>();
  const visit = (list: readonly DocBlock[]): void => {
    for (const block of list) {
      ids.add(block.id);
      if (block.type === 'appendix') visit(block.blocks);
    }
  };
  visit(blocks);
  return ids;
}

/** A block id that is not in use, in the form `<type>-<n>`. */
export function freshId(blocks: readonly DocBlock[], type: BlockType): string {
  const used = collectIds(blocks);
  for (let n = 1; n < 10_000; n += 1) {
    const id = `${type}-${n}`;
    if (!used.has(id)) return id;
  }
  return `${type}-${used.size + 1}`;
}

export interface NewBlockOptions {
  readonly placeholder: {
    readonly heading: string;
    readonly caption: string;
    readonly column: string;
    readonly label: string;
    readonly source: string;
    readonly alt: string;
  };
}

/** A block of the type with minimal valid content (the server rejects empty tables and charts). */
export function newBlock(
  type: BlockType,
  all: readonly DocBlock[],
  options: NewBlockOptions,
): DocBlock {
  const id = freshId(all, type);
  const text = options.placeholder;
  switch (type) {
    case 'heading':
      return { type, id, level: 2, text: text.heading };
    case 'paragraph':
      return { type, id, runs: [{ text: '' }] };
    case 'list':
      return { type, id, ordered: false, items: [''] };
    case 'table':
      return {
        type,
        id,
        caption: text.caption,
        columns: [`${text.column} 1`, `${text.column} 2`],
        rows: [['', '']],
      };
    case 'callout':
      return { type, id, tone: 'info', text: '' };
    case 'chart':
      return {
        type,
        id,
        kind: 'bar',
        title: text.caption,
        unit: '',
        source: text.source,
        alt: text.alt,
        labels: [text.label],
        values: [0],
      };
    case 'pageBreak':
      return { type, id };
    case 'appendix':
      return { type, id, title: text.heading, blocks: [] };
    case 'figure':
      return { type, id, assetRef: '', caption: text.caption, alt: text.alt };
    case 'bibliography':
      return { type, id, entries: [] };
  }
}

export function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
  const at = Math.max(0, Math.min(list.length, index));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, position) => position !== index);
}

/** Moves the item by `delta` places (−1 up, +1 down); at an end the list is returned unchanged. */
export function moveAt<T>(list: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item as T);
  return copy;
}

export function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  return list.map((existing, position) => (position === index ? item : existing));
}

// ---------------------------------------------------------------- tables

type Table = Extract<DocBlock, { type: 'table' }>;

export function addRow(table: Table): Table {
  return { ...table, rows: [...table.rows, table.columns.map(() => '')] };
}

export function removeRow(table: Table, index: number): Table {
  // A table keeps one row: the server rejects an empty one.
  return table.rows.length <= 1 ? table : { ...table, rows: removeAt(table.rows, index) };
}

export function addColumn(table: Table, name: string): Table {
  return {
    ...table,
    columns: [...table.columns, name],
    rows: table.rows.map((row) => [...row, '']),
  };
}

export function removeColumn(table: Table, index: number): Table {
  if (table.columns.length <= 1) return table;
  return {
    ...table,
    columns: removeAt(table.columns, index),
    rows: table.rows.map((row) => removeAt(row, index)),
  };
}

export function setCell(table: Table, row: number, column: number, value: string): Table {
  return {
    ...table,
    rows: table.rows.map((cells, position) =>
      position === row ? replaceAt(cells, column, value) : cells,
    ),
  };
}

// ---------------------------------------------------------------- charts

type Chart = Extract<DocBlock, { type: 'chart' }>;

export function addPoint(chart: Chart, label: string): Chart {
  return { ...chart, labels: [...chart.labels, label], values: [...chart.values, 0] };
}

export function removePoint(chart: Chart, index: number): Chart {
  if (chart.labels.length <= 1) return chart;
  return {
    ...chart,
    labels: removeAt(chart.labels, index),
    values: removeAt(chart.values, index),
  };
}

// ---------------------------------------------------------------- lists

export const itemsToText = (items: readonly string[]): string => items.join('\n');
export const textToItems = (value: string): string[] => value.split('\n');

// ---------------------------------------------------------------- references and citations

type Bibliography = Extract<DocBlock, { type: 'bibliography' }>;

export function findBibliography(blocks: readonly DocBlock[]): Bibliography | null {
  for (const block of blocks) {
    if (block.type === 'bibliography') return block;
    if (block.type === 'appendix') {
      const inner = findBibliography(block.blocks);
      if (inner) return inner;
    }
  }
  return null;
}

/** The next free reference id, `B1`, `B2`, … */
export function nextReferenceId(entries: readonly { id: string }[]): string {
  const used = new Set(entries.map((entry) => entry.id));
  for (let n = 1; n < 10_000; n += 1) if (!used.has(`B${n}`)) return `B${n}`;
  return `B${used.size + 1}`;
}

/** The reference ids the paragraphs cite, in reading order without repeats. */
export function citedIds(blocks: readonly DocBlock[]): string[] {
  const order: string[] = [];
  const visit = (list: readonly DocBlock[]): void => {
    for (const block of list) {
      if (block.type === 'paragraph')
        for (const run of block.runs)
          for (const id of run.citations ?? []) if (!order.includes(id)) order.push(id);
      if (block.type === 'appendix') visit(block.blocks);
    }
  };
  visit(blocks);
  return order;
}

/** Removes a citation id from every run; a deleted reference must not stay cited. */
export function stripCitation(blocks: readonly DocBlock[], id: string): DocBlock[] {
  return blocks.map((block): DocBlock => {
    if (block.type === 'paragraph') {
      return {
        ...block,
        runs: block.runs.map((run): DocRun => {
          if (!run.citations?.includes(id)) return run;
          const rest = run.citations.filter((item) => item !== id);
          const without = omitKey(run, 'citations');
          return rest.length > 0 ? { ...without, citations: rest } : without;
        }),
      };
    }
    if (block.type === 'appendix') return { ...block, blocks: stripCitation(block.blocks, id) };
    return block;
  });
}

/**
 * Removes the citations that point at no reference of the bibliography, so deleting a reference
 * (or the whole list) never leaves a run that cites nothing.
 */
export function dropDanglingCitations(blocks: readonly DocBlock[]): DocBlock[] {
  const known = new Set<string>();
  const collect = (list: readonly DocBlock[]): void => {
    for (const block of list) {
      if (block.type === 'bibliography') for (const entry of block.entries) known.add(entry.id);
      if (block.type === 'appendix') collect(block.blocks);
    }
  };
  collect(blocks);
  const prune = (list: readonly DocBlock[]): DocBlock[] =>
    list.map((block): DocBlock => {
      if (block.type === 'paragraph') {
        return {
          ...block,
          runs: block.runs.map((run): DocRun => {
            if (!run.citations) return run;
            const kept = run.citations.filter((id) => known.has(id));
            if (kept.length === run.citations.length) return run;
            const without = omitKey(run, 'citations');
            return kept.length > 0 ? { ...without, citations: kept } : without;
          }),
        };
      }
      return block.type === 'appendix' ? { ...block, blocks: prune(block.blocks) } : block;
    });
  return prune(blocks);
}

export function toggleCitation(run: DocRun, id: string, on: boolean): DocRun {
  const current = run.citations ?? [];
  const next = on
    ? current.includes(id)
      ? current
      : [...current, id]
    : current.filter((item) => item !== id);
  const without = omitKey(run, 'citations');
  return next.length > 0 ? { ...without, citations: next } : without;
}

// ---------------------------------------------------------------- outline and saving

export interface OutlineItem {
  readonly id: string;
  readonly level: 1 | 2 | 3;
  readonly text: string;
}

export function outlineOf(blocks: readonly DocBlock[]): OutlineItem[] {
  const items: OutlineItem[] = [];
  const visit = (list: readonly DocBlock[]): void => {
    for (const block of list) {
      if (block.type === 'heading')
        items.push({ id: block.id, level: block.level, text: block.text });
      if (block.type === 'appendix') visit(block.blocks);
    }
  };
  visit(blocks);
  return items;
}

/**
 * What is sent to the server: empty runs, list items and table rows that the writer left blank
 * are dropped so a half-finished line does not block saving; everything else is untouched.
 */
export function cleanForSave(content: DocContent): DocContent {
  const clean = (blocks: readonly DocBlock[]): DocBlock[] =>
    blocks.flatMap((block): DocBlock[] => {
      switch (block.type) {
        case 'paragraph': {
          const runs = block.runs.filter((run) => run.text.trim() !== '');
          return runs.length > 0 ? [{ ...block, runs }] : [];
        }
        case 'list': {
          const items = block.items.map((item) => item.trim()).filter(Boolean);
          return items.length > 0 ? [{ ...block, items }] : [];
        }
        case 'table': {
          const rows = block.rows.filter((row) => row.some((cell) => cell.trim() !== ''));
          return rows.length > 0 ? [{ ...block, rows }] : [];
        }
        case 'callout':
          return block.text.trim() === '' ? [] : [block];
        case 'appendix':
          return [{ ...block, blocks: clean(block.blocks) }];
        case 'bibliography':
          return block.entries.length > 0 ? [block] : [];
        default:
          return [block];
      }
    });
  return { ...content, blocks: clean(content.blocks) };
}

export const sameContent = (a: DocContent, b: DocContent): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
