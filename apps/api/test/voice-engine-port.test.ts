import { describe, expect, it } from 'vitest';
import type { LiveAskAnswer } from '@docoo/contracts';

import {
  startVoiceRelay,
  type ClientLink,
  type RelayHost,
} from '../src/live-assistant/live-voice-relay.js';
import type { VoiceEngine, VoiceEngineEvents } from '../src/live-assistant/voice-engine.js';

/** An engine that speaks no provider protocol at all: the relay core must work with any engine. */
class ScriptedEngine implements VoiceEngine {
  events!: VoiceEngineEvents;
  audioIn: Buffer[] = [];
  toolAnswers: { callId: string; output: string }[] = [];
  told: string[] = [];
  cancelled = 0;
  closed = 0;
  start(events: VoiceEngineEvents): void {
    this.events = events;
  }
  sendAudio(pcm: Buffer): void {
    this.audioIn.push(pcm);
  }
  answerTool(callId: string, output: string): void {
    this.toolAnswers.push({ callId, output });
  }
  spokenTold: string[] = [];
  tell(text: string, spoken: string): void {
    this.told.push(text);
    this.spokenTold.push(spoken);
  }
  cancelSpeech(): void {
    this.cancelled += 1;
  }
  close(): void {
    this.closed += 1;
  }
}

class Link implements ClientLink {
  out: (string | Buffer)[] = [];
  closed = false;
  /** What the browser still has not taken, for the slow-browser checks. */
  buffered = 0;
  bufferedBytes(): number {
    return this.buffered;
  }
  private onData: (data: Buffer, isBinary: boolean) => void = () => undefined;
  send(data: string | Buffer): void {
    this.out.push(data);
  }
  close(): void {
    this.closed = true;
  }
  onMessage(listener: (data: Buffer, isBinary: boolean) => void): void {
    this.onData = listener;
  }
  onClose(): void {
    /* not needed here */
  }
  say(data: string | Buffer, isBinary = false): void {
    this.onData(typeof data === 'string' ? Buffer.from(data) : data, isBinary);
  }
  json(): Record<string, unknown>[] {
    return this.out
      .filter((item): item is string => typeof item === 'string')
      .map((item) => JSON.parse(item) as Record<string, unknown>);
  }
}

const answer: LiveAskAnswer = {
  answer: 'done',
  actions: [],
  screen: [],
  steps: [],
  toolCalls: 0,
  stop: 'answered',
  errorCode: null,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
};

function rig(clock?: () => number) {
  const engine = new ScriptedEngine();
  const client = new Link();
  const asked: string[] = [];
  const recorded: Record<string, unknown>[] = [];
  const host: RelayHost = {
    model: 'm',
    voice: 'v',
    language: 'fa',
    instructions: 'x',
    ask: (text) => {
      asked.push(text);
      return Promise.resolve(answer);
    },
    saveLines: () => Promise.resolve(),
    costOf: (usage) => Promise.resolve((usage.characters ?? 0) * 0.00004),
    record: (totals) => {
      recorded.push({ ...totals });
      return Promise.resolve({ ended: false });
    },
  };
  startVoiceRelay({ host, client, engine, readyTimeoutMs: 40, ...(clock ? { now: clock } : {}) });
  return { engine, client, asked, recorded };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('the voice engine port (ADR-0057)', () => {
  it('lets the browser talk only after the engine said ready', () => {
    const { engine, client } = rig();
    client.say(Buffer.alloc(320, 1), true);
    expect(engine.audioIn).toHaveLength(0);
    engine.events.ready();
    client.say(Buffer.alloc(320, 1), true);
    expect(engine.audioIn).toHaveLength(1);
    expect(client.json()).toContainEqual({ type: 'ready' });
  });

  it('closes both sides when the engine never gets ready', async () => {
    const { engine, client } = rig();
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(client.json().at(-1)).toEqual({ type: 'closed', reason: 'provider' });
    expect(engine.closed).toBe(1);
    expect(client.closed).toBe(true);
  });

  it('closes the engine, once, when it fails', () => {
    const { engine, client } = rig();
    engine.events.failed();
    engine.events.failed();
    expect(engine.closed).toBe(1);
    expect(client.json().at(-1)).toEqual({ type: 'closed', reason: 'provider' });
  });

  it('carries a tool call to the executor and hands the engine a short answer', async () => {
    const { engine, asked, client } = rig();
    engine.events.ready();
    engine.events.toolCall('c1', 'pause the Nile project');
    await tick();
    expect(asked).toEqual(['pause the Nile project']);
    expect(engine.toolAnswers[0]?.callId).toBe('c1');
    expect(client.json().some((m) => m['type'] === 'answer')).toBe(true);
  });

  it('does not call the executor for an empty request', async () => {
    const { engine, asked } = rig();
    engine.events.ready();
    engine.events.toolCall('c2', '   ');
    await tick();
    expect(asked).toEqual([]);
    expect(JSON.parse(engine.toolAnswers[0]?.output ?? '{}')).toMatchObject({
      answer: 'No request was given.',
    });
  });

  it('prices a pipeline by what it reports: time and characters count, not only tokens', async () => {
    const { engine, recorded, client } = rig();
    engine.events.ready();
    engine.events.responseDone({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      audioSeconds: 12,
      characters: 400,
    });
    await tick();
    expect(recorded.at(-1)).toMatchObject({ audioSeconds: 12, characters: 400, costUsd: 0.016 });
    expect(client.json().at(-1)).toMatchObject({ type: 'usage', costUsd: 0.016 });
  });

  it('plays audio and reports speaking, then listening, whatever the engine is', async () => {
    const { engine, client } = rig();
    engine.events.ready();
    engine.events.audio(Buffer.from('abcd'));
    engine.events.responseDone(null);
    await tick();
    expect(client.out.some((item) => Buffer.isBuffer(item))).toBe(true);
    expect(client.json().filter((m) => m['type'] === 'activity')).toEqual([
      { type: 'activity', activity: 'speaking' },
      { type: 'activity', activity: 'listening' },
    ]);
  });

  it('stops the engine speaking when the browser asks, and tells it what became of a change', () => {
    const { engine, client } = rig();
    engine.events.ready();
    client.say(JSON.stringify({ type: 'stop_speaking' }));
    client.say(
      JSON.stringify({
        type: 'action_result',
        capability: 'pause',
        status: 'executed',
        summary: 'Ok.',
      }),
    );
    expect(engine.cancelled).toBe(1);
    expect(engine.told[0]).toContain('"pause" is now executed');
    // An engine with no model speaks the plain summary instead of the instruction.
    expect(engine.spokenTold[0]).toBe('Ok.');
  });

  it('counts use an engine reports outside a response, and leaves the activity alone', async () => {
    const { engine, recorded, client } = rig();
    engine.events.ready();
    engine.events.speechStopped();
    engine.events.usage({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      audioSeconds: 30,
      characters: 0,
    });
    await tick();
    expect(recorded.at(-1)).toMatchObject({ audioSeconds: 30, characters: 0 });
    // Only the speech stop changed the activity; the report did not bring it back to listening.
    expect(client.json().filter((m) => m['type'] === 'activity')).toEqual([
      { type: 'activity', activity: 'thinking' },
    ]);
  });

  describe('limits on the browser link (hardening)', () => {
    const closedReasons = (client: Link) =>
      client
        .json()
        .filter((m) => m['type'] === 'closed')
        .map((m) => m['reason']);

    it('lets a page that sends at real time through, whatever the frame size', () => {
      let at = 0;
      const { engine, client } = rig(() => at);
      engine.events.ready();
      // 100 ms of audio (4 800 bytes) every 100 ms, for ten seconds.
      for (let i = 0; i < 100; i += 1) {
        at += 100;
        client.say(Buffer.alloc(4_800, 1), true);
      }
      expect(engine.audioIn).toHaveLength(100);
      expect(closedReasons(client)).toEqual([]);
    });

    it('drops a flood of microphone audio past the burst and closes the link that keeps at it', () => {
      const { engine, client } = rig(() => 0); // time stands still: nothing refills
      engine.events.ready();
      for (let i = 0; i < 400; i += 1) client.say(Buffer.alloc(32_768, 1), true);
      // Two seconds of audio (96 000 bytes at 24 kHz, 16-bit) fit: two frames of 32 768.
      expect(engine.audioIn).toHaveLength(2);
      expect(closedReasons(client)).toEqual(['error']);
      expect(engine.closed).toBe(1);
    });

    it('forgives a page that is only a little fast', () => {
      let at = 0;
      const { engine, client } = rig(() => at);
      engine.events.ready();
      // Three times real time for ten seconds: many frames are dropped, but each accepted one
      // takes a strike back, so the link stays open.
      for (let i = 0; i < 200; i += 1) {
        at += 50;
        client.say(Buffer.alloc(7_200, 1), true); // 150 ms of audio every 50 ms
      }
      expect(engine.audioIn.length).toBeGreaterThan(60);
      expect(engine.audioIn.length).toBeLessThan(200);
      expect(closedReasons(client)).toEqual([]);
    });

    it('limits control messages too', () => {
      const { engine, client } = rig(() => 0);
      engine.events.ready();
      for (let i = 0; i < 300; i += 1) client.say(JSON.stringify({ type: 'stop_speaking' }));
      expect(engine.cancelled).toBe(40);
      expect(closedReasons(client)).toEqual(['error']);
    });

    it('holds back audio for a browser that cannot take it, and closes a link that is far behind', () => {
      const { engine, client } = rig();
      engine.events.ready();
      client.buffered = 2 * 1024 * 1024; // past the soft limit
      engine.events.audio(Buffer.from('abcd'));
      expect(client.out.some((item) => Buffer.isBuffer(item))).toBe(false);
      expect(closedReasons(client)).toEqual([]);
      client.buffered = 0; // caught up
      engine.events.audio(Buffer.from('abcd'));
      expect(client.out.some((item) => Buffer.isBuffer(item))).toBe(true);
      client.buffered = 5 * 1024 * 1024; // past the hard limit
      engine.events.audio(Buffer.from('abcd'));
      expect(closedReasons(client)).toEqual(['error']);
    });
  });
});
