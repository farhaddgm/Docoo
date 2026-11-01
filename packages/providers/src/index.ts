import { AnthropicAdapter, GeminiAdapter, OpenAiAdapter, type AdapterOptions } from './adapters.js';
import type { ModelProviderAdapter, ProviderKind } from './contract.js';
import { FakeAdapter } from './fake.js';
import { ElevenLabsSpeechAdapter, OpenAiSpeechAdapter } from './speech-adapters.js';
import {
  FakeSpeechAdapter,
  type SpeechProviderAdapter,
  type SpeechProviderKind,
} from './speech.js';

export * from './adapters.js';
export * from './contract.js';
export * from './fake.js';
export * from './http.js';
export * from './policy.js';
export * from './price-catalog.js';
export * from './secrets.js';

/** Builds the adapter for a stored connection; the fake provider needs no secret. */
export function createAdapter(kind: ProviderKind, options: AdapterOptions): ModelProviderAdapter {
  switch (kind) {
    case 'openai':
      return new OpenAiAdapter(options);
    case 'gemini':
      return new GeminiAdapter(options);
    case 'anthropic':
      return new AnthropicAdapter(options);
    case 'fake':
      return new FakeAdapter();
  }
}
export * from './schema-compat.js';
export * from './openai-embedding-adapter.js';
export * from './speech.js';
export * from './speech-adapters.js';

/** Builds the speech adapter for a stored connection (ADR-0046); the fake needs no secret. */
export function createSpeechAdapter(
  kind: SpeechProviderKind,
  options: AdapterOptions,
): SpeechProviderAdapter {
  switch (kind) {
    case 'openai':
      return new OpenAiSpeechAdapter(options);
    case 'elevenlabs':
      return new ElevenLabsSpeechAdapter(options);
    case 'fake':
      return new FakeSpeechAdapter();
  }
}
