import {
  fetchPriceCatalog,
  PriceCatalogError,
  type PriceCatalog,
  type PriceCatalogClientOptions,
} from '@docoo/providers';

export const PRICE_CATALOG = Symbol('PRICE_CATALOG');

export interface LoadedPriceCatalog {
  readonly catalog: PriceCatalog;
  /** When this copy was downloaded (ISO 8601). */
  readonly fetchedAt: string;
}

/** Where the model price catalog comes from; tests replace it with a fixed one. */
export interface PriceCatalogSource {
  load(options: { refresh: boolean }): Promise<LoadedPriceCatalog>;
}

/** A copy is reused this long, so opening the preview twice does not download twice. */
const FRESH_MS = 10 * 60_000;
/** Even "refresh" never downloads more often than this, so clicking cannot hammer the source. */
const MIN_INTERVAL_MS = 30_000;

/**
 * Downloads the public price catalog on demand and keeps the last copy for a few minutes. Nothing runs
 * in the background: the catalog is read only when an administrator asks for prices.
 */
export class CachedPriceCatalogSource implements PriceCatalogSource {
  private current: LoadedPriceCatalog | null = null;
  private fetchedAtMs = 0;
  private inFlight: Promise<LoadedPriceCatalog> | null = null;

  constructor(
    private readonly options: PriceCatalogClientOptions = {},
    private readonly now: () => number = Date.now,
  ) {}

  async load({ refresh }: { refresh: boolean }): Promise<LoadedPriceCatalog> {
    const age = this.now() - this.fetchedAtMs;
    if (this.current && age < (refresh ? MIN_INTERVAL_MS : FRESH_MS)) return this.current;
    // One download at a time: concurrent callers share the same answer.
    this.inFlight ??= this.download().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async download(): Promise<LoadedPriceCatalog> {
    const catalog = await fetchPriceCatalog(this.options);
    const fetchedAtMs = this.now();
    this.fetchedAtMs = fetchedAtMs;
    this.current = { catalog, fetchedAt: new Date(fetchedAtMs).toISOString() };
    return this.current;
  }
}

export { PriceCatalogError };
