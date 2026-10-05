import { walkBlocks, type Block, type StructuredDocument } from './model.js';

/** Official character count algorithm (05-document-pipeline §4). */
export const COUNT_ALGORITHM = 'unicode-letter-number-v1';

/**
 * The visible text of the document in reading order: titles, headings, runs, list items,
 * table cells and captions, visible alt/summary text and citation labels. Markup, URLs and
 * hidden metadata are not visible text.
 */
export function visibleText(document: StructuredDocument): string {
  const parts: string[] = [document.title];
  const citationNumbers = new Map<string, number>();
  for (const block of walkBlocks(document.blocks)) {
    if (block.type === 'bibliography')
      block.entries.forEach((entry, index) => citationNumbers.set(entry.id, index + 1));
  }
  const add = (block: Block): void => {
    switch (block.type) {
      case 'heading':
        parts.push(block.text);
        break;
      case 'paragraph':
        for (const run of block.runs) {
          parts.push(run.text);
          for (const id of run.citations ?? []) parts.push(`[${citationNumbers.get(id) ?? '?'}]`);
        }
        break;
      case 'list':
        parts.push(...block.items);
        break;
      case 'table':
        parts.push(block.caption, ...block.columns, ...block.rows.flat(), block.notes ?? '');
        break;
      case 'figure':
        parts.push(block.caption, block.alt);
        break;
      case 'chart':
        parts.push(
          block.title,
          block.alt,
          block.unit,
          block.source,
          ...block.labels,
          ...block.values.map(String),
        );
        break;
      case 'callout':
        parts.push(block.text);
        break;
      case 'appendix':
        parts.push(block.title);
        break;
      case 'bibliography':
        // The visible reference text counts; the URL itself is markup.
        parts.push(...block.entries.map((entry) => entry.text));
        break;
      case 'pageBreak':
        break;
    }
  };
  for (const block of walkBlocks(document.blocks)) add(block);
  return parts.filter(Boolean).join('\n');
}

/** Counts only code points of General Category L* or N* after NFC normalisation. */
export function countCharacters(text: string): number {
  let count = 0;
  for (const char of text.normalize('NFC')) if (/[\p{L}\p{N}]/u.test(char)) count += 1;
  return count;
}

export function countDocument(document: StructuredDocument): { count: number; algorithm: string } {
  return { count: countCharacters(visibleText(document)), algorithm: COUNT_ALGORITHM };
}

export type Level = 1 | 2 | 3 | 4 | 5;

export interface LevelBounds {
  readonly min: number;
  readonly max: number;
}

/** Default bounds per level (§5); the active bounds come from the versioned setting. */
export const DEFAULT_LEVEL_BOUNDS: Readonly<Record<Level, LevelBounds>> = {
  1: { min: 1000, max: 3000 },
  2: { min: 5000, max: 7000 },
  3: { min: 9000, max: 11000 },
  4: { min: 13000, max: 17000 },
  5: { min: 22000, max: 28000 },
};

/**
 * What is wrong with a `document.level_bounds` value (ten whole numbers: min and max of levels 1
 * to 5), or `null` when it is usable. Each level needs min below max, and a level starts above
 * the end of the one before so a document belongs to at most one level.
 */
export function levelBoundsProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 10)
    return 'Expected ten numbers: min and max of levels 1 to 5.';
  if (!value.every((item) => Number.isInteger(item) && (item as number) >= 0)) {
    return 'Every number must be a whole number of at least 0.';
  }
  const numbers = value as number[];
  for (let level = 1; level <= 5; level += 1) {
    const min = numbers[(level - 1) * 2]!;
    const max = numbers[(level - 1) * 2 + 1]!;
    if (min >= max) return `Level ${level}: the minimum must be below the maximum.`;
    if (level > 1 && min <= numbers[(level - 1) * 2 - 1]!) {
      return `Level ${level} must start above the end of level ${level - 1}.`;
    }
  }
  return null;
}

export interface Compliance {
  readonly level: Level;
  readonly count: number;
  readonly algorithm: string;
  readonly bounds: LevelBounds;
  readonly withinBounds: boolean;
  /** Characters to add (negative) or remove (positive) to reach the bounds. */
  readonly deviation: number;
}

export function checkCompliance(
  document: StructuredDocument,
  level: Level,
  bounds: Readonly<Record<Level, LevelBounds>> = DEFAULT_LEVEL_BOUNDS,
): Compliance {
  const { count, algorithm } = countDocument(document);
  const range = bounds[level];
  const deviation =
    count < range.min ? count - range.min : count > range.max ? count - range.max : 0;
  return { level, count, algorithm, bounds: range, withinBounds: deviation === 0, deviation };
}
