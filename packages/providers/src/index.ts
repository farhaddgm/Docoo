import { AnthropicAdapter, GeminiAdapter, OpenAiAdapter, type AdapterOptions } from './adapters.js';
import type { ModelProviderAdapter, ProviderKind } from './contract.js';
import { FakeAdapter } from './fake.js';

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
