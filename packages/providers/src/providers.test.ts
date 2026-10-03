import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkCostLimit,
  createAdapter,
  decryptSecret,
  encryptSecret,
  estimateCostUsd,
  FakeAdapter,
  ProviderError,
  RETRY_SCHEDULE_SECONDS,
  retryDelaySeconds,
  sampleForSchema,
  sanitizeError,
  type NormalizedModelRequest,
  type ProviderKind,
} from './index.js';

const schema = {
  type: 'object',
  properties: { summary: { type: 'string' }, score: { type: 'integer', minimum: 1 } },
  required: ['summary', 'score'],
  additionalProperties: false,
};
const answer = { summary: 'Retail pricing review', score: 4 };

interface Captured {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown> | null;
}

/** Replies in the documented response shape of each provider. */
function providerReply(kind: Exclude<ProviderKind, 'fake'>, url: string): unknown {
  if (url.includes('/models') && !url.includes(':generateContent')) {
    if (kind === 'gemini') {
      return {
        models: [
          {
            name: 'models/gemini-test',
            displayName: 'Gemini Test',
            inputTokenLimit: 1000,
            outputTokenLimit: 100,
            supportedGenerationMethods: ['generateContent'],
          },
          { name: 'models/embed-test', supportedGenerationMethods: ['embedContent'] },
        ],
      };
    }
    return { data: [{ id: `${kind}-test`, display_name: `${kind} test` }] };
  }
  switch (kind) {
    case 'openai':
      return {
        id: 'resp_123',
        model: 'openai-test',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: JSON.stringify(answer) }],
          },
        ],
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          input_tokens_details: { cached_tokens: 20 },
          output_tokens_details: { reasoning_tokens: 5 },
        },
      };
    case 'gemini':
      return {
        responseId: 'gem_123',
        modelVersion: 'gemini-test',
        candidates: [
          {
            content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 120,
          candidatesTokenCount: 30,
          thoughtsTokenCount: 5,
          cachedContentTokenCount: 20,
        },
      };
    case 'anthropic':
      return {
        id: 'msg_123',
        model: 'anthropic-test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'review', input: answer }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 20 },
      };
  }
}

describe('provider adapters share one contract (AI-002)', () => {
  let server: Server;
  let base: string;
  const captured: Captured[] = [];
  let failWith: number | null = null;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const kind = request.url!.split('/')[1] as Exclude<ProviderKind, 'fake'>;
        const body = chunks.length
          ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
          : null;
        captured.push({
          method: request.method!,
          url: request.url!,
          headers: request.headers,
          body,
        });
        if (failWith) {
          response.writeHead(failWith, { 'content-type': 'application/json', 'retry-after': '12' });
          response.end(
            JSON.stringify({ error: { message: 'secret sk-live-should-not-leak-1234567890' } }),
          );
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(providerReply(kind, request.url!)));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const request: NormalizedModelRequest = {
    model: 'test-model',
    instructions: 'You review retail pricing.',
    messages: [{ role: 'user', content: 'Review the pricing policy.' }],
    responseSchema: { name: 'review', schema },
    maxOutputTokens: 500,
    idempotencyKey: 'attempt-1',
  };

  for (const kind of ['openai', 'gemini', 'anthropic'] as const) {
    it(`${kind}: one structured call normalises to the same result`, async () => {
      captured.length = 0;
      failWith = null;
      const adapter = createAdapter(kind, { apiKey: `key-${kind}`, baseUrl: `${base}/${kind}` });
      const response = await adapter.invoke(request);
      expect(response).toMatchObject({
        provider: kind,
        json: answer,
        finishReason: 'stop',
        usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: 20 },
      });
      expect(response.providerRequestId).toMatch(/_123$/u);
      const sent = captured[0]!;
      expect(sent.method).toBe('POST');
      // The secret travels only in the provider's auth header.
      const auth = { openai: 'authorization', gemini: 'x-goog-api-key', anthropic: 'x-api-key' }[
        kind
      ];
      expect(String(sent.headers[auth])).toContain(`key-${kind}`);
      expect(JSON.stringify(sent.body)).not.toContain(`key-${kind}`);
      if (kind === 'openai') {
        expect(sent.url).toBe('/openai/responses');
        expect(sent.body).toMatchObject({
          model: 'test-model',
          store: false,
          instructions: 'You review retail pricing.',
          text: { format: { type: 'json_schema', name: 'review', strict: true } },
        });
      } else if (kind === 'gemini') {
        expect(sent.url).toBe('/gemini/models/test-model:generateContent');
        expect(sent.body).toMatchObject({
          systemInstruction: { parts: [{ text: 'You review retail pricing.' }] },
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 500 },
        });
      } else {
        expect(sent.url).toBe('/anthropic/messages');
        expect(sent.headers['anthropic-version']).toBe('2023-06-01');
        expect(sent.body).toMatchObject({
          system: 'You review retail pricing.',
          max_tokens: 500,
          tool_choice: { type: 'tool', name: 'review' },
        });
      }
    });

    it(`${kind}: lists models from the live catalog and checks health`, async () => {
      failWith = null;
      const adapter = createAdapter(kind, { apiKey: 'k', baseUrl: `${base}/${kind}` });
      const models = await adapter.listModels();
      expect(models).toEqual([expect.objectContaining({ id: `${kind}-test`, provider: kind })]);
      expect((await adapter.healthCheck()).status).toBe('healthy');
    });

    it(`${kind}: classifies failures without leaking the response body`, async () => {
      const adapter = createAdapter(kind, { apiKey: 'k', baseUrl: `${base}/${kind}` });
      failWith = 429;
      const limited = await adapter.invoke(request).catch((error: unknown) => error);
      expect(limited).toBeInstanceOf(ProviderError);
      expect(limited).toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 12 });
      expect(String((limited as Error).message)).not.toContain('sk-live');
      failWith = 401;
      expect((await adapter.healthCheck()).status).toBe('invalid');
      failWith = 503;
      await expect(adapter.invoke(request)).rejects.toMatchObject({
        kind: 'transient',
        retryable: true,
      });
      failWith = 400;
      await expect(adapter.invoke(request)).rejects.toMatchObject({
        kind: 'invalid_request',
        retryable: false,
      });
      failWith = null;
    });
  }

  it('reports an unreachable provider as unavailable', async () => {
    const adapter = createAdapter('openai', { apiKey: 'k', baseUrl: 'http://127.0.0.1:1' });
    expect(await adapter.healthCheck()).toMatchObject({
      status: 'unavailable',
      error: 'openai_unreachable',
    });
  });
});

describe('fake provider (AI-002 in CI)', () => {
  it('is deterministic and honours the response schema', async () => {
    const fake = new FakeAdapter();
    const request: NormalizedModelRequest = {
      model: 'fake-standard',
      messages: [{ role: 'user', content: 'x' }],
      responseSchema: { name: 'review', schema },
    };
    const first = await fake.invoke(request);
    expect(await fake.invoke(request)).toEqual(first);
    expect(first.json).toEqual({
      summary: expect.stringContaining('fake review.summary'),
      score: 1,
    });
    expect(
      sampleForSchema(
        { type: 'array', minItems: 2, items: { type: 'string', enum: ['a', 'b'] } },
        's',
      ),
    ).toEqual(['a', 'a']);
  });

  it('can script failures', async () => {
    const fake = new FakeAdapter((_request, call) => (call <= 2 ? 'transient' : null));
    const request: NormalizedModelRequest = {
      model: 'fake-standard',
      messages: [{ role: 'user', content: 'x' }],
    };
    await expect(fake.invoke(request)).rejects.toMatchObject({ kind: 'transient' });
    await expect(fake.invoke(request)).rejects.toMatchObject({ kind: 'transient' });
    await expect(fake.invoke(request)).resolves.toMatchObject({ finishReason: 'stop' });
  });
});

describe('retry schedule and cost (AI-004, AI-005)', () => {
  it('follows the approved schedule, honours Retry-After and stops after ten retries', () => {
    expect(RETRY_SCHEDULE_SECONDS).toEqual([5, 5, 5, 10, 15, 20, 25, 30, 35, 40]);
    const transient = new ProviderError('transient', 'x');
    expect(Array.from({ length: 11 }, (_, i) => retryDelaySeconds(i + 1, transient))).toEqual([
      5,
      5,
      5,
      10,
      15,
      20,
      25,
      30,
      35,
      40,
      null,
    ]);
    expect(retryDelaySeconds(1, new ProviderError('rate_limited', 'x', 429, 60))).toBe(60);
    expect(retryDelaySeconds(1, new ProviderError('rate_limited', 'x', 429, 9999))).toBe(300);
    expect(retryDelaySeconds(1, new ProviderError('auth', 'x'))).toBeNull();
    expect(retryDelaySeconds(1, new Error('x'))).toBeNull();
  });

  it('estimates cost from a dated price snapshot and checks the project ceiling', () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      reasoningTokens: null,
      cachedInputTokens: 200_000,
    };
    const price = {
      currency: 'USD' as const,
      inputPerMillion: 2,
      outputPerMillion: 8,
      cachedInputPerMillion: 0.5,
      effectiveFrom: '2026-09-01',
    };
    expect(estimateCostUsd(usage, price)).toBe(1.6 + 0.1 + 4);
    expect(estimateCostUsd(usage, null)).toBeNull();
    expect(checkCostLimit(5, 20).status).toBe('ok');
    expect(checkCostLimit(16, 20).status).toBe('warning');
    expect(checkCostLimit(20, 20).status).toBe('exceeded');
  });
});

describe('secret envelope encryption (AI-001)', () => {
  const master = { id: 'mk-test', key: randomBytes(32) };

  it('round-trips only with the same master key and context', () => {
    const sealed = encryptSecret('sk-test-secret-value', master, 'conn-1:1');
    expect(JSON.stringify(sealed)).not.toContain('sk-test-secret-value');
    expect(decryptSecret(sealed, master, 'conn-1:1')).toBe('sk-test-secret-value');
    expect(() => decryptSecret(sealed, master, 'conn-2:1')).toThrow();
    expect(() =>
      decryptSecret(sealed, { id: 'mk-test', key: randomBytes(32) }, 'conn-1:1'),
    ).toThrow();
    expect(encryptSecret('sk-test-secret-value', master, 'conn-1:1').ciphertext).not.toBe(
      sealed.ciphertext,
    );
  });

  it('rejects a truncated authentication tag', () => {
    const sealed = encryptSecret('sk-test-secret-value', master, 'conn-1:1');
    const shortTag = Buffer.from(sealed.tag, 'base64').subarray(0, 4).toString('base64');
    expect(() => decryptSecret({ ...sealed, tag: shortTag }, master, 'conn-1:1')).toThrow();
  });

  it('redacts credentials from error text', () => {
    expect(
      sanitizeError('failed with key sk-proj-abcdefghijklmnop and Bearer abc.def', ['abc.def']),
    ).toBe('failed with key [REDACTED] and Bearer [REDACTED]');
  });
});
