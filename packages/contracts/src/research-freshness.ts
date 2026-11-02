/**
 * The age of a research finding (ADR-0051): the year the information is about, read from the date
 * the researcher reported, and how stale that makes it. Pure, so the page can recompute it each day
 * from the stored year without rewriting the output.
 */

/** What a figure of a finding may hold, cut so a long text cannot flood the output. */
export const FIGURE_LIMITS = {
  maxPerFinding: 8,
  maxLabel: 120,
  maxValue: 60,
  maxUnit: 30,
  maxPeriod: 30,
} as const;

const PERSIAN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;

/** Latin digits for Persian and Arabic-Indic ones; everything else stays. */
export function toLatinDigits(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.codePointAt(0)!;
      if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) return String(code - PERSIAN_ZERO);
      if (code >= ARABIC_ZERO && code <= ARABIC_ZERO + 9) return String(code - ARABIC_ZERO);
      return char;
    })
    .join('');
}

const JALALI_OFFSET = 621;

/**
 * The (Gregorian) year a reported date is about: the latest four-digit year in it, a Persian
 * (Jalali) year such as 1402 converted by the usual offset (right within a year, which is all
 * freshness needs). Null when the text holds no plausible year.
 */
export function asOfYear(text: string): number | null {
  const years = (toLatinDigits(text).match(/(?<!\d)\d{4}(?!\d)/gu) ?? [])
    .map(Number)
    .map((year) => (year >= 1250 && year <= 1500 ? year + JALALI_OFFSET : year))
    .filter((year) => year >= 1900 && year <= 2100);
  return years.length > 0 ? Math.max(...years) : null;
}

export type Freshness = 'current' | 'aging' | 'stale' | 'unknown';

/** Years a kind of information stays current: prices, markets, rules and statistics age fast. */
export const FRESH_YEARS = { fast: 1, slow: 3 } as const;

/**
 * `current` within the limit, `aging` within twice the limit, `stale` beyond; `unknown` without a
 * year, or with one in the future (a mistake, never "very fresh").
 */
export function freshnessOf(year: number | null, agesFast: boolean, nowYear: number): Freshness {
  if (year === null) return 'unknown';
  const age = nowYear - year;
  if (age < 0) return 'unknown';
  const limit = agesFast ? FRESH_YEARS.fast : FRESH_YEARS.slow;
  return age <= limit ? 'current' : age <= limit * 2 ? 'aging' : 'stale';
}

/** A figure of a finding, as stored. */
export interface ResearchFigure {
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly period: string;
  /** Whether the value appears in the finding's verified quote; a number only the model wrote is not. */
  readonly supported: boolean;
}

const separators = /[\s,٬،'’_]/gu;

/** The digits and sign/decimal point of a number as text, comparable across Persian and Latin writing. */
export function numberKey(text: string): string {
  return toLatinDigits(text).replace(/٫/gu, '.').replace(separators, '');
}

/** Whether a figure's value appears in any of the quotes, in either digit script and with any thousands separator. */
export function figureInQuotes(value: string, quotes: readonly string[]): boolean {
  const key = numberKey(value);
  if (!/\d/u.test(key)) return false;
  return quotes.some((quote) => numberKey(quote).includes(key));
}

const cut = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/**
 * The figures of a raw finding: at most `maxPerFinding`, each with a label and a value, trimmed, and
 * checked against the quotes that verified. A figure without a label or value is dropped, not repaired.
 */
export function readFigures(raw: unknown, verifiedQuotes: readonly string[]): ResearchFigure[] {
  const list = Array.isArray(raw) ? raw : [];
  const figures: ResearchFigure[] = [];
  for (const item of list) {
    const entry =
      item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const label = cut(entry['label'], FIGURE_LIMITS.maxLabel);
    const value = cut(entry['value'], FIGURE_LIMITS.maxValue);
    if (label === '' || value === '') continue;
    figures.push({
      label,
      value,
      unit: cut(entry['unit'], FIGURE_LIMITS.maxUnit),
      period: cut(entry['period'], FIGURE_LIMITS.maxPeriod),
      supported: figureInQuotes(value, verifiedQuotes),
    });
    if (figures.length >= FIGURE_LIMITS.maxPerFinding) break;
  }
  return figures;
}
