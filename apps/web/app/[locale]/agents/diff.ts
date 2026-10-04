export type DiffKind = 'same' | 'added' | 'removed';

export interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
}

/**
 * Line diff by longest common subsequence: what the new version removes and adds. The lists are
 * short (at most a few dozen rules), so the quadratic table is fine.
 */
export function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] =
        before[i] === after[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      lines.push({ kind: 'same', text: before[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: 'removed', text: before[i]! });
      i += 1;
    } else {
      lines.push({ kind: 'added', text: after[j]! });
      j += 1;
    }
  }
  for (; i < n; i += 1) lines.push({ kind: 'removed', text: before[i]! });
  for (; j < m; j += 1) lines.push({ kind: 'added', text: after[j]! });
  return lines;
}

/** The same for a block of text, line by line. */
export function diffText(before: string, after: string): DiffLine[] {
  return diffLines(before.split('\n'), after.split('\n'));
}

export const hasChanges = (lines: readonly DiffLine[]) =>
  lines.some((line) => line.kind !== 'same');
