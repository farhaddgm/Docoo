/**
 * The one provider contract the domain sees (docs/03-ai/04-provider-orchestration.md §2).
 * Adapters translate it to OpenAI Responses, Gemini generateContent and Anthropic Messages.
 */
export type ProviderKind = 'openai' | 'gemini' | 'anthropic' | 'fake';

export const PROVIDER_KINDS: readonly ProviderKind[] = ['openai', 'gemini', 'anthropic', 'fake'];

export interface ModelCapabilities {
  readonly text: boolean;
  readonly structuredOutput: boolean;
  readonly tools: boolean;
  readonly imageInput: boolean;
  readonly fileInput: boolean;
  readonly audioInput: boolean;
  readonly streaming: boolean;
  readonly reasoning: boolean;
}

export interface ModelDescriptor {
  readonly id: string;
  readonly provider: ProviderKind;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;
  readonly contextWindow: number | null;
  readonly maxOutputTokens: number | null;
}

/** A function a model may ask the platform to run (docs/03-ai/01-agent-system.md §6). */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** Strict-mode JSON schema of the arguments (see `strictSchemaProblems`). */
  readonly parameters: JsonSchema;
}

/** One call the model asked for. `arguments` is the parsed JSON object the model wrote. */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
  /** Opaque provider data that must be sent back with the call (Gemini thought signatures). */
  readonly providerData?: unknown;
}

export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /** The tool calls an assistant turn made; the next messages answer them. */
  readonly toolCalls?: readonly ToolCall[] | undefined;
}

/** The platform's answer to one tool call, sent back so the model can go on. */
export interface ToolResultMessage {
  readonly role: 'tool';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: string;
}

export type ConversationMessage = ChatMessage | ToolResultMessage;

export type ToolChoice = 'auto' | 'none' | 'required';

/** A JSON schema object for structured output (subset supported by all three providers). */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface NormalizedModelRequest {
  readonly model: string;
  readonly instructions?: string | undefined;
  readonly messages: readonly ConversationMessage[];
  /**
   * Functions the model may call. A request carries tools or a response schema, never both: the
   * platform first lets the model use tools, then asks for the structured answer in a second call.
   */
  readonly tools?: readonly ToolSpec[] | undefined;
  readonly toolChoice?: ToolChoice | undefined;
  readonly responseSchema?: { readonly name: string; readonly schema: JsonSchema } | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly temperature?: number | undefined;
  readonly timeoutMs?: number | undefined;
  /** Correlation/idempotency key forwarded where the provider supports it. */
  readonly idempotencyKey?: string | undefined;
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number | null;
  readonly cachedInputTokens: number | null;
}

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_call' | 'other';

export interface NormalizedModelResponse {
  readonly provider: ProviderKind;
  readonly model: string;
  readonly text: string;
  /** Parsed JSON when a response schema was requested. */
  readonly json: unknown;
  /** What the model asked to run; empty unless `finishReason` is `tool_call`. */
  readonly toolCalls: readonly ToolCall[];
  readonly finishReason: FinishReason;
  readonly rawFinishReason: string | null;
  readonly usage: Usage;
  readonly providerRequestId: string | null;
  readonly latencyMs: number;
}

export type HealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'invalid';

export interface ProviderHealth {
  readonly status: HealthStatus;
  readonly checkedAt: string;
  readonly latencyMs: number | null;
  /** Sanitised message: never contains the secret or request content. */
  readonly error: string | null;
}

export interface ModelProviderAdapter {
  readonly kind: ProviderKind;
  listModels(): Promise<ModelDescriptor[]>;
  healthCheck(): Promise<ProviderHealth>;
  invoke(request: NormalizedModelRequest): Promise<NormalizedModelResponse>;
}

export type ProviderErrorKind =
  | 'transient'
  | 'rate_limited'
  | 'timeout'
  | 'permanent'
  | 'auth'
  | 'invalid_request'
  | 'invalid_output';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly code: string,
    readonly status: number | null = null,
    readonly retryAfterSeconds: number | null = null,
    /** The provider's own reason (sanitised, at most 300 characters); never part of `message`. */
    readonly detail: string | null = null,
  ) {
    super(code);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.kind === 'transient' || this.kind === 'rate_limited' || this.kind === 'timeout';
  }
}
