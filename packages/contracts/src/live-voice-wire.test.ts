import { describe, expect, it } from 'vitest';

import {
  liveVoiceClientMessageSchema,
  liveVoiceServerMessageSchema,
  liveVoiceTicketSchema,
} from './live-voice-wire.js';

describe('the voice link messages', () => {
  it('accepts the server messages the browser reacts to', () => {
    for (const message of [
      { type: 'ready' },
      { type: 'activity', activity: 'speaking' },
      { type: 'user', text: 'سلام' },
      { type: 'assistant', text: 'سلام، بفرمایید' },
      { type: 'interrupt' },
      { type: 'closed', reason: 'cap' },
    ]) {
      expect(liveVoiceServerMessageSchema.safeParse(message).success, message.type).toBe(true);
    }
  });

  it('refuses an unknown kind, an unknown activity and an over-long line', () => {
    expect(liveVoiceServerMessageSchema.safeParse({ type: 'run', cmd: 'x' }).success).toBe(false);
    expect(
      liveVoiceServerMessageSchema.safeParse({ type: 'activity', activity: 'dancing' }).success,
    ).toBe(false);
    expect(
      liveVoiceServerMessageSchema.safeParse({ type: 'user', text: 'x'.repeat(4001) }).success,
    ).toBe(false);
  });

  it('accepts only the two things a browser may say besides audio', () => {
    expect(
      liveVoiceClientMessageSchema.safeParse({
        type: 'action_result',
        capability: 'pause',
        status: 'executed',
        summary: 'Paused.',
      }).success,
    ).toBe(true);
    expect(liveVoiceClientMessageSchema.safeParse({ type: 'stop_speaking' }).success).toBe(true);
    expect(liveVoiceClientMessageSchema.safeParse({ type: 'session.update' }).success).toBe(false);
  });

  it('describes a ticket without leaking more than the path and the secret', () => {
    expect(
      liveVoiceTicketSchema.safeParse({
        ticket: 'a'.repeat(32),
        path: '/api/workspaces/w/live-assistant/sessions/s/voice',
        expiresInMs: 30000,
      }).success,
    ).toBe(true);
  });
});
