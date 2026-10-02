export interface TranscriptSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly confidence?: number;
}

export interface Transcript {
  readonly language: string | null;
  readonly durationMs: number | null;
  readonly segments: TranscriptSegment[];
}

/** Speech-to-text port (ING-005). */
export interface Transcriber {
  readonly id: string;
  readonly configured: boolean;
  transcribe(audio: Uint8Array, mime: string, language: string | null): Promise<Transcript>;
}

export class TranscriptionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

interface VerboseSegment {
  start: number;
  end: number;
  text: string;
  avg_logprob?: number;
}

/**
 * OpenAI-compatible `/audio/transcriptions` (`verbose_json` with segment timestamps). Works
 * with any provider that implements this contract; the key comes from
 * `TRANSCRIPTION_API_KEY` and is never logged.
 */
export class OpenAiCompatibleTranscriber implements Transcriber {
  readonly id: string;
  readonly configured = true;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
    private readonly model = 'whisper-1',
    private readonly timeoutMs = 300_000,
  ) {
    this.id = `openai-compatible:${model}`;
  }

  async transcribe(audio: Uint8Array, mime: string, language: string | null): Promise<Transcript> {
    const form = new FormData();
    const extension = mime.split('/')[1] ?? 'bin';
    form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extension}`);
    form.append('model', this.model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    if (language) form.append('language', language);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/u, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new TranscriptionError('transcription_unreachable');
    }
    if (response.status === 401 || response.status === 403) {
      throw new TranscriptionError('transcription_unauthorized');
    }
    if (!response.ok) throw new TranscriptionError(`transcription_http_${response.status}`);
    const body = (await response.json()) as {
      language?: string;
      duration?: number;
      text?: string;
      segments?: VerboseSegment[];
    };
    const segments = (body.segments ?? []).map((segment) => ({
      startMs: Math.round(segment.start * 1000),
      endMs: Math.round(segment.end * 1000),
      text: segment.text.trim(),
      ...(segment.avg_logprob === undefined
        ? {}
        : { confidence: Math.round(Math.exp(segment.avg_logprob) * 1000) / 1000 }),
    }));
    if (segments.length === 0 && body.text) {
      segments.push({
        startMs: 0,
        endMs: Math.round((body.duration ?? 0) * 1000),
        text: body.text.trim(),
      });
    }
    return {
      language: body.language ?? language,
      durationMs: body.duration === undefined ? null : Math.round(body.duration * 1000),
      segments,
    };
  }
}

/** Used without `TRANSCRIPTION_API_KEY`: audio stays `partial` with a clear reason. */
export class UnconfiguredTranscriber implements Transcriber {
  readonly id = 'none';
  readonly configured = false;

  transcribe(): Promise<Transcript> {
    return Promise.reject(new TranscriptionError('transcription_not_configured'));
  }
}

export function transcriberFromEnv(env: NodeJS.ProcessEnv = process.env): Transcriber {
  const key = env['TRANSCRIPTION_API_KEY'];
  if (!key) return new UnconfiguredTranscriber();
  return new OpenAiCompatibleTranscriber(
    key,
    env['TRANSCRIPTION_BASE_URL'] || undefined,
    env['TRANSCRIPTION_MODEL'] || undefined,
  );
}

/** Duration of a PCM WAV file from its header, for the audio duration limit. */
export function wavDurationMs(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 44) return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') byteRate = view.getUint32(offset + 16, true);
    if (id === 'data') return byteRate > 0 ? Math.round((size / byteRate) * 1000) : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}
