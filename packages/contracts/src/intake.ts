import { z } from 'zod';

import { parsePersianNumberWords } from './money.js';

/**
 * Voice-first intake (NXT-008): a manager tells the problem in one to three minutes and the system
 * drafts the project from it. The transcript is the source of truth. Everything the draft claims to
 * have *heard* must point to words that are really in the transcript; a claim that does not is
 * dropped, and what the system worked out itself is labelled as inferred. Speech recognition of
 * numbers and names is the likeliest place for an error, so those are found by code (not by a model)
 * and highlighted for the manager to confirm.
 */

const quoted = z
  .object({ text: z.string().trim().min(1).max(600), quote: z.string().trim().min(1).max(600) })
  .strict();

/** What the model may return. */
export const intakeModelSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    problem: z.string().trim().min(1).max(4000),
    description: z.string().trim().max(2000),
    goal: quoted.nullable(),
    facts: z.array(quoted).max(20),
    constraints: z.array(quoted).max(15),
    names: z.array(quoted).max(20),
    assumptions: z.array(z.object({ text: z.string().trim().min(1).max(600) }).strict()).max(15),
    missing: z.array(z.string().trim().min(1).max(300)).max(8),
  })
  .strict();
export type IntakeModelOutput = z.infer<typeof intakeModelSchema>;

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface HeardItem {
  readonly text: string;
  readonly quote: string;
  /** Where the quote is in the transcript, for highlighting. */
  readonly span: Span;
}

export interface IntakeDraft {
  readonly title: string;
  readonly problem: string;
  readonly description: string;
  readonly goal: HeardItem | null;
  readonly facts: HeardItem[];
  readonly constraints: HeardItem[];
  /** People, brands and organisations the model heard; checked against the transcript, to be confirmed. */
  readonly names: HeardItem[];
  /** What the system worked out itself; never said in the transcript. */
  readonly assumptions: { text: string }[];
  /** Questions the story did not answer. */
  readonly missing: string[];
  /** Numbers, amounts and percentages found in the transcript by code. */
  readonly figures: Figure[];
  /** Claims dropped because their quote is not in the transcript. */
  readonly dropped: number;
}

/** One-to-one normalisation (the length never changes), so a position in it is a position in the text. */
export function foldChar(char: string): string {
  if (char === 'ي') return 'ی';
  if (char === 'ك') return 'ک';
  if (char === '‌' || char === '‏' || char === '‎') return ' ';
  const code = char.charCodeAt(0);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  return char.toLowerCase();
}

export function fold(text: string): string {
  return Array.from(text, foldChar).join('');
}

/** The words of a text with their positions; separators and punctuation between words are skipped. */
function wordsWithPositions(text: string): { word: string; start: number; end: number }[] {
  return [...text.matchAll(/[^\s.,!?؟،؛:]+/gu)].map((m) => ({
    word: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/**
 * Where a quote is in the transcript, ignoring spacing, punctuation, Arabic letter variants and digit
 * scripts. It compares whole words one after another (no pattern built from the quote), so a long
 * or odd quote can never make the search slow.
 */
export function findQuoteSpan(transcript: string, quote: string): Span | null {
  const wanted = wordsWithPositions(fold(quote)).map((w) => w.word);
  if (wanted.join('').length < 4) return null;
  const have = wordsWithPositions(fold(transcript));
  for (let i = 0; i + wanted.length <= have.length; i += 1) {
    if (wanted.every((word, k) => have[i + k]?.word === word)) {
      return { start: have[i]!.start, end: have[i + wanted.length - 1]!.end };
    }
  }
  return null;
}

/** Text without the given characters at its end, in one pass (no pattern, so no backtracking). */
function trimEnd(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1] as string)) end -= 1;
  return text.slice(0, end);
}

export interface Figure {
  readonly text: string;
  readonly kind: 'number' | 'percent' | 'money' | 'words';
  readonly span: Span;
}

const UNIT =
  '(?:درصد|٪|%|میلیارد|میلیون|هزار|تومان|تومن|ریال|نفر|روز|ماه|سال|هفته|ساعت|عدد|دلار|یورو)';
const DIGITS = '[0-9۰-۹٠-٩]';
const NUMBER = `${DIGITS}[0-9۰-۹٠-٩٬,٫.]*`;
const FIGURE = new RegExp(
  `${NUMBER}(?:\\s*${UNIT}(?:\\s+(?:تومان|تومن|ریال|نفر|دلار|یورو))?)*`,
  'gu',
);
const WORD_TOKEN = /[؀-ۿ‌]+/gu;
const NUMBER_WORD = new Set([
  'صفر',
  'یک',
  'دو',
  'سه',
  'چهار',
  'پنج',
  'شش',
  'شیش',
  'هفت',
  'هشت',
  'نه',
  'ده',
  'یازده',
  'دوازده',
  'سیزده',
  'چهارده',
  'پانزده',
  'شانزده',
  'هفده',
  'هجده',
  'نوزده',
  'بیست',
  'سی',
  'چهل',
  'پنجاه',
  'شصت',
  'هفتاد',
  'هشتاد',
  'نود',
  'صد',
  'یکصد',
  'دویست',
  'سیصد',
  'چهارصد',
  'پانصد',
  'ششصد',
  'هفتصد',
  'هشتصد',
  'نهصد',
  'هزار',
  'میلیون',
  'میلیارد',
  'تریلیون',
]);
const BIG = new Set(['هزار', 'میلیون', 'میلیارد', 'تریلیون']);
const MONEY_UNIT = new Set(['تومان', 'تومن', 'ریال']);

/**
 * Numbers, percentages, amounts and number words in a transcript, found by code. The manager is
 * asked to confirm each; a recogniser mishearing “پانزده” as “پنجاه” changes the problem.
 */
export function findFigures(transcript: string): Figure[] {
  // Digits keep their script here; the folded copy is only used to match quotes elsewhere.
  const folded = transcript;
  const out: Figure[] = [];
  for (const match of folded.matchAll(FIGURE)) {
    const value = trimEnd(match[0].trim(), '.,٬٫،');
    if (!value) continue;
    const kind = /(?:درصد|٪|%)/u.test(value)
      ? 'percent'
      : /(?:تومان|تومن|ریال|دلار|یورو)/u.test(value)
        ? 'money'
        : 'number';
    out.push({ text: value, kind, span: { start: match.index, end: match.index + value.length } });
  }
  // Runs of number words (“دو میلیارد و پانصد میلیون تومان”).
  const tokens = [...folded.matchAll(WORD_TOKEN)].map((m) => ({
    word: m[0].replace(/‌/gu, ''),
    start: m.index,
    end: m.index + m[0].length,
  }));
  for (let i = 0; i < tokens.length; i += 1) {
    const first = tokens[i];
    if (!first || !NUMBER_WORD.has(first.word)) continue;
    let j = i;
    let last = i;
    while (j + 1 < tokens.length) {
      const next = tokens[j + 1];
      const between = folded.slice(tokens[j]!.end, next!.start);
      if (!/^\s+$/u.test(between)) break;
      if (NUMBER_WORD.has(next!.word)) {
        j += 1;
        last = j;
      } else if (next!.word === 'و' && NUMBER_WORD.has(tokens[j + 2]?.word ?? '')) {
        j += 2;
        last = j;
      } else break;
    }
    const run = tokens.slice(i, last + 1);
    const tail = tokens[last + 1];
    const hasUnit =
      tail &&
      MONEY_UNIT.has(tail.word) &&
      /^\s+$/u.test(folded.slice(tokens[last]!.end, tail.start));
    const end = hasUnit ? tail.end : tokens[last]!.end;
    const phrase = folded.slice(first.start, end);
    const value = parsePersianNumberWords(run.map((t) => t.word).join(' '));
    // A lone small word such as “یک” or “سه” in ordinary speech is not a figure worth checking.
    const meaningful =
      value !== null && (run.length > 1 || BIG.has(first.word) || value >= 10 || hasUnit);
    if (meaningful) {
      const overlaps = out.some((f) => f.span.start < end && f.span.end > first.start);
      if (!overlaps) {
        out.push({
          text: phrase,
          kind: hasUnit ? 'money' : 'words',
          span: { start: first.start, end },
        });
      }
    }
    i = last;
  }
  return out.sort((a, b) => a.span.start - b.span.start);
}

function heard(
  items: readonly { text: string; quote: string }[],
  transcript: string,
): { kept: HeardItem[]; dropped: number } {
  const kept: HeardItem[] = [];
  let dropped = 0;
  for (const item of items) {
    const span = findQuoteSpan(transcript, item.quote);
    if (span) kept.push({ text: item.text, quote: item.quote, span });
    else dropped += 1;
  }
  return { kept, dropped };
}

/** Keeps what the transcript supports, labels the rest, and adds the figures found by code. */
export function groundIntake(output: IntakeModelOutput, transcript: string): IntakeDraft {
  const facts = heard(output.facts, transcript);
  const constraints = heard(output.constraints, transcript);
  const names = heard(output.names, transcript);
  const goal = output.goal ? heard([output.goal], transcript) : { kept: [], dropped: 0 };
  return {
    title: output.title,
    problem: output.problem,
    description: output.description,
    goal: goal.kept[0] ?? null,
    facts: facts.kept,
    constraints: constraints.kept,
    names: names.kept,
    assumptions: output.assumptions.map((a) => ({ text: a.text })),
    missing: output.missing,
    figures: findFigures(transcript),
    dropped: facts.dropped + constraints.dropped + names.dropped + goal.dropped,
  };
}

export interface Segment {
  readonly text: string;
  /** `figure` and `name` are to be confirmed; `plain` is everything else. */
  readonly mark: 'plain' | 'figure' | 'name';
}

/** The transcript cut into plain, figure and name pieces for highlighting; overlaps are never shown twice. */
export function highlightSegments(
  transcript: string,
  figures: readonly Figure[],
  names: readonly HeardItem[],
): Segment[] {
  const marks = [
    ...figures.map((f) => ({ ...f.span, mark: 'figure' as const })),
    ...names.map((n) => ({ ...n.span, mark: 'name' as const })),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Segment[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.start < at) continue;
    if (m.start > at) out.push({ text: transcript.slice(at, m.start), mark: 'plain' });
    out.push({ text: transcript.slice(m.start, m.end), mark: m.mark });
    at = m.end;
  }
  if (at < transcript.length) out.push({ text: transcript.slice(at), mark: 'plain' });
  return out;
}
