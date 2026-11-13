import type { VoiceEngine, VoiceEngineConfig, VoiceEngineEvents } from './voice-engine.js';
import type { RelaySocket } from './realtime-link.js';

/**
 * The OpenAI realtime protocol (ADR-0055 §4-3), behind the voice engine port. Everything that
 * knows its event names is in this file and in `realtime-link.ts`; a change in the provider's
 * protocol is a change here and nowhere else.
 */

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

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requestOf(rawArguments: string): string {
  try {
    return stringOf(recordOf(JSON.parse(rawArguments) as unknown)['request']).slice(0, 1000);
  } catch {
    return '';
  }
}

export function createOpenAiRealtimeEngine(options: {
  readonly socket: RelaySocket;
  readonly config: VoiceEngineConfig;
}): VoiceEngine {
  const { socket, config } = options;
  let closed = false;
  let events: VoiceEngineEvents | null = null;
  let ready = false;

  const send = (event: Record<string, unknown>): void => {
    if (closed) return;
    try {
      socket.send(JSON.stringify(event));
    } catch {
      events?.failed();
    }
  };

  function onProviderEvent(raw: unknown): void {
    if (typeof raw !== 'string' || !events) return;
    let event: Record<string, unknown>;
    try {
      event = recordOf(JSON.parse(raw) as unknown);
    } catch {
      return;
    }
    switch (stringOf(event['type'])) {
      case 'session.updated':
        if (ready) return;
        ready = true;
        events.ready();
        return;
      case 'input_audio_buffer.speech_started':
        events.speechStarted();
        return;
      case 'input_audio_buffer.speech_stopped':
        events.speechStopped();
        return;
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        const audio = stringOf(event['delta']);
        if (audio !== '') events.audio(Buffer.from(audio, 'base64'));
        return;
      }
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        events.assistantText(stringOf(event['transcript']));
        return;
      case 'conversation.item.input_audio_transcription.completed':
        events.userText(stringOf(event['transcript']));
        return;
      case 'response.function_call_arguments.done': {
        const callId = stringOf(event['call_id']);
        if (stringOf(event['name']) !== 'ask_docoo' || callId === '') return;
        events.toolCall(callId, requestOf(stringOf(event['arguments'])));
        return;
      }
      case 'response.done': {
        const usage = recordOf(recordOf(event['response'])['usage']);
        const details = recordOf(usage['input_token_details']);
        const step = {
          inputTokens: numberOf(usage['input_tokens']),
          outputTokens: numberOf(usage['output_tokens']),
          cachedInputTokens: numberOf(details['cached_tokens']),
        };
        events.responseDone(step.inputTokens === 0 && step.outputTokens === 0 ? null : step);
        return;
      }
      case 'error':
        events.failed();
        return;
      default:
    }
  }

  return {
    start(next) {
      events = next;
      socket.onopen = () => {
        send({
          type: 'session.update',
          session: {
            type: 'realtime',
            model: config.model,
            instructions: config.instructions,
            output_modalities: ['audio'],
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                transcription: { model: 'gpt-4o-mini-transcribe', language: config.language },
                turn_detection: config.pushToTalk ? null : { type: 'semantic_vad' },
              },
              output: { format: { type: 'audio/pcm', rate: 24000 }, voice: config.voice },
            },
            tools: [ASK_TOOL],
            tool_choice: 'auto',
          },
        });
      };
      socket.onmessage = (event) => onProviderEvent(event.data);
      socket.onerror = () => events?.failed();
      socket.onclose = () => events?.failed();
    },
    sendAudio(pcm) {
      send({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') });
    },
    answerTool(callId, output) {
      send({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: callId, output },
      });
      send({ type: 'response.create' });
    },
    tell(text) {
      send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] },
      });
      send({ type: 'response.create' });
    },
    cancelSpeech() {
      send({ type: 'response.cancel' });
    },
    endTurn() {
      // With automatic turn detection the provider finds the end of a turn; a page cannot force one.
      if (!config.pushToTalk || !ready || closed) return false;
      send({ type: 'input_audio_buffer.commit' });
      send({ type: 'response.create' });
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        socket.close(1000);
      } catch {
        /* already closed */
      }
    },
  };
}
