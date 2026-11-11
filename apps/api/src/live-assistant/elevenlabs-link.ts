import type { LiveVoiceCheckFailure } from '@docoo/contracts';

import {
  classifyRefusal,
  nodeSocketFactory,
  type LinkCheckResult,
  type LinkSocketFactory,
} from './realtime-link.js';

/**
 * The links from the server to ElevenLabs for the voice pipeline (ADR-0057): the live speech to
 * text socket (Scribe v3 Live) and the text to dialogue socket (Eleven v4). The check opens each
 * once and closes it; nothing is said, so it costs nothing. Everything that knows ElevenLabs'
 * addresses and event names for the check is in this file.
 */

export interface ElevenLabsEndpoints {
  /** `wss://…` base, with no trailing slash and no version. */
  readonly ws: string;
}

/**
 * The address of a connection: its own base address if it has one (a regional endpoint such as
 * `https://api.eu.residency.elevenlabs.io`), else the global one. A trailing `/v1` is dropped.
 */
export function elevenLabsEndpoints(baseUrl: string | null): ElevenLabsEndpoints {
  const base = (baseUrl ?? 'https://api.elevenlabs.io')
    .trim()
    .replace(/\/+$/u, '')
    .replace(/\/v1$/u, '');
  return { ws: base.replace(/^http/iu, 'ws') };
}

/**
 * Whether Docoo asks ElevenLabs for zero retention on both sockets (`enable_logging=false`). The
 * documentation says zero retention may be limited to some plans; the link check sends the same
 * flag, so a plan that cannot have it fails the check, not a conversation. One switch, one place.
 */
export const ELEVENLABS_ZERO_RETENTION = true;

export interface SttUrlOptions {
  readonly audioFormat?: string;
  readonly commitStrategy?: 'manual' | 'vad' | 'turn_prediction';
  readonly zeroRetention?: boolean;
}

export function sttUrl(
  baseUrl: string | null,
  model: string,
  language?: string,
  options: SttUrlOptions = {},
): string {
  const query = new URLSearchParams({
    model_id: model,
    audio_format: options.audioFormat ?? 'pcm_16000',
  });
  if (language) query.set('language_code', language);
  if (options.commitStrategy) query.set('commit_strategy', options.commitStrategy);
  if (options.zeroRetention) query.set('enable_logging', 'false');
  return `${elevenLabsEndpoints(baseUrl).ws}/v1/speech-to-text/realtime?${query.toString()}`;
}

export interface DialogueUrlOptions {
  readonly language?: string;
  readonly zeroRetention?: boolean;
}

export function dialogueUrl(
  baseUrl: string | null,
  model: string,
  options: DialogueUrlOptions = {},
): string {
  const query = new URLSearchParams({ model_id: model, output_format: 'pcm_24000' });
  if (options.language) query.set('language_code', options.language);
  if (options.zeroRetention) query.set('enable_logging', 'false');
  return `${elevenLabsEndpoints(baseUrl).ws}/v1/text-to-dialogue/stream-input?${query.toString()}`;
}

/** The HTTP address of the same service, for the streaming fallback of the speaking side. */
export function dialogueHttpUrl(baseUrl: string | null, options: DialogueUrlOptions = {}): string {
  const base = (baseUrl ?? 'https://api.elevenlabs.io')
    .trim()
    .replace(/\/+$/u, '')
    .replace(/\/v1$/u, '');
  const query = new URLSearchParams({ output_format: 'pcm_24000' });
  if (options.zeroRetention) query.set('enable_logging', 'false');
  return `${base}/v1/text-to-dialogue/stream?${query.toString()}`;
}

export interface ElevenLabsCheckInput {
  readonly apiKey: string;
  readonly baseUrl: string | null;
  readonly sttModel: string;
  readonly ttsModel: string;
  readonly timeoutMs?: number;
  /** How long an opened dialogue socket must stay open without an error to count as accepted. */
  readonly settleMs?: number;
  readonly socket?: LinkSocketFactory;
  readonly now?: () => number;
}

/** What the speech to text socket's error events mean (never shown as text). */
function failureOfScribe(kind: string): LiveVoiceCheckFailure {
  switch (kind) {
    case 'auth_error':
      return 'auth';
    case 'quota_exceeded':
    case 'rate_limited':
    case 'resource_exhausted':
    case 'queue_overflow':
      return 'quota';
    case 'unaccepted_terms':
      return 'terms';
    case 'invalid_request':
      return 'model';
    default:
      return 'unexpected';
  }
}

function messageKind(data: unknown): string | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && 'message_type' in parsed) {
      const kind = parsed.message_type;
      if (typeof kind === 'string') return kind.slice(0, 100);
    }
  } catch {
    /* not JSON: ignored */
  }
  return null;
}

type Step = { ok: true } | { ok: false; failure: LiveVoiceCheckFailure };

/** Opens one socket and decides, from its first events, whether the door is open. */
function openOnce(options: {
  url: string;
  apiKey: string;
  make: LinkSocketFactory;
  timeoutMs: number;
  /** Event that proves the door is open; undefined: staying open for `settleMs` is enough. */
  readyKind?: string;
  settleMs: number;
  events: string[];
  tag: string;
}): Promise<Step> {
  return new Promise((resolve) => {
    let done = false;
    let socket: ReturnType<LinkSocketFactory> | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const finish = (step: Step): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (settle) clearTimeout(settle);
      try {
        socket?.close(1000);
      } catch {
        /* already closed */
      }
      resolve(step);
    };
    const timer = setTimeout(() => finish({ ok: false, failure: 'timeout' }), options.timeoutMs);
    try {
      socket = options.make(options.url, { 'xi-api-key': options.apiKey });
    } catch {
      finish({ ok: false, failure: 'network' });
      return;
    }
    socket.onopen = () => {
      options.events.push(`${options.tag}_open`);
      if (!options.readyKind) {
        settle = setTimeout(() => finish({ ok: true }), options.settleMs);
      }
    };
    socket.onmessage = (event) => {
      const kind = messageKind(event.data);
      if (kind) options.events.push(kind);
      if (options.readyKind && kind === options.readyKind) finish({ ok: true });
      else if (kind && kind !== options.readyKind && failureOfScribe(kind) !== 'unexpected') {
        finish({ ok: false, failure: failureOfScribe(kind) });
      } else if (kind === 'error') {
        finish({ ok: false, failure: 'unexpected' });
      }
    };
    socket.onerror = (event) => {
      const text =
        event && typeof event === 'object' && 'message' in event ? String(event.message) : '';
      finish({ ok: false, failure: text ? classifyRefusal(text) : 'network' });
    };
    socket.onclose = (event) => {
      const text = `${event.code ?? ''} ${event.reason ?? ''}`.trim();
      const failure = classifyRefusal(text);
      finish({ ok: false, failure: failure === 'unexpected' ? 'network' : failure });
    };
  });
}

/**
 * Checks both links of the pipeline: the speech to text socket must say its session started, and
 * the dialogue socket must stay open a moment. The first failure ends the check.
 */
export async function checkElevenLabsLink(input: ElevenLabsCheckInput): Promise<LinkCheckResult> {
  const now = input.now ?? Date.now;
  const make = input.socket ?? nodeSocketFactory;
  const started = now();
  const events: string[] = [];
  const timeoutMs = input.timeoutMs ?? 10_000;
  const settleMs = input.settleMs ?? 1_500;
  const hearing = await openOnce({
    url: sttUrl(input.baseUrl, input.sttModel, undefined, {
      zeroRetention: ELEVENLABS_ZERO_RETENTION,
    }),
    apiKey: input.apiKey,
    make,
    timeoutMs,
    readyKind: 'session_started',
    settleMs,
    events,
    tag: 'stt',
  });
  if (!hearing.ok) {
    return { ok: false, failure: hearing.failure, events: events.slice(0, 10), latencyMs: null };
  }
  const speaking = await openOnce({
    url: dialogueUrl(input.baseUrl, input.ttsModel, { zeroRetention: ELEVENLABS_ZERO_RETENTION }),
    apiKey: input.apiKey,
    make,
    timeoutMs,
    settleMs,
    events,
    tag: 'tts',
  });
  if (!speaking.ok) {
    return { ok: false, failure: speaking.failure, events: events.slice(0, 10), latencyMs: null };
  }
  return { ok: true, failure: null, events: events.slice(0, 10), latencyMs: now() - started };
}
