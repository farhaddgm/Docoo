import { createHash } from 'node:crypto';

import { sanitizeError } from './secrets.js';

/**
 * Prices taken from a public catalog instead of being typed in (ADR-0022). The default source is
 * LiteLLM's community-maintained `model_prices_and_context_window.json`: it lists, per model, the
 * price of one token, which is converted here to USD per million tokens. Nothing from the workspace
 * (no key, no model name, no content) is sent to it; it is one plain GET.
 *
 * The catalog is only a *suggestion*: the administrator sees every price next to the current one and
 * chooses what to save, and a price that cannot be trusted (zero, missing, not a number) is never
 * offered, because a zero price would switch the cost ceiling off for that model.
 */

export const DEFAULT_PRICE_CATALOG_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
/** Short name stored with every price that came from the catalog. */
export const PRICE_CATALOG_SOURCE = 'litellm';

export type CatalogProvider = 'openai' | 'gemini' | 'anthropic';

/** One usable price of one model, in USD per million tokens. */
export interface CatalogPrice {
  readonly provider: CatalogProvider;
  /** The model id as the provider's own API names it (Gemini without the `gemini/` prefix). */
  readonly model: string;
  /** The key of the entry in the catalog file, kept as the reference of the price. */
  readonly key: string;
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cachedInputPerMillion: number | null;
  /** Only when the catalog gives reasoning tokens a price different from output. */
  readonly reasoningPerMillion: number | null;
  readonly maxOutputTokens: number | null;
  /** `YYYY-MM-DD` when the catalog says the model is retired on that day. */
  readonly deprecationDate: string | null;
  /** The model has a dearer price above some prompt length; only the base price is read. */
  readonly tiered: boolean;
}

export type CatalogRejection = 'no_price' | 'zero_price';

export interface PriceCatalog {
  /** sha256 of the canonical content that matters to Docoo; unrelated entries never change it. */
  readonly hash: string;
  readonly prices: ReadonlyMap<string, CatalogPrice>;
  /** Entries of a known provider that were left out, and why (`provider:model` → reason). */
  readonly rejected: ReadonlyMap<string, CatalogRejection>;
}

export type CatalogMatch = 'exact' | 'alias';

export interface CatalogLookup {
  readonly match: CatalogMatch;
  readonly price: CatalogPrice;
}

const PROVIDERS: Readonly<Record<string, CatalogProvider>> = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
};
/** Text models only: embeddings, images, speech and the like can never answer a platform call. */
const TEXT_MODES = new Set(['chat', 'responses', 'completion']);
const MAX_PER_MILLION = 10_000;

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** USD per token → USD per million tokens, without the float noise of 0.3 × 1e6. */
export function perMillion(perToken: number): number {
  return Math.round(perToken * 1e6 * 1e6) / 1e6;
}

function modelIdOf(provider: CatalogProvider, key: string): string | null {
  if (provider === 'gemini') return key.startsWith('gemini/') ? key.slice('gemini/'.length) : null;
  // Keys with a slash (`low/1024-x-1024/gpt-image-1`, `openai/...`) are variants, not model ids.
  return key.includes('/') ? null : key;
}

/** Reads the catalog file; anything that is not a usable text-model price is left out. */
export function parsePriceCatalog(raw: unknown): PriceCatalog {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PriceCatalogError('bad_response', 'not_an_object');
  }
  const prices = new Map<string, CatalogPrice>();
  const rejected = new Map<string, CatalogRejection>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const providerName = entry['litellm_provider'];
    const mode = entry['mode'];
    const provider = typeof providerName === 'string' ? PROVIDERS[providerName] : undefined;
    if (!provider || typeof mode !== 'string' || !TEXT_MODES.has(mode)) continue;
    const model = modelIdOf(provider, key);
    if (!model) continue;
    const identity = `${provider}:${model}`;

    const input = asNumber(entry['input_cost_per_token']);
    const output = asNumber(entry['output_cost_per_token']);
    if (input === null || output === null || input < 0 || output < 0) {
      rejected.set(identity, 'no_price');
      continue;
    }
    const inputPerMillion = perMillion(input);
    const outputPerMillion = perMillion(output);
    // Zero means "free" or "not filled in"; either way it would turn the cost ceiling off.
    if (inputPerMillion <= 0 || outputPerMillion <= 0) {
      rejected.set(identity, 'zero_price');
      continue;
    }
    if (inputPerMillion > MAX_PER_MILLION || outputPerMillion > MAX_PER_MILLION) {
      rejected.set(identity, 'no_price');
      continue;
    }

    const cached = asNumber(entry['cache_read_input_token_cost']);
    const reasoning = asNumber(entry['output_cost_per_reasoning_token']);
    const maxOutput = asNumber(entry['max_output_tokens']);
    const deprecation = entry['deprecation_date'];
    const reasoningPerMillion =
      reasoning !== null && reasoning > 0 && perMillion(reasoning) !== outputPerMillion
        ? perMillion(reasoning)
        : null;
    prices.set(identity, {
      provider,
      model,
      key,
      inputPerMillion,
      outputPerMillion,
      cachedInputPerMillion:
        cached !== null && cached >= 0 && perMillion(cached) <= MAX_PER_MILLION
          ? perMillion(cached)
          : null,
      reasoningPerMillion:
        reasoningPerMillion !== null && reasoningPerMillion <= MAX_PER_MILLION
          ? reasoningPerMillion
          : null,
      maxOutputTokens: maxOutput !== null && maxOutput > 0 ? Math.floor(maxOutput) : null,
      deprecationDate:
        typeof deprecation === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(deprecation)
          ? deprecation
          : null,
      tiered: Object.keys(entry).some((name) => /_above_\d+k_tokens$/u.test(name)),
    });
  }
  const canonical = [...prices.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([identity, price]) => [
      identity,
      price.inputPerMillion,
      price.outputPerMillion,
      price.cachedInputPerMillion,
      price.reasoningPerMillion,
    ]);
  return {
    hash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
    prices,
    rejected,
  };
}

/** `gpt-4o-2024-08-06` and `claude-sonnet-4-5-20250929` → the same model without its date. */
export function withoutDate(model: string): string | null {
  const stripped = model.replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/u, '');
  return stripped === model ? null : stripped;
}

/**
 * The catalog price of a model: the exact id first, then the id without a date suffix (a dated
 * snapshot normally costs what its alias costs, but that is a guess, so it is marked `alias`).
 */
export function lookupCatalogPrice(
  catalog: PriceCatalog,
  provider: CatalogProvider,
  model: string,
): CatalogLookup | null {
  const exact = catalog.prices.get(`${provider}:${model}`);
  if (exact) return { match: 'exact', price: exact };
  const base = withoutDate(model);
  const alias = base === null ? undefined : catalog.prices.get(`${provider}:${base}`);
  return alias ? { match: 'alias', price: alias } : null;
}

/** Why a model has no usable catalog price, for the preview. */
export function catalogRejection(
  catalog: PriceCatalog,
  provider: CatalogProvider,
  model: string,
): CatalogRejection | null {
  const base = withoutDate(model);
  return (
    catalog.rejected.get(`${provider}:${model}`) ??
    (base === null ? undefined : catalog.rejected.get(`${provider}:${base}`)) ??
    null
  );
}

export interface PriceValues {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cachedInputPerMillion: number | null;
  readonly reasoningPerMillion: number | null;
}

const SAME_TOLERANCE = 1e-6;
const sameNumber = (a: number | null, b: number | null): boolean =>
  a === null || b === null ? a === b : Math.abs(a - b) <= SAME_TOLERANCE;

/** Whether two prices are the same in every field the platform uses. */
export function samePrice(a: PriceValues, b: PriceValues): boolean {
  return (
    sameNumber(a.inputPerMillion, b.inputPerMillion) &&
    sameNumber(a.outputPerMillion, b.outputPerMillion) &&
    sameNumber(a.cachedInputPerMillion, b.cachedInputPerMillion) &&
    sameNumber(a.reasoningPerMillion, b.reasoningPerMillion)
  );
}

export type PriceCatalogErrorKind = 'unreachable' | 'bad_response' | 'too_large';

export class PriceCatalogError extends Error {
  constructor(
    readonly kind: PriceCatalogErrorKind,
    detail = '',
  ) {
    super(detail || kind);
    this.name = 'PriceCatalogError';
  }
}

/** https only; plain http is accepted for this machine alone (a stand-in during tests), never for a remote host. */
export function isAllowedCatalogUrl(url: string): boolean {
  if (url.startsWith('https://')) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/u.test(url);
}

export interface PriceCatalogClientOptions {
  readonly url?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** The file is about 3 MB; this only stops a runaway answer. */
const DEFAULT_MAX_BYTES = 12_000_000;

/** Reads the catalog: one fixed https address, no redirects, a time limit and a size limit. */
export async function fetchPriceCatalog(
  options: PriceCatalogClientOptions = {},
): Promise<PriceCatalog> {
  const url = options.url ?? DEFAULT_PRICE_CATALOG_URL;
  if (!isAllowedCatalogUrl(url)) throw new PriceCatalogError('bad_response', 'not_https');
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new PriceCatalogError('unreachable', describe(error));
  }
  if (!response.ok) throw new PriceCatalogError('bad_response', `status_${response.status}`);
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    throw new PriceCatalogError('too_large');
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new PriceCatalogError('unreachable', describe(error));
  }
  if (text.length > maxBytes) throw new PriceCatalogError('too_large');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PriceCatalogError('bad_response', 'not_json');
  }
  const catalog = parsePriceCatalog(raw);
  // A file that holds no price of a known provider is not this catalog.
  if (catalog.prices.size === 0) throw new PriceCatalogError('bad_response', 'no_prices');
  return catalog;
}

function describe(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'timeout';
  }
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
  const code = cause && 'code' in cause && typeof cause.code === 'string' ? cause.code : '';
  return sanitizeError(code || (error instanceof Error ? error.message : 'request_failed')).slice(
    0,
    200,
  );
}
