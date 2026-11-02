import { describe, expect, it } from 'vitest';

import {
  asOfYear,
  figureInQuotes,
  FIGURE_LIMITS,
  freshnessOf,
  numberKey,
  readFigures,
  toLatinDigits,
} from './research-freshness.js';

describe('asOfYear', () => {
  it('reads a Gregorian year from a date, a month and year or a range (the latest wins)', () => {
    expect(asOfYear('2023')).toBe(2023);
    expect(asOfYear('March 2024')).toBe(2024);
    expect(asOfYear('2019-2023')).toBe(2023);
    expect(asOfYear('Q3 2022 report, 2021 edition')).toBe(2022);
  });

  it('reads Persian digits and converts a Jalali year', () => {
    expect(asOfYear('۲۰۲۳')).toBe(2023);
    expect(asOfYear('1402/05/10')).toBe(2023);
    expect(asOfYear('۱۴۰۲')).toBe(2023);
    expect(asOfYear('مهر ۱۴۰۳')).toBe(2024);
  });

  it('gives null for no year, an implausible one or a number that is not a year', () => {
    expect(asOfYear('')).toBeNull();
    expect(asOfYear('recently')).toBeNull();
    expect(asOfYear('12345')).toBeNull();
    expect(asOfYear('1650')).toBeNull();
    expect(asOfYear('3000')).toBeNull();
    expect(asOfYear('value 4521 units')).toBeNull();
  });
});

describe('freshnessOf', () => {
  it('judges fast-aging information by a year and the rest by three', () => {
    expect(freshnessOf(2026, true, 2026)).toBe('current');
    expect(freshnessOf(2025, true, 2026)).toBe('current');
    expect(freshnessOf(2024, true, 2026)).toBe('aging');
    expect(freshnessOf(2023, true, 2026)).toBe('stale');
    expect(freshnessOf(2023, false, 2026)).toBe('current');
    expect(freshnessOf(2021, false, 2026)).toBe('aging');
    expect(freshnessOf(2019, false, 2026)).toBe('stale');
  });

  it('is unknown without a year or with a year in the future', () => {
    expect(freshnessOf(null, false, 2026)).toBe('unknown');
    expect(freshnessOf(2030, true, 2026)).toBe('unknown');
  });
});

describe('figures', () => {
  it('compares numbers across digit scripts and thousands separators', () => {
    expect(toLatinDigits('۱۲٬۵۰۰ و ٣٤')).toBe('12٬500 و 34');
    expect(numberKey('۱۲٬۵۰۰')).toBe('12500');
    expect(numberKey('12,500')).toBe('12500');
    expect(numberKey('12 500')).toBe('12500');
    expect(numberKey('۱۲٫۵')).toBe('12.5');
    expect(figureInQuotes('12,500', ['The market reached 12500 units in 2023.'])).toBe(true);
    expect(figureInQuotes('۱۲٬۵۰۰', ['بازار به 12,500 واحد رسید'])).toBe(true);
    expect(figureInQuotes('12.5', ['The rate was 12.5 percent'])).toBe(true);
  });

  it('does not count a value that is not in any quote, or has no digit', () => {
    expect(figureInQuotes('99', ['The market reached 12500 units.'])).toBe(false);
    expect(figureInQuotes('many', ['many people'])).toBe(false);
    expect(figureInQuotes('12', [])).toBe(false);
  });

  it('keeps a figure with a label and a value, marks whether the quotes back it, and drops the rest', () => {
    const figures = readFigures(
      [
        { label: ' Market size ', value: '12,500', unit: 'units', period: '2023' },
        { label: 'Invented', value: '777', unit: '', period: '' },
        { label: '', value: '5', unit: '', period: '' },
        { label: 'No value', value: '  ', unit: '', period: '' },
        null,
        'x',
      ],
      ['The market reached 12500 units.'],
    );
    expect(figures).toEqual([
      { label: 'Market size', value: '12,500', unit: 'units', period: '2023', supported: true },
      { label: 'Invented', value: '777', unit: '', period: '', supported: false },
    ]);
  });

  it('caps the number of figures and the length of each part, and survives a non-list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      label: 'L'.repeat(500),
      value: String(i + 1),
      unit: 'u'.repeat(100),
      period: 'p'.repeat(100),
    }));
    const figures = readFigures(many, []);
    expect(figures).toHaveLength(FIGURE_LIMITS.maxPerFinding);
    expect(figures[0]!.label).toHaveLength(FIGURE_LIMITS.maxLabel);
    expect(figures[0]!.unit).toHaveLength(FIGURE_LIMITS.maxUnit);
    expect(figures[0]!.period).toHaveLength(FIGURE_LIMITS.maxPeriod);
    for (const bad of [undefined, null, 'x', 5, {}]) expect(readFigures(bad, [])).toEqual([]);
  });
});
