import { describe, expect, it } from 'vitest';

import { textToSpeak, voiceCostUsd } from '../src/voice/voice-pricing.js';

const price = {
  perMinute: 0.006,
  per1kCharacters: 0.015,
  inputPerMillion: null,
  outputPerMillion: null,
};
const usage = { audioSeconds: null, characters: null, inputTokens: 0, outputTokens: 0 };

describe('voice cost (ADR-0046)', () => {
  it('charges speech to text by the minute and text to speech by the thousand characters', () => {
    expect(voiceCostUsd('stt', { ...usage, audioSeconds: 90 }, price)).toBeCloseTo(0.009, 8);
    expect(voiceCostUsd('tts', { ...usage, characters: 2000 }, price)).toBeCloseTo(0.03, 8);
  });

  it('adds token charges when the model reports tokens', () => {
    const tokens = { ...price, perMinute: null, inputPerMillion: 2, outputPerMillion: 10 };
    expect(
      voiceCostUsd('stt', { ...usage, inputTokens: 1000, outputTokens: 100 }, tokens),
    ).toBeCloseTo(0.003, 8);
  });

  it('is unpriced, never zero, without a price or a matching unit', () => {
    expect(voiceCostUsd('stt', { ...usage, audioSeconds: 10 }, null)).toBeNull();
    expect(voiceCostUsd('stt', { ...usage, characters: 100 }, price)).toBeNull();
    expect(
      voiceCostUsd('tts', { ...usage, audioSeconds: 10 }, { ...price, per1kCharacters: null }),
    ).toBeNull();
  });
});

describe('text read aloud', () => {
  it('drops code blocks and markup so they are not spelled out', () => {
    const source = ['## عنوان', '```ts', 'const a = 1', '```', 'متن **مهم** است'].join('\n');
    expect(textToSpeak(source, 500).text).toBe('عنوان متن مهم است');
  });

  it('cuts a long answer at the end of a sentence and says it was cut', () => {
    const long = `${'یک جمله است. '.repeat(30)}`.trim();
    const out = textToSpeak(long, 100);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(100);
    expect(out.text.endsWith('.')).toBe(true);
  });

  it('leaves a short text whole', () => {
    expect(textToSpeak('سلام', 100)).toEqual({ text: 'سلام', truncated: false });
  });
});
