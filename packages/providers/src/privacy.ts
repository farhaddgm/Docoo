import {
  ProviderError,
  type ConversationMessage,
  type NormalizedModelRequest,
  type NormalizedModelResponse,
  type ToolCall,
} from './contract.js';

/**
 * Privacy layer in front of every model call (ADR-0059).
 *
 * Before a request leaves for a provider, private values in it (emails, phone numbers, national
 * ids, card numbers, IBANs and the project's blocked words) are replaced by stable placeholders
 * such as `‹EMAIL_1›`. The model works with the placeholders; the answer is put back before the
 * platform stores or shows it. The mapping lives only in the memory of one call.
 *
 * Detection is by pattern and checksum, so it does not find free names or addresses; those are what
 * the project's blocked words are for. Everything here is pure and linear in the text.
 */

export const PRIVACY_MODES = ['off', 'mask', 'block'] as const;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];

export const PRIVACY_KINDS = ['EMAIL', 'PHONE', 'NATIONAL_ID', 'CARD', 'IBAN', 'TERM'] as const;
export type PrivacyKind = (typeof PRIVACY_KINDS)[number];

export interface PrivacyPolicy {
  readonly mode: PrivacyMode;
  /** Words (a client's name, a product code) that are hidden wherever they appear. */
  readonly blockedWords: readonly string[];
}

/** What the layer does when a project has no policy of its own. */
export const DEFAULT_PRIVACY_POLICY: PrivacyPolicy = { mode: 'mask', blockedWords: [] };

export interface PrivacyReport {
  /** Number of values replaced (or, in block mode, found), counting repeats. */
  readonly total: number;
  readonly byKind: Readonly<Partial<Record<PrivacyKind, number>>>;
}

export const EMPTY_PRIVACY_REPORT: PrivacyReport = { total: 0, byKind: {} };

export const PRIVACY_BLOCKED_CODE = 'privacy_blocked';

/** Told to the model whenever a request carries placeholders, so it keeps them as they are. */
export const PRIVACY_INSTRUCTION =
  'Some private values were replaced by placeholders written like ‹EMAIL_1› or ‹TERM_2›. ' +
  'Treat each placeholder as an opaque value, never guess what it hides, and copy it exactly as ' +
  'written (with its ‹ › marks) wherever your answer needs that value.';

// ---- text normalisation ---------------------------------------------------------------------

/** Persian and Arabic-Indic digits become Latin ones, unit for unit, so positions stay the same. */
function foldDigits(text: string): string {
  let out = '';
  for (const unit of text) {
    const code = unit.charCodeAt(0);
    if (unit.length === 1 && code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0);
    else if (unit.length === 1 && code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    else out += unit;
  }
  return out;
}

/** Folding for blocked words: case, and the Arabic yeh and kaf people type for the Persian ones. */
function foldWord(text: string): string {
  let out = '';
  for (const unit of text) {
    const mapped = unit === 'ي' ? 'ی' : unit === 'ك' ? 'ک' : unit;
    const lower = mapped.toLowerCase();
    out += lower.length === mapped.length ? lower : mapped;
  }
  return out;
}

// ---- validators -----------------------------------------------------------------------------

/** Iranian national id: ten digits, not all equal, and a valid control digit. */
export function isValidNationalId(digits: string): boolean {
  if (!/^\d{10}$/u.test(digits) || /^(\d)\1{9}$/u.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * (10 - i);
  const remainder = sum % 11;
  const check = Number(digits[9]);
  return remainder < 2 ? check === remainder : check === 11 - remainder;
}

/** Luhn checksum of a card number. */
export function isValidLuhn(digits: string): boolean {
  if (!/^\d{12,19}$/u.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Iranian IBAN: `IR` and 24 digits, and ISO 7064 mod 97 equal to 1. */
export function isValidIranIban(compact: string): boolean {
  if (!/^IR\d{24}$/u.test(compact)) return false;
  const rearranged = `${compact.slice(4)}1827${compact.slice(2, 4)}`;
  let remainder = 0;
  for (const digit of rearranged) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

// ---- detection ------------------------------------------------------------------------------

interface Span {
  readonly start: number;
  readonly end: number;
  readonly kind: PrivacyKind;
  /** Identity of the value, so the same value always gets the same placeholder. */
  readonly key: string;
}

const digitsOf = (value: string): string => value.replace(/\D/gu, '');

interface Detector {
  readonly kind: Exclude<PrivacyKind, 'TERM'>;
  readonly pattern: RegExp;
  /** Returns the identity of the value, or null when the match is not a real one. */
  readonly accept: (match: string) => string | null;
}

// Order is priority: a span that overlaps an earlier detector's span is dropped.
const DETECTORS: readonly Detector[] = [
  {
    kind: 'IBAN',
    pattern: /(?<![A-Za-z0-9])IR(?:[\s-]?\d){24}(?!\d)/giu,
    accept: (match) => {
      const compact = `IR${digitsOf(match)}`;
      return isValidIranIban(compact) ? compact : null;
    },
  },
  {
    kind: 'CARD',
    pattern: /(?<![\d])\d(?:[\s-]?\d){15}(?!\d)/gu,
    accept: (match) => {
      const digits = digitsOf(match);
      return isValidLuhn(digits) ? digits : null;
    },
  },
  {
    kind: 'EMAIL',
    pattern:
      /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu,
    accept: (match) => match.toLowerCase(),
  },
  {
    // A mobile number with its prefix: 0912…, +98 912…, 0098912…, 98912…
    kind: 'PHONE',
    pattern: /(?<![\d+])(?:\+98|0098|98|0)[\s-]?9\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)/gu,
    accept: (match) => `9${digitsOf(match).slice(-9)}`,
  },
  {
    // A landline: area code and eight digits, e.g. 021-12345678.
    kind: 'PHONE',
    pattern: /(?<![\d+])(?:\+98|0098|0)\(?[1-8]\d\)?[\s-]?\d{8}(?!\d)/gu,
    accept: (match) => digitsOf(match).replace(/^(?:98|0098)/u, '0'),
  },
  {
    kind: 'NATIONAL_ID',
    pattern: /(?<![\d])\d{10}(?!\d)/gu,
    accept: (match) => (isValidNationalId(match) ? match : null),
  },
];

/** Finds every private value in one text. Spans do not overlap and come in text order. */
export function findPrivateValues(text: string, blockedWords: readonly string[]): Span[] {
  if (text === '') return [];
  const folded = foldDigits(text);
  const accepted: Span[] = [];
  const overlaps = (start: number, end: number): boolean =>
    accepted.some((span) => start < span.end && end > span.start);

  for (const detector of DETECTORS) {
    for (const match of folded.matchAll(detector.pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (overlaps(start, end)) continue;
      const key = detector.accept(match[0]);
      if (key === null) continue;
      accepted.push({ start, end, kind: detector.kind, key: `${detector.kind}:${key}` });
    }
  }

  const foldedWords = foldWord(text);
  for (const word of blockedWords) {
    const needle = foldWord(word.trim());
    if (needle === '') continue;
    let from = 0;
    for (;;) {
      const at = foldedWords.indexOf(needle, from);
      if (at < 0) break;
      from = at + 1;
      if (!overlaps(at, at + needle.length))
        accepted.push({ start: at, end: at + needle.length, kind: 'TERM', key: `TERM:${needle}` });
    }
  }
  return accepted.sort((a, b) => a.start - b.start);
}

// ---- the layer ------------------------------------------------------------------------------

const PLACEHOLDER = /‹([A-Z_]+_\d+)›/gu;

export interface PrivacyResult {
  /** The request to send: masked, or the same request when nothing was found or mode is `off`. */
  readonly request: NormalizedModelRequest;
  readonly report: PrivacyReport;
  /** Puts the original values back into a response. */
  readonly restore: (response: NormalizedModelResponse) => NormalizedModelResponse;
}

const jsonEscape = (value: string): string => JSON.stringify(value).slice(1, -1);

/**
 * Applies a policy to one request. In `block` mode a request that carries a private value is not
 * sent at all: it fails with `privacy_blocked` and a detail that names kinds and counts only.
 */
export function applyPrivacy(
  request: NormalizedModelRequest,
  policy: PrivacyPolicy,
): PrivacyResult {
  const identity: PrivacyResult = {
    request,
    report: EMPTY_PRIVACY_REPORT,
    restore: (response) => response,
  };
  if (policy.mode === 'off') return identity;

  const tokens = new Map<string, string>(); // identity key -> placeholder
  const originals = new Map<string, string>(); // placeholder -> original text
  const counters = new Map<PrivacyKind, number>();
  const byKind: Partial<Record<PrivacyKind, number>> = {};
  let total = 0;

  const maskText = (text: string): string => {
    const spans = findPrivateValues(text, policy.blockedWords);
    if (spans.length === 0) return text;
    let out = '';
    let cursor = 0;
    for (const span of spans) {
      let token = tokens.get(span.key);
      if (token === undefined) {
        const next = (counters.get(span.kind) ?? 0) + 1;
        counters.set(span.kind, next);
        token = `‹${span.kind}_${next}›`;
        tokens.set(span.key, token);
        originals.set(token, text.slice(span.start, span.end));
      }
      out += text.slice(cursor, span.start) + token;
      cursor = span.end;
      total += 1;
      byKind[span.kind] = (byKind[span.kind] ?? 0) + 1;
    }
    return out + text.slice(cursor);
  };

  const maskDeep = (value: unknown): unknown => {
    if (typeof value === 'string') return maskText(value);
    if (Array.isArray(value)) return value.map(maskDeep);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
    return value;
  };

  const maskCall = (call: ToolCall): ToolCall => ({ ...call, arguments: maskDeep(call.arguments) });
  const maskMessage = (message: ConversationMessage): ConversationMessage =>
    message.role === 'tool'
      ? { ...message, content: maskText(message.content) }
      : {
          ...message,
          content: maskText(message.content),
          ...(message.toolCalls ? { toolCalls: message.toolCalls.map(maskCall) } : {}),
        };

  const instructions =
    request.instructions === undefined ? undefined : maskText(request.instructions);
  const messages = request.messages.map(maskMessage);
  const report: PrivacyReport = { total, byKind };

  if (total === 0) return { ...identity, report };
  if (policy.mode === 'block') {
    const detail = Object.entries(byKind)
      .map(([kind, count]) => `${kind}:${count}`)
      .join(',');
    throw new ProviderError('permanent', PRIVACY_BLOCKED_CODE, null, null, detail);
  }

  const restoreWith = (escape: (value: string) => string) => (text: string) =>
    text.replace(PLACEHOLDER, (whole, id: string) => {
      const original = originals.get(`‹${id}›`);
      return original === undefined ? whole : escape(original);
    });
  const restorePlain = restoreWith((value) => value);
  const restoreInJson = restoreWith(jsonEscape);
  const restoreDeep = (value: unknown): unknown => {
    if (typeof value === 'string') return restorePlain(value);
    if (Array.isArray(value)) return value.map(restoreDeep);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreDeep(v)]));
    return value;
  };

  const masked: NormalizedModelRequest = {
    ...request,
    instructions: instructions ? `${instructions}\n\n${PRIVACY_INSTRUCTION}` : PRIVACY_INSTRUCTION,
    messages,
  };
  return {
    request: masked,
    report,
    restore: (response) => ({
      ...response,
      // With a response schema the text is JSON, so a value goes back as a JSON string body.
      text: request.responseSchema ? restoreInJson(response.text) : restorePlain(response.text),
      json: restoreDeep(response.json),
      toolCalls: response.toolCalls.map((call) => ({
        ...call,
        arguments: restoreDeep(call.arguments),
      })),
      ...(response.web ? { web: response.web } : {}),
    }),
  };
}

/** Parses the stored policy of a project; anything unexpected falls back to the default. */
export function parsePrivacyPolicy(mode: unknown, blockedWords: unknown): PrivacyPolicy {
  const safeMode = (PRIVACY_MODES as readonly unknown[]).includes(mode)
    ? (mode as PrivacyMode)
    : DEFAULT_PRIVACY_POLICY.mode;
  const words = Array.isArray(blockedWords)
    ? blockedWords.filter((word): word is string => typeof word === 'string' && word.trim() !== '')
    : [];
  return { mode: safeMode, blockedWords: words };
}
