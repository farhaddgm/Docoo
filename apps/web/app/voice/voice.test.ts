import { describe, expect, it } from 'vitest';

import {
  appendTranscript,
  describeMode,
  formatElapsed,
  pickRecordingType,
  problemFor,
} from './voice-helpers';

describe('voice helpers', () => {
  it('picks the best recording format the browser supports, or none', () => {
    expect(pickRecordingType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecordingType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickRecordingType(() => false)).toBeNull();
  });

  it('shows the clock of a recording as minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65.9)).toBe('1:05');
    expect(formatElapsed(-3)).toBe('0:00');
  });

  it('names the four modes from the two choices', () => {
    expect(describeMode('text', 'text')).toBe('text');
    expect(describeMode('voice', 'text')).toBe('dictate');
    expect(describeMode('text', 'voice')).toBe('listen');
    expect(describeMode('voice', 'voice')).toBe('talk');
  });

  it('adds a transcript after what is typed and ignores an empty one', () => {
    expect(appendTranscript('', ' سلام ')).toBe('سلام');
    expect(appendTranscript('پیش از این ', 'سلام')).toBe('پیش از این سلام');
    expect(appendTranscript('متن', '   ')).toBe('متن');
  });

  it('reduces API problem codes to the few the messages explain', () => {
    expect(problemFor('VOICE_DISABLED', 409)).toBe('disabled');
    expect(problemFor('VOICE_AUDIO_TOO_LONG', 422)).toBe('too_long');
    expect(problemFor('AUTH_AI_LIMIT_REACHED', 429)).toBe('limit');
    expect(problemFor('VOICE_PROVIDER_TIMEOUT', 409)).toBe('timeout');
    expect(problemFor(undefined, 403)).toBe('denied');
    expect(problemFor(undefined, 500)).toBe('unknown');
  });
});
