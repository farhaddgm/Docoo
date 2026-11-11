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
  tell(text: string): void {
    this.told.push(text);
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

function rig() {
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
  startVoiceRelay({ host, client, engine, readyTimeoutMs: 40 });
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
  });
});
