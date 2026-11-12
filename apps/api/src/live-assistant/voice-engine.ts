/**
 * The port between the voice relay and a voice provider (ADR-0057). The relay core owns everything
 * that does not depend on the provider: the browser link, the caps, the counting of use, the
 * transcript and the one tool the model has (`ask_docoo`). An engine owns what does: the provider's
 * wire protocol, or, for a pipeline, the speech-to-text, the reply and the text-to-speech.
 */

/** Tokens a stretch of use consumed; a pipeline reports what it can measure (the rest is 0). */
export interface EngineUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  /** Seconds of audio the provider listened to or spoke, for providers priced by time. */
  readonly audioSeconds?: number;
  /** Characters sent to a text-to-speech model, for providers priced by character. */
  readonly characters?: number;
}

/** What an engine tells the relay. All of it is optional to call, none of it is trusted blindly. */
export interface VoiceEngineEvents {
  /** The provider accepted the session; the microphone may start. */
  ready(): void;
  /** The person started talking: whatever the assistant is saying must stop. */
  speechStarted(): void;
  /** The person stopped talking and the assistant is working on an answer. */
  speechStopped(): void;
  /** A piece of the assistant's voice (16-bit mono PCM at 24 kHz). */
  audio(pcm: Buffer): void;
  /** A finished line of the conversation. */
  userText(text: string): void;
  assistantText(text: string): void;
  /** The model asked Docoo for something, in the person's words. An empty request is allowed. */
  toolCall(callId: string, request: string): void;
  /** One response is complete, with what it used when the provider says so. */
  responseDone(usage: EngineUsage | null): void;
  /**
   * Use that is not tied to a response (a pipeline listens for as long as the microphone is open,
   * answer or not). It only counts; the activity of the session is left alone.
   */
  usage(usage: EngineUsage): void;
  /** The provider failed or closed the link; the session cannot continue. */
  failed(): void;
}

export interface VoiceEngine {
  /** Opens the provider side and starts reporting through `events`. */
  start(events: VoiceEngineEvents): void;
  /** Microphone audio (16-bit mono PCM at 24 kHz); only sent after `ready`. */
  sendAudio(pcm: Buffer): void;
  /** The answer to a tool call; the engine makes the model continue with it. */
  answerTool(callId: string, output: string): void;
  /**
   * Tells the person what became of a change. A model-driven engine gives `instruction` to the
   * model, which says it in its own words; a pipeline has no model and speaks `spoken` as it is.
   */
  tell(instruction: string, spoken: string): void;
  /** Stops what the assistant is saying now. */
  cancelSpeech(): void;
  /**
   * The person let go of the push-to-talk key: what they said is one turn, answer it now. True when
   * the engine took it as the end of a turn; false when it did nothing (always-listening mode,
   * where the provider finds the end of a turn itself, so a page cannot force one).
   */
  endTurn(): boolean;
  close(): void;
}

/** The part of the session an engine needs to know. */
export interface VoiceEngineConfig {
  /** The owner chose push-to-talk: no automatic end of turn, the page says when a turn ends. */
  readonly pushToTalk?: boolean;
  readonly model: string;
  readonly voice: string;
  readonly language: string;
  readonly instructions: string;
}
