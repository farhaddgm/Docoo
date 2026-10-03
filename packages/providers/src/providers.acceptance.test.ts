import { describe, expect, it } from 'vitest';

import type { ProviderKind } from './contract.js';
import { createAdapter } from './index.js';

/**
 * AI-002/003/004 acceptance against the real provider APIs. Each provider runs only when its
 * key is present (the Provider acceptance workflow passes the repository secrets). The model
 * comes from <PROVIDER>_MODEL or, without it, the first live catalog model with structured
 * output, so no model name is hard-coded.
 */
const providers: {
  kind: Exclude<ProviderKind, 'fake'>;
  key: string | undefined;
  model: string | undefined;
}[] = [
  { kind: 'openai', key: process.env['OPENAI_API_KEY'], model: process.env['OPENAI_MODEL'] },
  { kind: 'gemini', key: process.env['GEMINI_API_KEY'], model: process.env['GEMINI_MODEL'] },
  {
    kind: 'anthropic',
    key: process.env['ANTHROPIC_API_KEY'],
    model: process.env['ANTHROPIC_MODEL'],
  },
];

for (const provider of providers) {
  describe.skipIf(!provider.key)(`${provider.kind} acceptance`, () => {
    const adapter = () => createAdapter(provider.kind, { apiKey: provider.key ?? '' });

    it('is healthy and lists live models', async () => {
      const health = await adapter().healthCheck();
      expect(health).toMatchObject({ status: 'healthy', error: null });
      const models = await adapter().listModels();
      expect(models.length).toBeGreaterThan(0);
    }, 60_000);

    it('returns structured output with usage and a normalized finish reason', async () => {
      const models = await adapter().listModels();
      const model = provider.model ?? models.find((item) => item.capabilities.structuredOutput)?.id;
      expect(
        model,
        'set <PROVIDER>_MODEL or use a key whose catalog has a structured-output model',
      ).toBeTruthy();
      const response = await adapter().invoke({
        model: model!,
        instructions: 'Answer in JSON only.',
        messages: [
          { role: 'user', content: 'Name the capital of France and give the answer in English.' },
        ],
        responseSchema: {
          name: 'capital',
          schema: {
            type: 'object',
            properties: { city: { type: 'string' }, country: { type: 'string' } },
            required: ['city', 'country'],
            additionalProperties: false,
          },
        },
        maxOutputTokens: 2000,
      });
      expect(['stop', 'tool_call']).toContain(response.finishReason);
      expect((response.json as { city?: string }).city?.toLowerCase()).toContain('paris');
      expect(response.usage.inputTokens).toBeGreaterThan(0);
      expect(response.usage.outputTokens).toBeGreaterThan(0);
      console.log(
        `${provider.kind} ${model}: ${response.usage.inputTokens}+${response.usage.outputTokens} tokens, ${response.latencyMs} ms`,
      );
    }, 120_000);
  });
}
