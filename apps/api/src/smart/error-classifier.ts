import { createHash } from 'node:crypto';

export type ErrorSource = 'server' | 'client';
/** How the browser caught the error (reported by the web error reporter). */
export type ClientErrorKind = 'runtime' | 'promise' | 'render' | 'api';

export const ERROR_CATEGORIES = [
  'database',
  'validation',
  'permission',
  'network',
  'provider',
  'not_found',
  'ui',
  'unknown',
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const MESSAGE_LIMIT = 500;
export const STACK_LIMIT = 4000;
const CONTEXT_STRING_LIMIT = 300;
const CONTEXT_ARRAY_LIMIT = 20;
const CONTEXT_KEY_LIMIT = 30;
const CONTEXT_DEPTH_LIMIT = 4;

const secretKeys = /password|secret|token|api[_-]?key|credential|cookie|authorization/i;
/** PostgreSQL errors reach us as `[SQLSTATE] message` (see describeFailure). */
const sqlStatePattern = /^\[(?:[0-9]{2}|P0|XX|HV|F0)[0-9A-Z]{3}\]/;
const databasePattern =
  /relation ".*" does not exist|violates .*constraint|duplicate key|deadlock|statement timeout|connection terminated|too many clients|prepared statement|current transaction is aborted|row-level security|\bpg\b|postgres|ECONNREFUSED.*5432/i;
const providerPattern =
  /\bprovider\b|\bopenai\b|\banthropic\b|\bgemini\b|ai_connection|ai_secret|model_not|rate.?limit|quota/i;
const networkPattern =
  /failed to fetch|networkerror|load failed|network request failed|econnreset|econnrefused|etimedout|socket hang up|fetch failed|timeout/i;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export interface ClassifyInput {
  readonly source: ErrorSource;
  readonly message: string;
  readonly status?: number | null | undefined;
  readonly kind?: ClientErrorKind | undefined;
}

/**
 * Rule-based first analysis (SMT-001): no model is involved, so the same error always lands
 * in the same category and its fingerprint stays stable.
 */
export function categorize(input: ClassifyInput): ErrorCategory {
  const { message, status } = input;
  if (sqlStatePattern.test(message) || databasePattern.test(message)) return 'database';
  if (providerPattern.test(message)) return 'provider';
  if (networkPattern.test(message)) return 'network';
  if (status === 400 || status === 422) return 'validation';
  if (status === 401 || status === 403) return 'permission';
  if (status === 404) return 'not_found';
  if (status === 502 || status === 503 || status === 504) return 'network';
  if (input.source === 'client' && input.kind !== 'api') return 'ui';
  return 'unknown';
}

/** Masks values that look like credentials or addresses and caps the length. */
export function scrubMessage(value: string, limit = MESSAGE_LIMIT): string {
  const cleaned = value
    .replace(/(bearer\s+)[a-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|pk|key|tok)[-_][A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned;
}

export function scrubStack(value: string | null | undefined): string | null {
  if (!value) return null;
  return scrubMessage(value, STACK_LIMIT);
}

/** Replaces ids and numbers so a recurring error maps to one fingerprint. */
export function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(uuidPattern, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/g, '<hex>')
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, '<time>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** `/fa/projects/3f2…/documents?x=1` → `/fa/projects/:id/documents`. */
export function normalizePath(path: string | null | undefined): string {
  if (!path) return '';
  const clean = (path.split(/[?#]/)[0] ?? '').slice(0, 300);
  return clean
    .split('/')
    .map((segment) => (uuidPattern.test(segment) || /^\d+$/.test(segment) ? ':id' : segment))
    .join('/')
    .replace(uuidPattern, ':id');
}

export interface FingerprintInput {
  readonly source: ErrorSource;
  readonly category: ErrorCategory;
  readonly method?: string | null | undefined;
  readonly route?: string | null | undefined;
  readonly message: string;
}

export function fingerprint(input: FingerprintInput): string {
  return createHash('sha256')
    .update(
      [
        input.source,
        input.category,
        (input.method ?? '').toUpperCase(),
        normalizePath(input.route),
        normalizeMessage(input.message),
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 40);
}

/**
 * Deep copy that is safe to store: secret-looking keys are masked, strings, arrays and
 * objects are capped. Never feed request bodies through this; they are not stored at all.
 */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return scrubMessage(value, CONTEXT_STRING_LIMIT);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= CONTEXT_DEPTH_LIMIT) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, CONTEXT_ARRAY_LIMIT).map((item) => sanitize(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value as Record<string, unknown>).slice(
      0,
      CONTEXT_KEY_LIMIT,
    )) {
      result[key] = secretKeys.test(key) ? '[REDACTED]' : sanitize(field, depth + 1);
    }
    return result;
  }
  return null;
}
