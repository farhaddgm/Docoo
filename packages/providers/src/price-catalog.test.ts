import { describe, expect, it } from 'vitest';

import {
  catalogRejection,
  fetchPriceCatalog,
  lookupCatalogPrice,
  parsePriceCatalog,
  perMillion,
  PriceCatalogError,
  samePrice,
  withoutDate,
} from './index.js';

/** A small file in the shape of the real catalog. */
const FILE = {
  sample_spec: { litellm_provider: 'one of https://docs.litellm.ai/docs/providers', mode: 'chat' },
  'gpt-4o': {
    litellm_provider: 'openai',
    mode: 'chat',
    input_cost_per_token: 0.0000025,
    output_cost_per_token: 0.00001,
    cache_read_input_token_cost: 0.00000125,
    max_output_tokens: 16384,
  },
  'gpt-5': {
    litellm_provider: 'openai',
    mode: 'responses',
    input_cost_per_token: 0.00000125,
    output_cost_per_token: 0.00001,
    output_cost_per_reasoning_token: 0.00002,
    deprecation_date: '2027-01-31',
  },
  'gpt-4o-mini': {
    litellm_provider: 'openai',
    mode: 'chat',
    input_cost_per_token: 1.5e-7,
    output_cost_per_token: 6e-7,
  },
  'text-embedding-3-small': {
    litellm_provider: 'openai',
    mode: 'embedding',
    input_cost_per_token: 2e-8,
    output_cost_per_token: 0,
  },
  'low/1024-x-1024/gpt-image-1': {
    litellm_provider: 'openai',
    mode: 'chat',
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.00004,
  },
  'claude-sonnet-4-5': {
    litellm_provider: 'anthropic',
    mode: 'chat',
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_read_input_token_cost: 3e-7,
    input_cost_per_token_above_200k_tokens: 0.000006,
  },
  'claude-haiku-4-5': {
    litellm_provider: 'anthropic',
    mode: 'chat',
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000005,
  },
  'gemini/gemini-2.5-flash': {
    litellm_provider: 'gemini',
    mode: 'chat',
    input_cost_per_token: 3e-7,
    output_cost_per_token: 0.0000025,
  },
  'gemini/gemini-free-preview': {
    litellm_provider: 'gemini',
    mode: 'chat',
    input_cost_per_token: 0,
    output_cost_per_token: 0,
  },
  'gemini/gemini-no-price': { litellm_provider: 'gemini', mode: 'chat' },
  'gemini/gemini-embedding-001': {
    litellm_provider: 'gemini',
    mode: 'embedding',
    input_cost_per_token: 1.5e-7,
    output_cost_per_token: 0,
  },
  'bedrock/claude-sonnet-4-5': {
    litellm_provider: 'bedrock',
    mode: 'chat',
    input_cost_per_token: 0.000099,
    output_cost_per_token: 0.000099,
  },
};

describe('price catalog', () => {
  it('converts a price per token to USD per million tokens without float noise', () => {
    expect(perMillion(0.0000025)).toBe(2.5);
    expect(perMillion(3e-7)).toBe(0.3);
    expect(perMillion(1.5e-7)).toBe(0.15);
    expect(perMillion(0.000015)).toBe(15);
  });

  it('keeps only usable text-model prices of the three providers', () => {
    const catalog = parsePriceCatalog(FILE);
    expect([...catalog.prices.keys()].sort()).toEqual([
      'anthropic:claude-haiku-4-5',
      'anthropic:claude-sonnet-4-5',
      'gemini:gemini-2.5-flash',
      'openai:gpt-4o',
      'openai:gpt-4o-mini',
      'openai:gpt-5',
    ]);
    // Other providers' prices for the same model name must never leak in.
    expect(catalog.prices.get('anthropic:claude-sonnet-4-5')?.inputPerMillion).toBe(3);
    expect(catalog.prices.get('openai:gpt-4o')).toMatchObject({
      key: 'gpt-4o',
      inputPerMillion: 2.5,
      outputPerMillion: 10,
      cachedInputPerMillion: 1.25,
      reasoningPerMillion: null,
      maxOutputTokens: 16384,
      tiered: false,
    });
    expect(catalog.prices.get('gemini:gemini-2.5-flash')).toMatchObject({
      key: 'gemini/gemini-2.5-flash',
      inputPerMillion: 0.3,
      outputPerMillion: 2.5,
    });
  });

  it('prices reasoning only when it differs from output, and flags tiered and retiring models', () => {
    const catalog = parsePriceCatalog(FILE);
    expect(catalog.prices.get('openai:gpt-5')).toMatchObject({
      reasoningPerMillion: 20,
      deprecationDate: '2027-01-31',
    });
    expect(catalog.prices.get('anthropic:claude-sonnet-4-5')?.tiered).toBe(true);
  });

  it('never offers a zero or missing price, because zero would switch the cost ceiling off', () => {
    const catalog = parsePriceCatalog(FILE);
    expect(catalog.prices.has('gemini:gemini-free-preview')).toBe(false);
    expect(catalogRejection(catalog, 'gemini', 'gemini-free-preview')).toBe('zero_price');
    expect(catalogRejection(catalog, 'gemini', 'gemini-no-price')).toBe('no_price');
    expect(catalogRejection(catalog, 'gemini', 'gemini-2.5-flash')).toBeNull();
  });

  it('rejects an absurd price and a file that is not an object', () => {
    const absurd = parsePriceCatalog({
      ...FILE,
      'gpt-absurd': {
        litellm_provider: 'openai',
        mode: 'chat',
        input_cost_per_token: 1,
        output_cost_per_token: 1,
      },
      'gpt-negative': {
        litellm_provider: 'openai',
        mode: 'chat',
        input_cost_per_token: -1e-6,
        output_cost_per_token: 1e-6,
      },
    });
    expect(absurd.prices.has('openai:gpt-absurd')).toBe(false);
    expect(absurd.prices.has('openai:gpt-negative')).toBe(false);
    expect(() => parsePriceCatalog([])).toThrow(PriceCatalogError);
    expect(() => parsePriceCatalog('x')).toThrow(PriceCatalogError);
  });

  it('matches the exact id first, then the id without its date, and says which it was', () => {
    const catalog = parsePriceCatalog(FILE);
    expect(lookupCatalogPrice(catalog, 'openai', 'gpt-4o')).toMatchObject({ match: 'exact' });
    const dated = lookupCatalogPrice(catalog, 'openai', 'gpt-4o-2024-08-06');
    expect(dated).toMatchObject({ match: 'alias' });
    expect(dated?.price.key).toBe('gpt-4o');
    const compact = lookupCatalogPrice(catalog, 'anthropic', 'claude-haiku-4-5-20251001');
    expect(compact).toMatchObject({ match: 'alias' });
    expect(lookupCatalogPrice(catalog, 'openai', 'gpt-unknown')).toBeNull();
    // A model name of one provider is never looked up under another.
    expect(lookupCatalogPrice(catalog, 'openai', 'claude-sonnet-4-5')).toBeNull();
    expect(withoutDate('gpt-4o')).toBeNull();
    expect(withoutDate('gemini-2.5-flash')).toBeNull();
  });

  it('hashes only what matters: other providers changing does not change it, a price does', () => {
    const base = parsePriceCatalog(FILE).hash;
    const otherProvider = parsePriceCatalog({
      ...FILE,
      'bedrock/claude-sonnet-4-5': {
        ...FILE['bedrock/claude-sonnet-4-5'],
        input_cost_per_token: 1,
      },
    }).hash;
    const changed = parsePriceCatalog({
      ...FILE,
      'gpt-4o': { ...FILE['gpt-4o'], input_cost_per_token: 0.000003 },
    }).hash;
    expect(otherProvider).toBe(base);
    expect(changed).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('compares prices field by field with a tolerance for float noise', () => {
    const a = {
      inputPerMillion: 2.5,
      outputPerMillion: 10,
      cachedInputPerMillion: null,
      reasoningPerMillion: null,
    };
    expect(samePrice(a, { ...a, inputPerMillion: 2.5000000001 })).toBe(true);
    expect(samePrice(a, { ...a, outputPerMillion: 10.5 })).toBe(false);
    expect(samePrice(a, { ...a, cachedInputPerMillion: 1.25 })).toBe(false);
  });
});

describe('price catalog download', () => {
  const answer = (body: string, init: ResponseInit = {}) =>
    (() => Promise.resolve(new Response(body, { status: 200, ...init }))) as typeof fetch;

  it('reads the catalog from a fixed https address without following redirects', async () => {
    let seen: { url: string; redirect?: string } | null = null;
    const fetchImpl = ((url: string, init?: RequestInit) => {
      seen = { url, ...(init?.redirect ? { redirect: init.redirect } : {}) };
      return Promise.resolve(new Response(JSON.stringify(FILE), { status: 200 }));
    }) as typeof fetch;
    const catalog = await fetchPriceCatalog({
      url: 'https://prices.example/catalog.json',
      fetchImpl,
    });
    expect(catalog.prices.size).toBe(6);
    expect(seen).toEqual({ url: 'https://prices.example/catalog.json', redirect: 'error' });
  });

  it('refuses a plain-http address, a failed answer, a huge answer, text that is not JSON and an empty catalog', async () => {
    const url = 'https://prices.example/catalog.json';
    for (const plain of [
      'http://prices.example/catalog.json',
      'http://localhost.evil.example/catalog.json',
      'http://127.0.0.1.evil.example/catalog.json',
    ]) {
      await expect(
        fetchPriceCatalog({ url: plain, fetchImpl: answer('{}') }),
      ).rejects.toMatchObject({ kind: 'bad_response', message: 'not_https' });
    }
    // This machine alone may use plain http (a stand-in during tests).
    await expect(
      fetchPriceCatalog({
        url: 'http://127.0.0.1:4010/catalog.json',
        fetchImpl: answer(JSON.stringify(FILE)),
      }),
    ).resolves.toMatchObject({ prices: expect.any(Map) });
    await expect(
      fetchPriceCatalog({ url, fetchImpl: answer('nope', { status: 503 }) }),
    ).rejects.toMatchObject({ kind: 'bad_response', message: 'status_503' });
    await expect(
      fetchPriceCatalog({ url, fetchImpl: answer(JSON.stringify(FILE)), maxBytes: 100 }),
    ).rejects.toMatchObject({ kind: 'too_large' });
    await expect(fetchPriceCatalog({ url, fetchImpl: answer('<html>') })).rejects.toMatchObject({
      kind: 'bad_response',
      message: 'not_json',
    });
    await expect(
      fetchPriceCatalog({ url, fetchImpl: answer(JSON.stringify({ gpt: 1 })) }),
    ).rejects.toMatchObject({ kind: 'bad_response', message: 'no_prices' });
  });

  it('reports an unreachable address with a short reason and no credential-like text', async () => {
    const fetchImpl = (() =>
      Promise.reject(
        new TypeError('fetch failed sk-abcdefghijklmnopqrstuvwxyz', {
          cause: Object.assign(new Error('x'), { code: 'ENOTFOUND' }),
        }),
      )) as typeof fetch;
    await expect(
      fetchPriceCatalog({ url: 'https://prices.example/c.json', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'unreachable', message: 'ENOTFOUND' });
    const noCause = (() =>
      Promise.reject(new Error('boom sk-abcdefghijklmnopqrstuvwxyz'))) as typeof fetch;
    let message = '';
    try {
      await fetchPriceCatalog({ url: 'https://prices.example/c.json', fetchImpl: noCause });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('boom');
    expect(message).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });
});
