import { z } from 'zod';

import { liveAskAnswerSchema, liveActivities } from './live-assistant-api.js';

/**
 * What the browser and the Docoo server say to each other over the voice link (ADR-0055 §4-3,
 * option "relay"). Audio travels as binary frames of 16-bit little-endian mono PCM at
 * {@link LIVE_VOICE_SAMPLE_RATE}; everything else is a small JSON message of the kinds below. The
 * provider's own protocol never reaches the browser: only this one does.
 */
export const LIVE_VOICE_SAMPLE_RATE = 24_000;
/** The largest audio frame the server accepts from a browser (about 1.3 s of speech). */
export const LIVE_VOICE_MAX_FRAME_BYTES = 64 * 1024;
/** A ticket for opening the link lives this long and works once. */
export const LIVE_VOICE_TICKET_TTL_MS = 30_000;

/** The server's messages to the browser. */
export const liveVoiceServerMessageSchema = z.discriminatedUnion('type', [
  /** The provider accepted the session; the microphone may start. */
  z.object({ type: z.literal('ready') }),
  /** What the assistant is doing now. */
  z.object({ type: z.literal('activity'), activity: z.enum(liveActivities) }),
  /** What the person said / what the assistant said, as finished lines of the conversation. */
  z.object({ type: z.literal('user'), text: z.string().max(4000) }),
  z.object({ type: z.literal('assistant'), text: z.string().max(4000) }),
  /** The session's totals so far, counted by the server (the page only shows them). */
  z.object({
    type: z.literal('usage'),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
  /** The person started talking over the assistant: stop playing what is queued. */
  z.object({ type: z.literal('interrupt') }),
  /** The result of a request the assistant sent to Docoo (changes wait on the confirmation card). */
  z.object({ type: z.literal('answer'), answer: liveAskAnswerSchema }),
  /** Why the link ended. */
  z.object({
    type: z.literal('closed'),
    reason: z.enum(['ended', 'cap', 'provider', 'idle', 'superseded', 'error']),
  }),
]);
export type LiveVoiceServerMessage = z.infer<typeof liveVoiceServerMessageSchema>;

/** The browser's messages to the server (besides the audio frames). */
export const liveVoiceClientMessageSchema = z.discriminatedUnion('type', [
  /** A change that was waiting has ended: tell the model what became of it. */
  z.object({
    type: z.literal('action_result'),
    capability: z.string().max(100),
    status: z.string().max(40),
    summary: z.string().max(500),
  }),
  /** The person asked the assistant to stop speaking. */
  z.object({ type: z.literal('stop_speaking') }),
]);
export type LiveVoiceClientMessage = z.infer<typeof liveVoiceClientMessageSchema>;

export const liveVoiceTicketSchema = z.object({
  /** A one-time secret for the WebSocket address; never stored by the page. */
  ticket: z.string().min(16).max(200),
  /** The path to open (the page adds its own host). */
  path: z.string().max(300),
  expiresInMs: z.number().int(),
});
export type LiveVoiceTicket = z.infer<typeof liveVoiceTicketSchema>;
