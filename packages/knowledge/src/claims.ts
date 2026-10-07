import { normalizeForSearch } from './normalize.js';

export type ClaimKind = 'numeric' | 'causal' | 'comparative' | 'recommendation';

/** Where a piece of extracted text sits in its source (page, slide, sheet cell, line, time). */
export type SegmentLocator = Readonly<Record<string, string | number>>;

export interface TextSegment {
  readonly ordinal: number;
  readonly locator: SegmentLocator;
  readonly text: string;
}

export interface ClaimCandidate {
  readonly ordinal: number;
  readonly text: string;
  readonly normalizedText: string;
  readonly kind: ClaimKind;
  /** Segment locator plus the character range of the sentence inside the segment. */
  readonly locator: SegmentLocator & {
    readonly segment: number;
    readonly start: number;
    readonly end: number;
  };
}

const PATTERNS: readonly (readonly [ClaimKind, RegExp])[] = [
  [
    'recommendation',
    /\b(should|must|recommend(?:ed|s)?|ought to|need to)\b|باید|توصیه|پیشنهاد می|لازم است|ضروری است/iu,
  ],
  [
    'causal',
    /\b(because|therefore|due to|leads? to|results? in|caused?|so that)\b|زیرا|چون|به دلیل|بنابراین|در نتیجه|منجر به|باعث|موجب/iu,
  ],
  [
    'comparative',
    /\b(more|less|fewer|greater|higher|lower|better|worse)\b[^.]*\bthan\b|\b(compared (?:to|with)|versus|vs\.?)\b|بیشتر از|کمتر از|بهتر از|بدتر از|بالاتر از|پایین\u200Cتر از|در مقایسه با|نسبت به/iu,
  ],
  ['numeric', /[0-9۰-۹٠-٩]+(?:[.,/٫][0-9۰-۹٠-٩]+)?\s*(?:%|٪|درصد|percent)?/u],
];

const MIN_LENGTH = 12;
const MAX_LENGTH = 600;

/** Sentence ranges of a text, split on Latin and Persian terminators and line breaks. */
export function sentenceRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  // Scan each punctuation run once. A failing lookahead after a long run must not
  // retry at every character (the previous regex had quadratic backtracking).
  for (let index = 0; index < text.length;) {
    const char = text[index]!;
    if (char === '\n') {
      pushTrimmed(text, start, index, ranges);
      while (text[index] === '\n') index += 1;
      start = index;
    } else if ('.!?؟۔'.includes(char)) {
      do {
        index += 1;
      } while (index < text.length && '.!?؟۔'.includes(text[index]!));
      if (index === text.length || /\s/u.test(text[index]!)) {
        pushTrimmed(text, start, index, ranges);
        start = index;
      }
    } else {
      index += 1;
    }
  }
  pushTrimmed(text, start, text.length, ranges);
  return ranges;
}

function pushTrimmed(
  text: string,
  start: number,
  end: number,
  ranges: { start: number; end: number }[],
): void {
  while (start < end && /\s/u.test(text[start]!)) start += 1;
  while (end > start && /\s/u.test(text[end - 1]!)) end -= 1;
  if (end > start) ranges.push({ start, end });
}

export function classifyClaim(sentence: string): ClaimKind | null {
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(sentence)) return kind;
  }
  return null;
}

/**
 * Rule-based claim candidates (ING-008): decision-relevant sentences — numeric, causal,
 * comparative and recommendation — with the exact location in the source. Candidates are
 * never retrievable on their own; they enter Brain audit as part of a knowledge version.
 */
export function extractClaimCandidates(
  segments: readonly TextSegment[],
  limit = 200,
): ClaimCandidate[] {
  const candidates: ClaimCandidate[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    for (const range of sentenceRanges(segment.text)) {
      const sentence = segment.text.slice(range.start, range.end);
      if (sentence.length < MIN_LENGTH || sentence.length > MAX_LENGTH) continue;
      const kind = classifyClaim(sentence);
      if (!kind) continue;
      const normalizedText = normalizeForSearch(sentence);
      if (seen.has(normalizedText)) continue;
      seen.add(normalizedText);
      candidates.push({
        ordinal: candidates.length + 1,
        text: sentence,
        normalizedText,
        kind,
        locator: {
          ...segment.locator,
          segment: segment.ordinal,
          start: range.start,
          end: range.end,
        },
      });
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}
