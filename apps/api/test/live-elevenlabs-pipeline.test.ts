import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { pipelineCostUsd, type LiveAskAnswer } from '@docoo/contracts';

import {
  createElevenLabsPipelineEngine,
  speechPieces,
} from '../src/live-assistant/elevenlabs-pipeline-engine.js';
import { startVoiceRelay, type RelayHost } from '../src/live-assistant/live-voice-relay.js';
import { nodeRelaySocketFactory } from '../src/live-assistant/realtime-link.js';
import type { EngineUsage, VoiceEngineEvents } from '../src/live-assistant/voice-engine.js';

/** What the fake service does; each test changes only what it needs. */
interface Behavior {
  /** Messages the fake speaking socket gets are answered by this (default: two chunks and final). */
  speak: (socket: ServerSocket, messages: Record<string, unknown>[]) => void;
  /** The HTTP fallback (default: refuse). */
  http: (request: IncomingMessage, body: string, response: ServerResponse) => void;
}

interface Fake {
  baseUrl: string;
  hearingUrls: string[];
  speakingUrls: string[];
  hearingAuth: string[];
  speakingAuth: string[];
  hearing: ServerSocket[];
  hearingSeen: Record<string, unknown>[];
  speaking: { socket: ServerSocket; messages: Record<string, unknown>[]; closed: boolean }[];
  httpSeen: { headers: IncomingMessage['headers']; body: Record<string, unknown> }[];
  behavior: Behavior;
  close: () => Promise<void>;
}

const CHUNK = Buffer.from([1, 2, 3, 4]);

function json(socket: ServerSocket, value: unknown): void {
  socket.send(JSON.stringify(value));
}

async function fake(): Promise<Fake> {
  const state: Fake = {
    baseUrl: '',
    hearingUrls: [],
    speakingUrls: [],
    hearingAuth: [],
    speakingAuth: [],
    hearing: [],
    hearingSeen: [],
    speaking: [],
    httpSeen: [],
    behavior: {
      speak: (socket) => {
        json(socket, { audio: CHUNK.toString('base64') });
        json(socket, { audio: CHUNK.toString('base64') });
        json(socket, { is_final: true });
      },
      http: (_request, _body, response) => {
        response.statusCode = 500;
        response.end();
      },
    },
    close: () => Promise.resolve(),
  };
  const server: Server = createServer((request, response) => {
    let body = '';
    request.on('data', (piece: Buffer) => (body += piece.toString('utf8')));
    request.on('end', () => {
      try {
        state.httpSeen.push({
          headers: request.headers,
          body: JSON.parse(body) as Record<string, unknown>,
        });
      } catch {
        /* not JSON */
      }
      state.behavior.http(request, body, response);
    });
  });
  const hearing = new WebSocketServer({ noServer: true });
  const speaking = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';
    const auth = String(request.headers['xi-api-key']);
    if (url.startsWith('/v1/speech-to-text/realtime')) {
      hearing.handleUpgrade(request, socket, head, (ws) => {
        state.hearingUrls.push(url);
        state.hearingAuth.push(auth);
        state.hearing.push(ws);
        ws.on('message', (raw) =>
          state.hearingSeen.push(
            JSON.parse(Buffer.from(raw as Buffer).toString('utf8')) as Record<string, unknown>,
          ),
        );
        json(ws, { message_type: 'session_started', session_id: 's' });
      });
    } else if (url.startsWith('/v1/text-to-dialogue/stream-input')) {
      speaking.handleUpgrade(request, socket, head, (ws) => {
        state.speakingUrls.push(url);
        state.speakingAuth.push(auth);
        const entry = { socket: ws, messages: [] as Record<string, unknown>[], closed: false };
        state.speaking.push(entry);
        ws.on('close', () => (entry.closed = true));
        ws.on('message', (raw) => {
          const message = JSON.parse(Buffer.from(raw as Buffer).toString('utf8')) as Record<
            string,
            unknown
          >;
          entry.messages.push(message);
          if (message['close_socket'] === true) state.behavior.speak(ws, entry.messages);
        });
      });
    } else {
      socket.destroy();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () =>
    new Promise<void>((resolve) => {
      for (const client of [...hearing.clients, ...speaking.clients]) client.terminate();
      server.close(() => resolve());
    });
  return state;
}

interface Recorded {
  ready: number;
  speechStarted: number;
  speechStopped: number;
  audio: Buffer[];
  userText: string[];
  toolCalls: { callId: string; request: string }[];
  done: (EngineUsage | null)[];
  usage: EngineUsage[];
  failed: number;
}

function recorder(): { events: VoiceEngineEvents; seen: Recorded } {
  const seen: Recorded = {
    ready: 0,
    speechStarted: 0,
    speechStopped: 0,
    audio: [],
    userText: [],
    toolCalls: [],
    done: [],
    usage: [],
    failed: 0,
  };
  return {
    seen,
    events: {
      ready: () => void (seen.ready += 1),
      speechStarted: () => void (seen.speechStarted += 1),
      speechStopped: () => void (seen.speechStopped += 1),
      audio: (pcm) => void seen.audio.push(pcm),
      userText: (text) => void seen.userText.push(text),
      assistantText: () => undefined,
      toolCall: (callId, request) => void seen.toolCalls.push({ callId, request }),
      responseDone: (usage) => void seen.done.push(usage),
      usage: (usage) => void seen.usage.push(usage),
      failed: () => void (seen.failed += 1),
    },
  };
}

async function until(check: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const rigs: Fake[] = [];
afterEach(async () => {
  await Promise.all(rigs.splice(0).map((rig) => rig.close()));
});

async function start(
  overrides: { language?: 'fa' | 'en'; pushToTalk?: boolean } = {},
  mutate?: (rig: Fake) => void,
): Promise<{
  rig: Fake;
  engine: ReturnType<typeof createElevenLabsPipelineEngine>;
  seen: Recorded;
}> {
  const rig = await fake();
  rigs.push(rig);
  mutate?.(rig);
  const engine = createElevenLabsPipelineEngine({
    socket: nodeRelaySocketFactory,
    apiKey: 'xi-secret',
    baseUrl: rig.baseUrl,
    config: {
      ttsModel: 'eleven_v4_turbo',
      voice: 'voice-1',
      language: overrides.language ?? 'fa',
      ...(overrides.pushToTalk ? { pushToTalk: true } : {}),
    },
  });
  const { events, seen } = recorder();
  engine.start(events);
  await until(() => seen.ready === 1, 'ready');
  return { rig, engine, seen };
}

const waitingOutput = JSON.stringify({
  answer: 'سه پروژه دارید.',
  changes_waiting_for_the_person_to_confirm: 1,
});

describe('the ElevenLabs pipeline engine', () => {
  it('opens the hearing socket with the key in a header, zero retention and turn prediction', async () => {
    const { rig, engine } = await start();
    expect(rig.hearingAuth).toEqual(['xi-secret']);
    const url = new URL(rig.hearingUrls[0] ?? '', 'http://x');
    expect(url.searchParams.get('model_id')).toBe('scribe_v3_live');
    expect(url.searchParams.get('audio_format')).toBe('pcm_24000');
    expect(url.searchParams.get('language_code')).toBe('fa');
    expect(url.searchParams.get('commit_strategy')).toBe('turn_prediction');
    expect(url.searchParams.get('enable_logging')).toBe('false');
    expect(rig.hearingUrls[0]).not.toContain('xi-secret');
    engine.close();
  });

  it('sends the microphone as input_audio_chunk at 24 kHz', async () => {
    const { rig, engine } = await start();
    engine.sendAudio(Buffer.from([9, 9, 9, 9]));
    await until(() => rig.hearingSeen.length === 1, 'chunk');
    expect(rig.hearingSeen[0]).toEqual({
      message_type: 'input_audio_chunk',
      audio_base_64: Buffer.from([9, 9, 9, 9]).toString('base64'),
      sample_rate: 24000,
      commit: false,
    });
    engine.close();
  });

  it('turns a committed transcript into one request and speaks the answer, whole turn', async () => {
    const { rig, engine, seen } = await start();
    json(rig.hearing[0] as ServerSocket, { message_type: 'partial_transcript', text: 'سلام' });
    await until(() => seen.speechStarted === 1, 'speech started');
    json(rig.hearing[0] as ServerSocket, {
      message_type: 'committed_transcript',
      text: ' پروژه‌های من چند تاست؟ ',
    });
    await until(() => seen.toolCalls.length === 1, 'tool call');
    expect(seen.speechStopped).toBe(1);
    expect(seen.userText).toEqual(['پروژه‌های من چند تاست؟']);
    expect(seen.toolCalls[0]).toEqual({ callId: 'turn-1', request: 'پروژه‌های من چند تاست؟' });

    engine.answerTool('turn-1', waitingOutput);
    await until(() => seen.done.length === 1, 'response done');
    expect(Buffer.concat(seen.audio)).toEqual(Buffer.concat([CHUNK, CHUNK]));
    const spoken = rig.speaking[0];
    expect(rig.speakingAuth).toEqual(['xi-secret']);
    const url = new URL(rig.speakingUrls[0] ?? '', 'http://x');
    expect(url.searchParams.get('model_id')).toBe('eleven_v4_turbo');
    expect(url.searchParams.get('output_format')).toBe('pcm_24000');
    expect(url.searchParams.get('language_code')).toBe('fa');
    expect(url.searchParams.get('enable_logging')).toBe('false');
    expect(spoken?.messages[0]).toEqual({ voices: ['voice-1'] });
    const inputs = (spoken?.messages[1]?.['inputs'] ?? []) as { text: string; voice_id: string }[];
    expect(inputs.every((input) => input.voice_id === 'voice-1')).toBe(true);
    const text = inputs.map((input) => input.text).join(' ');
    expect(text).toContain('سه پروژه دارید.');
    // A change waiting for the person is always said, in the person's language.
    expect(text).toContain('یک تغییر منتظر تأیید شماست');
    expect(spoken?.messages[2]).toEqual({ close_socket: true });
    // The characters spoken are reported for the cost.
    await until(() => seen.usage.some((u) => (u.characters ?? 0) > 0), 'usage');
    expect(seen.usage.reduce((sum, u) => sum + (u.characters ?? 0), 0)).toBe(text.length);
    engine.close();
  });

  it('speaks English notes when the assistant language is English', async () => {
    const { rig, engine, seen } = await start({ language: 'en' });
    engine.answerTool('c', waitingOutput);
    await until(() => seen.done.length === 1, 'done');
    const inputs = (rig.speaking[0]?.messages[1]?.['inputs'] ?? []) as { text: string }[];
    expect(inputs.map((i) => i.text).join(' ')).toContain('A change is waiting');
    engine.close();
  });

  it('says it could not when the answer has nothing to read', async () => {
    const { rig, engine, seen } = await start();
    engine.answerTool('c', 'not json');
    await until(() => seen.done.length === 1, 'done');
    const inputs = (rig.speaking[0]?.messages[1]?.['inputs'] ?? []) as { text: string }[];
    expect(inputs.map((i) => i.text).join(' ')).toContain('نتوانستم');
    engine.close();
  });

  it('stops the speech when the person talks over it, and drops what was queued', async () => {
    let release: (() => void) | null = null;
    const { rig, engine, seen } = await start({}, (r) => {
      r.behavior.speak = (socket) => {
        json(socket, { audio: CHUNK.toString('base64') });
        // The rest is held back until the test lets it go, as a long answer would be.
        release = () => {
          try {
            json(socket, { audio: CHUNK.toString('base64') });
            json(socket, { is_final: true });
          } catch {
            /* the engine already closed it */
          }
        };
      };
    });
    engine.answerTool('c1', JSON.stringify({ answer: 'جملهٔ اول است.' }));
    engine.answerTool('c2', JSON.stringify({ answer: 'جملهٔ دوم است.' }));
    await until(() => seen.audio.length === 1, 'first audio');
    json(rig.hearing[0] as ServerSocket, { message_type: 'partial_transcript', text: 'صبر کن' });
    await until(() => seen.speechStarted === 1, 'interrupted');
    await until(() => rig.speaking[0]?.closed === true, 'speaking socket closed');
    (release as (() => void) | null)?.();
    await new Promise((resolve) => setTimeout(resolve, 60));
    // No more audio, no second answer opened, no response reported as done.
    expect(seen.audio).toHaveLength(1);
    expect(rig.speaking).toHaveLength(1);
    expect(seen.done).toHaveLength(0);
    engine.close();
  });

  it('cancelSpeech stops what is being said', async () => {
    const { rig, engine, seen } = await start({}, (r) => {
      r.behavior.speak = (socket) => json(socket, { audio: CHUNK.toString('base64') });
    });
    engine.answerTool('c', JSON.stringify({ answer: 'یک جمله.' }));
    await until(() => seen.audio.length === 1, 'audio');
    engine.cancelSpeech();
    await until(() => rig.speaking[0]?.closed === true, 'closed');
    engine.close();
  });

  it('speaks the summary of a change as it is', async () => {
    const { rig, engine, seen } = await start();
    engine.tell('instruction for a model', 'تغییر انجام شد.');
    await until(() => seen.done.length === 1, 'done');
    const inputs = (rig.speaking[0]?.messages[1]?.['inputs'] ?? []) as { text: string }[];
    expect(inputs.map((i) => i.text)).toEqual(['تغییر انجام شد.']);
    engine.close();
  });

  it('falls back to streaming over HTTP when the speaking socket gives nothing', async () => {
    const { rig, engine, seen } = await start({}, (r) => {
      r.behavior.speak = (socket) => json(socket, { error: 'quota' });
      r.behavior.http = (_request, _body, response) => {
        response.setHeader('content-type', 'application/octet-stream');
        // An odd number of bytes in the first piece: the half sample waits for its other half.
        response.write(Buffer.from([1, 2, 3]));
        response.end(Buffer.from([4, 5, 6]));
      };
    });
    engine.answerTool('c', JSON.stringify({ answer: 'جواب.' }));
    await until(() => seen.done.length === 1, 'done');
    expect(rig.httpSeen).toHaveLength(1);
    expect(rig.httpSeen[0]?.headers['xi-api-key']).toBe('xi-secret');
    expect(rig.httpSeen[0]?.body).toMatchObject({
      model_id: 'eleven_v4_turbo',
      language_code: 'fa',
      inputs: [{ text: 'جواب.', voice_id: 'voice-1' }],
    });
    const heard = Buffer.concat(seen.audio);
    expect(heard).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
    expect(seen.audio.every((piece) => piece.length % 2 === 0)).toBe(true);
    expect(seen.failed).toBe(0);
    engine.close();
  });

  it('fails the session when neither way of speaking works', async () => {
    const { engine, seen } = await start({}, (r) => {
      r.behavior.speak = (socket) => json(socket, { error: 'quota' });
    });
    engine.answerTool('c', JSON.stringify({ answer: 'جواب.' }));
    await until(() => seen.failed === 1, 'failed');
    engine.close();
  });

  it('ends on a fatal hearing event and when the hearing socket closes', async () => {
    const a = await start();
    json(a.rig.hearing[0] as ServerSocket, { message_type: 'auth_error' });
    await until(() => a.seen.failed === 1, 'auth error');
    a.engine.close();
    const b = await start();
    (b.rig.hearing[0] as ServerSocket).close();
    await until(() => b.seen.failed >= 1, 'hearing closed');
    b.engine.close();
  });

  it('does not end on a harmless hearing event, and ignores an empty transcript', async () => {
    const { rig, engine, seen } = await start();
    json(rig.hearing[0] as ServerSocket, { message_type: 'commit_throttled' });
    json(rig.hearing[0] as ServerSocket, { message_type: 'partial_transcript', text: '  ' });
    json(rig.hearing[0] as ServerSocket, { message_type: 'committed_transcript', text: ' ' });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen).toMatchObject({ failed: 0, speechStarted: 0, speechStopped: 0 });
    expect(seen.toolCalls).toHaveLength(0);
    engine.close();
  });

  it('reports the time it listened for, at least every twenty seconds, answer or not', async () => {
    const { rig, engine, seen } = await start();
    // 21 seconds of 16-bit mono PCM at 24 kHz in one frame (the relay bounds real frames).
    engine.sendAudio(Buffer.alloc(24_000 * 2 * 21));
    await until(() => seen.usage.length === 1, 'usage');
    expect(seen.usage[0]?.audioSeconds).toBe(21);
    await until(() => rig.hearingSeen.length === 1, 'the frame reaches the service');
    engine.close();
  });

  it('reports what was heard when it closes, and says nothing after that', async () => {
    const { engine, seen } = await start();
    engine.sendAudio(Buffer.alloc(24_000 * 2));
    engine.close();
    expect(seen.usage).toEqual([
      { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, audioSeconds: 1, characters: 0 },
    ]);
    engine.sendAudio(Buffer.alloc(100));
    engine.answerTool('c', JSON.stringify({ answer: 'x' }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen.done).toHaveLength(0);
  });
});

describe('push to talk', () => {
  it('asks for manual commits and commits when the page ends the turn', async () => {
    const { rig, engine, seen } = await start({ pushToTalk: true });
    const url = new URL(rig.hearingUrls[0] ?? '', 'http://x');
    expect(url.searchParams.get('commit_strategy')).toBe('manual');
    engine.sendAudio(Buffer.alloc(960, 1));
    expect(engine.endTurn()).toBe(true);
    await until(() => rig.hearingSeen.length === 2, 'chunk and commit');
    expect(rig.hearingSeen[1]).toEqual({
      message_type: 'input_audio_chunk',
      audio_base_64: '',
      sample_rate: 24000,
      commit: true,
    });
    // The committed transcript goes on to the executor like any other line.
    json(rig.hearing[0] as ServerSocket, {
      message_type: 'committed_transcript',
      text: 'پروژه‌ها را بگو',
    });
    await until(() => seen.toolCalls.length === 1, 'tool call');
    engine.close();
  });

  it('leaves the end of a turn to the provider when listening is always on', async () => {
    const { rig, engine } = await start();
    const url = new URL(rig.hearingUrls[0] ?? '', 'http://x');
    expect(url.searchParams.get('commit_strategy')).toBe('turn_prediction');
    expect(engine.endTurn()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(rig.hearingSeen).toHaveLength(0);
    engine.close();
  });
});

describe('the pieces handed to the speaking model', () => {
  it('keeps whole sentences and splits only what is too long', () => {
    expect(speechPieces('سلام. حال شما چطور است؟ خوبم!')).toEqual([
      'سلام. حال شما چطور است؟ خوبم!',
    ]);
    const long = `${'الف'.repeat(400)}.`;
    const pieces = speechPieces(long);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((piece) => piece.length <= 400)).toBe(true);
    expect(pieces.join('')).toBe(long);
    expect(speechPieces('   \n ')).toEqual([]);
  });

  it('starts a new piece when the next sentence would pass the limit', () => {
    const first = 'ب'.repeat(300) + '.';
    const second = 'پ'.repeat(300) + '.';
    expect(speechPieces(`${first} ${second}`)).toEqual([first, second]);
  });
});

describe('the relay core with the pipeline engine', () => {
  const answer: LiveAskAnswer = {
    answer: 'ok',
    actions: [],
    screen: [],
    steps: [],
    toolCalls: 0,
    stop: 'answered',
    errorCode: null,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };

  it('asks Docoo for each line, speaks the answer, and counts hearing and speaking by price', async () => {
    const rig = await fake();
    rigs.push(rig);
    const asked: string[] = [];
    const recorded: { totals: Record<string, number>; activity: string }[] = [];
    const out: (string | Buffer)[] = [];
    const host: RelayHost = {
      model: 'eleven_v4_turbo',
      voice: 'voice-1',
      language: 'fa',
      instructions: 'x',
      ask: (text) => {
        asked.push(text);
        return Promise.resolve({ ...answer, answer: 'سه پروژه دارید.' });
      },
      saveLines: () => Promise.resolve(),
      costOf: (usage) =>
        Promise.resolve(pipelineCostUsd(usage, { sttPerMinute: 0.0036, ttsPer1kCharacters: 0.04 })),
      record: (totals, activity) => {
        recorded.push({ totals: { ...totals }, activity });
        return Promise.resolve({ ended: false });
      },
    };
    let onData: (data: Buffer, isBinary: boolean) => void = () => undefined;
    const engine = createElevenLabsPipelineEngine({
      socket: nodeRelaySocketFactory,
      apiKey: 'k',
      baseUrl: rig.baseUrl,
      config: { ttsModel: host.model, voice: host.voice, language: 'fa' },
    });
    const relay = startVoiceRelay({
      host,
      engine,
      client: {
        send: (data) => void out.push(data),
        close: () => undefined,
        onMessage: (listener) => (onData = listener),
        onClose: () => undefined,
      },
    });
    await until(() => out.some((m) => typeof m === 'string' && m.includes('"ready"')), 'ready');
    // Thirty one-second frames, as the browser sends them (each is below the relay's frame limit).
    for (let second = 0; second < 30; second += 1) onData(Buffer.alloc(24_000 * 2), true);
    json(rig.hearing[0] as ServerSocket, {
      message_type: 'committed_transcript',
      text: 'پروژه‌ها را بگو',
    });
    await until(() => out.some((m) => Buffer.isBuffer(m)), 'audio to the browser');
    await until(() => recorded.some((r) => (r.totals['characters'] ?? 0) > 0), 'speaking counted');
    expect(asked).toEqual(['پروژه‌ها را بگو']);
    const last = recorded[recorded.length - 1];
    expect(last?.totals['audioSeconds']).toBe(30);
    expect(last?.totals['characters']).toBe('سه پروژه دارید.'.length);
    // 30 s at 0.0036/min = 0.0018, plus 15 characters at 0.04/1000 = 0.0006.
    expect(last?.totals['costUsd']).toBeCloseTo(0.0018 + (15 / 1000) * 0.04, 6);
    relay.stop('ended');
  });
});
