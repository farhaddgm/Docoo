import type { Locale } from '../i18n';

/**
 * How the voice assistant monitor writes its numbers and names (ADR-0056 §6). Pure, so the room
 * screen reads the same everywhere and a test can hold it.
 */

const intl = (locale: Locale): string => (locale === 'fa' ? 'fa-IR' : 'en-US');

const PROVIDERS: Readonly<Record<string, string>> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  anthropic: 'Anthropic',
  elevenlabs: 'ElevenLabs',
  fake: 'Test provider',
};

/** The name of a provider kind; an unknown kind is shown as it is, capitalised. */
export function providerName(kind: string): string {
  return PROVIDERS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** A whole number with thousands separators in the digits of the language. */
export const formatCount = (locale: Locale, value: number): string =>
  new Intl.NumberFormat(intl(locale), { maximumFractionDigits: 0 }).format(Math.round(value));

/** Dollars: two decimals, and four while the amount is under ten cents, so a small cost is not 0. */
export function formatDollars(locale: Locale, value: number): string {
  const fractionDigits = value > 0 && value < 0.1 ? 4 : 2;
  return new Intl.NumberFormat(intl(locale), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Minutes as "7 min" or "1 h 05 min"-style text of the language. */
export function formatMinutes(locale: Locale, minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return `${formatCount(locale, whole)}${locale === 'fa' ? ' دقیقه' : ' min'}`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  const hourText = `${formatCount(locale, hours)}${locale === 'fa' ? ' ساعت' : ' h'}`;
  return rest === 0
    ? hourText
    : `${hourText} ${formatCount(locale, rest)}${locale === 'fa' ? ' دقیقه' : ' min'}`;
}

/** The time of day of an instant, in the time zone of the screen. */
export function formatClock(locale: Locale, iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat(intl(locale), { hour: '2-digit', minute: '2-digit' }).format(at);
}

/** How much of a cap is used, 0 to 100 for the bar; the text may say more than 100. */
export const barPercent = (percent: number | null): number =>
  percent === null || !Number.isFinite(percent) ? 0 : Math.min(100, Math.max(0, percent));

/** Replaces `{name}` placeholders in a sentence. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/gu, (match, name: string) => values[name] ?? match);
}
