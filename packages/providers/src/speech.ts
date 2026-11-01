/**
 * The speech provider contract (ADR-0046). Voice is a layer over the text chat: speech to text
 * before a message is sent, text to speech after the answer is written. Adapters (OpenAI,
 * ElevenLabs) translate this contract to their own APIs. Model and voice ids come from the live
 * catalog of the provider and are never fixed in business code.
 */
export type SpeechProviderKind = 'openai' | 'elevenlabs' | 'fake';

export const SPEECH_PROVIDER_KINDS: readonly SpeechProviderKind[] = [
  'openai',
  'elevenlabs',
  'fake',
];

export type SpeechKind = 'stt' | 'tts';

export interface SpeechModelDescriptor {
  readonly id: string;
  readonly provider: SpeechProviderKind;
  readonly displayName: string;
  readonly kind: SpeechKind;
  /** Language codes the model is documented to handle; empty when the provider does not say. */
  readonly languages: readonly string[];
}

export interface VoiceDescriptor {
  readonly id: string;
  readonly provider: SpeechProviderKind;
  readonly name: string;
  readonly languages: readonly string[];
  readonly description: string | null;
  /** A short sample the provider supplies, when it does; otherwise a preview is synthesised. */
  readonly previewUrl: string | null;
}

/** Audio formats a recording may arrive in; the signature of the bytes is checked as well. */
export const AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/wav',
  'audio/mpeg',
] as const;
export type AudioMimeType = (typeof AUDIO_MIME_TYPES)[number];

export interface SpeechUsage {
  /** Seconds of audio read (speech to text). */
  readonly audioSeconds: number | null;
  /** Characters spoken (text to speech). */
  readonly characters: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface TranscribeRequest {
  readonly model: string;
  readonly audio: Uint8Array;
  readonly mimeType: AudioMimeType;
  /** `fa`, `en` or null to let the provider detect the language. */
  readonly language: string | null;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

export interface TranscribeResult {
  readonly text: string;
  readonly language: string | null;
  readonly durationMs: number | null;
  readonly usage: SpeechUsage;
  readonly latencyMs: number;
  readonly providerRequestId: string | null;
}

export interface SynthesizeRequest {
  readonly model: string;
  readonly voiceId: string;
  readonly text: string;
  readonly speed: number;
  readonly language: string | null;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

export interface SynthesizeResult {
  readonly audio: Uint8Array;
  readonly mimeType: AudioMimeType;
  readonly usage: SpeechUsage;
  readonly latencyMs: number;
  readonly providerRequestId: string | null;
}

export interface SpeechProviderAdapter {
  readonly kind: SpeechProviderKind;
  listModels(): Promise<readonly SpeechModelDescriptor[]>;
  listVoices(): Promise<readonly VoiceDescriptor[]>;
  transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
  synthesize(request: SynthesizeRequest): Promise<SynthesizeResult>;
}

/** The first bytes of a recording must match the format it claims; the browser's word is not enough. */
export function audioSignatureMatches(mime: AudioMimeType, bytes: Uint8Array): boolean {
  const at = (i: number, text: string) =>
    text.split('').every((ch, k) => bytes[i + k] === ch.charCodeAt(0));
  switch (mime) {
    case 'audio/webm':
      return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case 'audio/ogg':
      return at(0, 'OggS');
    case 'audio/wav':
      return at(0, 'RIFF') && at(8, 'WAVE');
    case 'audio/mp4':
      return at(4, 'ftyp');
    case 'audio/mpeg':
      return at(0, 'ID3') || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);
  }
}

/** A deterministic adapter for tests and local runs: echoes a fixed transcript, returns tiny WAV audio. */
export class FakeSpeechAdapter implements SpeechProviderAdapter {
  readonly kind = 'fake' as const;

  constructor(private readonly transcript = 'fake transcript') {}

  listModels(): Promise<readonly SpeechModelDescriptor[]> {
    return Promise.resolve([
      {
        id: 'fake-stt',
        provider: 'fake',
        displayName: 'Fake STT',
        kind: 'stt',
        languages: ['fa', 'en'],
      },
      {
        id: 'fake-tts',
        provider: 'fake',
        displayName: 'Fake TTS',
        kind: 'tts',
        languages: ['fa', 'en'],
      },
    ]);
  }

  listVoices(): Promise<readonly VoiceDescriptor[]> {
    return Promise.resolve([
      {
        id: 'fake-voice',
        provider: 'fake',
        name: 'Fake',
        languages: ['fa', 'en'],
        description: null,
        previewUrl: null,
      },
    ]);
  }

  transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
    return Promise.resolve({
      text: this.transcript,
      language: request.language,
      durationMs: 1000,
      usage: { audioSeconds: 1, characters: null, inputTokens: 0, outputTokens: 0 },
      latencyMs: 1,
      providerRequestId: 'fake-stt',
    });
  }

  synthesize(request: SynthesizeRequest): Promise<SynthesizeResult> {
    const wav = new Uint8Array(44);
    wav.set([0x52, 0x49, 0x46, 0x46, 36, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    return Promise.resolve({
      audio: wav,
      mimeType: 'audio/wav',
      usage: {
        audioSeconds: null,
        characters: request.text.length,
        inputTokens: 0,
        outputTokens: 0,
      },
      latencyMs: 1,
      providerRequestId: 'fake-tts',
    });
  }
}
