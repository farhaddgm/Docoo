/**
 * Masking of text before a monitor shows it (ADR-0056 §8-2). A monitor puts the work of the system
 * on a room screen, so any text that comes from the work (an output, a message, a name) passes
 * through here first. Two parts:
 *
 * - the **level**, which the owner cannot turn off: `standard` hides what must never be on a screen
 *   (emails, phone numbers, addresses of machines, paths, keys, technical ids); `strict` also hides
 *   every web address, long number and amount of money;
 * - the **blocked words** the owner lists, such as a client's name, hidden wherever they appear.
 *
 * Everything is pure and linear in the length of the text.
 */

export const redactionLevels = ['standard', 'strict'] as const;
export type RedactionLevel = (typeof redactionLevels)[number];

export const MASK = '●●●';

export interface RedactionOptions {
  readonly level: RedactionLevel;
  readonly blockedWords: readonly string[];
}

// A digit of any script a message may use: Latin, Persian, Arabic-Indic.
const D = '[0-9\\u06F0-\\u06F9\\u0660-\\u0669]';

const standardPatterns: readonly RegExp[] = [
  // A technical id.
  /(?<![0-9a-f-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f-])/giu,
  // An email address.
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/giu,
  // A key or token that has a well-known shape.
  /\bsk-[A-Za-z0-9_-]{16,}/gu,
  /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{16,}/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/giu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu,
  // A web address of a machine inside the network, or a bare internal host name.
  /\b(?:https?|ftp|ssh):\/\/(?:localhost|[^\s/:]*\.(?:local|internal|lan|corp|intranet|home)|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:[^\s]*[^\s.,;:!?)\]،؛])?/giu,
  /(?<![\w.-])(?:[a-z0-9-]+\.)*[a-z0-9-]+\.(?:local|internal|lan|corp|intranet)(?::\d+)?(?![\w-])/giu,
  /(?<![\w.-])localhost(?::\d+)?(?:\/(?:[^\s]*[^\s.,;:!?)\]،؛])?)?/giu,
  // An IP address.
  /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/gu,
  // IPv6: the full form, the compressed form with "::", and the loopback. A time such as 10:30:45
  // is none of them.
  /(?<![0-9a-f:])(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}(?![0-9a-f:])/giu,
  /(?<![0-9a-f:])(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?(?![0-9a-f:])/giu,
  /(?<![\w:])::1(?![\w:])/gu,
  // A path inside a machine.
  /(?<![\w/.])\/(?:home|etc|var|usr|opt|srv|root|tmp|app|mnt|proc|Users)\/(?:[^\s]*[^\s.,;:!?)\]،؛])?/gu,
  /(?<![\w])[A-Za-z]:\\(?:[^\s]*[^\s.,;:!?)\]،؛])?/gu,
  /(?<![\w])~\/(?:[^\s]*[^\s.,;:!?)\]،؛])?/gu,
  // A phone number: eight digits or more, possibly spaced, dashed or in brackets; a date is not one.
  new RegExp(
    `(?<!${D})(?!${D}{4}[-/.]${D}{1,2}[-/.]${D}{1,2}(?!${D}))[+(]?${D}(?:[\\s().-]{0,2}${D}){7,}(?!${D})`,
    'gu',
  ),
];

const strictPatterns: readonly RegExp[] = [
  // Any web address.
  /\b(?:https?:\/\/|www\.)[^\s)>\]]*[^\s)>\].,;:!?،؛]/giu,
  // An amount of money.
  new RegExp(`[$€£¥]\\s?${D}[${'0-9\\u06F0-\\u06F9\\u0660-\\u0669'},\\u066C.]*`, 'gu'),
  new RegExp(
    `${D}[${'0-9\\u06F0-\\u06F9\\u0660-\\u0669'},\\u066C.]*\\s?(?:(?:میلیون|میلیارد|هزار)\\s?)?(?:USD|EUR|GBP|دلار|یورو|تومان|ریال)`,
    'giu',
  ),
  // A long number: five digits or more, thousands separators allowed.
  new RegExp(`(?<!${D})${D}(?:[,\\u066C]?${D}){4,}(?!${D})`, 'gu'),
];

/** A long run of letters, digits, `_` and `-` is a token when it mixes letters and digits, or is hex. */
const LONG_RUN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/gu;
const looksLikeToken = (run: string): boolean =>
  (/[A-Za-z]/u.test(run) && /[0-9]/u.test(run)) || /^[0-9a-f]+$/iu.test(run);

// ---- blocked words --------------------------------------------------------------------------

/** One UTF-16 unit for one unit, so a position in the folded text is a position in the original. */
function fold(text: string): string {
  let out = '';
  for (const unit of text) {
    // Arabic yeh and kaf are the same letters as the Persian ones; people type either.
    const mapped = unit === '\u064A' ? '\u06CC' : unit === '\u0643' ? '\u06A9' : unit;
    const lower = mapped.toLowerCase();
    out += lower.length === mapped.length ? lower : mapped;
  }
  return out;
}

function maskWords(text: string, words: readonly string[]): string {
  const folded = fold(text);
  const ranges: [number, number][] = [];
  for (const word of words) {
    const needle = fold(word.trim());
    if (needle === '') continue;
    let from = 0;
    for (;;) {
      const at = folded.indexOf(needle, from);
      if (at < 0) break;
      ranges.push([at, at + needle.length]);
      from = at + 1;
    }
  }
  if (ranges.length === 0) return text;
  // Words that overlap or repeat become one masked stretch.
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] < last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  let out = '';
  let cursor = 0;
  for (const [start, end] of merged) {
    out += text.slice(cursor, start) + MASK;
    cursor = end;
  }
  return out + text.slice(cursor);
}

/**
 * The longest text masked in one piece. A monitor shows lines and names, never documents, and the
 * patterns scan a run of text more than once, so a text past this is cut (with an ellipsis) before
 * masking: it can never make the screen slow, and a cut text only shows less.
 */
export const MAX_REDACT_LENGTH = 8000;

/** Masks what the level and the blocked words say; everything else is returned as it was. */
export function redactText(input: string, options: RedactionOptions): string {
  let text = input.length > MAX_REDACT_LENGTH ? `${input.slice(0, MAX_REDACT_LENGTH)}…` : input;
  // The patterns go first, so a blocked word inside an address cannot break the address's shape
  // and let the rest of it through.
  for (const pattern of standardPatterns) text = text.replace(pattern, MASK);
  text = text.replace(LONG_RUN, (run) => (looksLikeToken(run) ? MASK : run));
  if (options.level === 'strict') {
    for (const pattern of strictPatterns) text = text.replace(pattern, MASK);
  }
  return maskWords(text, options.blockedWords);
}
