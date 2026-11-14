import { describe, expect, it } from 'vitest';

import { voiceLabel, voiceSpeaks } from './voice-list';

describe('the voices of the live assistant settings', () => {
  it('shows a voice with the languages the provider says it speaks, at most four', () => {
    expect(voiceLabel({ name: 'Rachel', languages: [] })).toBe('Rachel');
    expect(voiceLabel({ name: 'Rachel', languages: ['en', 'fa'] })).toBe('Rachel — en, fa');
    expect(voiceLabel({ name: 'Wide', languages: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe(
      'Wide — a, b, c, d',
    );
  });

  it('puts first the voices that speak the conversation language, and none for "auto"', () => {
    const persian = { languages: ['en', 'fa-IR'] };
    expect(voiceSpeaks(persian, 'fa')).toBe(true);
    expect(voiceSpeaks(persian, 'FA')).toBe(true);
    expect(voiceSpeaks(persian, 'en')).toBe(true);
    expect(voiceSpeaks({ languages: ['en'] }, 'fa')).toBe(false);
    expect(voiceSpeaks(persian, 'auto')).toBe(false);
    expect(voiceSpeaks(persian, '')).toBe(false);
    expect(voiceSpeaks(undefined, 'fa')).toBe(false);
  });
});
