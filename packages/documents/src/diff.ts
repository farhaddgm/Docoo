import { walkBlocks, type Block, type StructuredDocument } from './model.js';

export interface BlockChange {
  readonly id: string;
  readonly change: 'added' | 'removed' | 'changed' | 'moved';
  readonly type: Block['type'];
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface DocumentDiff {
  readonly titleChanged: boolean;
  readonly changes: BlockChange[];
  readonly summary: {
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
    readonly moved: number;
  };
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

/** Block-level diff by block id, including blocks inside appendices (DOC-102). */
export function diffDocuments(before: StructuredDocument, after: StructuredDocument): DocumentDiff {
  const left = [...walkBlocks(before.blocks)];
  const right = [...walkBlocks(after.blocks)];
  const leftById = new Map(left.map((block, index) => [block.id, { block, index }]));
  const rightById = new Map(right.map((block, index) => [block.id, { block, index }]));
  const changes: BlockChange[] = [];
  const shell = (block: Block): unknown =>
    block.type === 'appendix' ? { ...block, blocks: block.blocks.map((child) => child.id) } : block;
  for (const [id, { block, index }] of rightById) {
    const previous = leftById.get(id);
    if (!previous) changes.push({ id, change: 'added', type: block.type, after: shell(block) });
    else if (stable(shell(previous.block)) !== stable(shell(block))) {
      changes.push({
        id,
        change: 'changed',
        type: block.type,
        before: shell(previous.block),
        after: shell(block),
      });
    } else if (previous.index !== index) changes.push({ id, change: 'moved', type: block.type });
  }
  for (const [id, { block }] of leftById) {
    if (!rightById.has(id))
      changes.push({ id, change: 'removed', type: block.type, before: shell(block) });
  }
  const count = (kind: BlockChange['change']) =>
    changes.filter((change) => change.change === kind).length;
  return {
    titleChanged: before.title !== after.title,
    changes,
    summary: {
      added: count('added'),
      removed: count('removed'),
      changed: count('changed'),
      moved: count('moved'),
    },
  };
}
