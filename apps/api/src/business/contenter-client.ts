import { sanitizeError } from '@docoo/providers';

/** Why a call to Contenter did not give a usable answer. */
export type ContenterErrorKind =
  /** Nothing answered: wrong address, the server is down or too slow. */
  | 'unreachable'
  /** The service token was refused. */
  | 'unauthorized'
  /** The service API is not there (switched off in Contenter, or the address is not Contenter). */
  | 'not_available'
  | 'business_not_found'
  /** An answer that is not what the contract says. */
  | 'bad_response'
  | 'server_error';

export class ContenterError extends Error {
  constructor(
    readonly kind: ContenterErrorKind,
    readonly status: number | null = null,
    detail = '',
  ) {
    super(detail || kind);
    this.name = 'ContenterError';
  }
}

export interface ContenterClientOptions {
  /** The API root, for example https://contenter.example.com/api */
  readonly apiUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** The largest export read (the export itself is far smaller; this only stops a runaway answer). */
const DEFAULT_MAX_BYTES = 6_000_000;

/**
 * Reads Contenter's service API (docs/18-docoo-integration.md of Contenter). One fixed base address,
 * no redirects, a time limit and a size limit; the token is sent only as a bearer header and is
 * never part of an error message.
 */
export class ContenterClient {
  private readonly base: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ContenterClientOptions) {
    this.base = options.apiUrl.replace(/\/+$/u, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  ping(): Promise<unknown> {
    return this.get('/integrations/docoo/ping');
  }

  listBusinesses(query: { q?: string; page?: number; pageSize?: number }): Promise<unknown> {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.page) params.set('page', String(query.page));
    if (query.pageSize) params.set('pageSize', String(query.pageSize));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get(`/integrations/docoo/businesses${suffix}`);
  }

  exportBusiness(id: string): Promise<unknown> {
    return this.get(`/integrations/docoo/businesses/${encodeURIComponent(id)}/export`, id);
  }

  private async get(path: string, businessId?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: 'application/json', authorization: `Bearer ${this.token}` },
      });
    } catch (error) {
      throw new ContenterError('unreachable', null, this.describe(error));
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > this.maxBytes)
      throw new ContenterError('bad_response', response.status, 'too_large');
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new ContenterError('unreachable', response.status, this.describe(error));
    }
    if (text.length > this.maxBytes)
      throw new ContenterError('bad_response', response.status, 'too_large');

    if (response.status === 401 || response.status === 403) {
      throw new ContenterError('unauthorized', response.status);
    }
    if (response.status === 404) {
      throw new ContenterError(
        businessId !== undefined && this.messageOf(text) === 'Business not found'
          ? 'business_not_found'
          : 'not_available',
        404,
      );
    }
    if (response.status >= 500) throw new ContenterError('server_error', response.status);
    if (!response.ok) throw new ContenterError('bad_response', response.status);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ContenterError('bad_response', response.status, 'not_json');
    }
  }

  private messageOf(text: string): string {
    try {
      const body = JSON.parse(text) as { message?: unknown };
      return typeof body.message === 'string' ? body.message : '';
    } catch {
      return '';
    }
  }

  /** A short reason for the administrator, without the token or anything key-like. */
  private describe(error: unknown): string {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return 'timeout';
    }
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
    const code = cause && 'code' in cause && typeof cause.code === 'string' ? cause.code : '';
    return sanitizeError(code || (error instanceof Error ? error.message : 'request_failed'), [
      this.token,
    ]).slice(0, 200);
  }
}
