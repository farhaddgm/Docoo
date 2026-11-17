/**
 * Money in Rial and Toman (NXT-003). An amount is always stored in **Rial**, the legal unit, as a
 * whole number; Toman (one tenth of a Rial) is only how it is shown or typed. Keeping one stored
 * unit is what stops an agent or a manager from mixing the two by a factor of ten.
 */
export const currencyUnits = ['IRR', 'IRT'] as const;
export type CurrencyUnit = (typeof currencyUnits)[number];

const RIAL_PER_UNIT: Record<CurrencyUnit, number> = { IRR: 1, IRT: 10 };

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Persian and Arabic-Indic digits, and the separators typed with them, as plain ASCII. */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[۰-۹]/gu, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/gu, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[٬،,]/gu, '')
    .replace(/[٫]/gu, '.');
}

export function toPersianDigits(text: string): string {
  return text.replace(/\d/gu, (d) => PERSIAN_DIGITS[Number(d)] as string);
}

const SCALES = [
  { value: 1_000_000_000_000, fa: 'هزار میلیارد', en: 'trillion' },
  { value: 1_000_000_000, fa: 'میلیارد', en: 'billion' },
  { value: 1_000_000, fa: 'میلیون', en: 'million' },
  { value: 1_000, fa: 'هزار', en: 'thousand' },
] as const;

export interface FormatMoneyOptions {
  readonly unit?: CurrencyUnit;
  readonly locale?: 'fa' | 'en';
  /** “۱۲٫۵ میلیارد تومان” instead of every digit. */
  readonly compact?: boolean;
}

const unitName = {
  fa: { IRR: 'ریال', IRT: 'تومان' },
  en: { IRR: 'Rial', IRT: 'Toman' },
} as const;

/** An amount in Rial as text in the chosen unit; Persian digits and groups for `fa`. */
export function formatMoney(amountRial: number, options: FormatMoneyOptions = {}): string {
  if (!Number.isSafeInteger(amountRial)) throw new Error('A Rial amount is a whole number.');
  const unit = options.unit ?? 'IRT';
  const locale = options.locale ?? 'fa';
  const shown = amountRial / RIAL_PER_UNIT[unit];
  const sign = shown < 0 ? '-' : '';
  const abs = Math.abs(shown);
  const tag = locale === 'fa' ? 'fa-IR' : 'en-US';
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(tag, { maximumFractionDigits: digits }).format(value);
  if (options.compact) {
    const scale = SCALES.find((s) => abs >= s.value);
    if (scale) {
      const scaled = Math.round((abs / scale.value) * 10) / 10;
      return `${sign}${number(scaled, 1)} ${locale === 'fa' ? scale.fa : scale.en} ${unitName[locale][unit]}`;
    }
  }
  return `${sign}${number(abs, 1)} ${unitName[locale][unit]}`;
}

const ONES: Record<string, number> = {
  صفر: 0,
  یک: 1,
  دو: 2,
  سه: 3,
  چهار: 4,
  پنج: 5,
  شش: 6,
  شیش: 6,
  هفت: 7,
  هشت: 8,
  نه: 9,
  ده: 10,
  یازده: 11,
  دوازده: 12,
  سیزده: 13,
  چهارده: 14,
  پانزده: 15,
  شانزده: 16,
  هفده: 17,
  هجده: 18,
  نوزده: 19,
  بیست: 20,
  سی: 30,
  چهل: 40,
  پنجاه: 50,
  شصت: 60,
  هفتاد: 70,
  هشتاد: 80,
  نود: 90,
  صد: 100,
  یکصد: 100,
  دویست: 200,
  سیصد: 300,
  چهارصد: 400,
  پانصد: 500,
  ششصد: 600,
  شیشصد: 600,
  هفتصد: 700,
  هشتصد: 800,
  نهصد: 900,
};
const MULTIPLIERS: Record<string, number> = {
  هزار: 1_000,
  میلیون: 1_000_000,
  ملیون: 1_000_000,
  میلیارد: 1_000_000_000,
  بیلیون: 1_000_000_000,
  تریلیون: 1_000_000_000_000,
};

/** Persian number words, e.g. “دو میلیارد و پانصد میلیون”; null when a word is not a number. */
export function parsePersianNumberWords(text: string): number | null {
  const words = text
    .replace(/‌/gu, ' ')
    .split(/\s+/u)
    .filter((w) => w && w !== 'و');
  if (words.length === 0) return null;
  let total = 0;
  let group = 0;
  let any = false;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] as string;
    if (word === 'هزار' && words[i + 1] === 'میلیارد') {
      total += (group || 1) * 1_000_000_000_000;
      group = 0;
      i += 1;
      any = true;
      continue;
    }
    if (word in ONES) {
      group += ONES[word] as number;
      any = true;
    } else if (word in MULTIPLIERS) {
      total += (group || 1) * (MULTIPLIERS[word] as number);
      group = 0;
      any = true;
    } else return null;
  }
  const value = total + group;
  return any && Number.isSafeInteger(value) ? value : null;
}

export interface ParsedMoney {
  /** The amount in Rial. */
  readonly amountRial: number;
  /** The unit the person wrote; `null` when none was written and `defaultUnit` was assumed. */
  readonly writtenUnit: CurrencyUnit | null;
}

const UNIT_WORDS: { re: RegExp; unit: CurrencyUnit }[] = [
  { re: /(تومان|تومن|ت\.?\s*$)/u, unit: 'IRT' },
  { re: /(ریال|ریالی)/u, unit: 'IRR' },
  { re: /\b(toman|tomans|irt)\b/iu, unit: 'IRT' },
  { re: /\b(rial|rials|irr)\b/iu, unit: 'IRR' },
];
const SCALE_WORDS = /(هزار میلیارد|میلیارد|میلیون|هزار|تریلیون|billion|million|thousand)/iu;
const SCALE_VALUE: Record<string, number> = {
  'هزار میلیارد': 1_000_000_000_000,
  میلیارد: 1_000_000_000,
  میلیون: 1_000_000,
  هزار: 1_000,
  تریلیون: 1_000_000_000_000,
  billion: 1_000_000_000,
  million: 1_000_000,
  thousand: 1_000,
};

/**
 * An amount the way a manager writes it: “۱۲٫۵ میلیارد تومان”, “500 هزار ریال”, “ده میلیارد تومان”.
 * It never guesses the unit silently: `writtenUnit` is null when the text names none, so a caller
 * can ask. Returns null when the text is not an amount.
 */
export function parseMoney(text: string, defaultUnit: CurrencyUnit = 'IRT'): ParsedMoney | null {
  const raw = text.trim();
  if (!raw) return null;
  const unit = UNIT_WORDS.find(({ re }) => re.test(raw))?.unit ?? null;
  const body = raw
    .replace(/(تومان|تومن|ریال|ریالی|toman|tomans|irt|rial|rials|irr)/giu, ' ')
    .replace(/ت\.?\s*$/u, ' ')
    .trim();
  const ascii = normalizeDigits(body);
  const numeric = /^(-?\d+(?:\.\d+)?)\s*(.*)$/u.exec(ascii);
  let value: number | null;
  if (numeric) {
    const scale = numeric[2]?.trim() ?? '';
    const factor = scale ? (SCALE_VALUE[scale.toLowerCase()] ?? null) : 1;
    if (factor === null) return null;
    value = Number(numeric[1]) * factor;
  } else {
    value = parsePersianNumberWords(body);
    if (value === null && SCALE_WORDS.test(body)) return null;
  }
  if (value === null || !Number.isFinite(value)) return null;
  const rial = Math.round(value * RIAL_PER_UNIT[unit ?? defaultUnit]);
  return Number.isSafeInteger(rial) ? { amountRial: rial, writtenUnit: unit } : null;
}
