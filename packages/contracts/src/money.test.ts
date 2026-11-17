import { describe, expect, it } from 'vitest';
import { formatMoney, normalizeDigits, parseMoney, parsePersianNumberWords } from './money.js';

describe('formatMoney', () => {
  it('shows Rial amounts in Toman or Rial with Persian groups', () => {
    expect(formatMoney(100_000_000, { unit: 'IRT' })).toBe('۱۰٬۰۰۰٬۰۰۰ تومان');
    expect(formatMoney(100_000_000, { unit: 'IRR' })).toBe('۱۰۰٬۰۰۰٬۰۰۰ ریال');
    expect(formatMoney(100_000_000, { unit: 'IRT', locale: 'en' })).toBe('10,000,000 Toman');
  });
  it('compacts by scale', () => {
    expect(formatMoney(125_000_000_000, { unit: 'IRT', compact: true })).toBe('۱۲٫۵ میلیارد تومان');
    expect(formatMoney(5_000_000, { unit: 'IRT', compact: true })).toBe('۵۰۰ هزار تومان');
    expect(formatMoney(5_000_000_000_000, { unit: 'IRT', compact: true, locale: 'en' })).toBe(
      '500 billion Toman',
    );
    expect(formatMoney(900, { unit: 'IRR', compact: true })).toBe('۹۰۰ ریال');
  });
  it('refuses a fraction of a Rial', () => {
    expect(() => formatMoney(1.5)).toThrow();
  });
});

describe('normalizeDigits', () => {
  it('turns Persian and Arabic digits and separators into ASCII', () => {
    expect(normalizeDigits('۱۲٬۳۴۵٫۶')).toBe('12345.6');
    expect(normalizeDigits('٣٤٥')).toBe('345');
  });
});

describe('parsePersianNumberWords', () => {
  it('reads compound numbers and big scales', () => {
    expect(parsePersianNumberWords('ده')).toBe(10);
    expect(parsePersianNumberWords('دو میلیارد و پانصد میلیون')).toBe(2_500_000_000);
    expect(parsePersianNumberWords('سیصد و بیست و پنج هزار')).toBe(325_000);
    expect(parsePersianNumberWords('دو هزار میلیارد')).toBe(2_000_000_000_000);
    expect(parsePersianNumberWords('میلیون')).toBe(1_000_000);
  });
  it('is null for words that are not numbers', () => {
    expect(parsePersianNumberWords('سلام')).toBeNull();
    expect(parsePersianNumberWords('')).toBeNull();
  });
});

describe('parseMoney', () => {
  it('stores Rial whatever the unit written', () => {
    expect(parseMoney('۱۲٫۵ میلیارد تومان')).toEqual({
      amountRial: 125_000_000_000,
      writtenUnit: 'IRT',
    });
    expect(parseMoney('500 هزار ریال')).toEqual({ amountRial: 500_000, writtenUnit: 'IRR' });
    expect(parseMoney('ده میلیارد تومان')).toEqual({
      amountRial: 100_000_000_000,
      writtenUnit: 'IRT',
    });
    expect(parseMoney('2.5 million toman')).toEqual({ amountRial: 25_000_000, writtenUnit: 'IRT' });
    expect(parseMoney('۱٬۲۰۰٬۰۰۰ تومن')).toEqual({ amountRial: 12_000_000, writtenUnit: 'IRT' });
  });
  it('never hides that the unit was a guess', () => {
    expect(parseMoney('۵۰۰ میلیون')).toEqual({ amountRial: 5_000_000_000, writtenUnit: null });
    expect(parseMoney('۵۰۰ میلیون', 'IRR')).toEqual({ amountRial: 500_000_000, writtenUnit: null });
  });
  it('is null for text that is not an amount', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('بودجه‌ی خوب')).toBeNull();
    expect(parseMoney('۵ ستاره')).toBeNull();
  });
});
