import { describe, expect, it } from 'vitest';

import { costFigures, providerLabel } from './voice-assistant-cost';
import { voiceCostMessagesFor } from './voice-cost-messages';

const group = {
  provider: 'openai',
  mode: 'realtime' as const,
  model: 'gpt-realtime',
  sessions: 4,
  minutes: 20,
  voiceCostUsd: 0.6,
  typedCostUsd: 0.2,
  tokens: 100,
  cachedInputTokens: 10,
};

describe('the voice assistant cost tab', () => {
  it('works out the total, the average per conversation and the voice share', () => {
    const figures = costFigures(group);
    expect(figures.total).toBeCloseTo(0.8);
    expect(figures.perSession).toBeCloseTo(0.2);
    expect(figures.voiceShare).toBeCloseTo(0.75);
  });

  it('shows zeros, not NaN, for a group that cost nothing or has no conversation', () => {
    expect(costFigures({ ...group, voiceCostUsd: 0, typedCostUsd: 0 })).toEqual({
      total: 0,
      perSession: 0.0,
      voiceShare: 0,
    });
    expect(
      costFigures({ ...group, sessions: 0, voiceCostUsd: 0, typedCostUsd: 0 }).perSession,
    ).toBe(0);
  });

  it('names a provider as people know it, and a typed session as having none', () => {
    const text = voiceCostMessagesFor('en');
    expect(providerLabel('openai', text)).toBe('OpenAI');
    expect(providerLabel('elevenlabs', text)).toBe('ElevenLabs');
    expect(providerLabel('', text)).toBe(text.typedOnly);
    expect(providerLabel('somebody', text)).toBe('somebody');
  });

  it('has the same words in both languages, none empty', () => {
    const fa = voiceCostMessagesFor('fa');
    const en = voiceCostMessagesFor('en');
    expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
    for (const messages of [fa, en]) {
      const entries = Object.entries(messages) as [string, string | Record<string, string>][];
      for (const [key, value] of entries) {
        const words: string[] = typeof value === 'string' ? [value] : Object.values(value);
        for (const word of words) expect(word.trim(), key).not.toBe('');
      }
      expect(messages.lastDays).toContain('{n}');
      expect(messages.busiest).toContain('{day}');
      expect(messages.busiest).toContain('{cost}');
    }
  });
});
