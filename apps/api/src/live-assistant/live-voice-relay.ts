import {
  LIVE_VOICE_MAX_FRAME_BYTES,
  liveVoiceClientMessageSchema,
  type LiveActivity,
  type LiveAskAnswer,
  type LiveVoiceServerMessage,
} from '@docoo/contracts';

import type { EngineUsage, VoiceEngine } from './voice-engine.js';
import {
  CLIENT_BUFFER_HARD_BYTES,
  CLIENT_BUFFER_SOFT_BYTES,
  CONTROL_BURST,
  CONTROL_MESSAGES_PER_SECOND,
  MIC_BURST_BYTES,
  MIC_RATE_BYTES_PER_SECOND,
  createStrikes,
  createTokenBucket,
} from './voice-flow.js';

/**
 * The relay between the browser and a voice provider (ADR-0055 §4-3, ADR-0057): audio and a few
 * small messages go in and out of the Docoo server, which holds the key, counts the use, and runs
 * everything the model asks for through the gateway. The model only ever gets one tool,
 * `ask_docoo`; what it asks is carried out by the executor and its confirmations, exactly as for
 * typed requests. Nothing here knows a provider's protocol: that is the engine (`VoiceEngine`).
 */

/** What the relay needs from the rest of the server; tests give a scripted one. */
export interface RelayHost {
  readonly model: string;
  readonly voice: string;
  readonly language: string;
  readonly instructions: string;
  /** A request the model made in the person's words; changes come back waiting for a person. */
  ask(text: string): Promise<LiveAskAnswer>;
  /** Finished lines of the conversation (kept only when the owner keeps transcripts). */
  saveLines(lines: readonly { role: 'user' | 'assistant'; content: string }[]): Promise<void>;
  /** The cost of one stretch of use; the caps are checked by `record`. */
  costOf(usage: RelayUsage): Promise<number>;
  /** Adds to the session's totals; `ended` means a cap or the owner closed it. */
  record(
    totals: RelayUsage & { costUsd: number },
    activity: LiveActivity,
  ): Promise<{ ended: boolean }>;
}

export type RelayUsage = EngineUsage;

/** The part of the browser's socket the relay uses (the `ws` library's socket fits it). */
export interface ClientLink {
  send(data: string | Buffer): void;
  close(code?: number): void;
  onMessage(listener: (data: Buffer, isBinary: boolean) => void): void;
  onClose(listener: () => void): void;
  /** Bytes sent but not yet taken by the browser; when the link can tell, a slow page is held back. */
  bufferedBytes?(): number;
}

export interface RelayOptions {
  readonly host: RelayHost;
  readonly client: ClientLink;
  readonly engine: VoiceEngine;
  /** How long the provider may take to accept the session. */
  readonly readyTimeoutMs?: number;
  /** The clock of the rate limits; tests give a scripted one. */
  readonly now?: () => number;
}

/** What the model is told after the executor answered: short, with no raw data. */
function toolOutputOf(answer: LiveAskAnswer): string {
  const waiting = answer.actions.filter(
    (action) => action.status === 'proposed' || action.status === 'first_confirmed',
  ).length;
  return JSON.stringify({
    answer: answer.answer.slice(0, 2000),
    changes_waiting_for_the_person_to_confirm: waiting,
    note:
      waiting > 0
        ? 'Nothing is changed yet. Tell the person what is waiting and ask them to confirm.'
        : undefined,
  });
}

/** Starts the relay; returns a function that ends it. */
export function startVoiceRelay(options: RelayOptions): { stop: (reason: string) => void } {
  const { host, client, engine } = options;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const micBucket = createTokenBucket({
    ratePerSecond: MIC_RATE_BYTES_PER_SECOND,
    burst: MIC_BURST_BYTES,
    ...(options.now ? { now: options.now } : {}),
  });
  const controlBucket = createTokenBucket({
    ratePerSecond: CONTROL_MESSAGES_PER_SECOND,
    burst: CONTROL_BURST,
    ...(options.now ? { now: options.now } : {}),
  });
  const strikes = createStrikes();
  let closed = false;
  let ready = false;
  let activity: LiveActivity = 'listening';
  let speaking = false;
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    audioSeconds: 0,
    characters: 0,
    costUsd: 0,
  };
  let asking: Promise<void> = Promise.resolve();

  const toClient = (message: LiveVoiceServerMessage): void => {
    if (closed) return;
    try {
      client.send(JSON.stringify(message));
    } catch {
      /* the browser went away; its close event ends the relay */
    }
  };
  const setActivity = (next: LiveActivity): void => {
    if (activity === next) return;
    activity = next;
    toClient({ type: 'activity', activity: next });
  };

  function end(reason: 'ended' | 'cap' | 'provider' | 'idle' | 'superseded' | 'error'): void {
    if (closed) return;
    toClient({ type: 'closed', reason });
    closed = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    engine.close();
    try {
      client.close(1000);
    } catch {
      /* already closed */
    }
  }

  const readyTimer = setTimeout(() => end('provider'), options.readyTimeoutMs ?? 10_000);
  timers.add(readyTimer);

  async function save(role: 'user' | 'assistant', text: string): Promise<void> {
    const content = text.trim().slice(0, 4000);
    if (content === '') return;
    try {
      await host.saveLines([{ role, content }]);
    } catch {
      /* a line that cannot be saved must not stop the conversation */
    }
  }

  async function addUsage(step: EngineUsage): Promise<void> {
    const cost = await host.costOf(step).catch(() => 0);
    totals.inputTokens += step.inputTokens;
    totals.outputTokens += step.outputTokens;
    totals.cachedInputTokens += step.cachedInputTokens;
    totals.audioSeconds += step.audioSeconds ?? 0;
    totals.characters += step.characters ?? 0;
    totals.costUsd = Math.round((totals.costUsd + cost) * 1e6) / 1e6;
    try {
      const outcome = await host.record({ ...totals }, activity);
      toClient({
        type: 'usage',
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cachedInputTokens: totals.cachedInputTokens,
        costUsd: totals.costUsd,
      });
      if (outcome.ended) end('cap');
    } catch {
      /* the next report tries again; the browser's own heartbeat also reaches the server */
    }
  }

  function answerTool(callId: string, request: string): void {
    asking = asking.then(async () => {
      if (closed) return;
      let output: string;
      if (request.trim() === '') {
        output = JSON.stringify({ answer: 'No request was given.' });
      } else {
        setActivity('thinking');
        try {
          const answer = await host.ask(request.slice(0, 1000));
          toClient({ type: 'answer', answer });
          output = toolOutputOf(answer);
        } catch {
          output = JSON.stringify({ answer: 'Docoo could not carry this out right now.' });
        }
      }
      if (!closed) engine.answerTool(callId, output);
    });
  }

  engine.start({
    ready() {
      if (ready || closed) return;
      ready = true;
      clearTimeout(readyTimer);
      timers.delete(readyTimer);
      toClient({ type: 'ready' });
    },
    speechStarted() {
      speaking = false;
      toClient({ type: 'interrupt' });
      setActivity('listening');
    },
    speechStopped() {
      setActivity('thinking');
    },
    audio(pcm) {
      if (closed || pcm.length === 0) return;
      // A browser that cannot take the audio as it comes gets no unbounded buffer on the server:
      // past the soft limit the audio is dropped, past the hard one the link is closed.
      const waiting = client.bufferedBytes?.() ?? 0;
      if (waiting > CLIENT_BUFFER_HARD_BYTES) {
        end('error');
        return;
      }
      if (waiting > CLIENT_BUFFER_SOFT_BYTES) return;
      if (!speaking) {
        speaking = true;
        setActivity('speaking');
      }
      try {
        client.send(pcm);
      } catch {
        /* the browser went away */
      }
    },
    userText(text) {
      if (text.trim() === '') return;
      toClient({ type: 'user', text: text.slice(0, 4000) });
      void save('user', text);
    },
    assistantText(text) {
      if (text.trim() === '') return;
      toClient({ type: 'assistant', text: text.slice(0, 4000) });
      void save('assistant', text);
    },
    toolCall(callId, request) {
      answerTool(callId, request);
    },
    responseDone(usage) {
      speaking = false;
      if (usage) void addUsage(usage);
      // A tool call is still being answered; only then does listening resume.
      void asking.then(() => setActivity('listening'));
    },
    usage(step) {
      void addUsage(step);
    },
    failed() {
      end('provider');
    },
  });

  client.onClose(() => end('ended'));
  client.onMessage((data, isBinary) => {
    if (closed) return;
    if (isBinary) {
      if (!ready || data.length === 0 || data.length > LIVE_VOICE_MAX_FRAME_BYTES) return;
      // The microphone may come at a little above real time; more than that is dropped, and a
      // link that keeps doing it is closed.
      if (!micBucket.take(data.length)) {
        if (strikes.dropped()) end('error');
        return;
      }
      strikes.accepted();
      engine.sendAudio(data);
      return;
    }
    if (!controlBucket.take(1)) {
      if (strikes.dropped()) end('error');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    const message = liveVoiceClientMessageSchema.safeParse(parsed);
    if (!message.success) return;
    if (message.data.type === 'stop_speaking') {
      engine.cancelSpeech();
      toClient({ type: 'interrupt' });
      return;
    }
    const { capability, status, summary } = message.data;
    engine.tell(
      `Docoo: the change "${capability}" is now ${status}. ${summary} Tell the person briefly.`,
      summary,
    );
  });

  return { stop: (reason) => end(reason === 'cap' ? 'cap' : 'ended') };
}
