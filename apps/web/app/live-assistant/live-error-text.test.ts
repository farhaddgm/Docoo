import { liveVoiceCheckFailures } from '@docoo/contracts';
import { describe, expect, it } from 'vitest';

import { liveErrorText, liveMessagesFor } from './messages';
import { initialLiveState, reduceLive } from './state';

describe('the words for a lost live connection', () => {
  const locales = ['fa', 'en'] as const;

  it('says something specific for every kind of failure, in both languages', () => {
    for (const locale of locales) {
      const messages = liveMessagesFor(locale);
      const plain = messages.card.errors.connection_lost;
      const seen = new Set<string>();
      for (const failure of liveVoiceCheckFailures) {
        const text = liveErrorText(messages, { error: 'connection_lost', errorDetail: failure });
        expect(text.startsWith(plain), `${locale} ${failure}`).toBe(true);
        expect(text.length, `${locale} ${failure}`).toBeGreaterThan(plain.length + 10);
        seen.add(text);
      }
      // No two kinds share the same sentence.
      expect(seen.size).toBe(liveVoiceCheckFailures.length);
    }
  });

  it('keeps the plain message when the server gave no reason', () => {
    const messages = liveMessagesFor('fa');
    expect(liveErrorText(messages, { error: 'connection_lost', errorDetail: null })).toBe(
      messages.card.errors.connection_lost,
    );
  });

  it('adds a reason only to a lost connection', () => {
    const messages = liveMessagesFor('en');
    expect(liveErrorText(messages, { error: 'cap_reached', errorDetail: 'quota' })).toBe(
      messages.card.errors.cap_reached,
    );
  });

  it('keeps the reason in the state until the error is dismissed', () => {
    const started = reduceLive(reduceLive(initialLiveState(), { type: 'start' }), {
      type: 'started',
      now: 1,
    });
    const failed = reduceLive(started, {
      type: 'failed',
      error: 'connection_lost',
      detail: 'retention',
    });
    expect(failed).toMatchObject({ status: 'error', errorDetail: 'retention' });
    expect(reduceLive(failed, { type: 'stop' })).toMatchObject({ error: null, errorDetail: null });
  });
});
