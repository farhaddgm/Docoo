import { liveVoiceServerMessageSchema, type LiveActionView } from '@docoo/contracts';

import type { LiveTransport, LiveTransportHandlers } from './transport';
import {
  createBrowserMicrophone,
  createBrowserSpeaker,
  type Microphone,
  type Speaker,
} from './voice-audio';

/**
 * The real voice transport (ADR-0055 §4-3, relay): the browser talks to the Docoo server over one
 * WebSocket, and the server talks to the provider. The page never sees a provider key or the
 * provider's own messages; it sends microphone audio, plays the audio it gets back, and reacts to
 * the few small messages of the wire protocol (`live-voice-wire` in the contracts).
 */

/** The part of a browser WebSocket this transport uses; tests give a scripted one. */
export interface RelaySocketLike {
  binaryType: string;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number): void;
}

export interface RelayTransportDeps {
  /** Where the page is served from, to build the WebSocket address (same origin only). */
  readonly origin: () => string;
  readonly socket?: (url: string) => RelaySocketLike;
  readonly microphone?: () => Microphone;
  readonly speaker?: () => Speaker;
  /** How long the server may take to say the link is ready. */
  readonly readyTimeoutMs?: number;
}

const READY_TIMEOUT_MS = 15_000;

/** `https://host` to `wss://host`, `http://…` to `ws://…`. */
export function webSocketOrigin(origin: string): string {
  return origin.replace(/^http/iu, 'ws');
}

function summaryOf(view: LiveActionView): string {
  return view.status === 'executed'
    ? 'It was carried out.'
    : view.status === 'failed'
      ? 'It failed.'
      : view.status === 'cancelled' || view.status === 'expired'
        ? 'It will not happen.'
        : '';
}

export function createRelayTransport(deps: RelayTransportDeps): LiveTransport {
  const makeSocket =
    deps.socket ?? ((url: string) => new WebSocket(url) as unknown as RelaySocketLike);
  const makeMicrophone = deps.microphone ?? createBrowserMicrophone;
  const makeSpeaker = deps.speaker ?? createBrowserSpeaker;

  let socket: RelaySocketLike | null = null;
  let microphone: Microphone | null = null;
  let speaker: Speaker | null = null;
  let stopped = false;
  // The server counts the use; the page is told the totals and passes on what is new.
  const seen = { tokens: 0, cached: 0, cost: 0 };

  function release(): void {
    stopped = true;
    try {
      microphone?.stop();
    } catch {
      /* already stopped */
    }
    try {
      speaker?.close();
    } catch {
      /* already closed */
    }
    try {
      socket?.close(1000);
    } catch {
      /* already closed */
    }
    microphone = null;
    speaker = null;
  }

  return {
    async start(handlers: LiveTransportHandlers, session) {
      if (!session?.voiceTicket) throw new Error('The voice link needs its session.');
      stopped = false;
      // A one-time ticket, asked with the page's own signed-in request.
      const ticket = await session.voiceTicket(session.sessionId);
      if (stopped) return;
      const url = `${webSocketOrigin(deps.origin())}${ticket.path}?ticket=${encodeURIComponent(ticket.ticket)}`;
      const link = makeSocket(url);
      link.binaryType = 'arraybuffer';
      socket = link;
      speaker = makeSpeaker();
      let ready = false;

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('The voice link did not become ready.')),
          deps.readyTimeoutMs ?? READY_TIMEOUT_MS,
        );
        const fail = (message: string): void => {
          clearTimeout(timer);
          reject(new Error(message));
        };

        link.onerror = () => {
          if (!ready) fail('The voice link could not be opened.');
        };
        link.onclose = () => {
          if (!ready) {
            fail('The voice link closed before it was ready.');
            return;
          }
          // After a clean "closed" message nothing more is needed; otherwise the link was lost.
          if (!stopped) {
            release();
            handlers.onLost();
          }
        };
        link.onmessage = (event) => {
          if (stopped) return;
          if (event.data instanceof ArrayBuffer) {
            speaker?.play(event.data);
            return;
          }
          if (typeof event.data !== 'string') return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(event.data);
          } catch {
            return;
          }
          const message = liveVoiceServerMessageSchema.safeParse(parsed);
          if (!message.success) return;
          const m = message.data;
          switch (m.type) {
            case 'ready':
              ready = true;
              clearTimeout(timer);
              resolve();
              return;
            case 'activity':
              handlers.onActivity?.(m.activity === 'asleep' ? 'listening' : m.activity);
              return;
            case 'user':
              handlers.onSpeech(m.text);
              return;
            case 'assistant':
              // The server keeps the transcript; the page needs nothing more here.
              return;
            case 'interrupt':
              speaker?.clear();
              return;
            case 'answer':
              handlers.onAnswer?.(m.answer);
              return;
            case 'usage': {
              const tokens = m.inputTokens + m.outputTokens;
              const addTokens = Math.max(0, tokens - seen.tokens);
              const addCached = Math.max(0, m.cachedInputTokens - seen.cached);
              const addCost = Math.max(0, m.costUsd - seen.cost);
              seen.tokens = Math.max(seen.tokens, tokens);
              seen.cached = Math.max(seen.cached, m.cachedInputTokens);
              seen.cost = Math.max(seen.cost, m.costUsd);
              if (addTokens > 0 || addCost > 0) handlers.onUsage(addTokens, addCost, addCached);
              return;
            }
            case 'closed':
              release();
              if (m.reason === 'cap' || m.reason === 'ended' || m.reason === 'superseded') {
                handlers.onServerEnded?.();
              } else {
                handlers.onLost();
              }
              return;
          }
        };
      }).catch((error: unknown) => {
        release();
        throw error;
      });

      if (stopped) return;
      // The microphone only after the provider accepted the session, so nothing is heard before.
      const mic = makeMicrophone();
      microphone = mic;
      try {
        await mic.start((frame) => {
          if (!stopped && socket) socket.send(frame);
        });
      } catch (error) {
        release();
        throw error;
      }
    },

    stop() {
      release();
      return Promise.resolve();
    },

    reportAction(view) {
      if (stopped || !socket) return;
      const summary = summaryOf(view);
      try {
        socket.send(
          JSON.stringify({
            type: 'action_result',
            capability: view.capability.slice(0, 100),
            status: view.status.slice(0, 40),
            summary,
          }),
        );
      } catch {
        /* the link is going away */
      }
    },
  };
}
