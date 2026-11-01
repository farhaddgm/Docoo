import { describe, expect, it } from 'vitest';

import { defaultVoicePreferences, voicePreferencesSchema, voiceSteps } from './voice.js';

describe('voice modes', () => {
  it('the default is text in and text out, nothing sent to a speech provider', () => {
    expect(voiceSteps(defaultVoicePreferences)).toEqual({ transcribe: false, speak: false });
  });

  it('maps each of the three voice modes to the steps it needs', () => {
    expect(voiceSteps({ input: 'voice', output: 'text' })).toEqual({
      transcribe: true,
      speak: false,
    });
    expect(voiceSteps({ input: 'voice', output: 'voice' })).toEqual({
      transcribe: true,
      speak: true,
    });
    expect(voiceSteps({ input: 'text', output: 'voice' })).toEqual({
      transcribe: false,
      speak: true,
    });
  });

  it('refuses a mode or a volume outside the allowed values', () => {
    expect(
      voicePreferencesSchema.safeParse({ ...defaultVoicePreferences, input: 'video' }).success,
    ).toBe(false);
    expect(
      voicePreferencesSchema.safeParse({ ...defaultVoicePreferences, volume: 2 }).success,
    ).toBe(false);
    expect(voicePreferencesSchema.safeParse(defaultVoicePreferences).success).toBe(true);
  });
});
