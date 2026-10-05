import {
  ProviderError,
  type FinishReason,
  type ModelCapabilities,
  type ModelDescriptor,
  type ModelProviderAdapter,
  type NormalizedModelRequest,
  type NormalizedModelResponse,
  type ProviderHealth,
  type ProviderKind,
} from './contract.js';
import { parseStructured, requestJson, type FetchLike } from './http.js';

export interface AdapterOptions {
  readonly apiKey: string;
  readonly baseUrl?: string | undefined;
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
  /** Above this latency a successful health check reports `degraded`. */
  readonly degradedAfterMs?: number | undefined;
}

/** A long structured answer from a reasoning model can take minutes; the activity allows ten. */
const DEFAULT_TIMEOUT_MS = 300_000;
/** Generation output limit when the request sets none (Anthropic requires one). */
const DEFAULT_MAX_OUTPUT = 8192;

/** Provider-level capabilities; model listings do not expose them, so they are the baseline. */
const BASELINE: Record<Exclude<ProviderKind, 'fake'>, ModelCapabilities> = {
  openai: {
    text: true,
    structuredOutput: true,
    tools: true,
    imageInput: true,
    fileInput: true,
    audioInput: false,
    streaming: true,
    reasoning: true,
  },
  gemini: {
    text: true,
    structuredOutput: true,
    tools: true,
    imageInput: true,
    fileInput: true,
    audioInput: true,
    streaming: true,
    reasoning: true,
  },
  anthropic: {
    text: true,
    structuredOutput: true,
    tools: true,
    imageInput: true,
    fileInput: true,
    audioInput: false,
    streaming: true,
    reasoning: true,
  },
};

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Chat-capable OpenAI models only: the account also lists embeddings, speech, images and more. */
export function isOpenAiTextModel(id: string): boolean {
  if (!/^(gpt-|o\d|chatgpt-)/u.test(id)) return false;
  return !/(embedding|whisper|tts|dall-e|moderation|realtime|audio|transcribe|image|search|instruct|davinci|babbage)/u.test(
    id,
  );
}

/** Gemini text models that take a system instruction and a JSON schema (not Gemma, speech or image ones). */
export function isGeminiTextModel(name: string): boolean {
  const id = name.replace(/^models\//u, '');
  if (!id.startsWith('gemini')) return false;
  return !/(embedding|image|tts|live|native-audio|robotics|computer-use|aqa)/u.test(id);
}

abstract class HttpAdapter implements ModelProviderAdapter {
  abstract readonly kind: Exclude<ProviderKind, 'fake'>;
  protected readonly fetchImpl: FetchLike;
  protected readonly timeoutMs: number;

  constructor(protected readonly options: AdapterOptions) {
    if (!options.apiKey) throw new ProviderError('auth', 'provider_secret_missing');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  abstract listModels(): Promise<ModelDescriptor[]>;
  abstract invoke(request: NormalizedModelRequest): Promise<NormalizedModelResponse>;

  /** Lists models: no customer data is sent, and auth, reachability and latency are proven. */
  async healthCheck(): Promise<ProviderHealth> {
    const started = performance.now();
    const checkedAt = new Date().toISOString();
    try {
      await this.listModels();
      const latencyMs = Math.round(performance.now() - started);
      return {
        status: latencyMs > (this.options.degradedAfterMs ?? 5000) ? 'degraded' : 'healthy',
        checkedAt,
        latencyMs,
        error: null,
      };
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? error
          : new ProviderError('transient', `${this.kind}_unreachable`);
      return {
        status:
          providerError.kind === 'auth'
            ? 'invalid'
            : providerError.kind === 'rate_limited'
              ? 'degraded'
              : 'unavailable',
        checkedAt,
        latencyMs: null,
        error: providerError.code,
      };
    }
  }

  protected descriptor(
    id: string,
    displayName: string,
    contextWindow: number | null,
    maxOutputTokens: number | null,
  ): ModelDescriptor {
    return {
      id,
      provider: this.kind,
      displayName,
      capabilities: BASELINE[this.kind],
      contextWindow,
      maxOutputTokens,
    };
  }
}

/** OpenAI Responses API. `store` is false so content is not kept as application state. */
export class OpenAiAdapter extends HttpAdapter {
  readonly kind = 'openai' as const;
  private get base(): string {
    return (this.options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/u, '');
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.options.apiKey}` };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    const result = await requestJson(this.fetchImpl, 'openai', `${this.base}/models`, {
      method: 'GET',
      headers: this.headers(),
      timeoutMs: 20_000,
    });
    return asArray(asObject(result.body)['data'])
      .map((item) => asObject(item))
      .filter((item) => typeof item['id'] === 'string' && isOpenAiTextModel(String(item['id'])))
      .map((item) => this.descriptor(String(item['id']), String(item['id']), null, null));
  }

  async invoke(request: NormalizedModelRequest): Promise<NormalizedModelResponse> {
    const body: Json = {
      model: request.model,
      input: request.messages.map((message) => ({ role: message.role, content: message.content })),
      store: false,
      max_output_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
    };
    if (request.instructions) body['instructions'] = request.instructions;
    if (request.temperature !== undefined) body['temperature'] = request.temperature;
    if (request.responseSchema) {
      body['text'] = {
        format: {
          type: 'json_schema',
          name: request.responseSchema.name,
          schema: request.responseSchema.schema,
          strict: true,
        },
      };
    }
    const headers = this.headers();
    if (request.idempotencyKey) headers['idempotency-key'] = request.idempotencyKey;
    const result = await requestJson(this.fetchImpl, 'openai', `${this.base}/responses`, {
      method: 'POST',
      headers,
      body,
      timeoutMs: request.timeoutMs ?? this.timeoutMs,
    });
    const response = asObject(result.body);
    const text = asArray(response['output'])
      .map((item) => asObject(item))
      .filter((item) => item['type'] === 'message')
      .flatMap((item) => asArray(item['content']).map((part) => asObject(part)))
      .filter((part) => part['type'] === 'output_text' && typeof part['text'] === 'string')
      .map((part) => String(part['text']))
      .join('');
    const status = typeof response['status'] === 'string' ? response['status'] : null;
    const incomplete = asObject(response['incomplete_details'])['reason'];
    const raw = status === 'incomplete' && typeof incomplete === 'string' ? incomplete : status;
    const finishReason: FinishReason =
      status === 'completed'
        ? 'stop'
        : incomplete === 'max_output_tokens'
          ? 'length'
          : incomplete === 'content_filter'
            ? 'content_filter'
            : 'other';
    const usage = asObject(response['usage']);
    // OpenAI counts reasoning inside output_tokens; split it out so cost never counts it twice.
    const reasoning = num(asObject(usage['output_tokens_details'])['reasoning_tokens']);
    return {
      provider: 'openai',
      model: typeof response['model'] === 'string' ? response['model'] : request.model,
      text,
      json:
        request.responseSchema && finishReason === 'stop' ? parseStructured(text, 'openai') : null,
      finishReason,
      rawFinishReason: raw,
      usage: {
        inputTokens: num(usage['input_tokens']) ?? 0,
        outputTokens: Math.max(0, (num(usage['output_tokens']) ?? 0) - (reasoning ?? 0)),
        reasoningTokens: reasoning,
        cachedInputTokens: num(asObject(usage['input_tokens_details'])['cached_tokens']),
      },
      providerRequestId:
        typeof response['id'] === 'string' ? response['id'] : result.headers.get('x-request-id'),
      latencyMs: result.latencyMs,
    };
  }
}

/** Google Gemini generateContent with JSON-schema responses. */
export class GeminiAdapter extends HttpAdapter {
  readonly kind = 'gemini' as const;
  private get base(): string {
    return (this.options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(
      /\/$/u,
      '',
    );
  }

  private headers(): Record<string, string> {
    return { 'x-goog-api-key': this.options.apiKey };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    const result = await requestJson(
      this.fetchImpl,
      'gemini',
      `${this.base}/models?pageSize=1000`,
      {
        method: 'GET',
        headers: this.headers(),
        timeoutMs: 20_000,
      },
    );
    return asArray(asObject(result.body)['models'])
      .map((item) => asObject(item))
      .filter(
        (item) =>
          typeof item['name'] === 'string' &&
          asArray(item['supportedGenerationMethods']).includes('generateContent') &&
          isGeminiTextModel(String(item['name'])),
      )
      .map((item) =>
        this.descriptor(
          String(item['name']).replace(/^models\//u, ''),
          typeof item['displayName'] === 'string' ? item['displayName'] : String(item['name']),
          num(item['inputTokenLimit']),
          num(item['outputTokenLimit']),
        ),
      );
  }

  async invoke(request: NormalizedModelRequest): Promise<NormalizedModelResponse> {
    const generationConfig: Json = {
      maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
    };
    if (request.temperature !== undefined) generationConfig['temperature'] = request.temperature;
    if (request.responseSchema) {
      generationConfig['responseMimeType'] = 'application/json';
      generationConfig['responseJsonSchema'] = request.responseSchema.schema;
    }
    const body: Json = {
      contents: request.messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      generationConfig,
    };
    if (request.instructions)
      body['systemInstruction'] = { parts: [{ text: request.instructions }] };
    const model = encodeURIComponent(request.model.replace(/^models\//u, ''));
    const result = await requestJson(
      this.fetchImpl,
      'gemini',
      `${this.base}/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: this.headers(),
        body,
        timeoutMs: request.timeoutMs ?? this.timeoutMs,
      },
    );
    const response = asObject(result.body);
    const candidate = asObject(asArray(response['candidates'])[0]);
    const text = asArray(asObject(candidate['content'])['parts'])
      .map((part) => asObject(part))
      .filter((part) => typeof part['text'] === 'string' && part['thought'] !== true)
      .map((part) => String(part['text']))
      .join('');
    const raw = typeof candidate['finishReason'] === 'string' ? candidate['finishReason'] : null;
    const finishReason: FinishReason =
      raw === 'STOP'
        ? 'stop'
        : raw === 'MAX_TOKENS'
          ? 'length'
          : raw === 'SAFETY' || raw === 'PROHIBITED_CONTENT' || raw === 'BLOCKLIST'
            ? 'content_filter'
            : 'other';
    const usage = asObject(response['usageMetadata']);
    return {
      provider: 'gemini',
      model:
        typeof response['modelVersion'] === 'string' ? response['modelVersion'] : request.model,
      text,
      json:
        request.responseSchema && finishReason === 'stop' ? parseStructured(text, 'gemini') : null,
      finishReason,
      rawFinishReason: raw,
      usage: {
        inputTokens: num(usage['promptTokenCount']) ?? 0,
        outputTokens: num(usage['candidatesTokenCount']) ?? 0,
        reasoningTokens: num(usage['thoughtsTokenCount']),
        cachedInputTokens: num(usage['cachedContentTokenCount']),
      },
      providerRequestId: typeof response['responseId'] === 'string' ? response['responseId'] : null,
      latencyMs: result.latencyMs,
    };
  }
}

/** Anthropic Messages API; structured output through a forced tool call. */
export class AnthropicAdapter extends HttpAdapter {
  readonly kind = 'anthropic' as const;
  static readonly API_VERSION = '2023-06-01';
  private get base(): string {
    return (this.options.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/u, '');
  }

  private headers(): Record<string, string> {
    return { 'x-api-key': this.options.apiKey, 'anthropic-version': AnthropicAdapter.API_VERSION };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    const result = await requestJson(
      this.fetchImpl,
      'anthropic',
      `${this.base}/models?limit=1000`,
      {
        method: 'GET',
        headers: this.headers(),
        timeoutMs: 20_000,
      },
    );
    return asArray(asObject(result.body)['data'])
      .map((item) => asObject(item))
      .filter((item) => typeof item['id'] === 'string')
      .map((item) =>
        this.descriptor(
          String(item['id']),
          typeof item['display_name'] === 'string' ? item['display_name'] : String(item['id']),
          num(item['max_input_tokens']),
          num(item['max_tokens']),
        ),
      );
  }

  async invoke(request: NormalizedModelRequest): Promise<NormalizedModelResponse> {
    const body: Json = {
      model: request.model,
      max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    };
    if (request.instructions) body['system'] = request.instructions;
    if (request.temperature !== undefined) body['temperature'] = request.temperature;
    if (request.responseSchema) {
      body['tools'] = [
        {
          name: request.responseSchema.name,
          description: 'Return the result in this exact structure.',
          input_schema: request.responseSchema.schema,
        },
      ];
      body['tool_choice'] = { type: 'tool', name: request.responseSchema.name };
    }
    const result = await requestJson(this.fetchImpl, 'anthropic', `${this.base}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body,
      timeoutMs: request.timeoutMs ?? this.timeoutMs,
    });
    const response = asObject(result.body);
    const blocks = asArray(response['content']).map((block) => asObject(block));
    const text = blocks
      .filter((block) => block['type'] === 'text' && typeof block['text'] === 'string')
      .map((block) => String(block['text']))
      .join('');
    const raw = typeof response['stop_reason'] === 'string' ? response['stop_reason'] : null;
    const toolUse = blocks.find(
      (block) => block['type'] === 'tool_use' && block['name'] === request.responseSchema?.name,
    );
    const finishReason: FinishReason =
      raw === 'end_turn' || raw === 'stop_sequence' || (raw === 'tool_use' && toolUse)
        ? 'stop'
        : raw === 'max_tokens'
          ? 'length'
          : raw === 'refusal'
            ? 'content_filter'
            : 'other';
    if (request.responseSchema && finishReason === 'stop' && !toolUse) {
      throw new ProviderError('invalid_output', 'anthropic_structured_output_missing');
    }
    const usage = asObject(response['usage']);
    return {
      provider: 'anthropic',
      model: typeof response['model'] === 'string' ? response['model'] : request.model,
      text: request.responseSchema && toolUse ? JSON.stringify(toolUse['input']) : text,
      json: request.responseSchema && toolUse ? (toolUse['input'] ?? null) : null,
      finishReason,
      rawFinishReason: raw,
      usage: {
        inputTokens: num(usage['input_tokens']) ?? 0,
        outputTokens: num(usage['output_tokens']) ?? 0,
        reasoningTokens: null,
        cachedInputTokens: num(usage['cache_read_input_tokens']),
      },
      providerRequestId:
        typeof response['id'] === 'string' ? response['id'] : result.headers.get('request-id'),
      latencyMs: result.latencyMs,
    };
  }
}
