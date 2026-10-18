import { describe, expect, it } from 'vitest';

import { createAdapter, FakeAdapter, ProviderError, type NormalizedModelRequest } from './index.js';

/** An adapter whose network is a stub that records the request and answers with `reply`. */
function adapterFor(kind: 'openai' | 'gemini' | 'anthropic', reply: unknown) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const adapter = createAdapter(kind, {
    apiKey: 'k',
    fetch: (input, init) => {
      sent.push({
        url: String(input),
        body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
          string,
          unknown
        >,
      });
      return Promise.resolve(
        new Response(JSON.stringify(reply), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  });
  return { adapter, sent };
}

const ask: NormalizedModelRequest = {
  model: 'm',
  messages: [{ role: 'user', content: 'What do we know about churn?' }],
  webSearch: { maxUses: 3 },
};

describe('web search through the provider’s own tool', () => {
  it('OpenAI: asks for the web_search tool and reads queries and cited paragraphs', async () => {
    const text = 'Intro line.\nChurn rises after month four [1].\nOther line.';
    const { adapter, sent } = adapterFor('openai', {
      id: 'resp_1',
      status: 'completed',
      model: 'm',
      output: [
        {
          type: 'web_search_call',
          action: { type: 'search', query: 'subscription churn month four' },
        },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text,
              annotations: [
                {
                  type: 'url_citation',
                  url: 'https://example.org/a',
                  title: 'A study',
                  start_index: text.indexOf('Churn'),
                  end_index: text.indexOf('Churn') + 5,
                },
                { type: 'url_citation', url: 'javascript:alert(1)', title: 'Bad', start_index: 0 },
              ],
            },
          ],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    const result = await adapter.invoke(ask);
    expect(sent[0]!.body['tools']).toEqual([{ type: 'web_search' }]);
    expect(sent[0]!.body['max_tool_calls']).toBe(3);
    expect(result.web).toEqual({
      queries: ['subscription churn month four'],
      sources: [
        {
          url: 'https://example.org/a',
          title: 'A study',
          text: 'Churn rises after month four [1].',
        },
      ],
    });
  });

  it('Gemini: turns on Google Search and maps grounding supports to their pages', async () => {
    const { adapter, sent } = adapterFor('gemini', {
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: 'Churn rises after month four.' }] },
          groundingMetadata: {
            webSearchQueries: ['churn month four'],
            groundingChunks: [{ web: { uri: 'https://example.org/g', title: 'example.org' } }],
            groundingSupports: [
              {
                segment: { text: 'Churn rises after month four.' },
                groundingChunkIndices: [0],
              },
            ],
          },
        },
      ],
      usageMetadata: {},
    });
    const result = await adapter.invoke(ask);
    expect(sent[0]!.body['tools']).toEqual([{ google_search: {} }]);
    expect(result.web).toEqual({
      queries: ['churn month four'],
      sources: [
        {
          url: 'https://example.org/g',
          title: 'example.org',
          text: 'Churn rises after month four.',
        },
      ],
    });
  });

  it('Anthropic: declares the web search tool with its limit and reads the cited text', async () => {
    const { adapter, sent } = adapterFor('anthropic', {
      id: 'msg_1',
      model: 'm',
      stop_reason: 'end_turn',
      content: [
        { type: 'server_tool_use', name: 'web_search', input: { query: 'churn month four' } },
        {
          type: 'web_search_tool_result',
          content: [{ type: 'web_search_result', url: 'https://example.org/c', title: 'C' }],
        },
        {
          type: 'text',
          text: 'Churn rises after month four.',
          citations: [
            {
              type: 'web_search_result_location',
              url: 'https://example.org/c',
              title: 'C',
              cited_text: 'Churn rises sharply after the fourth month.',
            },
          ],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    const result = await adapter.invoke(ask);
    expect(sent[0]!.body['tools']).toEqual([
      { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
    ]);
    expect(result.web).toEqual({
      queries: ['churn month four'],
      sources: [
        {
          url: 'https://example.org/c',
          title: 'C',
          text: 'Churn rises sharply after the fourth month.',
        },
      ],
    });
    expect(result.finishReason).toBe('stop');
  });

  it('refuses to mix a web search with functions or a response schema', async () => {
    const { adapter } = adapterFor('openai', {});
    const withSchema = { ...ask, responseSchema: { name: 's', schema: { type: 'object' } } };
    await expect(adapter.invoke(withSchema)).rejects.toMatchObject({
      code: 'web_search_with_tools_or_schema',
    });
    await expect(new FakeAdapter().invoke(withSchema)).rejects.toBeInstanceOf(ProviderError);
  });

  it('a request that does not search carries no web result', async () => {
    const { adapter } = adapterFor('openai', {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
    });
    const result = await adapter.invoke({ model: 'm', messages: ask.messages });
    expect(result.web).toBeUndefined();
  });

  it('the fake provider answers a search deterministically', async () => {
    const result = await new FakeAdapter().invoke(ask);
    expect(result.web?.sources[0]?.url).toBe('https://example.test/fake-source');
    expect(result.text).toContain(result.web!.sources[0]!.text);
  });
});
