import {
  ELEVENLABS_ZERO_RETENTION,
  dialogueHttpUrl,
  dialogueUrl,
  userHttpUrl,
  sttUrl,
} from './elevenlabs-link.js';
import type { LiveVoiceCheckFailure } from '@docoo/contracts';

import type { RelaySocket, RelaySocketFactory } from './realtime-link.js';
import type { EngineUsage, VoiceEngine, VoiceEngineEvents } from './voice-engine.js';
import {
  clueOfClose,
  clueOfError,
  createFailureReporter,
  failureOfHttp,
  failureOfText,
} from './voice-failure.js';

/**
 * The voice pipeline of ElevenLabs behind the voice engine port (ADR-0057): Scribe v3 Live listens,
 * Docoo's own executor and confirmation gateway are the brain (the relay core asks them through the
 * one `toolCall`), and Eleven v4 Turbo speaks. There is no model in the engine: every finished line
 * the person says is the request, and the answer of the executor is what gets spoken. Everything
 * that knows an ElevenLabs address or event name is in this file and in `elevenlabs-link.ts`.
 */

/** The hearing model is fixed by Docoo (the admin chooses the speaking model and the voice). */
export const ELEVENLABS_HEARING_MODEL = 'scribe_v3_live';

/** The microphone and the speaker both use 16-bit mono PCM at 24 kHz (the relay's audio format). */
const SAMPLE_RATE = 24_000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;

/** Listening time is reported to the caps at least this often, answer or not. */
const REPORT_EVERY_SECONDS = 20;

/** One piece sent to the speaking model; the documentation advises at most 2000 per request. */
const MAX_PIECE_CHARACTERS = 400;
const MAX_SPOKEN_CHARACTERS = 1800;

/** Events of the hearing socket that end the session (the rest are not fatal or not errors). */
/** How long the check without zero retention may take to say the session started. */
const RETENTION_PROBE_TIMEOUT_MS = 5_000;

/** What a fatal event of the hearing socket means; its text only helps when the event is vague. */
function failureOfHearingEvent(kind: string, text: string): LiveVoiceCheckFailure {
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
    case 'session_time_limit_exceeded':
      return 'session_limit';
    case 'invalid_request':
      return failureOfText(text) ?? 'model';
    default:
      return failureOfText(text) ?? 'unexpected';
  }
}

const FATAL_HEARING_EVENTS: ReadonlySet<string> = new Set([
  'auth_error',
  'quota_exceeded',
  'rate_limited',
  'resource_exhausted',
  'queue_overflow',
  'transcriber_error',
  'session_time_limit_exceeded',
  'unaccepted_terms',
  'invalid_request',
  'error',
]);

export interface PipelineEngineOptions {
  readonly socket: RelaySocketFactory;
  readonly apiKey: string;
  /** Regional address of the connection, or null for the global one. */
  readonly baseUrl: string | null;
  readonly config: {
    /** The speaking model (the admin's choice); the hearing model is fixed. */
    readonly ttsModel: string;
    readonly voice: string;
    readonly language: 'fa' | 'en';
    /** Push-to-talk: the page says when a turn ends (a manual commit), no turn prediction. */
    readonly pushToTalk?: boolean;
  };
  /** Replaced by tests; the global `fetch` otherwise. */
  readonly fetch?: typeof fetch;
  readonly zeroRetention?: boolean;
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Pieces of a text for the speaking model: whole sentences, none longer than the limit. */
export function speechPieces(text: string): string[] {
  const sentences = text
    .slice(0, MAX_SPOKEN_CHARACTERS)
    .split(/(?<=[.!?؟۔…])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > MAX_PIECE_CHARACTERS) {
      if (current !== '') pieces.push(current);
      current = '';
      for (let at = 0; at < sentence.length; at += MAX_PIECE_CHARACTERS) {
        pieces.push(sentence.slice(at, at + MAX_PIECE_CHARACTERS));
      }
      continue;
    }
    if (current !== '' && current.length + 1 + sentence.length > MAX_PIECE_CHARACTERS) {
      pieces.push(current);
      current = sentence;
    } else {
      current = current === '' ? sentence : `${current} ${sentence}`;
    }
  }
  if (current !== '') pieces.push(current);
  return pieces;
}

const WAITING_NOTE = {
  fa: 'یک تغییر منتظر تأیید شماست. لطفاً روی صفحه تأیید کنید.',
  en: 'A change is waiting for your confirmation. Please confirm it on the screen.',
} as const;
const NOTHING_TO_SAY = {
  fa: 'در حال حاضر نتوانستم این کار را انجام دهم.',
  en: 'I could not do that right now.',
} as const;

/** What to say from the executor's answer (the JSON the relay builds for a model). */
function spokenOf(output: string, language: 'fa' | 'en'): string {
  let answer = '';
  let waiting = 0;
  try {
    const parsed = recordOf(JSON.parse(output) as unknown);
    answer = stringOf(parsed['answer']).trim();
    const count = parsed['changes_waiting_for_the_person_to_confirm'];
    waiting = typeof count === 'number' && count > 0 ? count : 0;
  } catch {
    /* not the expected shape: nothing to read out */
  }
  if (answer === '' && waiting === 0) return NOTHING_TO_SAY[language];
  return waiting > 0 ? `${answer} ${WAITING_NOTE[language]}`.trim() : answer;
}

export function createElevenLabsPipelineEngine(options: PipelineEngineOptions): VoiceEngine {
  const { config } = options;
  const zeroRetention = options.zeroRetention ?? ELEVENLABS_ZERO_RETENTION;
  const doFetch = options.fetch ?? fetch;
  const headers = { 'xi-api-key': options.apiKey };

  let events: VoiceEngineEvents | null = null;
  let closed = false;
  let ready = false;
  let hearing: RelaySocket | null = null;
  /** The person is talking now (a partial transcript arrived, no commit yet). */
  let userSpeaking = false;
  let turns = 0;
  /** Bumped whenever the speech in progress must stop; late audio of an older one is dropped. */
  let generation = 0;
  let speaking = false;
  const queue: string[] = [];
  let speakingSocket: RelaySocket | null = null;
  let speakingAbort: AbortController | null = null;
  /** Use not reported yet. */
  let pendingSeconds = 0;
  let pendingCharacters = 0;
  let sentSinceReport = 0;

  function flushUsage(): void {
    if (pendingSeconds <= 0 && pendingCharacters <= 0) return;
    const usage: EngineUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      audioSeconds: Math.round(pendingSeconds * 1000) / 1000,
      characters: pendingCharacters,
    };
    pendingSeconds = 0;
    pendingCharacters = 0;
    sentSinceReport = 0;
    events?.usage(usage);
  }

  function fail(failure: LiveVoiceCheckFailure): void {
    if (closed) return;
    events?.failed(failure);
  }

  /** What the speaking socket said about its own failure, for the kind of the failure if HTTP fails too. */
  let speakingClue = '';
  /** Stops the check without zero retention if the session ends while it runs. */
  let stopProbe: (() => void) | null = null;

  // ---- speaking ---------------------------------------------------------------------------

  function stopSpeaking(): void {
    generation += 1;
    queue.length = 0;
    speaking = false;
    const socket = speakingSocket;
    speakingSocket = null;
    if (socket) {
      try {
        socket.close(1000);
      } catch {
        /* already closed */
      }
    }
    speakingAbort?.abort();
    speakingAbort = null;
    flushUsage();
  }

  function finishSpeech(mine: number): void {
    if (mine !== generation || closed) return;
    speakingSocket = null;
    speakingAbort = null;
    speaking = false;
    flushUsage();
    if (queue.length > 0) {
      speakNext();
      return;
    }
    events?.responseDone(null);
  }

  /** Streams the speech over HTTP; used only when the socket gave nothing. */
  async function speakOverHttp(text: string, mine: number): Promise<void> {
    const abort = new AbortController();
    speakingAbort = abort;
    try {
      const response = await doFetch(dialogueHttpUrl(options.baseUrl, { zeroRetention }), {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          model_id: config.ttsModel,
          language_code: config.language,
          inputs: [{ text, voice_id: config.voice }],
        }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => '');
        if (mine !== generation || closed) return;
        const found = failureOfHttp(response.status, body.slice(0, 1000));
        fail(found === 'unexpected' ? (failureOfText(speakingClue) ?? found) : found);
        return;
      }
      const reader = response.body.getReader();
      let carry = Buffer.alloc(0);
      for (;;) {
        const step: { done: boolean; value?: Uint8Array } = await reader.read();
        if (mine !== generation || closed) {
          abort.abort();
          return;
        }
        if (step.done || !step.value) break;
        let chunk = Buffer.concat([carry, Buffer.from(step.value)]);
        // 16-bit samples: an odd byte waits for its other half.
        carry = chunk.length % 2 === 1 ? chunk.subarray(chunk.length - 1) : Buffer.alloc(0);
        if (carry.length > 0) chunk = chunk.subarray(0, chunk.length - 1);
        if (chunk.length > 0) events?.audio(chunk);
      }
      finishSpeech(mine);
    } catch {
      if (mine !== generation || closed) return;
      // The request itself did not get through: the server could not reach ElevenLabs.
      fail(failureOfText(speakingClue) ?? 'network');
    }
  }

  function speakNext(): void {
    const text = queue.shift();
    if (text === undefined || closed) return;
    const pieces = speechPieces(text);
    if (pieces.length === 0) {
      events?.responseDone(null);
      return;
    }
    speaking = true;
    speakingClue = '';
    const mine = (generation += 1);
    const full = pieces.join(' ');
    pendingCharacters += full.length;
    let gotAudio = false;
    let settled = false;
    const fallBack = (): void => {
      if (settled) return;
      settled = true;
      if (mine !== generation) return;
      speakingSocket = null;
      void speakOverHttp(full, mine);
    };
    let socket: RelaySocket;
    try {
      socket = options.socket(
        dialogueUrl(options.baseUrl, config.ttsModel, {
          language: config.language,
          zeroRetention,
        }),
        headers,
      );
    } catch {
      fallBack();
      return;
    }
    speakingSocket = socket;
    socket.onopen = () => {
      if (mine !== generation) return;
      try {
        socket.send(JSON.stringify({ voices: [config.voice] }));
        socket.send(
          JSON.stringify({
            inputs: pieces.map((piece, index) => ({
              text: piece,
              voice_id: config.voice,
              new_turn: index === 0,
            })),
          }),
        );
        socket.send(JSON.stringify({ close_socket: true }));
      } catch {
        fallBack();
      }
    };
    socket.onmessage = (event) => {
      if (mine !== generation || typeof event.data !== 'string') return;
      let message: Record<string, unknown>;
      try {
        message = recordOf(JSON.parse(event.data) as unknown);
      } catch {
        return;
      }
      if (message['error'] !== undefined && message['error'] !== null) {
        speakingClue = `${speakingClue} ${JSON.stringify(message['error'])}`.slice(0, 1000);
        if (gotAudio) {
          settled = true;
          finishSpeech(mine);
        } else fallBack();
        return;
      }
      const audio = stringOf(message['audio']);
      if (audio !== '') {
        gotAudio = true;
        const pcm = Buffer.from(audio, 'base64');
        if (pcm.length > 0) events?.audio(pcm.length % 2 === 0 ? pcm : pcm.subarray(0, -1));
      }
      if (message['is_final'] === true) {
        settled = true;
        try {
          socket.close(1000);
        } catch {
          /* already closed */
        }
        finishSpeech(mine);
      }
    };
    socket.onerror = (event) => {
      if (mine !== generation) return;
      speakingClue = `${speakingClue} ${clueOfError(event)}`.slice(0, 1000);
      if (gotAudio) {
        settled = true;
        finishSpeech(mine);
      } else fallBack();
    };
    socket.onclose = (event) => {
      if (mine !== generation || settled) return;
      speakingClue = `${speakingClue} ${clueOfClose(event)}`.slice(0, 1000);
      if (gotAudio) {
        settled = true;
        finishSpeech(mine);
      } else fallBack();
    };
  }

  function say(text: string): void {
    const clean = text.trim();
    if (clean === '' || closed) return;
    queue.push(clean);
    if (!speaking) speakNext();
  }

  /**
   * The hearing socket was refused before it started while zero retention was asked, and nothing
   * said why. Opens it once more without that flag (nothing is sent, so nothing is logged or
   * billed, as in the link check): if that opens, the plan does not allow zero retention, which
   * is a different cure than the network's.
   */
  function probeWithoutZeroRetention(): void {
    let settled = false;
    let probe: RelaySocket | null = null;
    const finish = (failure: LiveVoiceCheckFailure | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopProbe = null;
      try {
        probe?.close(1000);
      } catch {
        /* already closed */
      }
      // Not the retention flag either: ask the service about the key itself.
      if (failure) fail(failure);
      else void diagnoseRefusal();
    };
    const timer = setTimeout(() => finish(null), RETENTION_PROBE_TIMEOUT_MS);
    stopProbe = () => {
      settled = true;
      clearTimeout(timer);
      try {
        probe?.close(1000);
      } catch {
        /* already closed */
      }
    };
    try {
      probe = options.socket(
        sttUrl(options.baseUrl, ELEVENLABS_HEARING_MODEL, config.language, {
          audioFormat: `pcm_${SAMPLE_RATE}`,
          commitStrategy: config.pushToTalk ? 'manual' : 'turn_prediction',
          zeroRetention: false,
        }),
        headers,
      );
    } catch {
      finish(null);
      return;
    }
    probe.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const kind = stringOf(recordOf(JSON.parse(event.data) as unknown)['message_type']);
        finish(kind === 'session_started' ? 'retention' : null);
      } catch {
        /* not JSON: wait for the next message or the timeout */
      }
    };
    probe.onerror = () => finish(null);
    probe.onclose = () => finish(null);
  }

  /**
   * The hearing socket was refused at the door and a socket does not tell the HTTP status. One
   * plain request (it sends nothing and costs nothing) asks whether the key is accepted at all, so
   * a wrong key or an exhausted account is named instead of "refused".
   */
  async function diagnoseRefusal(): Promise<void> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), RETENTION_PROBE_TIMEOUT_MS);
    stopProbe = () => abort.abort();
    try {
      const response = await doFetch(userHttpUrl(options.baseUrl), {
        headers,
        signal: abort.signal,
      });
      if (closed) return;
      if (response.status === 401 || response.status === 403) fail('auth');
      else if (response.status === 402 || response.status === 429) fail('quota');
      else fail('refused');
    } catch {
      // Not even a plain request got through: the server cannot reach ElevenLabs.
      if (!closed) fail('network');
    } finally {
      clearTimeout(timer);
      stopProbe = null;
    }
  }

  // ---- hearing ----------------------------------------------------------------------------

  function onHearing(raw: unknown): void {
    if (typeof raw !== 'string' || !events || closed) return;
    let message: Record<string, unknown>;
    try {
      message = recordOf(JSON.parse(raw) as unknown);
    } catch {
      return;
    }
    const kind = stringOf(message['message_type']);
    if (kind === 'session_started') {
      if (ready) return;
      ready = true;
      events.ready();
      return;
    }
    if (FATAL_HEARING_EVENTS.has(kind)) {
      fail(
        failureOfHearingEvent(
          kind,
          `${stringOf(message['error'])} ${stringOf(message['message'])}`,
        ),
      );
      return;
    }
    if (kind === 'partial_transcript') {
      if (stringOf(message['text']).trim() === '' || userSpeaking) return;
      userSpeaking = true;
      // The person talks over the assistant: whatever is being said stops, and so does the queue.
      stopSpeaking();
      events.speechStarted();
      return;
    }
    if (kind === 'committed_transcript') {
      const text = stringOf(message['text']).trim();
      userSpeaking = false;
      if (text === '') return;
      turns += 1;
      events.speechStopped();
      events.userText(text);
      events.toolCall(`turn-${turns}`, text.slice(0, 1000));
    }
  }

  return {
    start(next) {
      events = next;
      let socket: RelaySocket;
      try {
        socket = options.socket(
          sttUrl(options.baseUrl, ELEVENLABS_HEARING_MODEL, config.language, {
            audioFormat: `pcm_${SAMPLE_RATE}`,
            commitStrategy: config.pushToTalk ? 'manual' : 'turn_prediction',
            zeroRetention,
          }),
          headers,
        );
      } catch {
        fail('network');
        return;
      }
      hearing = socket;
      socket.onmessage = (event) => onHearing(event.data);
      // A socket reports an error and then a close; the close carries the code and the reason.
      const reporter = createFailureReporter((clue) => {
        if (closed) return;
        const known = failureOfText(clue);
        if (known) fail(known);
        else if (ready) fail('dropped');
        // Refused at the door with zero retention asked: find out whether that is the reason.
        else if (zeroRetention) probeWithoutZeroRetention();
        else void diagnoseRefusal();
      });
      socket.onerror = (event) => reporter.error(clueOfError(event));
      socket.onclose = (event) => reporter.close(clueOfClose(event));
    },
    sendAudio(pcm) {
      if (closed || !hearing || !ready) return;
      try {
        hearing.send(
          JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: pcm.toString('base64'),
            sample_rate: SAMPLE_RATE,
            commit: false,
          }),
        );
      } catch {
        fail('dropped');
        return;
      }
      const seconds = pcm.length / BYTES_PER_SECOND;
      pendingSeconds += seconds;
      sentSinceReport += seconds;
      if (sentSinceReport >= REPORT_EVERY_SECONDS) flushUsage();
    },
    answerTool(_callId, output) {
      say(spokenOf(output, config.language));
    },
    tell(_instruction, spoken) {
      say(spoken.slice(0, MAX_SPOKEN_CHARACTERS));
    },
    cancelSpeech() {
      stopSpeaking();
    },
    endTurn() {
      if (!config.pushToTalk || closed || !hearing || !ready) return false;
      try {
        // An empty chunk with the commit flag closes the segment: its transcript comes back as the
        // committed one and goes to the executor like any other line.
        hearing.send(
          JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: '',
            sample_rate: SAMPLE_RATE,
            commit: true,
          }),
        );
      } catch {
        fail('dropped');
        return false;
      }
      return true;
    },
    close() {
      if (closed) return;
      stopSpeaking();
      closed = true;
      stopProbe?.();
      flushUsage();
      const socket = hearing;
      hearing = null;
      try {
        socket?.close(1000);
      } catch {
        /* already closed */
      }
    },
  };
}
