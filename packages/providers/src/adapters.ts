import {
  ProviderError,
  type ConversationMessage,
  type FinishReason,
  type ModelCapabilities,
  type ModelDescriptor,
  type ModelProviderAdapter,
  type NormalizedModelRequest,
  type NormalizedModelResponse,
  type ProviderHealth,
  type ProviderKind,
  type ToolCall,
  type WebSearchResult,
  type WebSource,
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

/** A request asks for tools or for a structured answer, never both (see `NormalizedModelRequest`). */
function assertToolsOrSchema(request: NormalizedModelRequest): void {
  if (request.tools && request.tools.length > 0 && request.responseSchema) {
    throw new ProviderError('invalid_request', 'tools_with_response_schema');
  }
}

/** A web search answers in plain text; it cannot be mixed with functions or a response schema. */
/** A provider field that should be text; anything else counts as empty. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function assertWebSearchAlone(request: NormalizedModelRequest): void {
  if (request.webSearch && (hasTools(request) || request.responseSchema)) {
    throw new ProviderError('invalid_request', 'web_search_with_tools_or_schema');
  }
}

const SOURCE_TEXT_LIMIT = 1200;
const MAX_WEB_SOURCES = 30;

/** Collects the passages that cite each URL into one source per URL, in first-seen order. */
class SourceCollector {
  private readonly byUrl = new Map<string, { title: string; parts: string[] }>();

  add(url: unknown, title: unknown, text: string): void {
    if (typeof url !== 'string' || !/^https?:\/\//iu.test(url)) return;
    const entry = this.byUrl.get(url) ?? {
      title: typeof title === 'string' && title.trim() !== '' ? title.trim() : url,
      parts: [],
    };
    const part = text.trim();
    if (part !== '' && !entry.parts.includes(part)) entry.parts.push(part);
    this.byUrl.set(url, entry);
  }

  sources(): WebSource[] {
    return [...this.byUrl.entries()]
      .map(([url, entry]) => ({
        url,
        title: entry.title.slice(0, 300),
        text: entry.parts.join(' … ').slice(0, SOURCE_TEXT_LIMIT),
      }))
      .filter((source) => source.text !== '')
      .slice(0, MAX_WEB_SOURCES);
  }
}

/** The paragraph of `text` that holds the character at `index` (what a citation rests on). */
function paragraphAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

function hasTools(request: NormalizedModelRequest): boolean {
  return request.tools !== undefined && request.tools.length > 0;
}

/** Parses the arguments a model wrote for a tool; anything but a JSON object is an invalid answer. */
function parseToolArguments(raw: unknown, provider: string): unknown {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new ProviderError('invalid_output', `${provider}_tool_arguments_invalid`);
  }
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

  /**
   * Responses API input items. A tool call goes back as `function_call` and its result as
   * `function_call_output`; no item id is sent, so no reasoning item has to travel with it.
   */
  private inputItems(messages: readonly ConversationMessage[]): Json[] {
    const items: Json[] = [];
    for (const message of messages) {
      if (message.role === 'tool') {
        items.push({
          type: 'function_call_output',
          call_id: message.toolCallId,
          output: message.content,
        });
        continue;
      }
      if (message.content !== '' || !message.toolCalls?.length) {
        items.push({ role: message.role, content: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        items.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        });
      }
    }
    return items;
  }

  /** Queries and cited pages of a Responses answer that used the web search tool. */
  private webResult(output: unknown[]): WebSearchResult {
    const queries: string[] = [];
    const collector = new SourceCollector();
    for (const raw of output) {
      const item = asObject(raw);
      if (item['type'] === 'web_search_call') {
        const query = asObject(item['action'])['query'];
        if (typeof query === 'string' && query !== '' && !queries.includes(query))
          queries.push(query);
      }
      if (item['type'] !== 'message') continue;
      for (const part of asArray(item['content']).map((value) => asObject(value))) {
        const text = typeof part['text'] === 'string' ? part['text'] : '';
        for (const note of asArray(part['annotations']).map((value) => asObject(value))) {
          if (note['type'] !== 'url_citation') continue;
          const at = num(note['start_index']) ?? 0;
          collector.add(note['url'], note['title'], paragraphAt(text, at));
        }
      }
    }
    return { queries, sources: collector.sources() };
  }

  async invoke(request: NormalizedModelRequest): Promise<NormalizedModelResponse> {
    assertToolsOrSchema(request);
    assertWebSearchAlone(request);
    const body: Json = {
      model: request.model,
      input: this.inputItems(request.messages),
      store: false,
      max_output_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
    };
    if (request.webSearch) {
      body['tools'] = [{ type: 'web_search' }];
      body['max_tool_calls'] = request.webSearch.maxUses;
    }
    if (hasTools(request)) {
      body['tools'] = request.tools!.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: true,
      }));
      body['tool_choice'] = request.toolChoice ?? 'auto';
      body['parallel_tool_calls'] = false;
    }
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
    const toolCalls: ToolCall[] = asArray(response['output'])
      .map((item) => asObject(item))
      .filter((item) => item['type'] === 'function_call' && typeof item['name'] === 'string')
      .map((item, index) => ({
        id: typeof item['call_id'] === 'string' ? item['call_id'] : `call_${index}`,
        name: String(item['name']),
        arguments: parseToolArguments(item['arguments'], 'openai'),
      }));
    const status = typeof response['status'] === 'string' ? response['status'] : null;
    const incomplete = asObject(response['incomplete_details'])['reason'];
    const raw = status === 'incomplete' && typeof incomplete === 'string' ? incomplete : status;
    const finishReason: FinishReason =
      status === 'completed'
        ? toolCalls.length > 0
          ? 'tool_call'
          : 'stop'
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
      toolCalls: finishReason === 'tool_call' ? toolCalls : [],
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
      ...(request.webSearch ? { web: this.webResult(asArray(response['output'])) } : {}),
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

  /**
   * `contents` with tool turns: a model turn that called tools carries `functionCall` parts (with
   * the thought signature Gemini asked to have returned) and the results come back together as
   * `functionResponse` parts of one user turn.
   */
  private contents(messages: readonly ConversationMessage[]): Json[] {
    const contents: Json[] = [];
    let pending: Json[] = [];
    const flush = () => {
      if (pending.length > 0) contents.push({ role: 'user', parts: pending });
      pending = [];
    };
    for (const message of messages) {
      if (message.role === 'tool') {
        pending.push({
          functionResponse: { name: message.toolName, response: { result: message.content } },
        });
        continue;
      }
      flush();
      const parts: Json[] = [];
      if (message.content !== '') parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        const signature = asObject(call.providerData)['thoughtSignature'];
        parts.push({
          functionCall: { name: call.name, args: call.arguments ?? {} },
          ...(typeof signature === 'string' ? { thoughtSignature: signature } : {}),
        });
      }
      if (parts.length === 0) parts.push({ text: '' });
      contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
    }
    flush();
    return contents;
  }

  /** Queries and pages of a Google Search grounded answer, with the passages that rest on each. */
  private webResult(candidate: Json): WebSearchResult {
    const grounding = asObject(candidate['groundingMetadata']);
    const chunks = asArray(grounding['groundingChunks']).map((value) =>
      asObject(asObject(value)['web']),
    );
    const collector = new SourceCollector();
    for (const support of asArray(grounding['groundingSupports']).map((value) => asObject(value))) {
      const text = textOf(asObject(support['segment'])['text']);
      for (const index of asArray(support['groundingChunkIndices'])) {
        const chunk = typeof index === 'number' ? chunks[index] : undefined;
        if (chunk) collector.add(chunk['uri'], chunk['title'], text);
      }
    }
    const queries = asArray(grounding['webSearchQueries']).filter(
      (value): value is string => typeof value === 'string' && value !== '',
    );
    return { queries, sources: collector.sources() };
  }

  async invoke(request: NormalizedModelRequest): Promise<NormalizedModelResponse> {
    assertToolsOrSchema(request);
    assertWebSearchAlone(request);
    const generationConfig: Json = {
      maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
    };
    if (request.temperature !== undefined) generationConfig['temperature'] = request.temperature;
    if (request.responseSchema) {
      generationConfig['responseMimeType'] = 'application/json';
      generationConfig['responseJsonSchema'] = request.responseSchema.schema;
    }
    const body: Json = {
      contents: this.contents(request.messages),
      generationConfig,
    };
    if (hasTools(request)) {
      body['tools'] = [
        {
          functionDeclarations: request.tools!.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: tool.parameters,
          })),
        },
      ];
      const mode = { auto: 'AUTO', none: 'NONE', required: 'ANY' }[request.toolChoice ?? 'auto'];
      body['toolConfig'] = { functionCallingConfig: { mode } };
    }
    if (request.webSearch) body['tools'] = [{ google_search: {} }];
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
    const toolCalls: ToolCall[] = asArray(asObject(candidate['content'])['parts'])
      .map((part) => asObject(part))
      .filter((part) => asObject(part['functionCall'])['name'] !== undefined)
      .map((part, index) => {
        const call = asObject(part['functionCall']);
        return {
          id: typeof call['id'] === 'string' ? call['id'] : `call_${index}`,
          name: String(call['name']),
          arguments: call['args'] ?? {},
          ...(typeof part['thoughtSignature'] === 'string'
            ? { providerData: { thoughtSignature: part['thoughtSignature'] } }
            : {}),
        };
      });
    const raw = typeof candidate['finishReason'] === 'string' ? candidate['finishReason'] : null;
    const finishReason: FinishReason =
      raw === 'STOP' || (raw === null && toolCalls.length > 0)
        ? toolCalls.length > 0
          ? 'tool_call'
          : 'stop'
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
      toolCalls: finishReason === 'tool_call' ? toolCalls : [],
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
      ...(request.webSearch ? { web: this.webResult(candidate) } : {}),
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

  /**
   * Messages with tool turns: an assistant turn that called tools is text plus `tool_use` blocks,
   * and the results of that turn come back together as `tool_result` blocks of one user message.
   */
  private wireMessages(messages: readonly ConversationMessage[]): Json[] {
    const wire: Json[] = [];
    let results: Json[] = [];
    const flush = () => {
      if (results.length > 0) wire.push({ role: 'user', content: results });
      results = [];
    };
    for (const message of messages) {
      if (message.role === 'tool') {
        results.push({
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content,
        });
        continue;
      }
      flush();
      if (!message.toolCalls?.length) {
        wire.push({ role: message.role, content: message.content });
        continue;
      }
      wire.push({
        role: 'assistant',
        content: [
          ...(message.content !== '' ? [{ type: 'text', text: message.content }] : []),
          ...message.toolCalls.map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments ?? {},
          })),
        ],
      });
    }
    flush();
    return wire;
  }

  /** Queries and pages of a Messages answer that used the web search tool, with the cited text. */
  private webResult(blocks: Json[]): WebSearchResult {
    const queries: string[] = [];
    const collector = new SourceCollector();
    for (const block of blocks) {
      if (block['type'] === 'server_tool_use' && block['name'] === 'web_search') {
        const query = asObject(block['input'])['query'];
        if (typeof query === 'string' && query !== '' && !queries.includes(query))
          queries.push(query);
      }
      if (block['type'] !== 'text') continue;
      for (const note of asArray(block['citations']).map((value) => asObject(value))) {
        if (note['type'] === 'web_search_result_location') {
          collector.add(note['url'], note['title'], textOf(note['cited_text']));
        }
      }
    }
    return { queries, sources: collector.sources() };
  }

  async invoke(request: NormalizedModelRequest): Promise<NormalizedModelResponse> {
    assertToolsOrSchema(request);
    assertWebSearchAlone(request);
    const body: Json = {
      model: request.model,
      max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
      messages: this.wireMessages(request.messages),
    };
    if (request.webSearch) {
      body['tools'] = [
        { type: 'web_search_20250305', name: 'web_search', max_uses: request.webSearch.maxUses },
      ];
    }
    if (hasTools(request)) {
      body['tools'] = request.tools!.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
      body['tool_choice'] = {
        type: { auto: 'auto', none: 'none', required: 'any' }[request.toolChoice ?? 'auto'],
        disable_parallel_tool_use: true,
      };
    }
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
    const toolUse = request.responseSchema
      ? blocks.find(
          (block) => block['type'] === 'tool_use' && block['name'] === request.responseSchema?.name,
        )
      : undefined;
    const toolCalls: ToolCall[] = request.responseSchema
      ? []
      : blocks
          .filter((block) => block['type'] === 'tool_use' && typeof block['name'] === 'string')
          .map((block, index) => ({
            id: typeof block['id'] === 'string' ? block['id'] : `call_${index}`,
            name: String(block['name']),
            arguments: block['input'] ?? {},
          }));
    const finishReason: FinishReason =
      raw === 'tool_use' && toolCalls.length > 0
        ? 'tool_call'
        : raw === 'end_turn' || raw === 'stop_sequence' || (raw === 'tool_use' && toolUse)
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
      toolCalls: finishReason === 'tool_call' ? toolCalls : [],
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
      ...(request.webSearch ? { web: this.webResult(blocks) } : {}),
    };
  }
}
