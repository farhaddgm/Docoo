import { describe, expect, it, vi } from 'vitest';

import {
  embedPendingChunks,
  embedQuery,
  holdsPrivateValue,
  embeddingBatches,
  openAiSemanticSearch,
  SEMANTIC_DIMENSIONS,
  semanticConfigFrom,
  semanticSearchFromEnv,
  type SemanticSearch,
} from './semantic-embeddings.js';

const open = {
  KNOWLEDGE_EMBEDDING_ENABLED: 'true',
  KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL: 'true',
  KNOWLEDGE_EMBEDDING_API_KEY: 'key-123456',
  KNOWLEDGE_EMBEDDING_MODEL: 'text-embedding-3-small',
};

const vector = (value = 0.1): number[] => Array.from({ length: SEMANTIC_DIMENSIONS }, () => value);

describe('the locks on sending knowledge out', () => {
  it('is on only when every lock is open', () => {
    expect(semanticConfigFrom(open)).toEqual({
      apiKey: 'key-123456',
      model: 'text-embedding-3-small',
    });
    // The already parsed environment of the API holds booleans, not strings.
    expect(
      semanticConfigFrom({
        ...open,
        KNOWLEDGE_EMBEDDING_ENABLED: true,
        KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL: true,
      }),
    ).not.toBeNull();
  });

  it.each([
    ['disabled', { ...open, KNOWLEDGE_EMBEDDING_ENABLED: 'false' }],
    ['absent', {}],
    ['internal not allowed', { ...open, KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL: 'false' }],
    ['no key', { ...open, KNOWLEDGE_EMBEDDING_API_KEY: '  ' }],
    ['no model', { ...open, KNOWLEDGE_EMBEDDING_MODEL: '' }],
  ])('is off when %s', (_name, env) => {
    expect(semanticConfigFrom(env)).toBeNull();
    expect(semanticSearchFromEnv(env)).toBeNull();
  });
});

const sentBody = (fetcher: { mock: { calls: unknown[][] } }): Record<string, unknown> => {
  const body = (fetcher.mock.calls[0]?.[1] as RequestInit | undefined)?.body;
  return typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : {};
};

describe('the request to the provider', () => {
  const answer = () =>
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ index: 0, embedding: vector() }] })),
      );

  it('shortens the vector of a text-embedding-3 model to the length of the column', async () => {
    const fetcher = answer();
    await openAiSemanticSearch({ apiKey: 'k', model: 'text-embedding-3-large' }, fetcher).embed([
      'a',
    ]);
    const sent = sentBody(fetcher);
    expect(sent).toMatchObject({
      model: 'text-embedding-3-large',
      dimensions: SEMANTIC_DIMENSIONS,
    });
  });

  it('does not ask an older model for a length it does not support', async () => {
    const fetcher = answer();
    await openAiSemanticSearch({ apiKey: 'k', model: 'text-embedding-ada-002' }, fetcher).embed([
      'a',
    ]);
    const sent = sentBody(fetcher);
    expect('dimensions' in sent).toBe(false);
  });
});

describe('embedQuery', () => {
  const search = (embed: SemanticSearch['embed']): SemanticSearch => ({ model: 'm', embed });

  it('returns the vector and its model', async () => {
    const embed = vi.fn(() => Promise.resolve([vector()]));
    expect(await embedQuery(search(embed), 'how to stop customers leaving')).toEqual({
      model: 'm',
      vector: vector(),
    });
    expect(embed).toHaveBeenCalledWith(['how to stop customers leaving']);
  });

  it('sends nothing when there is no search', async () => {
    expect(await embedQuery(null, 'a question about churn')).toBeNull();
  });

  it('does not send a question that carries personal data, a number or a key', async () => {
    const embed = vi.fn(() => Promise.resolve([vector()]));
    for (const question of [
      'ask ali.rezaei@acme-corp.com about churn',
      'call 0912 345 6789 about the contract',
      'why does 10.0.4.17 fail',
      'key sk-proj-AbCdEf1234567890XyZ was leaked',
    ]) {
      expect(await embedQuery(search(embed), question)).toBeNull();
    }
    expect(embed).not.toHaveBeenCalled();
  });

  it('answers null, never an error, when the provider fails or answers the wrong length', async () => {
    expect(
      await embedQuery(
        search(() => Promise.reject(new Error('down'))),
        'a question about churn',
      ),
    ).toBeNull();
    expect(
      await embedQuery(
        search(() => Promise.resolve([[1, 2, 3]])),
        'a question about churn',
      ),
    ).toBeNull();
    expect(
      await embedQuery(
        search(() => Promise.resolve([])),
        'a question about churn',
      ),
    ).toBeNull();
  });
});

describe('embeddingBatches', () => {
  const chunk = (id: string, text: string) => ({ id, text });

  it('keeps a request within the count the adapter accepts', () => {
    const chunks = Array.from({ length: 70 }, (_, i) => chunk(`c${i}`, 'short text'));
    const batches = embeddingBatches(chunks);
    expect(batches.map((b) => b.length)).toEqual([32, 32, 6]);
  });

  it('keeps a request within the bytes the adapter accepts', () => {
    const big = 'x'.repeat(5_000);
    const batches = embeddingBatches(Array.from({ length: 30 }, (_, i) => chunk(`c${i}`, big)));
    for (const batch of batches) expect(batch.length * 5_000).toBeLessThanOrEqual(120_000);
    expect(batches.flat()).toHaveLength(30);
  });

  it('leaves out a text the adapter would refuse instead of failing the batch', () => {
    const batches = embeddingBatches([
      chunk('a', 'fine'),
      chunk('b', 'x'.repeat(7_000)),
      chunk('c', '   '.trim()),
    ]);
    expect(batches.flat().map((c) => c.id)).toEqual(['a']);
  });
});

describe('embedPendingChunks', () => {
  const pending = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, text: `chunk ${i}` }));

  it('stores every vector it got and counts them', async () => {
    const stored: string[] = [];
    const result = await embedPendingChunks({
      search: { model: 'm', embed: (texts) => Promise.resolve(texts.map(() => vector())) },
      pending,
      store: (rows) => {
        stored.push(...rows.map((row) => row.id));
        return Promise.resolve();
      },
    });
    expect(result).toEqual({ embedded: 40, failedBatches: 0 });
    expect(stored).toHaveLength(40);
  });

  it('skips a failed batch, counts it and goes on with the next', async () => {
    let call = 0;
    const result = await embedPendingChunks({
      search: {
        model: 'm',
        embed: (texts) => {
          call += 1;
          return call === 1
            ? Promise.reject(new Error('rate limited'))
            : Promise.resolve(texts.map(() => vector()));
        },
      },
      pending,
      store: () => Promise.resolve(),
    });
    expect(result).toEqual({ embedded: 8, failedBatches: 1 });
  });

  it('does not store a vector of the wrong length', async () => {
    const stored: string[] = [];
    const result = await embedPendingChunks({
      search: { model: 'm', embed: (texts) => Promise.resolve(texts.map(() => [1, 2])) },
      pending: pending.slice(0, 3),
      store: (rows) => {
        stored.push(...rows.map((row) => row.id));
        return Promise.resolve();
      },
    });
    expect(stored).toEqual([]);
    expect(result).toEqual({ embedded: 0, failedBatches: 1 });
  });
});

describe('semanticQueryFromEnv', () => {
  it('is null at once in a process whose environment does not open every lock', async () => {
    const { semanticQueryFromEnv } = await import('./semantic-embeddings.js');
    const saved = { ...process.env };
    try {
      delete process.env['KNOWLEDGE_EMBEDDING_ENABLED'];
      delete process.env['KNOWLEDGE_EMBEDDING_API_KEY'];
      expect(await semanticQueryFromEnv('a question about churn')).toBeNull();
    } finally {
      process.env = saved;
    }
  });
});

describe('holdsPrivateValue', () => {
  it.each([
    'برای تماس با مدیر: 09123456789',
    'ایمیل ali.rezaei@acme-corp.com را بنویسید',
    'کد ملی ۰۰۱۲۳۴۵۶۷۹',
    'card 4539 1488 0343 6467',
    'شبا IR062960000000100324200001',
  ])('sees a private value in: %s', (text) => {
    // Each sample is valid for its detector: a mobile number, an e-mail, a national id with its check
    // digit (0012345679), a Luhn card number and an IBAN with its mod-97 check.
    expect(holdsPrivateValue(text)).toBe(true);
  });

  it.each([
    'نرخ ریزش مشتریان کسب‌وکارهای کوچک در سال ۱۴۰۳ به هفت درصد رسید',
    'order 1234567890 shipped on 2024-05-01',
    'قیمت ۱۲۰۰۰۰۰ تومان برای ده کاربر',
    '',
  ])('sees none in: %s', (text) => {
    expect(holdsPrivateValue(text)).toBe(false);
  });
});
