import { ProviderError } from '@docoo/providers';
import { describe, expect, it } from 'vitest';
import type { PromptResearchQuestion } from '@docoo/domain';

import { assessGaps } from './research-gap-run.js';

const asked: PromptResearchQuestion[] = [
  { id: 'Q1', question: 'a', why: 'w', channel: 'web' },
  { id: 'Q2', question: 'b', why: 'w', channel: 'web' },
];
const base = {
  model: { connectionId: 'c', model: 'm' },
  asked,
  notes: 'notes',
  pages: [],
  language: 'en' as const,
  affordable: () => Promise.resolve(true),
};

describe('assessGaps', () => {
  it('returns the coverage the model gave', async () => {
    const result = await assessGaps({
      ...base,
      invoke: (_t, request) => {
        expect(request.responseSchema.name).toBe('research_gaps');
        return Promise.resolve({
          response: {
            finishReason: 'stop',
            json: { questions: [{ id: 'Q1', covered: true, missing: '' }] },
          },
        });
      },
    });
    expect(result).toEqual([
      { id: 'Q1', covered: true, missing: '' },
      { id: 'Q2', covered: false, missing: '' },
    ]);
  });

  it('returns null, and never calls the model, with nothing asked or no budget', async () => {
    const invoke = () => Promise.reject(new Error('must not be called'));
    expect(await assessGaps({ ...base, asked: [], invoke })).toBeNull();
    expect(
      await assessGaps({ ...base, affordable: () => Promise.resolve(false), invoke }),
    ).toBeNull();
  });

  it('returns null when the call fails or comes back unusable, so the loop is not stopped by it', async () => {
    expect(
      await assessGaps({
        ...base,
        invoke: () => Promise.reject(new ProviderError('transient', 'rate_limited')),
      }),
    ).toBeNull();
    expect(
      await assessGaps({
        ...base,
        invoke: () => Promise.resolve({ response: { finishReason: 'length', json: null } }),
      }),
    ).toBeNull();
  });
});
