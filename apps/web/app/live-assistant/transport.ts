import type { LiveActionView, LiveAskAnswer, LiveVoiceTicket } from '@docoo/contracts';

/**
 * How the browser talks to the voice provider. The store knows only this interface, so the real
 * WebRTC connection (ADR-0055 §4-3) and the stand-in used for tests and development are
 * interchangeable. A transport reports what happens; it never decides policy.
 */

export interface LiveTransportHandlers {
  /**
   * Tokens just used by the voice model or the executor (added to the session total), and what
   * they cost in dollars when the provider's price is known. The server checks its caps against
   * the totals the store reports.
   */
  onUsage: (tokens: number, costUsd?: number, cachedTokens?: number) => void;
  /** What the assistant is doing right now; the store reports it so a projector can show it. */
  onActivity?: (activity: 'listening' | 'thinking' | 'speaking') => void;
  /** A finished line of the conversation, for the transcript the owner can read later. */
  onMessage: (role: 'user' | 'assistant', content: string) => void;
  /**
   * The model asked for something (a tool call). The gateway decides: a read comes back with its
   * result, a change comes back waiting for a person. The transport hands the answer to the model;
   * it never decides, and it never confirms.
   */
  propose: (
    capability: string,
    params: Record<string, unknown>,
    tainted?: boolean,
  ) => Promise<LiveActionView>;
  /**
   * What the person said, as the speech recogniser heard it. While a change waits, the store reads
   * it as an answer to that change; otherwise it is just conversation and changes nothing.
   */
  onSpeech: (transcript: string) => void;
  /**
   * The result of a request the assistant sent to Docoo while talking (the server ran it through the
   * executor and the gateway): changes wait on the confirmation card, a page or a form draft is shown.
   */
  onAnswer?: (answer: LiveAskAnswer) => void;
  /** The server ended the link because the session ended there (a cap, the owner, a new start). */
  onServerEnded?: () => void;
  onSleep: () => void;
  onWake: () => void;
  /** The connection dropped by itself; the session is over. */
  onLost: () => void;
}

export interface LiveTransportSession {
  readonly sessionId: string;
  /** Push-to-talk: the microphone is heard only between `setTalking(true)` and `setTalking(false)`. */
  readonly pushToTalk?: boolean;
  readonly voiceTicket?: (sessionId: string) => Promise<LiveVoiceTicket>;
}

export interface LiveTransport {
  /**
   * Resolves when the session is live; rejects if it cannot be opened. `session` is what a transport
   * that talks to the server needs: the session's id and how to ask for a one-time voice ticket.
   */
  start: (handlers: LiveTransportHandlers, session?: LiveTransportSession) => Promise<void>;
  /** Releases the microphone and the connection. Safe to call more than once or mid-start. */
  stop: () => Promise<void>;
  /** A change that was waiting has ended (done, failed, cancelled, expired): tell the model. */
  reportAction?: (view: LiveActionView) => void;
  /**
   * The push-to-talk key goes down or up. Down: whatever the assistant is saying stops and the
   * microphone is heard. Up: what was said is one turn and the assistant answers it. Without
   * push-to-talk this does nothing.
   */
  setTalking?: (on: boolean) => void;
}

export type LiveTransportFactory = () => LiveTransport;

export interface FakeTransportOptions {
  readonly tokensPerTick?: number;
  readonly costPerTick?: number;
  /** Changes the stand-in "model" asks for, one after the other, to exercise the confirmation card. */
  readonly proposals?: readonly {
    capability: string;
    params?: Record<string, unknown>;
    afterMs?: number;
  }[];
  /** Lines the stand-in "says" as soon as it starts, to exercise the transcript. */
  readonly lines?: readonly { role: 'user' | 'assistant'; content: string }[];
  readonly tickMs?: number;
  readonly failOnStart?: boolean;
}

/**
 * A transport that speaks to nobody: it only counts tokens up on a timer. Used by tests and by
 * development builds to exercise the pill, the lock and the navigation without a provider.
 */
export function createFakeTransport(options: FakeTransportOptions = {}): LiveTransport {
  const tokensPerTick = options.tokensPerTick ?? 25;
  const tickMs = options.tickMs ?? 1000;
  let timer: ReturnType<typeof setInterval> | null = null;
  const proposalTimers: ReturnType<typeof setTimeout>[] = [];
  return {
    start(handlers) {
      if (options.failOnStart) return Promise.reject(new Error('fake transport refused to start'));
      for (const line of options.lines ?? []) handlers.onMessage(line.role, line.content);
      for (const proposal of options.proposals ?? []) {
        proposalTimers.push(
          setTimeout(() => {
            // A refusal or a closed session is the model's problem, not the page's.
            void handlers
              .propose(proposal.capability, proposal.params ?? {})
              .catch(() => undefined);
          }, proposal.afterMs ?? 0),
        );
      }
      timer = setInterval(() => handlers.onUsage(tokensPerTick, options.costPerTick), tickMs);
      return Promise.resolve();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const pending of proposalTimers.splice(0)) clearTimeout(pending);
      return Promise.resolve();
    },
  };
}
