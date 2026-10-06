import { createHash } from 'node:crypto';

import {
  ProviderError,
  type JsonSchema,
  type ModelDescriptor,
  type ModelProviderAdapter,
  type NormalizedModelRequest,
  type NormalizedModelResponse,
  type ProviderErrorKind,
  type ProviderHealth,
  type ToolCall,
} from './contract.js';

/** Fails the n-th call (1-based) with the given error kind, for retry and pause tests. */
export type FakeScript = (
  request: NormalizedModelRequest,
  call: number,
) => ProviderErrorKind | null;

/** A JSON value that satisfies the schema, chosen deterministically from the request. */
export function sampleForSchema(schema: JsonSchema, seed: string, depth = 0): unknown {
  if (depth > 8) return null;
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];
  const rawType: unknown = schema['type'];
  const type: unknown = Array.isArray(rawType) ? (rawType as unknown[])[0] : rawType;
  switch (type) {
    case 'object': {
      const properties = (schema['properties'] ?? {}) as Record<string, JsonSchema>;
      return Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          sampleForSchema(value, `${seed}.${key}`, depth + 1),
        ]),
      );
    }
    case 'array': {
      const min = typeof schema['minItems'] === 'number' ? schema['minItems'] : 1;
      const items = (schema['items'] ?? { type: 'string' }) as JsonSchema;
      return Array.from({ length: Math.max(1, min) }, (_, index) =>
        sampleForSchema(items, `${seed}[${index}]`, depth + 1),
      );
    }
    case 'integer':
    case 'number': {
      const minimum = typeof schema['minimum'] === 'number' ? schema['minimum'] : 0;
      return minimum;
    }
    case 'boolean':
      return true;
    case 'string':
    default: {
      const digest = createHash('sha256').update(seed).digest('hex').slice(0, 8);
      const min = typeof schema['minLength'] === 'number' ? schema['minLength'] : 0;
      return `fake ${seed} ${digest}`.padEnd(min, '.');
    }
  }
}

/** Models whose id starts with this are refused by the fake provider (offline failure tests). */
export const FAKE_REFUSED_MODEL_PREFIX = 'fake-refused';

/**
 * Deterministic provider for CI and local development: same request, same answer, no
 * network. Token counts are derived from the text so usage and cost paths are exercised.
 */
export class FakeAdapter implements ModelProviderAdapter {
  readonly kind = 'fake' as const;
  calls = 0;

  /** Optional canned structured answer per request (tests); null falls back to the schema sample. */
  responder: (request: NormalizedModelRequest) => unknown = () => null;

  /**
   * Optional tool calls per request (tests): when the request offers tools and this returns calls,
   * the answer is those calls; returning null or an empty list lets the model "answer" instead.
   */
  toolResponder: (request: NormalizedModelRequest) => readonly ToolCall[] | null = () => null;

  constructor(public script: FakeScript = () => null) {}

  listModels(): Promise<ModelDescriptor[]> {
    const capabilities = {
      text: true,
      structuredOutput: true,
      tools: false,
      imageInput: false,
      fileInput: false,
      audioInput: false,
      streaming: false,
      reasoning: false,
    };
    return Promise.resolve([
      {
        id: 'fake-standard',
        provider: 'fake',
        displayName: 'Fake standard',
        capabilities,
        contextWindow: 32_000,
        maxOutputTokens: 4096,
      },
      {
        id: 'fake-small',
        provider: 'fake',
        displayName: 'Fake small',
        capabilities: { ...capabilities, structuredOutput: false },
        contextWindow: 8000,
        maxOutputTokens: 1024,
      },
    ]);
  }

  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({
      status: 'healthy',
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      error: null,
    });
  }

  invoke(request: NormalizedModelRequest): Promise<NormalizedModelResponse> {
    this.calls += 1;
    // A model name that starts with this prefix is refused the way a real provider refuses a model
    // that cannot do structured output; the model self-check tests show the reason that way.
    if (request.model.startsWith(FAKE_REFUSED_MODEL_PREFIX)) {
      return Promise.reject(
        new ProviderError(
          'invalid_request',
          'fake_model_refused',
          400,
          null,
          `The model ${request.model} does not support structured output.`,
        ),
      );
    }
    const failure = this.script(request, this.calls);
    if (failure) {
      return Promise.reject(
        new ProviderError(
          failure,
          `fake_${failure}`,
          failure === 'rate_limited' ? 429 : 503,
          failure === 'rate_limited' ? 1 : null,
        ),
      );
    }
    const prompt = [
      request.instructions ?? '',
      ...request.messages.map((message) => message.content),
    ].join('\n');
    if (request.tools && request.tools.length > 0 && request.responseSchema) {
      return Promise.reject(new ProviderError('invalid_request', 'tools_with_response_schema'));
    }
    const calls = request.tools && request.tools.length > 0 ? this.toolResponder(request) : null;
    if (calls && calls.length > 0 && request.toolChoice !== 'none') {
      const text = '';
      return Promise.resolve({
        provider: 'fake',
        model: request.model,
        text,
        json: null,
        toolCalls: calls,
        finishReason: 'tool_call',
        rawFinishReason: 'tool_calls',
        usage: {
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: Math.ceil(JSON.stringify(calls).length / 4),
          reasoningTokens: null,
          cachedInputTokens: null,
        },
        providerRequestId: `fake-${createHash('sha256')
          .update(`${prompt}|${request.idempotencyKey ?? ''}`)
          .digest('hex')
          .slice(0, 12)}`,
        latencyMs: 1,
      });
    }
    const canned = request.responseSchema ? this.responder(request) : null;
    const json = request.responseSchema
      ? (canned ?? sampleForSchema(request.responseSchema.schema, request.responseSchema.name))
      : null;
    // After a tool turn the fake "answers" from what the tool returned, so a round trip is testable.
    const toolTurn = [...request.messages].reverse().find((message) => message.role === 'tool');
    const text =
      json !== null
        ? JSON.stringify(json)
        : toolTurn
          ? `Fake answer from the tool result: ${toolTurn.content}`
          : `Fake answer: ${createHash('sha256').update(prompt).digest('hex').slice(0, 16)}`;
    return Promise.resolve({
      provider: 'fake',
      model: request.model,
      text,
      json,
      toolCalls: [],
      finishReason: 'stop',
      rawFinishReason: 'stop',
      usage: {
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: Math.ceil(text.length / 4),
        reasoningTokens: null,
        cachedInputTokens: null,
      },
      providerRequestId: `fake-${createHash('sha256')
        .update(`${prompt}|${request.idempotencyKey ?? ''}`)
        .digest('hex')
        .slice(0, 12)}`,
      latencyMs: 1,
    });
  }
}
