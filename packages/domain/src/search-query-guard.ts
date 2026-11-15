/**
 * The last check of a web search query before it leaves the system (ADR-0059, ADR-0026 §6).
 *
 * A query is derived from the confirmed research questions or the problem statement, both written
 * by people, so it can carry things that must never reach an outside search service: an e-mail
 * address, a phone or card number, an internal address, a secret that looks like a key. The check
 * is deterministic code, never a model, and it only ever answers with a reason code: the text of
 * a rejected query is not repeated in the answer, so it cannot end up in a log through it.
 */

export const SEARCH_QUERY_LIMITS = { min: 3, max: 400 } as const;

export type SearchQueryBlock =
  'too_short' | 'email' | 'phone_or_id_number' | 'card_number' | 'internal_address' | 'secret_like';

export type SearchQueryCheck =
  | { readonly ok: true; readonly query: string }
  | { readonly ok: false; readonly reason: SearchQueryBlock };

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Persian and Arabic-Indic digits as ASCII, so one set of patterns covers every script. */
function asciiDigits(value: string): string {
  let out = '';
  for (const char of value) {
    const persian = PERSIAN_DIGITS.indexOf(char);
    if (persian >= 0) {
      out += String(persian);
      continue;
    }
    const arabic = ARABIC_DIGITS.indexOf(char);
    out += arabic >= 0 ? String(arabic) : char;
  }
  return out;
}

const EMAIL = /[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){1,8}/u;
/** Internal hosts and private or loopback addresses. */
const INTERNAL_HOST =
  /(?:^|[\s/@(])(?:localhost|[\w-]+\.(?:internal|local|lan|corp|intranet|home|private)|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|0\.0\.0\.0)(?=$|[\s:/)\],.])/iu;
/** Well-known secret prefixes and long unbroken tokens that mix letters and digits. */
const SECRET_PREFIX = /\b(?:sk|pk|rk|ghp|gho|ghs|xox[abp]|AKIA|AIza)[-_A-Za-z0-9]{12,}/u;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu;
const LONG_TOKEN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{28,}\b/u;
/** A bearer-style credential written out in words. */
const CREDENTIAL_WORD = /\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*\S+/iu;

/** Digit groups of 13 to 19 digits that pass the Luhn check are card numbers. */
function luhn(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48;
    if (alternate) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Checks one query. A query that passes is returned with its whitespace collapsed and its length
 * capped; a query that does not is refused with the first reason found, and nothing of it is kept.
 */
export function checkSearchQuery(raw: string): SearchQueryCheck {
  // What is checked is exactly what would be sent, and the patterns below never see more than that.
  const query = raw
    .slice(0, SEARCH_QUERY_LIMITS.max * 4)
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, SEARCH_QUERY_LIMITS.max);
  if (query.length < SEARCH_QUERY_LIMITS.min) return { ok: false, reason: 'too_short' };
  const ascii = asciiDigits(query);

  if (EMAIL.test(ascii)) return { ok: false, reason: 'email' };
  if (INTERNAL_HOST.test(ascii)) return { ok: false, reason: 'internal_address' };
  if (SECRET_PREFIX.test(ascii) || CREDENTIAL_WORD.test(ascii) || UUID.test(ascii))
    return { ok: false, reason: 'secret_like' };
  if (LONG_TOKEN.test(ascii)) return { ok: false, reason: 'secret_like' };

  // Digits written with spaces, dashes or parentheses still count as one number. Dots are left out
  // on purpose: they separate decimals ("12.5 14.3"), which are figures a research query needs.
  for (const match of ascii.matchAll(/\+?\d[\d\s()-]{5,}\d/gu)) {
    const groups = match[0].split(/[\s()-]+/u).filter(Boolean);
    // "2019-2024" and "2021 2022 2023" are years, not numbers of a person.
    if (groups.every((group) => /^(?:19|20)\d{2}$/u.test(group))) continue;
    const digits = match[0].replace(/\D/gu, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits))
      return { ok: false, reason: 'card_number' };
    if (digits.length >= 9) return { ok: false, reason: 'phone_or_id_number' };
  }
  // An unbroken run of ten or more digits: a mobile or an identity number.
  if (/\d{10,}/u.test(ascii)) return { ok: false, reason: 'phone_or_id_number' };

  return { ok: true, query };
}
