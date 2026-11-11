import { describe, expect, it } from 'vitest';

import {
  ELEVENLABS_DEFAULT_TTS_MODEL,
  ELEVENLABS_STT_MODEL,
  PIPELINE_FALLBACK_PRICE,
  isLiveVoiceProvider,
  liveVoiceProviders,
  pipelineCostUsd,
  voiceModeOf,
} from './live-assistant.js';

describe('the voice brands of the assistant (ADR-0057)', () => {
  it('knows the two brands and which kind of session each runs', () => {
    expect(liveVoiceProviders).toEqual(['openai', 'elevenlabs']);
    expect(isLiveVoiceProvider('elevenlabs')).toBe(true);
    expect(isLiveVoiceProvider('gemini')).toBe(false);
    expect(isLiveVoiceProvider('')).toBe(false);
    expect(voiceModeOf('openai')).toBe('realtime');
    expect(voiceModeOf('elevenlabs')).toBe('pipeline');
  });

  it('fixes the hearing model and suggests the Persian-capable speaking model', () => {
    expect(ELEVENLABS_STT_MODEL).toBe('scribe_v3_live');
    expect(ELEVENLABS_DEFAULT_TTS_MODEL).toBe('eleven_v4_turbo');
  });
});

describe('the cost of a pipeline', () => {
  const listed = { sttPerMinute: 0.22 / 60, ttsPer1kCharacters: 0.04 };

  it('adds the time heard and the characters spoken at the entered prices', () => {
    // 10 minutes heard at 0.22 USD per hour, 4500 characters at 0.04 USD per 1000.
    const cost = pipelineCostUsd({ audioSeconds: 600, characters: 4500 }, listed);
    expect(cost).toBeCloseTo(0.22 / 6 + 0.18, 5);
  });

  it('uses a deliberately high price for a component that has none, so the caps still work', () => {
    const unpriced = pipelineCostUsd({ audioSeconds: 60, characters: 1000 }, null);
    expect(unpriced).toBeCloseTo(
      PIPELINE_FALLBACK_PRICE.sttPerMinute + PIPELINE_FALLBACK_PRICE.ttsPer1kCharacters,
      6,
    );
    const half = pipelineCostUsd(
      { audioSeconds: 60, characters: 1000 },
      { sttPerMinute: null, ttsPer1kCharacters: 0.04 },
    );
    expect(half).toBeCloseTo(PIPELINE_FALLBACK_PRICE.sttPerMinute + 0.04, 6);
    expect(PIPELINE_FALLBACK_PRICE.sttPerMinute * 60).toBeGreaterThan(0.22);
    expect(PIPELINE_FALLBACK_PRICE.ttsPer1kCharacters).toBeGreaterThan(0.04);
  });

  it('is zero for no use, ignores negative or missing numbers and rounds to a millionth', () => {
    expect(pipelineCostUsd({}, listed)).toBe(0);
    expect(pipelineCostUsd({ audioSeconds: -5, characters: -9 }, listed)).toBe(0);
    expect(pipelineCostUsd({ audioSeconds: 1, characters: 1 }, listed)).toBe(0.000101);
  });
});
