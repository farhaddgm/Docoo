import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

export type UrlPolicy = 'deny' | 'allowlist' | 'public';

export interface UrlFetchOptions {
  readonly policy: UrlPolicy;
  readonly allowlist: readonly string[];
  readonly maxBytes: number;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  /** Resolver override (tests). */
  readonly resolve?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  /** Address filter override (tests); defaults to public addresses only. */
  readonly addressAllowed?: (address: string) => boolean;
  /** Ports a URL may use; defaults to 80 and 443. */
  readonly allowedPorts?: readonly string[];
}

export interface FetchedUrl {
  readonly finalUrl: string;
  readonly status: number;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly address: string;
  readonly fetchedAt: string;
}

export class UrlFetchError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Addresses no fetch may reach: private, loopback, link-local, metadata, multicast, reserved. */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:xxxx:xxxx) is judged by its IPv4 address.
  // (A ::ffff:0:0/96 rule in the BlockList would also match every plain IPv4 address.)
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/iu.exec(
    address,
  );
  if (mapped) {
    const v4 =
      mapped[1] ??
      [
        parseInt(mapped[2]!, 16) >> 8,
        parseInt(mapped[2]!, 16) & 255,
        parseInt(mapped[3]!, 16) >> 8,
        parseInt(mapped[3]!, 16) & 255,
      ].join('.');
    return isPublicAddress(v4);
  }
  return !BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export function hostAllowed(hostname: string, allowlist: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, '');
  return allowlist.some((domain) => {
    const entry = domain.toLowerCase().replace(/^\*\./u, '').replace(/\.$/u, '');
    return host === entry || host.endsWith(`.${entry}`);
  });
}

const ALLOWED_TYPES = [
  'text/html',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.',
  'image/png',
  'image/jpeg',
];

/** Checks a URL before any network access: scheme, credentials, port and policy. */
export function validateUrl(
  raw: string,
  options: Pick<UrlFetchOptions, 'policy' | 'allowlist' | 'allowedPorts'>,
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlFetchError('url_invalid');
  }
  if (options.policy === 'deny') throw new UrlFetchError('url_policy_denied');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UrlFetchError('url_scheme');
  if (url.username || url.password) throw new UrlFetchError('url_credentials');
  if (url.port && !(options.allowedPorts ?? ['80', '443']).includes(url.port)) {
    throw new UrlFetchError('url_port');
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new UrlFetchError('url_private_address');
  if (
    /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/iu.test(hostname)
  ) {
    throw new UrlFetchError('url_private_address');
  }
  if (options.policy === 'allowlist' && !hostAllowed(hostname, options.allowlist)) {
    throw new UrlFetchError('url_not_allowlisted');
  }
  return url;
}

/**
 * SSRF-guarded fetch (ING-006): every hop is validated, the DNS answer is checked and then
 * pinned for the connection (no rebinding between check and connect), redirects are
 * limited and the body is capped.
 */
export async function fetchUrl(raw: string, options: UrlFetchOptions): Promise<FetchedUrl> {
  const resolve =
    options.resolve ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));
  let current = raw;
  for (let hop = 0; hop <= (options.maxRedirects ?? 3); hop += 1) {
    const url = validateUrl(current, options);
    const hostname = url.hostname.replace(/^\[|\]$/gu, '');
    let addresses: { address: string; family: number }[];
    if (isIP(hostname)) {
      addresses = [{ address: hostname, family: isIP(hostname) }];
    } else {
      try {
        addresses = await resolve(hostname);
      } catch {
        throw new UrlFetchError('url_dns_failed');
      }
    }
    const allowed = options.addressAllowed ?? isPublicAddress;
    if (addresses.length === 0 || addresses.some((entry) => !allowed(entry.address))) {
      throw new UrlFetchError('url_private_address');
    }
    const pinned = addresses[0]!;
    const response = await request(url, pinned, options);
    if (response.status >= 300 && response.status < 400 && response.location) {
      current = new URL(response.location, url).toString();
      continue;
    }
    if (response.status !== 200) throw new UrlFetchError(`url_http_${response.status}`);
    if (!ALLOWED_TYPES.some((type) => response.contentType.startsWith(type))) {
      throw new UrlFetchError('url_content_type');
    }
    return {
      finalUrl: url.toString(),
      status: response.status,
      contentType: response.contentType,
      bytes: response.bytes,
      address: pinned.address,
      fetchedAt: new Date().toISOString(),
    };
  }
  throw new UrlFetchError('url_too_many_redirects');
}

function request(
  url: URL,
  pinned: { address: string; family: number },
  options: UrlFetchOptions,
): Promise<{ status: number; contentType: string; location: string | null; bytes: Uint8Array }> {
  const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'GET',
        lookup,
        agent: false,
        headers: { 'user-agent': 'DocooIngest/1.0', accept: '*/*', 'accept-encoding': 'identity' },
        timeout: options.timeoutMs ?? 20_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
        const location = typeof res.headers.location === 'string' ? res.headers.location : null;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, contentType, location, bytes: new Uint8Array() });
          return;
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > options.maxBytes) {
          res.destroy();
          reject(new UrlFetchError('url_too_large'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            res.destroy();
            reject(new UrlFetchError('url_too_large'));
          } else {
            chunks.push(chunk);
          }
        });
        res.on('end', () =>
          resolve({ status, contentType, location, bytes: new Uint8Array(Buffer.concat(chunks)) }),
        );
        res.on('error', () => reject(new UrlFetchError('url_read_failed')));
      },
    );
    req.on('timeout', () => req.destroy(new UrlFetchError('url_timeout')));
    req.on('error', (error) =>
      reject(error instanceof UrlFetchError ? error : new UrlFetchError('url_connect_failed')),
    );
    req.end();
  });
}

/** Readable text of an HTML page: scripts, styles and markup removed, entities decoded. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1]?.trim() ?? null;
  const text = html
    .replace(/<(script|style|noscript|template|svg|iframe)[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)\s*>|<br\s*\/?>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{2,}/gu, '\n\n')
    .trim();
  return { title: title ? htmlToText(title).text : null, text };
}
