import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { UrlFetchError, type FetchedUrl } from '@docoo/ingestion/url-fetch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  pagesToRead,
  pageText,
  READ_LIMITS,
  readPages,
  relevantExcerpt,
  searchTerms,
} from './page-reading.js';
import type { WebPassage } from './research.js';

const page = (n: number, over: Partial<WebPassage> = {}): WebPassage => ({
  ref: `W${n}`,
  url: `https://site${n}.test/p`,
  title: `Page ${n}`,
  text: `notes ${n}`,
  sourceClass: 'public',
  ...over,
});
const bytes = (text: string) => new TextEncoder().encode(text);
const fetched = (contentType: string, body: string): FetchedUrl => ({
  finalUrl: 'https://x.test/',
  status: 200,
  contentType,
  bytes: bytes(body),
  address: '93.184.216.34',
  fetchedAt: new Date().toISOString(),
});

describe('pagesToRead', () => {
  it('puts pages both models found first, then official pages, then the rest in order, up to the limit', () => {
    const sources = [
      page(1),
      page(2, { sourceClass: 'official' }),
      page(3, { foundBy: ['primary', 'second'] }),
      page(4),
      page(5, { sourceClass: 'official' }),
    ];
    expect(pagesToRead(sources, 4).map((item) => item.ref)).toEqual(['W3', 'W2', 'W5', 'W1']);
  });

  it('reads each address once, never a non-web address, never more than the cap, and nothing for 0', () => {
    const sources = [
      page(1),
      page(2, { url: 'https://site1.test/p' }),
      page(3, { url: 'file:///etc/passwd' }),
      page(4, { url: 'ftp://x.test/a' }),
      page(5, { url: 'javascript:alert(1)' }),
    ];
    expect(pagesToRead(sources, 5).map((item) => item.ref)).toEqual(['W1']);
    const many = Array.from({ length: 30 }, (_, i) => page(i + 1));
    expect(pagesToRead(many, 99)).toHaveLength(READ_LIMITS.maxPages);
    expect(pagesToRead(many, 0)).toEqual([]);
  });
});

describe('relevantExcerpt', () => {
  const filler = (n: number) =>
    `Unrelated navigation or footer text number ${n} about nothing. `.repeat(3);

  it('returns a short page whole', () => {
    expect(relevantExcerpt('A short page.', ['market'], 100)).toBe('A short page.');
  });

  it('keeps the paragraphs that hold the question words, in page order, within the budget', () => {
    const text = [
      filler(1),
      'The market size reached 12,500 units in 2023, a record for the market.',
      filler(2),
      'Prices of units fell while the market grew by 8.5 percent.',
      filler(3),
    ].join('\n');
    const terms = searchTerms(['market size units']);
    const excerpt = relevantExcerpt(text, terms, 160);
    expect(excerpt).toContain('12,500 units');
    expect(excerpt).not.toContain('navigation');
    expect(excerpt.length).toBeLessThanOrEqual(160);
    expect(excerpt.indexOf('12,500')).toBeLessThan(excerpt.indexOf('Prices'));
  });

  it('gives the beginning of a page when nothing matches, and never more than the budget', () => {
    const text = Array.from({ length: 50 }, (_, i) => filler(i)).join('\n');
    const excerpt = relevantExcerpt(text, ['zzzz'], 200);
    expect(excerpt).toBe(text.trim().slice(0, 200));
  });
});

describe('searchTerms and pageText', () => {
  it('takes the distinct words of more than two letters', () => {
    expect(searchTerms(['Market size of the market', 'size in units'])).toEqual(
      expect.arrayContaining(['market', 'size', 'the', 'units']),
    );
    expect(searchTerms(['of in a'])).toEqual([]);
  });

  it('reads HTML without scripts, plain text, and nothing of a PDF or an image', () => {
    const html =
      '<html><title>T</title><script>evil()</script><body><p>Hello <b>world</b></p></body></html>';
    expect(pageText(fetched('text/html; charset=utf-8', html))).toContain('Hello world');
    expect(pageText(fetched('text/html', html))).not.toContain('evil');
    expect(pageText(fetched('text/plain', 'just text'))).toBe('just text');
    expect(pageText(fetched('application/pdf', '%PDF'))).toBeNull();
    expect(pageText(fetched('image/png', 'x'))).toBeNull();
  });

  it('decodes the charset a page declares, and falls back to UTF-8 for one it does not know', () => {
    const cp1256 = new Uint8Array([0xd3, 0xe1, 0xc7, 0xe3]); // "سلام" in windows-1256
    expect(pageText({ bytes: cp1256, contentType: 'text/plain; charset=windows-1256' })).toBe(
      'سلام',
    );
    expect(pageText({ bytes: bytes('ok'), contentType: 'text/plain; charset=nonsense-9' })).toBe(
      'ok',
    );
  });
});

describe('readPages', () => {
  const base = { max: 5, terms: ['market'], policy: 'public' as const, allowlist: [] };

  it('does not touch the network when the owner’s URL policy denies fetching', async () => {
    const result = await readPages({
      ...base,
      policy: 'deny',
      sources: [page(1)],
      fetch: () => Promise.reject(new Error('must not be called')),
    });
    expect(result.info.status).toBe('denied');
    expect(result.sources[0]).toEqual(page(1));
  });

  it('extends a read page with its relevant part, marks it, and leaves the rest as they were', async () => {
    const result = await readPages({
      ...base,
      sources: [page(1), page(2)],
      fetch: (url) =>
        url.includes('site1')
          ? Promise.resolve(fetched('text/html', '<p>The market reached 12,500 units in 2023.</p>'))
          : Promise.reject(new UrlFetchError('url_http_404')),
    });
    expect(result.info).toMatchObject({ status: 'used', read: 1, failed: 1 });
    expect(result.info.entries).toEqual([
      { ref: 'W1', status: 'read', code: null },
      { ref: 'W2', status: 'failed', code: 'url_http_404' },
    ]);
    expect(result.sources[0]).toMatchObject({ read: true });
    expect(result.sources[0]!.text).toContain('notes 1');
    expect(result.sources[0]!.text).toContain('12,500 units');
    expect(result.sources[1]).toEqual(page(2));
  });

  it('records why a page was not read: unsupported type, empty page, unknown error', async () => {
    const result = await readPages({
      ...base,
      sources: [page(1), page(2), page(3)],
      fetch: (url) => {
        if (url.includes('site1')) return Promise.resolve(fetched('application/pdf', '%PDF'));
        if (url.includes('site2')) return Promise.resolve(fetched('text/plain', '   '));
        return Promise.reject(new Error('socket hang up with a secret address 10.0.0.1'));
      },
    });
    expect(result.info.status).toBe('none');
    expect(result.info.entries.map((entry) => [entry.status, entry.code])).toEqual([
      ['skipped', 'unsupported_type'],
      ['skipped', 'empty_page'],
      ['failed', 'read_failed'],
    ]);
    // The code never carries the text of an error.
    expect(JSON.stringify(result.info)).not.toContain('10.0.0.1');
  });

  it('strips control characters from a page', async () => {
    const result = await readPages({
      ...base,
      sources: [page(1)],
      fetch: () =>
        Promise.resolve(fetched('text/plain', 'market\u0000data\u0007 stays\nnext line')),
    });
    expect(result.sources[0]!.text).toContain('marketdata stays\nnext line');
  });

  it('reads at most three pages at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    const result = await readPages({
      ...base,
      max: 10,
      sources: Array.from({ length: 9 }, (_, i) => page(i + 1)),
      fetch: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return fetched('text/plain', 'market text');
      },
    });
    expect(result.info.read).toBe(9);
    expect(peak).toBeLessThanOrEqual(READ_LIMITS.concurrency);
  });

  it('starts no new page after the time budget, and says so', async () => {
    let clock = 0;
    const result = await readPages({
      ...base,
      max: 4,
      sources: [page(1), page(2), page(3), page(4)],
      now: () => clock,
      fetch: () => {
        clock += READ_LIMITS.budgetMs; // each fetch "takes" the whole budget
        return Promise.resolve(fetched('text/plain', 'market text'));
      },
    });
    expect(result.info.entries.some((entry) => entry.code === 'read_budget')).toBe(true);
    expect(result.info.read).toBeGreaterThanOrEqual(1);
  });
});

describe('readPages through the real guarded fetcher', () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(
        request.url === '/big'
          ? `<p>${'x'.repeat(3_000_000)}</p>`
          : '<html><body><p>The market reached 12,500 units in 2023.</p></body></html>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('refuses a loopback address even when its port is allowed: nothing local can be read', async () => {
    const result = await readPages({
      max: 5,
      terms: ['market'],
      policy: 'public',
      allowlist: [],
      sources: [
        page(1, { url: `http://127.0.0.1:${port}/` }),
        page(2, { url: `http://localhost:${port}/` }),
      ],
      fetchOptions: { allowedPorts: [String(port)] },
    });
    expect(result.info.read).toBe(0);
    expect(result.info.entries.map((entry) => entry.code)).toEqual([
      'url_private_address',
      'url_private_address',
    ]);
  });

  it('refuses a port other than 80 and 443 under the default rules', async () => {
    const result = await readPages({
      max: 5,
      terms: [],
      policy: 'public',
      allowlist: [],
      sources: [page(1, { url: `http://example.test:${port}/` })],
    });
    expect(result.info.entries[0]).toMatchObject({ status: 'failed', code: 'url_port' });
  });

  it('refuses a host the allowlist does not name, whatever it resolves to', async () => {
    const result = await readPages({
      max: 5,
      terms: [],
      policy: 'allowlist',
      allowlist: ['other.test'],
      sources: [page(1, { url: `http://example.test:${port}/` })],
      fetchOptions: {
        resolve: () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
        allowedPorts: [String(port)],
      },
    });
    expect(result.info.entries[0]).toMatchObject({ status: 'failed', code: 'url_not_allowlisted' });
  });

  it('reads an allowed page end to end, and refuses one over the size limit', async () => {
    const options = {
      resolve: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
      addressAllowed: () => true,
      allowedPorts: [String(port)],
    };
    const result = await readPages({
      max: 5,
      terms: ['market'],
      policy: 'allowlist',
      allowlist: ['example.test'],
      sources: [
        page(1, { url: `http://example.test:${port}/ok` }),
        page(2, { url: `http://example.test:${port}/big` }),
      ],
      fetchOptions: options,
    });
    expect(result.info.entries.map((entry) => [entry.status, entry.code])).toEqual([
      ['read', null],
      ['failed', 'url_too_large'],
    ]);
    expect(result.sources[0]!.text).toContain('12,500 units in 2023');
  });
});
