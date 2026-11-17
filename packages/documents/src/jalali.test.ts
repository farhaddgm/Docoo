import { describe, expect, it } from 'vitest';
import {
  formatJalali,
  gregorianToJalali,
  isJalaliLeapYear,
  jalaliMonthLength,
  jalaliToGregorian,
  tehranDay,
} from './jalali.js';

describe('Jalali conversion', () => {
  it('knows the anchor days', () => {
    expect(gregorianToJalali(2021, 3, 21)).toEqual({ year: 1400, month: 1, day: 1 });
    expect(gregorianToJalali(2024, 3, 20)).toEqual({ year: 1403, month: 1, day: 1 });
    expect(gregorianToJalali(2025, 3, 21)).toEqual({ year: 1404, month: 1, day: 1 });
    expect(gregorianToJalali(2026, 11, 17)).toEqual({ year: 1405, month: 8, day: 26 });
    expect(jalaliToGregorian(1405, 8, 26)).toEqual({ year: 2026, month: 11, day: 17 });
  });

  it('agrees with ICU on every day of 1380–1420 and round-trips', () => {
    const icu = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    for (let ms = Date.UTC(2001, 2, 1); ms < Date.UTC(2042, 2, 31); ms += 86_400_000) {
      const d = new Date(ms);
      const parts = icu.formatToParts(d);
      const read = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      const mine = gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      expect(mine).toEqual({ year: read('year'), month: read('month'), day: read('day') });
      expect(jalaliToGregorian(mine.year, mine.month, mine.day)).toEqual({
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
      });
    }
  });

  it('knows leap years and month lengths', () => {
    expect(isJalaliLeapYear(1403)).toBe(true);
    expect(isJalaliLeapYear(1404)).toBe(false);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
    expect(jalaliMonthLength(1404, 1)).toBe(31);
    expect(jalaliMonthLength(1404, 7)).toBe(30);
  });
});

describe('formatting', () => {
  it('formats in Persian or Latin digits', () => {
    expect(formatJalali('2026-11-17T09:00:00Z')).toBe('۲۶ آبان ۱۴۰۵');
    expect(formatJalali('2026-11-17T09:00:00Z', { style: 'numeric' })).toBe('۱۴۰۵/۰۸/۲۶');
    expect(formatJalali('2026-11-17T09:00:00Z', { style: 'numeric', digits: 'latn' })).toBe(
      '1405/08/26',
    );
  });

  it('uses the calendar day in Tehran, not in UTC', () => {
    // 21:00 UTC on 16 Nov is already 00:30 on 17 Nov in Tehran (UTC+3:30).
    expect(tehranDay('2026-11-16T21:00:00Z')).toEqual({ year: 2026, month: 11, day: 17 });
    expect(formatJalali('2026-11-16T21:00:00Z', { digits: 'latn' })).toBe('26 آبان 1405');
  });

  it('refuses an invalid date', () => {
    expect(() => formatJalali('not a date')).toThrow();
  });
});
