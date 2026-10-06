import { describe, expect, it } from 'vitest';

import {
  createAdapter,
  FakeAdapter,
  ProviderError,
  strictSchemaProblems,
  type ConversationMessage,
  type NormalizedModelRequest,
  type ToolSpec,
} from './index.js';

const parameters = {
  type: 'object',
  properties: { query: { type: 'string' } },
  required: ['query'],
  additionalProperties: false,
};
const search: ToolSpec = {
  name: 'knowledge_retrieve',
  description: 'Find approved knowledge.',
  parameters,
};

interface Seen {
  url: string;
  body: Record<string, unknown>;
}

/** An adapter whose HTTP layer replies with `reply` and records what was sent. */
function adapterWith(kind: 'openai' | 'gemini' | 'anthropic', reply: unknown) {
  const seen: Seen[] = [];
  const adapter = createAdapter(kind, {
    apiKey: 'k',
    baseUrl: 'https://provider.test',
    fetch: (url, init) => {
      seen.push({ url, body: JSON.parse(init.body as string) as Record<string, unknown> });
      return Promise.resolve(
        new Response(JSON.stringify(reply), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  });
  return { adapter, seen };
}

const history: ConversationMessage[] = [
  { role: 'user', content: 'Find what we know about churn.' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [
      {
        id: 'call_1',
        name: 'knowledge_retrieve',
        arguments: { query: 'churn' },
        providerData: { thoughtSignature: 'sig-1' },
      },
    ],
  },
  { role: 'tool', toolCallId: 'call_1', toolName: 'knowledge_retrieve', content: '{"results":[]}' },
];

const request: NormalizedModelRequest = {
  model: 'm',
  messages: history,
  tools: [search],
  toolChoice: 'auto',
};

describe('tool schemas', () => {
  it('are held to the strict structured-output subset', () => {
    expect(strictSchemaProblems(parameters)).toEqual([]);
  });
});

describe('tool calling through the three adapters', () => {
  it('openai: sends function tools and the tool turn, and reads a function_call', async () => {
    const { adapter, seen } = adapterWith('openai', {
      id: 'resp_1',
      status: 'completed',
      model: 'm',
      output: [
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_9',
          name: 'knowledge_retrieve',
          arguments: '{"query":"cancel rate"}',
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const response = await adapter.invoke(request);
    expect(response).toMatchObject({
      finishReason: 'tool_call',
      toolCalls: [
        { id: 'call_9', name: 'knowledge_retrieve', arguments: { query: 'cancel rate' } },
      ],
    });
    const sent = seen[0]!.body;
    expect(sent['tools']).toEqual([
      {
        type: 'function',
        name: 'knowledge_retrieve',
        description: 'Find approved knowledge.',
        parameters,
        strict: true,
      },
    ]);
    expect(sent['tool_choice']).toBe('auto');
    expect(sent['parallel_tool_calls']).toBe(false);
    // The earlier turn goes back without item ids, so no reasoning item has to travel with it.
    expect(sent['input']).toEqual([
      { role: 'user', content: 'Find what we know about churn.' },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'knowledge_retrieve',
        arguments: '{"query":"churn"}',
      },
      { type: 'function_call_output', call_id: 'call_1', output: '{"results":[]}' },
    ]);
  });

  it('openai: an answer without tool calls finishes with stop', async () => {
    const { adapter } = adapterWith('openai', {
      id: 'resp_2',
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }],
      usage: {},
    });
    expect(await adapter.invoke(request)).toMatchObject({
      finishReason: 'stop',
      text: 'done',
      toolCalls: [],
    });
  });

  it('openai: arguments that are not JSON are an invalid answer, not a crash', async () => {
    const { adapter } = adapterWith('openai', {
      status: 'completed',
      output: [{ type: 'function_call', call_id: 'c', name: 'x', arguments: '{oops' }],
      usage: {},
    });
    await expect(adapter.invoke(request)).rejects.toMatchObject({
      kind: 'invalid_output',
      code: 'openai_tool_arguments_invalid',
    });
  });

  it('gemini: declares functions, echoes the thought signature and groups results', async () => {
    const { adapter, seen } = adapterWith('gemini', {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                functionCall: { name: 'knowledge_retrieve', args: { query: 'x' } },
                thoughtSignature: 'sig-2',
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
    });
    const response = await adapter.invoke({ ...request, toolChoice: 'required' });
    expect(response).toMatchObject({
      finishReason: 'tool_call',
      toolCalls: [
        {
          name: 'knowledge_retrieve',
          arguments: { query: 'x' },
          providerData: { thoughtSignature: 'sig-2' },
        },
      ],
    });
    const sent = seen[0]!.body;
    expect(sent['tools']).toEqual([
      {
        functionDeclarations: [
          {
            name: 'knowledge_retrieve',
            description: 'Find approved knowledge.',
            parametersJsonSchema: parameters,
          },
        ],
      },
    ]);
    expect(sent['toolConfig']).toEqual({ functionCallingConfig: { mode: 'ANY' } });
    expect(sent['contents']).toEqual([
      { role: 'user', parts: [{ text: 'Find what we know about churn.' }] },
      {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'knowledge_retrieve', args: { query: 'churn' } },
            thoughtSignature: 'sig-1',
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'knowledge_retrieve',
              response: { result: '{"results":[]}' },
            },
          },
        ],
      },
    ]);
  });

  it('anthropic: sends tools and tool_result blocks and reads tool_use blocks', async () => {
    const { adapter, seen } = adapterWith('anthropic', {
      id: 'msg_1',
      model: 'm',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 'toolu_7', name: 'knowledge_retrieve', input: { query: 'q' } },
      ],
      usage: { input_tokens: 3, output_tokens: 4 },
    });
    const response = await adapter.invoke({
      ...request,
      messages: [
        ...history,
        // A second result of the same turn joins the first user message.
        { role: 'tool', toolCallId: 'call_2', toolName: 'calculator', content: '4' },
      ],
    });
    expect(response).toMatchObject({
      finishReason: 'tool_call',
      text: 'Let me look.',
      toolCalls: [{ id: 'toolu_7', name: 'knowledge_retrieve', arguments: { query: 'q' } }],
    });
    const sent = seen[0]!.body;
    expect(sent['tools']).toEqual([
      {
        name: 'knowledge_retrieve',
        description: 'Find approved knowledge.',
        input_schema: parameters,
      },
    ]);
    expect(sent['tool_choice']).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(sent['messages']).toEqual([
      { role: 'user', content: 'Find what we know about churn.' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'knowledge_retrieve', input: { query: 'churn' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: '{"results":[]}' },
          { type: 'tool_result', tool_use_id: 'call_2', content: '4' },
        ],
      },
    ]);
  });

  for (const kind of ['openai', 'gemini', 'anthropic'] as const) {
    it(`${kind}: refuses tools together with a response schema before any request`, async () => {
      const { adapter, seen } = adapterWith(kind, {});
      const error = await adapter
        .invoke({ ...request, responseSchema: { name: 'r', schema: parameters } })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ code: 'tools_with_response_schema', retryable: false });
      expect(seen).toHaveLength(0);
    });
  }
});

describe('fake provider tool calls', () => {
  it('answers with the scripted calls, or with text when there are none', async () => {
    const fake = new FakeAdapter();
    expect(await fake.invoke(request)).toMatchObject({ finishReason: 'stop', toolCalls: [] });
    fake.toolResponder = () => [
      { id: 'c1', name: 'knowledge_retrieve', arguments: { query: 'a' } },
    ];
    expect(await fake.invoke(request)).toMatchObject({
      finishReason: 'tool_call',
      toolCalls: [{ id: 'c1', name: 'knowledge_retrieve' }],
    });
    // "none" forbids tools even when the script would call one.
    expect(await fake.invoke({ ...request, toolChoice: 'none' })).toMatchObject({
      finishReason: 'stop',
    });
    await expect(
      fake.invoke({ ...request, responseSchema: { name: 'r', schema: parameters } }),
    ).rejects.toMatchObject({ code: 'tools_with_response_schema' });
  });
});
