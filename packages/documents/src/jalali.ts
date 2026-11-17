/**
 * Jalali (Solar Hijri) dates for documents. The conversion is plain arithmetic (the 33-year cycle
 * algorithm of jalaali-js), so a rendered document never depends on the ICU data of the machine that
 * rendered it and the same version always renders to the same bytes. The tests check it against ICU
 * for every day of 1380–1420.
 */
export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
] as const;

const div = (a: number, b: number) => Math.trunc(a / b);
const mod = (a: number, b: number) => a - Math.trunc(a / b) * b;

function jalCal(jy: number, withoutLeap: boolean): { leap: number; gy: number; march: number } {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0] as number;
  let jump = 0;
  if (jy < jp || jy >= (BREAKS[bl - 1] as number)) throw new Error(`Invalid Jalali year ${jy}`);
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i] as number;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (withoutLeap) return { leap: 0, gy, march };
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy, true);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export function gregorianToJalali(year: number, month: number, day: number): CalendarDate {
  const jdn = g2d(year, month, day);
  let jy = d2g(jdn).gy - 621;
  const r = jalCal(jy, false);
  const first = g2d(r.gy, 3, r.march);
  let k = jdn - first;
  if (k >= 0) {
    if (k <= 185) return { year: jy, month: 1 + div(k, 31), day: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { year: jy, month: 7 + div(k, 30), day: mod(k, 30) + 1 };
}

export function jalaliToGregorian(year: number, month: number, day: number): CalendarDate {
  const g = d2g(j2d(year, month, day));
  return { year: g.gy, month: g.gm, day: g.gd };
}

export function isJalaliLeapYear(year: number): boolean {
  return jalCal(year, false).leap === 0;
}

/** Days in a Jalali month: 31 for the first six, 30 for the next five, and 29 or 30 for Esfand. */
export function jalaliMonthLength(year: number, month: number): number {
  if (month >= 1 && month <= 6) return 31;
  if (month >= 7 && month <= 11) return 30;
  if (month === 12) return isJalaliLeapYear(year) ? 30 : 29;
  throw new Error(`Invalid Jalali month ${month}`);
}

/** The calendar day an instant falls on in Tehran (Iran has no daylight saving since 2022). */
export function tehranDay(value: Date | string): { year: number; month: number; day: number } {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day') };
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const toPersianDigits = (text: string): string =>
  text.replace(/\d/gu, (digit) => PERSIAN_DIGITS[Number(digit)] as string);

export interface JalaliFormat {
  /** `long` is “۲۶ آبان ۱۴۰۵”; `numeric` is “۱۴۰۵/۰۸/۲۶”. */
  readonly style?: 'long' | 'numeric';
  readonly digits?: 'fa' | 'latn';
}

/** A moment as a Jalali date in Tehran. */
export function formatJalali(value: Date | string, format: JalaliFormat = {}): string {
  const day = tehranDay(value);
  const j = gregorianToJalali(day.year, day.month, day.day);
  const text =
    (format.style ?? 'long') === 'long'
      ? `${j.day} ${JALALI_MONTHS[j.month - 1]} ${j.year}`
      : `${j.year}/${String(j.month).padStart(2, '0')}/${String(j.day).padStart(2, '0')}`;
  return (format.digits ?? 'fa') === 'fa' ? toPersianDigits(text) : text;
}

/**
 * The line under a document title that says which version this is and when it was made: a Jalali
 * date for Persian documents and an ISO date for English ones. The date comes from the version
 * itself, never from the clock, so rendering the same version twice gives the same bytes.
 */
export function documentDateLine(
  language: 'fa' | 'en',
  createdAt: string,
  version: number,
): string {
  if (language === 'fa') {
    return `تاریخ نسخه: ${formatJalali(createdAt)} · نسخهٔ ${toPersianDigits(String(version))}`;
  }
  const day = tehranDay(createdAt);
  const iso = `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
  return `Version date: ${iso} · Version ${version}`;
}
