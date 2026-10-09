import { expect, it, vi } from 'vitest';
import { createOpenAiEmbeddings } from './openai-embedding-adapter.js';
it('restores provider indices and uses fixed endpoint without redirects', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }),
    ),
  );
  expect(
    await createOpenAiEmbeddings({
      apiKey: 'secret-key',
      model: 'explicit-model',
      texts: ['a', 'b'],
      fetcher,
    }),
  ).toEqual([
    [1, 0],
    [0, 1],
  ]);
  expect(fetcher).toHaveBeenCalledWith(
    'https://api.openai.com/v1/embeddings',
    expect.objectContaining({ redirect: 'error' }),
  );
});
it.each([
  {
    data: [
      { index: 0, embedding: [1] },
      { index: 0, embedding: [2] },
    ],
  },
  {
    data: [
      { index: 0, embedding: [1] },
      { index: 1, embedding: [1, 2] },
    ],
  },
  {
    data: [
      { index: 0, embedding: [0] },
      { index: 1, embedding: [0] },
    ],
  },
])('rejects malformed vectors with redacted errors', async (payload) => {
  await expect(
    createOpenAiEmbeddings({
      apiKey: 'secret-key',
      model: 'explicit-model',
      texts: ['a', 'b'],
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload))),
    }),
  ).rejects.toThrow('EMBEDDING_PROVIDER_UNAVAILABLE');
});
it('redacts network errors and bounds output size', async () => {
  await expect(
    createOpenAiEmbeddings({
      apiKey: 'secret-key',
      model: 'model',
      texts: ['private'],
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-key private')),
    }),
  ).rejects.toThrow(/^EMBEDDING_PROVIDER_UNAVAILABLE$/);
  await expect(
    createOpenAiEmbeddings({
      apiKey: 'secret-key',
      model: 'model',
      texts: ['private'],
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(4000001))),
    }),
  ).rejects.toThrow(/^EMBEDDING_PROVIDER_UNAVAILABLE$/);
});
