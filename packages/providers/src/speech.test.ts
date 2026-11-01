import { describe, expect, it } from 'vitest';

import { audioSignatureMatches, FakeSpeechAdapter } from './index.js';

describe('audioSignatureMatches', () => {
  it('accepts the real header of each format', () => {
    expect(audioSignatureMatches('audio/webm', Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe(
      true,
    );
    expect(audioSignatureMatches('audio/ogg', Uint8Array.from([0x4f, 0x67, 0x67, 0x53]))).toBe(
      true,
    );
    expect(audioSignatureMatches('audio/mpeg', Uint8Array.from([0x49, 0x44, 0x33]))).toBe(true);
    expect(
      audioSignatureMatches('audio/mp4', Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])),
    ).toBe(true);
  });

  it('rejects bytes that do not match the claimed format', () => {
    expect(audioSignatureMatches('audio/webm', Uint8Array.from([0x4f, 0x67, 0x67, 0x53]))).toBe(
      false,
    );
    expect(audioSignatureMatches('audio/wav', new TextEncoder().encode('<html></html>'))).toBe(
      false,
    );
    expect(audioSignatureMatches('audio/ogg', new Uint8Array(0))).toBe(false);
  });

  it('the fake adapter produces audio that passes its own check', async () => {
    const fake = new FakeSpeechAdapter();
    const out = await fake.synthesize({
      model: 'fake-tts',
      voiceId: 'fake-voice',
      text: 'سلام',
      speed: 1,
      language: 'fa',
      timeoutMs: 1000,
    });
    expect(audioSignatureMatches(out.mimeType, out.audio)).toBe(true);
    expect(out.usage.characters).toBe(4);
  });
});
