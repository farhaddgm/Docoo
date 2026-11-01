import { describe, expect, it } from 'vitest';

import { createSpeechAdapter, ProviderError, type FetchLike } from './index.js';

interface Call {
  url: string;
  init: RequestInit;
}

function stub(reply: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (url, init) => {
      const call = { url, init };
      calls.push(call);
      return Promise.resolve(reply(call));
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const mp3 = () =>
  new Response(Uint8Array.from([0x49, 0x44, 0x33, 4]), {
    headers: { 'content-type': 'audio/mpeg' },
  });
const recording = {
  audio: Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]),
  mimeType: 'audio/webm' as const,
};

describe('OpenAI speech adapter', () => {
  it('lists speech models only and never fetches voices from the network', async () => {
    const s = stub(() =>
      json({
        data: [
          { id: 'gpt-4o-mini-tts' },
          { id: 'gpt-4o-transcribe' },
          { id: 'whisper-1' },
          { id: 'gpt-4o' },
        ],
      }),
    );
    const adapter = createSpeechAdapter('openai', { apiKey: 'sk-secret', fetch: s.fetch });
    const models = await adapter.listModels();
    expect(models.map((m) => `${m.kind}:${m.id}`)).toEqual([
      'tts:gpt-4o-mini-tts',
      'stt:gpt-4o-transcribe',
      'stt:whisper-1',
    ]);
    expect((await adapter.listVoices()).length).toBeGreaterThan(5);
    expect(s.calls).toHaveLength(1);
    expect((s.calls[0]!.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer sk-secret',
    );
    expect(s.calls[0]!.init.redirect).toBe('error');
  });

  it('sends the recording as multipart and reports the seconds it was billed for', async () => {
    const s = stub(() => json({ text: ' سلام ', usage: { type: 'duration', seconds: 3.5 } }));
    const adapter = createSpeechAdapter('openai', { apiKey: 'k', fetch: s.fetch });
    const out = await adapter.transcribe({
      ...recording,
      model: 'whisper-1',
      language: 'fa',
      timeoutMs: 1000,
    });
    expect(out.text).toBe('سلام');
    expect(out.usage.audioSeconds).toBe(3.5);
    const form = s.calls[0]!.init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('fa');
    expect((form.get('file') as File).name).toBe('recording.webm');
  });

  it('falls back to the length the browser measured when the provider reports none', async () => {
    const s = stub(() => json({ text: 'hi' }));
    const adapter = createSpeechAdapter('openai', { apiKey: 'k', fetch: s.fetch });
    const out = await adapter.transcribe({
      ...recording,
      model: 'm',
      language: null,
      durationMsHint: 2000,
      timeoutMs: 1000,
    });
    expect(out.usage.audioSeconds).toBe(2);
  });

  it('synthesizes mp3 and counts characters', async () => {
    const s = stub(mp3);
    const adapter = createSpeechAdapter('openai', { apiKey: 'k', fetch: s.fetch });
    const out = await adapter.synthesize({
      model: 'gpt-4o-mini-tts',
      voiceId: 'coral',
      text: 'سلام دنیا',
      speed: 9,
      language: 'fa',
      timeoutMs: 1000,
    });
    expect(out.mimeType).toBe('audio/mpeg');
    expect(out.usage.characters).toBe(9);
    const sent = JSON.parse(s.calls[0]!.init.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({ voice: 'coral', model: 'gpt-4o-mini-tts', speed: 4 });
  });

  it('maps a rejected key to an auth error without leaking the key', async () => {
    const s = stub(() => json({ error: { message: 'bad key sk-secret-123456789012345678' } }, 401));
    const adapter = createSpeechAdapter('openai', {
      apiKey: 'sk-secret-123456789012345678',
      fetch: s.fetch,
    });
    const error = await adapter.listModels().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe('auth');
    expect(JSON.stringify(error)).not.toContain('sk-secret-123456789012345678');
    expect((await adapter.healthCheck?.())?.status).toBe('invalid');
  });

  it('refuses a voice id that could change the request', async () => {
    const adapter = createSpeechAdapter('openai', { apiKey: 'k', fetch: stub(mp3).fetch });
    await expect(
      adapter.synthesize({
        model: 'm',
        voiceId: '../x',
        text: 'a',
        speed: 1,
        language: null,
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
  });
});

describe('ElevenLabs speech adapter', () => {
  it('lists text to speech models from the account plus the documented speech to text model', async () => {
    const s = stub(() =>
      json([
        {
          model_id: 'eleven_multilingual_v2',
          name: 'Multilingual v2',
          can_do_text_to_speech: true,
          languages: [{ language_id: 'fa' }, { language_id: 'en' }],
        },
        { model_id: 'eleven_sts', can_do_text_to_speech: false },
      ]),
    );
    const adapter = createSpeechAdapter('elevenlabs', { apiKey: 'xi', fetch: s.fetch });
    const models = await adapter.listModels();
    expect(models.map((m) => `${m.kind}:${m.id}`)).toEqual([
      'stt:scribe_v1',
      'tts:eleven_multilingual_v2',
    ]);
    expect(models[1]!.languages).toEqual(['fa', 'en']);
    expect((s.calls[0]!.init.headers as Record<string, string>)['xi-api-key']).toBe('xi');
  });

  it('lists the voices of the account with their preview samples', async () => {
    const s = stub(() =>
      json({
        voices: [
          {
            voice_id: 'abc123',
            name: 'Sara',
            description: 'calm',
            preview_url: 'https://x/p.mp3',
            verified_languages: [{ language: 'fa' }],
          },
          { voice_id: '../bad', name: 'x' },
        ],
      }),
    );
    const adapter = createSpeechAdapter('elevenlabs', { apiKey: 'xi', fetch: s.fetch });
    const voices = await adapter.listVoices();
    expect(voices).toHaveLength(1);
    expect(voices[0]).toMatchObject({
      id: 'abc123',
      name: 'Sara',
      languages: ['fa'],
      previewUrl: 'https://x/p.mp3',
    });
  });

  it('takes the duration from the last word and keeps the speed within the range it accepts', async () => {
    const s = stub((call) =>
      call.url.includes('speech-to-text')
        ? json({ text: 'hello', language_code: 'en', words: [{ end: 0.5 }, { end: 1.75 }] })
        : mp3(),
    );
    const adapter = createSpeechAdapter('elevenlabs', { apiKey: 'xi', fetch: s.fetch });
    const heard = await adapter.transcribe({
      ...recording,
      model: 'scribe_v1',
      language: null,
      timeoutMs: 1000,
    });
    expect(heard.usage.audioSeconds).toBe(1.75);
    expect(heard.language).toBe('en');
    await adapter.synthesize({
      model: 'eleven_multilingual_v2',
      voiceId: 'abc123',
      text: 'x',
      speed: 3,
      language: 'fa',
      timeoutMs: 1000,
    });
    expect(s.calls[1]!.url).toContain('/v1/text-to-speech/abc123');
    expect(JSON.parse(s.calls[1]!.init.body as string)).toMatchObject({
      voice_settings: { speed: 1.2 },
      language_code: 'fa',
    });
  });

  it('reports a slow provider as a timeout and a limit as rate limited', async () => {
    const slow: FetchLike = () =>
      Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    await expect(
      createSpeechAdapter('elevenlabs', { apiKey: 'k', fetch: slow }).listVoices(),
    ).rejects.toMatchObject({ kind: 'timeout' });
    const limited = stub(
      () => new Response('{}', { status: 429, headers: { 'retry-after': '7' } }),
    );
    await expect(
      createSpeechAdapter('elevenlabs', { apiKey: 'k', fetch: limited.fetch }).listModels(),
    ).rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('needs a key', () => {
    expect(() => createSpeechAdapter('elevenlabs', { apiKey: '' })).toThrow(ProviderError);
  });
});
