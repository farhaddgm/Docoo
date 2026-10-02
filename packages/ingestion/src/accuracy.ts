import { normalizeForSearch, tokenize } from '@docoo/knowledge';

function levenshtein<T>(a: readonly T[], b: readonly T[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** 1 − CER over the search form (letters, digits and single spaces). */
export function characterAccuracy(actual: string, expected: string): number {
  const a = [...normalizeForSearch(actual)];
  const b = [...normalizeForSearch(expected)];
  if (b.length === 0) return a.length === 0 ? 1 : 0;
  return Math.max(0, 1 - levenshtein(a, b) / b.length);
}

/** 1 − WER over normalised word tokens. */
export function wordAccuracy(actual: string, expected: string): number {
  const a = tokenize(actual);
  const b = tokenize(expected);
  if (b.length === 0) return a.length === 0 ? 1 : 0;
  return Math.max(0, 1 - levenshtein(a, b) / b.length);
}
