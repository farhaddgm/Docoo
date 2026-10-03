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

export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** A JSON schema object for structured output (subset supported by all three providers). */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface NormalizedModelRequest {
  readonly model: string;
  readonly instructions?: string | undefined;
  readonly messages: readonly ChatMessage[];
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
  ) {
    super(code);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.kind === 'transient' || this.kind === 'rate_limited' || this.kind === 'timeout';
  }
}
