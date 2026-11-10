import { describe, expect, it, vi } from 'vitest';
import type { LiveActionView, LiveAskAnswer } from '@docoo/contracts';

import { createRelayTransport, webSocketOrigin, type RelaySocketLike } from './relay-transport';
import type { LiveTransportHandlers } from './transport';
import type { Microphone, Speaker } from './voice-audio';

class FakeSocket implements RelaySocketLike {
  binaryType = 'blob';
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  sent: (string | ArrayBuffer)[] = [];
  closed = false;
  constructor(readonly url: string) {}
  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.onclose?.({});
  }
  say(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function fakeMic() {
  const calls = { started: 0, stopped: 0 };
  let emit: (pcm: ArrayBuffer) => void = () => undefined;
  const microphone: Microphone = {
    start: (onFrame) => {
      calls.started += 1;
      emit = onFrame;
      return Promise.resolve();
    },
    stop: () => {
      calls.stopped += 1;
    },
  };
  return { microphone, calls, frame: (pcm: ArrayBuffer) => emit(pcm) };
}

function fakeSpeaker() {
  const played: ArrayBuffer[] = [];
  const log = { cleared: 0, closed: 0 };
  const speaker: Speaker = {
    play: (pcm) => played.push(pcm),
    clear: () => {
      log.cleared += 1;
    },
    close: () => {
      log.closed += 1;
    },
  };
  return { speaker, played, log };
}

function handlers() {
  const events: string[] = [];
  const h: LiveTransportHandlers = {
    onUsage: (tokens, cost, cached) => events.push(`usage:${tokens}:${cost}:${cached}`),
    onMessage: () => events.push('message'),
    propose: () => Promise.reject(new Error('not used')),
    onSpeech: (text) => events.push(`speech:${text}`),
    onActivity: (a) => events.push(`activity:${a}`),
    onAnswer: () => events.push('answer'),
    onServerEnded: () => events.push('serverEnded'),
    onSleep: () => events.push('sleep'),
    onWake: () => events.push('wake'),
    onLost: () => events.push('lost'),
  };
  return { h, events };
}

const ticket = {
  ticket: 'T'.repeat(43),
  path: '/api/workspaces/w/live-assistant/sessions/s/voice',
  expiresInMs: 30000,
};

function rig(options: { readyTimeoutMs?: number } = {}) {
  let socket: FakeSocket | null = null;
  const mic = fakeMic();
  const spk = fakeSpeaker();
  const transport = createRelayTransport({
    origin: () => 'https://docoo.example',
    socket: (url) => (socket = new FakeSocket(url)),
    microphone: () => mic.microphone,
    speaker: () => spk.speaker,
    ...options,
  });
  const session = { sessionId: 's', voiceTicket: vi.fn(() => Promise.resolve(ticket)) };
  const live = handlers();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    transport,
    session,
    mic,
    spk,
    live,
    tick,
    get socket() {
      return socket!;
    },
  };
}

const answer = { answer: 'ok' } as unknown as LiveAskAnswer;

describe('the voice transport through the server', () => {
  it('builds the secure address from the page origin and one ticket', async () => {
    expect(webSocketOrigin('https://a.b')).toBe('wss://a.b');
    expect(webSocketOrigin('http://localhost:3000')).toBe('ws://localhost:3000');
    const r = rig();
    const started = r.transport.start(r.live.h, r.session);
    await r.tick();
    expect(r.session.voiceTicket).toHaveBeenCalledWith('s');
    expect(r.socket.url).toBe(`wss://docoo.example${ticket.path}?ticket=${ticket.ticket}`);
    expect(r.socket.binaryType).toBe('arraybuffer');
    r.socket.say({ type: 'ready' });
    await started;
  });

  it('opens the microphone only after the server says ready', async () => {
    const r = rig();
    const started = r.transport.start(r.live.h, r.session);
    await r.tick();
    expect(r.mic.calls.started).toBe(0);
    r.socket.say({ type: 'ready' });
    await started;
    expect(r.mic.calls.started).toBe(1);
    r.mic.frame(new Int16Array([1, 2, 3]).buffer);
    expect(r.socket.sent).toHaveLength(1);
    expect(r.socket.sent[0]).toBeInstanceOf(ArrayBuffer);
  });

  it('plays what the assistant says, and drops it when the person interrupts', async () => {
    const r = rig();
    const started = r.transport.start(r.live.h, r.session);
    await r.tick();
    r.socket.say({ type: 'ready' });
    await started;
    r.socket.onmessage?.({ data: new Uint8Array([1, 0, 2, 0]).buffer });
    expect(r.spk.played).toHaveLength(1);
    r.socket.say({ type: 'interrupt' });
    expect(r.spk.log.cleared).toBe(1);
  });

  it('turns the server messages into what the store understands', async () => {
    const r = rig();
    const started = r.transport.start(r.live.h, r.session);
    await r.tick();
    r.socket.say({ type: 'ready' });
    await started;
    r.socket.say({ type: 'activity', activity: 'thinking' });
    r.socket.say({ type: 'user', text: 'بله' });
    r.socket.say({ type: 'assistant', text: 'خب' });
    r.socket.say({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 30,
      costUsd: 0.5,
    });
    r.socket.say({
      type: 'usage',
      inputTokens: 150,
      outputTokens: 20,
      cachedInputTokens: 30,
      costUsd: 0.75,
    });
    // A total that went backwards (should never) adds nothing.
    r.socket.say({
      type: 'usage',
      inputTokens: 10,
      outputTokens: 1,
      cachedInputTokens: 0,
      costUsd: 0.1,
    });
    expect(r.live.events).toEqual([
      'activity:thinking',
      'speech:بله',
      'usage:120:0.5:30',
      'usage:50:0.25:0',
    ]);
  });

  it('passes an answer from the executor to the store', async () => {
    const r = rig();
    const started = r.transport.start(r.live.h, r.session);
    await r.tick();
    r.socket.say({ type: 'ready' });
    await started;
    r.socket.say({
      type: 'answer',
      answer: {
        answer: 'x',
        actions: [],
        screen: [],
        steps: [],
        toolCalls: 0,
        stop: 'answered',
        errorCode: null,
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
      },
    });
    expect(r.live.events).toEqual(['answer']);
    expect(answer).toBeDefined();
  });

  it('ignores a message it does not know and one that is not JSON', async () => {
    const r = rig();
    const started = r.transport.start(r.live.h, r.session);
    await r.tick();
    r.socket.say({ type: 'ready' });
    await started;
    r.socket.say({ type: 'run_this', cmd: 'x' });
    r.socket.onmessage?.({ data: 'not json' });
    expect(r.live.events).toEqual([]);
  });

  it('tells the store why the link ended', async () => {
    const reasons: [string, string][] = [
      ['cap', 'serverEnded'],
      ['ended', 'serverEnded'],
      ['superseded', 'serverEnded'],
      ['provider', 'lost'],
      ['error', 'lost'],
      ['idle', 'lost'],
    ];
    for (const [reason, event] of reasons) {
      const r = rig();
      const started = r.transport.start(r.live.h, r.session);
      await r.tick();
      r.socket.say({ type: 'ready' });
      await started;
      r.socket.say({ type: 'closed', reason });
      expect(r.live.events, reason).toEqual([event]);
      expect(r.socket.closed).toBe(true);
      expect(r.mic.calls.stopped).toBe(1);
      expect(r.spk.log.closed).toBe(1);
    }
  });

  it('reports a link that drops by itself as lost, once', async () => {
    const r = rig();
    const started = r.transport.start(r.live.h, r.session);
    await r.tick();
    r.socket.say({ type: 'ready' });
    await started;
    r.socket.onclose?.({});
    r.socket.onclose?.({});
    expect(r.live.events).toEqual(['lost']);
  });

  it('fails to start when the link cannot be opened, or never becomes ready', async () => {
    const closing = rig();
    const first = closing.transport.start(closing.live.h, closing.session);
    await closing.tick();
    closing.socket.onerror?.({});
    await expect(first).rejects.toThrow();
    expect(closing.mic.calls.started).toBe(0);

    const slow = rig({ readyTimeoutMs: 20 });
    await expect(slow.transport.start(slow.live.h, slow.session)).rejects.toThrow(/ready/u);
    expect(slow.socket.closed).toBe(true);
  });

  it('fails to start, and closes, when the microphone is refused', async () => {
    const r = rig();
    r.mic.microphone.start = () => Promise.reject(new Error('NotAllowedError'));
    const started = r.transport.start(r.live.h, r.session);
    await r.tick();
    r.socket.say({ type: 'ready' });
    await expect(started).rejects.toThrow('NotAllowedError');
    expect(r.socket.closed).toBe(true);
  });

  it('needs a session with a ticket function', async () => {
    const r = rig();
    await expect(r.transport.start(r.live.h)).rejects.toThrow();
    await expect(r.transport.start(r.live.h, { sessionId: 's' })).rejects.toThrow();
  });

  it('stops everything, safely more than once', async () => {
    const r = rig();
    const started = r.transport.start(r.live.h, r.session);
    await r.tick();
    r.socket.say({ type: 'ready' });
    await started;
    await r.transport.stop();
    await r.transport.stop();
    expect(r.socket.closed).toBe(true);
    expect(r.mic.calls.stopped).toBe(1);
    expect(r.live.events).toEqual([]);
  });

  it('tells the model what became of a change, and only while the link is open', async () => {
    const r = rig();
    const started = r.transport.start(r.live.h, r.session);
    await r.tick();
    r.socket.say({ type: 'ready' });
    await started;
    const view = { capability: 'pause', status: 'executed' } as unknown as LiveActionView;
    r.transport.reportAction?.(view);
    const message = JSON.parse(r.socket.sent.at(-1) as string) as Record<string, string>;
    expect(message).toMatchObject({
      type: 'action_result',
      capability: 'pause',
      status: 'executed',
    });
    await r.transport.stop();
    const before = r.socket.sent.length;
    r.transport.reportAction?.(view);
    expect(r.socket.sent.length).toBe(before);
  });
});
