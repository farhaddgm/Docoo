import type { AdapterOptions } from './adapters.js';
import { ProviderError } from './contract.js';
import { errorForStatus, providerErrorDetail, type FetchLike } from './http.js';
import type {
  AudioMimeType,
  SpeechModelDescriptor,
  SpeechProviderAdapter,
  SpeechProviderKind,
  SynthesizeRequest,
  SynthesizeResult,
  TranscribeRequest,
  TranscribeResult,
  VoiceDescriptor,
} from './speech.js';
import { AUDIO_MIME_TYPES } from './speech.js';

const DEFAULT_TIMEOUT_MS = 25_000;
/** An answer that is read aloud is far smaller than this; the cap stops a runaway response. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/u;

interface BinaryResult {
  readonly status: number;
  readonly headers: Headers;
  readonly bytes: Uint8Array;
  readonly latencyMs: number;
}

/** Like `requestJson` but the answer may be audio; never follows a redirect and caps the size. */
async function requestBytes(
  fetchImpl: FetchLike,
  provider: string,
  url: string,
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string | FormData;
    json?: boolean;
    timeoutMs: number;
    signal?: AbortSignal | undefined;
  },
): Promise<BinaryResult> {
  const started = performance.now();
  const signals = [AbortSignal.timeout(init.timeoutMs), ...(init.signal ? [init.signal] : [])];
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method,
      redirect: 'error',
      headers: {
        ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.any(signals),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError')
      throw new ProviderError('timeout', `${provider}_timeout`);
    throw new ProviderError('transient', `${provider}_unreachable`);
  }
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) {
    const raw = await response
      .text()
      .then((text) => text.slice(0, 4096))
      .catch(() => '');
    throw errorForStatus(response.status, response.headers, provider, providerErrorDetail(raw));
  }
  const buffer = await response.arrayBuffer().catch(() => null);
  if (!buffer) throw new ProviderError('transient', `${provider}_invalid_body`, response.status);
  if (buffer.byteLength > MAX_AUDIO_BYTES)
    throw new ProviderError('invalid_output', `${provider}_audio_too_large`, response.status);
  return {
    status: response.status,
    headers: response.headers,
    bytes: new Uint8Array(buffer),
    latencyMs,
  };
}

function parseJson(result: BinaryResult, provider: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(result.bytes));
    if (value !== null && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    // falls through to the error below
  }
  throw new ProviderError('transient', `${provider}_invalid_json`, result.status);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mimeOf(headers: Headers, fallback: AudioMimeType): AudioMimeType {
  const type = headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return AUDIO_MIME_TYPES.find((mime) => mime === type) ?? fallback;
}

function extensionOf(mime: AudioMimeType): string {
  return {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'mp4',
    'audio/wav': 'wav',
    'audio/mpeg': 'mp3',
  }[mime];
}

function recordingForm(request: TranscribeRequest, fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const copy = new Uint8Array(request.audio.byteLength);
  copy.set(request.audio);
  form.append(
    'file',
    new Blob([copy], { type: request.mimeType }),
    `recording.${extensionOf(request.mimeType)}`,
  );
  return form;
}

abstract class SpeechHttpAdapter implements SpeechProviderAdapter {
  abstract readonly kind: SpeechProviderKind;
  protected readonly fetchImpl: FetchLike;

  constructor(protected readonly options: AdapterOptions) {
    if (!options.apiKey) throw new ProviderError('auth', 'provider_secret_missing');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  abstract listModels(): Promise<readonly SpeechModelDescriptor[]>;
  abstract listVoices(): Promise<readonly VoiceDescriptor[]>;
  abstract transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
  abstract synthesize(request: SynthesizeRequest): Promise<SynthesizeResult>;

  async healthCheck() {
    const started = performance.now();
    const checkedAt = new Date().toISOString();
    try {
      await this.listModels();
      const latencyMs = Math.round(performance.now() - started);
      return {
        status:
          latencyMs > (this.options.degradedAfterMs ?? 5000)
            ? ('degraded' as const)
            : ('healthy' as const),
        checkedAt,
        latencyMs,
        error: null,
      };
    } catch (error) {
      const failure =
        error instanceof ProviderError
          ? error
          : new ProviderError('transient', `${this.kind}_unreachable`);
      return {
        status: failure.kind === 'auth' ? ('invalid' as const) : ('unavailable' as const),
        checkedAt,
        latencyMs: null,
        error: failure.message,
      };
    }
  }
}

/** The voices OpenAI documents for its speech models; the API has no endpoint that lists them. */
const OPENAI_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'fable',
  'marin',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
] as const;

export class OpenAiSpeechAdapter extends SpeechHttpAdapter {
  readonly kind = 'openai' as const;
  private get base(): string {
    return this.options.baseUrl ?? 'https://api.openai.com/v1';
  }
  private get auth(): Record<string, string> {
    return { authorization: `Bearer ${this.options.apiKey}` };
  }

  async listModels(): Promise<readonly SpeechModelDescriptor[]> {
    const result = await requestBytes(this.fetchImpl, 'openai', `${this.base}/models`, {
      method: 'GET',
      headers: { ...this.auth, accept: 'application/json' },
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const data = parseJson(result, 'openai')['data'];
    const models: SpeechModelDescriptor[] = [];
    for (const item of Array.isArray(data) ? (data as unknown[]) : []) {
      const id = str((item as Record<string, unknown> | null)?.['id']);
      if (!id) continue;
      const kind = /transcribe|whisper/u.test(id)
        ? 'stt'
        : /(^|-)tts(-|$)/u.test(id)
          ? 'tts'
          : null;
      if (kind) models.push({ id, provider: 'openai', displayName: id, kind, languages: [] });
    }
    return models.sort((a, b) => a.id.localeCompare(b.id));
  }

  listVoices(): Promise<readonly VoiceDescriptor[]> {
    return Promise.resolve(
      OPENAI_VOICES.map((id) => ({
        id,
        provider: 'openai' as const,
        name: id[0]!.toUpperCase() + id.slice(1),
        languages: [],
        description: null,
        previewUrl: null,
      })),
    );
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
    const result = await requestBytes(
      this.fetchImpl,
      'openai',
      `${this.base}/audio/transcriptions`,
      {
        method: 'POST',
        headers: { ...this.auth, accept: 'application/json' },
        body: recordingForm(request, {
          model: request.model,
          response_format: 'json',
          ...(request.language ? { language: request.language } : {}),
        }),
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      },
    );
    const body = parseJson(result, 'openai');
    const text = str(body['text']);
    if (text === null && typeof body['text'] !== 'string')
      throw new ProviderError('invalid_output', 'openai_transcript_missing');
    const usage = (body['usage'] ?? {}) as Record<string, unknown>;
    const seconds =
      num(usage['seconds']) ?? (request.durationMsHint ? request.durationMsHint / 1000 : null);
    return {
      text: (text ?? '').trim(),
      language: request.language,
      durationMs: seconds === null ? null : Math.round(seconds * 1000),
      usage: {
        audioSeconds: seconds,
        characters: null,
        inputTokens: num(usage['input_tokens']) ?? 0,
        outputTokens: num(usage['output_tokens']) ?? 0,
      },
      latencyMs: result.latencyMs,
      providerRequestId: result.headers.get('x-request-id'),
    };
  }

  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResult> {
    if (!VOICE_ID.test(request.voiceId))
      throw new ProviderError('invalid_request', 'openai_voice_invalid');
    const result = await requestBytes(this.fetchImpl, 'openai', `${this.base}/audio/speech`, {
      method: 'POST',
      headers: { ...this.auth, accept: 'audio/mpeg' },
      body: JSON.stringify({
        model: request.model,
        voice: request.voiceId,
        input: request.text,
        speed: Math.min(4, Math.max(0.25, request.speed)),
        response_format: 'mp3',
      }),
      timeoutMs: request.timeoutMs,
      signal: request.signal,
    });
    return {
      audio: result.bytes,
      mimeType: mimeOf(result.headers, 'audio/mpeg'),
      usage: {
        audioSeconds: null,
        characters: request.text.length,
        inputTokens: 0,
        outputTokens: 0,
      },
      latencyMs: result.latencyMs,
      providerRequestId: result.headers.get('x-request-id'),
    };
  }
}

/** ElevenLabs lists its speech-to-text model nowhere in the API, so the one it documents is named here. */
const ELEVENLABS_STT_MODELS = ['scribe_v1'] as const;
/** The range ElevenLabs accepts for the speed of a voice. */
const ELEVENLABS_SPEED = { min: 0.7, max: 1.2 } as const;

export class ElevenLabsSpeechAdapter extends SpeechHttpAdapter {
  readonly kind = 'elevenlabs' as const;
  private get base(): string {
    return this.options.baseUrl ?? 'https://api.elevenlabs.io';
  }
  private get auth(): Record<string, string> {
    return { 'xi-api-key': this.options.apiKey };
  }

  private async json(path: string): Promise<unknown> {
    const result = await requestBytes(this.fetchImpl, 'elevenlabs', `${this.base}${path}`, {
      method: 'GET',
      headers: { ...this.auth, accept: 'application/json' },
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    try {
      return JSON.parse(new TextDecoder().decode(result.bytes));
    } catch {
      throw new ProviderError('transient', 'elevenlabs_invalid_json', result.status);
    }
  }

  async listModels(): Promise<readonly SpeechModelDescriptor[]> {
    const body = await this.json('/v1/models');
    const models: SpeechModelDescriptor[] = ELEVENLABS_STT_MODELS.map((id) => ({
      id,
      provider: 'elevenlabs' as const,
      displayName: id,
      kind: 'stt' as const,
      languages: [],
    }));
    for (const item of Array.isArray(body) ? (body as unknown[]) : []) {
      const row = (item ?? {}) as Record<string, unknown>;
      const id = str(row['model_id']);
      if (!id || row['can_do_text_to_speech'] !== true) continue;
      const languages = Array.isArray(row['languages'])
        ? (row['languages'] as unknown[]).flatMap((entry) => {
            const code = str((entry as Record<string, unknown> | null)?.['language_id']);
            return code ? [code] : [];
          })
        : [];
      models.push({
        id,
        provider: 'elevenlabs',
        displayName: str(row['name']) ?? id,
        kind: 'tts',
        languages,
      });
    }
    return models;
  }

  async listVoices(): Promise<readonly VoiceDescriptor[]> {
    const body = (await this.json('/v2/voices?page_size=100')) as Record<string, unknown> | null;
    const voices: VoiceDescriptor[] = [];
    for (const item of Array.isArray(body?.['voices']) ? (body['voices'] as unknown[]) : []) {
      const row = (item ?? {}) as Record<string, unknown>;
      const id = str(row['voice_id']);
      if (!id || !VOICE_ID.test(id)) continue;
      const verified = Array.isArray(row['verified_languages'])
        ? (row['verified_languages'] as unknown[])
        : [];
      voices.push({
        id,
        provider: 'elevenlabs',
        name: str(row['name']) ?? id,
        languages: verified.flatMap((entry) => {
          const code = str((entry as Record<string, unknown> | null)?.['language']);
          return code ? [code] : [];
        }),
        description: str(row['description']),
        previewUrl: str(row['preview_url']),
      });
    }
    return voices;
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
    const result = await requestBytes(
      this.fetchImpl,
      'elevenlabs',
      `${this.base}/v1/speech-to-text`,
      {
        method: 'POST',
        headers: { ...this.auth, accept: 'application/json' },
        body: recordingForm(request, {
          model_id: request.model,
          ...(request.language ? { language_code: request.language } : {}),
        }),
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      },
    );
    const body = parseJson(result, 'elevenlabs');
    if (typeof body['text'] !== 'string')
      throw new ProviderError('invalid_output', 'elevenlabs_transcript_missing');
    const words = Array.isArray(body['words']) ? (body['words'] as unknown[]) : [];
    const lastEnd = words.reduce<number>(
      (end, word) => Math.max(end, num((word as Record<string, unknown> | null)?.['end']) ?? 0),
      0,
    );
    const seconds =
      lastEnd > 0 ? lastEnd : request.durationMsHint ? request.durationMsHint / 1000 : null;
    return {
      text: body['text'].trim(),
      language: str(body['language_code']) ?? request.language,
      durationMs: seconds === null ? null : Math.round(seconds * 1000),
      usage: { audioSeconds: seconds, characters: null, inputTokens: 0, outputTokens: 0 },
      latencyMs: result.latencyMs,
      providerRequestId: result.headers.get('request-id'),
    };
  }

  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResult> {
    if (!VOICE_ID.test(request.voiceId))
      throw new ProviderError('invalid_request', 'elevenlabs_voice_invalid');
    const speed = Math.min(ELEVENLABS_SPEED.max, Math.max(ELEVENLABS_SPEED.min, request.speed));
    const result = await requestBytes(
      this.fetchImpl,
      'elevenlabs',
      `${this.base}/v1/text-to-speech/${request.voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { ...this.auth, accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: request.text,
          model_id: request.model,
          ...(request.language ? { language_code: request.language } : {}),
          voice_settings: { speed },
        }),
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      },
    );
    return {
      audio: result.bytes,
      mimeType: mimeOf(result.headers, 'audio/mpeg'),
      usage: {
        audioSeconds: null,
        characters: request.text.length,
        inputTokens: 0,
        outputTokens: 0,
      },
      latencyMs: result.latencyMs,
      providerRequestId: result.headers.get('request-id'),
    };
  }
}
