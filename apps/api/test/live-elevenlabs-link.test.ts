import { describe, expect, it } from 'vitest';

import {
  checkElevenLabsLink,
  dialogueUrl,
  elevenLabsEndpoints,
  sttUrl,
} from '../src/live-assistant/elevenlabs-link.js';
import type { LinkSocket } from '../src/live-assistant/realtime-link.js';

type Script = (socket: LinkSocket, url: string) => void;

/** One script per URL path: the hearing socket and the dialogue socket behave differently. */
function scripted(scripts: { stt?: Script; dialogue?: Script }) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const closed: string[] = [];
  return {
    seen,
    closed,
    factory: (url: string, headers: Record<string, string>): LinkSocket => {
      seen.push({ url, headers });
      const socket: LinkSocket = {
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        close: () => {
          closed.push(url);
        },
      };
      const script = url.includes('/speech-to-text/') ? scripts.stt : scripts.dialogue;
      queueMicrotask(() => script?.(socket, url));
      return socket;
    },
  };
}

const started: Script = (socket) => {
  socket.onopen?.({});
  socket.onmessage?.({
    data: JSON.stringify({ message_type: 'session_started', session_id: 's' }),
  });
};
const opens: Script = (socket) => socket.onopen?.({});

const input = {
  apiKey: 'xi-secret',
  baseUrl: null,
  sttModel: 'scribe_v3_live',
  ttsModel: 'eleven_v4_turbo',
};

describe('the ElevenLabs link addresses', () => {
  it('uses the global endpoint, or the connection own regional one, without a version suffix', () => {
    expect(elevenLabsEndpoints(null).ws).toBe('wss://api.elevenlabs.io');
    expect(elevenLabsEndpoints('https://api.eu.residency.elevenlabs.io/').ws).toBe(
      'wss://api.eu.residency.elevenlabs.io',
    );
    expect(elevenLabsEndpoints('https://api.us.elevenlabs.io/v1').ws).toBe(
      'wss://api.us.elevenlabs.io',
    );
  });

  it('asks for 16 kHz audio from the hearing socket and 24 kHz from the dialogue socket', () => {
    expect(sttUrl(null, 'scribe_v3_live')).toBe(
      'wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v3_live&audio_format=pcm_16000',
    );
    expect(sttUrl(null, 'scribe_v3_live', 'fa')).toContain('language_code=fa');
    expect(dialogueUrl(null, 'eleven_v4_turbo')).toBe(
      'wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo&output_format=pcm_24000',
    );
  });
});

describe('the ElevenLabs link check (ADR-0057)', () => {
  it('passes when hearing starts a session and the dialogue socket stays open, key only as a header', async () => {
    const s = scripted({ stt: started, dialogue: opens });
    const result = await checkElevenLabsLink({ ...input, settleMs: 5, socket: s.factory });
    expect(result).toMatchObject({ ok: true, failure: null });
    expect(result.events).toEqual(['stt_open', 'session_started', 'tts_open']);
    expect(s.seen).toHaveLength(2);
    for (const call of s.seen) {
      expect(call.headers['xi-api-key']).toBe('xi-secret');
      expect(call.url).not.toContain('xi-secret');
    }
    expect(s.closed).toHaveLength(2);
  });

  it('stops at the first failure and never opens the dialogue socket after a refusal', async () => {
    for (const [kind, failure] of [
      ['auth_error', 'auth'],
      ['quota_exceeded', 'quota'],
      ['rate_limited', 'quota'],
      ['unaccepted_terms', 'terms'],
      ['invalid_request', 'model'],
    ] as const) {
      const s = scripted({
        stt: (socket) => socket.onmessage?.({ data: JSON.stringify({ message_type: kind }) }),
        dialogue: opens,
      });
      const result = await checkElevenLabsLink({ ...input, settleMs: 5, socket: s.factory });
      expect(result, kind).toMatchObject({ ok: false, failure });
      expect(s.seen, kind).toHaveLength(1);
    }
  });

  it('classifies a refusal at the door by its text, as the OpenAI check does', async () => {
    const region = scripted({
      stt: (socket) => socket.onerror?.({ message: 'Unexpected server response: 403' }),
    });
    expect(await checkElevenLabsLink({ ...input, socket: region.factory })).toMatchObject({
      ok: false,
      failure: 'region',
    });
    const down = scripted({ stt: (socket) => socket.onerror?.({}) });
    expect(await checkElevenLabsLink({ ...input, socket: down.factory })).toMatchObject({
      ok: false,
      failure: 'network',
    });
  });

  it('fails when the dialogue socket is closed at once, and on a timeout', async () => {
    const closing = scripted({
      stt: started,
      dialogue: (socket) => {
        socket.onopen?.({});
        socket.onclose?.({ code: 1008, reason: 'unauthorized' });
      },
    });
    const result = await checkElevenLabsLink({ ...input, settleMs: 50, socket: closing.factory });
    expect(result.ok).toBe(false);

    const silent = scripted({ stt: (socket) => socket.onopen?.({}) });
    expect(
      await checkElevenLabsLink({ ...input, timeoutMs: 20, socket: silent.factory }),
    ).toMatchObject({
      ok: false,
      failure: 'timeout',
    });
  });

  it('survives a socket that cannot even be created', async () => {
    const result = await checkElevenLabsLink({
      ...input,
      socket: () => {
        throw new Error('no network');
      },
    });
    expect(result).toMatchObject({ ok: false, failure: 'network' });
  });
});
