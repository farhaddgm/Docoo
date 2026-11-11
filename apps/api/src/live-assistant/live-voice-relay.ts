import {
  LIVE_VOICE_MAX_FRAME_BYTES,
  liveVoiceClientMessageSchema,
  type LiveActivity,
  type LiveAskAnswer,
  type LiveVoiceServerMessage,
} from '@docoo/contracts';

import type { RelaySocket } from './realtime-link.js';

/**
 * The relay between the browser and the provider's realtime voice service (ADR-0055 §4-3, relay
 * option): audio and a few small messages go in and out of the Docoo server, which holds the key,
 * counts the use, and runs everything the model asks for through the gateway. The model only ever
 * gets one tool, `ask_docoo`; what it asks is carried out by the executor and its confirmations,
 * exactly as for typed requests. All knowledge of the provider's wire protocol is in this file.
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

export interface RelayUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
}

/** The part of the browser's socket the relay uses (the `ws` library's socket fits it). */
export interface ClientLink {
  send(data: string | Buffer): void;
  close(code?: number): void;
  onMessage(listener: (data: Buffer, isBinary: boolean) => void): void;
  onClose(listener: () => void): void;
}

export interface RelayOptions {
  readonly host: RelayHost;
  readonly client: ClientLink;
  readonly provider: RelaySocket;
  /** How long the provider may take to accept the session. */
  readonly readyTimeoutMs?: number;
  readonly now?: () => number;
}

const ASK_TOOL = {
  type: 'function',
  name: 'ask_docoo',
  description:
    'Ask Docoo to look something up or to do something, in the words of the person. Use it for anything about their projects, knowledge, notifications or settings. A change is never done at once: the person confirms it on screen.',
  parameters: {
    type: 'object',
    properties: {
      request: { type: 'string', description: "The person's request, in their own words." },
    },
    required: ['request'],
    additionalProperties: false,
  },
} as const;

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

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function requestOf(rawArguments: string): string {
  try {
    return stringOf(recordOf(JSON.parse(rawArguments) as unknown)['request']).slice(0, 1000);
  } catch {
    return '';
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Starts the relay; resolves with a function that ends it. */
export function startVoiceRelay(options: RelayOptions): { stop: (reason: string) => void } {
  const { host, client, provider } = options;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;
  let ready = false;
  let activity: LiveActivity = 'listening';
  let speaking = false;
  const totals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 };
  let asking: Promise<void> = Promise.resolve();

  const toClient = (message: LiveVoiceServerMessage): void => {
    if (closed) return;
    try {
      client.send(JSON.stringify(message));
    } catch {
      /* the browser went away; its close event ends the relay */
    }
  };
  const toProvider = (event: Record<string, unknown>): void => {
    if (closed) return;
    try {
      provider.send(JSON.stringify(event));
    } catch {
      end('provider');
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
    try {
      provider.close(1000);
    } catch {
      /* already closed */
    }
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

  async function addUsage(response: Record<string, unknown>): Promise<void> {
    const usage = recordOf(response['usage']);
    const details = recordOf(usage['input_token_details']);
    const step: RelayUsage = {
      inputTokens: numberOf(usage['input_tokens']),
      outputTokens: numberOf(usage['output_tokens']),
      cachedInputTokens: numberOf(details['cached_tokens']),
    };
    if (step.inputTokens === 0 && step.outputTokens === 0) return;
    const cost = await host.costOf(step).catch(() => 0);
    totals.inputTokens += step.inputTokens;
    totals.outputTokens += step.outputTokens;
    totals.cachedInputTokens += step.cachedInputTokens;
    totals.costUsd = Math.round((totals.costUsd + cost) * 1e6) / 1e6;
    try {
      const outcome = await host.record({ ...totals }, activity);
      toClient({ type: 'usage', ...totals });
      if (outcome.ended) end('cap');
    } catch {
      /* the next report tries again; the browser's own heartbeat also reaches the server */
    }
  }

  function answerTool(callId: string, rawArguments: string): void {
    asking = asking.then(async () => {
      if (closed) return;
      const request = requestOf(rawArguments);
      let output: string;
      if (request.trim() === '') {
        output = JSON.stringify({ answer: 'No request was given.' });
      } else {
        setActivity('thinking');
        try {
          const answer = await host.ask(request);
          toClient({ type: 'answer', answer });
          output = toolOutputOf(answer);
        } catch {
          output = JSON.stringify({ answer: 'Docoo could not carry this out right now.' });
        }
      }
      toProvider({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: callId, output },
      });
      toProvider({ type: 'response.create' });
    });
  }

  function onProviderEvent(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let event: Record<string, unknown>;
    try {
      event = recordOf(JSON.parse(raw) as unknown);
    } catch {
      return;
    }
    switch (stringOf(event['type'])) {
      case 'session.updated': {
        if (ready) return;
        ready = true;
        clearTimeout(readyTimer);
        timers.delete(readyTimer);
        toClient({ type: 'ready' });
        return;
      }
      case 'input_audio_buffer.speech_started':
        speaking = false;
        toClient({ type: 'interrupt' });
        setActivity('listening');
        return;
      case 'input_audio_buffer.speech_stopped':
        setActivity('thinking');
        return;
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        const audio = stringOf(event['delta']);
        if (audio === '') return;
        if (!speaking) {
          speaking = true;
          setActivity('speaking');
        }
        try {
          client.send(Buffer.from(audio, 'base64'));
        } catch {
          /* the browser went away */
        }
        return;
      }
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const text = stringOf(event['transcript']);
        if (text.trim() === '') return;
        toClient({ type: 'assistant', text: text.slice(0, 4000) });
        void save('assistant', text);
        return;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const text = stringOf(event['transcript']);
        if (text.trim() === '') return;
        toClient({ type: 'user', text: text.slice(0, 4000) });
        void save('user', text);
        return;
      }
      case 'response.function_call_arguments.done': {
        const callId = stringOf(event['call_id']);
        if (stringOf(event['name']) !== 'ask_docoo' || callId === '') return;
        answerTool(callId, stringOf(event['arguments']));
        return;
      }
      case 'response.done': {
        speaking = false;
        void addUsage(recordOf(event['response']));
        // A tool call is still being answered; only then does listening resume.
        void asking.then(() => setActivity('listening'));
        return;
      }
      case 'error':
        end('provider');
        return;
      default:
    }
  }

  provider.onopen = () => {
    toProvider({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: host.model,
        instructions: host.instructions,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: 'gpt-4o-mini-transcribe', language: host.language },
            turn_detection: { type: 'semantic_vad' },
          },
          output: { format: { type: 'audio/pcm', rate: 24000 }, voice: host.voice },
        },
        tools: [ASK_TOOL],
        tool_choice: 'auto',
      },
    });
  };
  provider.onmessage = (event) => onProviderEvent(event.data);
  provider.onerror = () => end('provider');
  provider.onclose = () => end('provider');

  client.onClose(() => end('ended'));
  client.onMessage((data, isBinary) => {
    if (closed) return;
    if (isBinary) {
      if (!ready || data.length === 0 || data.length > LIVE_VOICE_MAX_FRAME_BYTES) return;
      toProvider({ type: 'input_audio_buffer.append', audio: data.toString('base64') });
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
      toProvider({ type: 'response.cancel' });
      toClient({ type: 'interrupt' });
      return;
    }
    const { capability, status, summary } = message.data;
    toProvider({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: `Docoo: the change "${capability}" is now ${status}. ${summary} Tell the person briefly.`,
          },
        ],
      },
    });
    toProvider({ type: 'response.create' });
  });

  return { stop: (reason) => end(reason === 'cap' ? 'cap' : 'ended') };
}
