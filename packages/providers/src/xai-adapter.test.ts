import { describe, expect, it } from 'vitest';

import {
  createAdapter,
  ProviderError,
  type FetchLike,
  type NormalizedModelRequest,
} from './index.js';

/**
 * The xAI adapter against replies written from xAI's published Responses API reference
 * (docs.x.ai/developers/rest-api-reference/inference/responses and the tools guides). No call
 * reaches xAI: the wire shape is what these tests pin down.
 */

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

function stub(reply: unknown, sent: Sent[] = [], status = 200): FetchLike {
  return (input, init) => {
    sent.push({
      url: String(input),
      headers: init.headers as Record<string, string>,
      body:
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify(reply), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
}

const adapterWith = (fetch: FetchLike) => createAdapter('xai', { apiKey: 'xai-key-123456', fetch });

const message = (text: string, annotations: unknown[] = []) => ({
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations }],
});

const base: NormalizedModelRequest = {
  model: 'grok-4.7',
  messages: [{ role: 'user', content: 'Hello' }],
};

describe('xAI adapter (Responses API at api.x.ai)', () => {
  it('calls api.x.ai/v1 with a bearer key and sends no OpenAI-only fields', async () => {
    const sent: Sent[] = [];
    const reply = { id: 'r1', status: 'completed', output: [message('hi')], usage: {} };
    await adapterWith(stub(reply, sent)).invoke({ ...base, idempotencyKey: 'attempt-1' });
    expect(sent[0]!.url).toBe('https://api.x.ai/v1/responses');
    expect(sent[0]!.headers['authorization']).toBe('Bearer xai-key-123456');
    expect(sent[0]!.headers['idempotency-key']).toBeUndefined();
    expect(sent[0]!.body).toMatchObject({ model: 'grok-4.7', store: false });
    expect(sent[0]!.body).not.toHaveProperty('tools');
  });

  it('reads reasoning tokens as extra: output_tokens is not reduced by them', async () => {
    const reply = {
      id: 'r1',
      status: 'completed',
      output: [message('hi')],
      // The reference's own example: 32 in, 9 out, 110 reasoning, 151 in total.
      usage: {
        input_tokens: 32,
        output_tokens: 9,
        total_tokens: 151,
        input_tokens_details: { cached_tokens: 8 },
        output_tokens_details: { reasoning_tokens: 110 },
      },
    };
    const response = await adapterWith(stub(reply)).invoke(base);
    expect(response.usage).toEqual({
      inputTokens: 32,
      outputTokens: 9,
      reasoningTokens: 110,
      cachedInputTokens: 8,
    });
  });

  it('splits reasoning out of the output count if a response adds up the other way', async () => {
    const reply = {
      id: 'r1',
      status: 'completed',
      output: [message('hi')],
      usage: {
        input_tokens: 10,
        output_tokens: 40,
        total_tokens: 50,
        output_tokens_details: { reasoning_tokens: 30 },
      },
    };
    const response = await adapterWith(stub(reply)).invoke(base);
    expect(response.usage).toMatchObject({ outputTokens: 10, reasoningTokens: 30 });
  });

  it('sends function tools without strict, runs them one at a time and reads the call', async () => {
    const sent: Sent[] = [];
    const reply = {
      id: 'r2',
      status: 'completed',
      output: [
        { type: 'reasoning', id: '', summary: [], status: 'completed' },
        {
          type: 'function_call',
          call_id: 'call_9',
          name: 'lookup',
          arguments: '{"term":"price"}',
          status: 'completed',
        },
      ],
      usage: { input_tokens: 5, output_tokens: 2 },
    };
    const response = await adapterWith(stub(reply, sent)).invoke({
      ...base,
      tools: [
        {
          name: 'lookup',
          description: 'Look a term up',
          parameters: { type: 'object', properties: { term: { type: 'string' } } },
        },
      ],
      toolChoice: 'required',
      messages: [
        { role: 'user', content: 'Find it' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'lookup', arguments: { term: 'a' } }],
        },
        { role: 'tool', toolCallId: 'call_1', toolName: 'lookup', content: '{"ok":true}' },
      ],
    });
    expect(sent[0]!.body).toMatchObject({
      tools: [{ type: 'function', name: 'lookup', description: 'Look a term up' }],
      tool_choice: 'required',
      parallel_tool_calls: false,
      input: [
        { role: 'user', content: 'Find it' },
        { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"term":"a"}' },
        { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
      ],
    });
    expect(JSON.stringify(sent[0]!.body)).not.toContain('"strict"');
    expect(response.finishReason).toBe('tool_call');
    expect(response.toolCalls).toEqual([
      { id: 'call_9', name: 'lookup', arguments: { term: 'price' } },
    ]);
  });

  it('uses the web_search tool and turns url_citation annotations into sources', async () => {
    const sent: Sent[] = [];
    const text = 'Intro line.\nPrices rose in 2025.[[1]](https://example.com/a)\nOther.';
    const reply = {
      id: 'r3',
      status: 'completed',
      output: [
        { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { query: 'prices' } },
        message(text, [
          {
            type: 'url_citation',
            url: 'https://example.com/a',
            start_index: text.indexOf('[[1]]'),
            end_index: text.indexOf('[[1]]') + 30,
            title: '1',
          },
        ]),
      ],
      usage: { input_tokens: 50, output_tokens: 20 },
    };
    const response = await adapterWith(stub(reply, sent)).invoke({
      ...base,
      webSearch: { maxUses: 4 },
    });
    expect(sent[0]!.body).toMatchObject({ tools: [{ type: 'web_search' }] });
    // xAI has no per-call cap field for searches; none is invented.
    expect(sent[0]!.body).not.toHaveProperty('max_tool_calls');
    expect(response.web?.queries).toEqual(['prices']);
    expect(response.web?.sources).toEqual([
      {
        url: 'https://example.com/a',
        // The annotation title is only the citation number, so the address labels the page.
        title: 'https://example.com/a',
        text: 'Prices rose in 2025.[[1]](https://example.com/a)',
      },
    ]);
  });

  it('refuses a request that mixes tools with a response schema, like the other providers', async () => {
    const adapter = adapterWith(stub({}));
    await expect(
      adapter.invoke({
        ...base,
        tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
        responseSchema: { name: 's', schema: { type: 'object' } },
      }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
  });

  it('reports a cut-off answer as length and does not parse it', async () => {
    const reply = {
      id: 'r4',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [message('{"summary":"cut')],
      usage: { input_tokens: 5, output_tokens: 5 },
    };
    const response = await adapterWith(stub(reply)).invoke({
      ...base,
      responseSchema: { name: 's', schema: { type: 'object' } },
    });
    expect(response).toMatchObject({ finishReason: 'length', json: null });
  });

  it('rejects an answer that is not the requested JSON as invalid output', async () => {
    const reply = { id: 'r5', status: 'completed', output: [message('not json')], usage: {} };
    const result = await adapterWith(stub(reply))
      .invoke({ ...base, responseSchema: { name: 's', schema: { type: 'object' } } })
      .catch((error: unknown) => error);
    expect(result).toBeInstanceOf(ProviderError);
    expect(result).toMatchObject({ kind: 'invalid_output', code: 'xai_structured_output_invalid' });
  });

  it('names its failures after xai and treats a bad key as an auth failure', async () => {
    const adapter = adapterWith(stub({ error: 'Incorrect API key provided' }, [], 401));
    await expect(adapter.invoke(base)).rejects.toMatchObject({
      kind: 'auth',
      code: 'xai_unauthorized',
    });
    expect((await adapter.healthCheck()).status).toBe('invalid');
  });
});
