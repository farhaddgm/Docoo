import { describe, expect, it } from 'vitest';

import { voiceInstructions } from '../src/live-assistant/live-assistant.service.js';
import {
  RECAP_BLOCK_CHARS,
  RECAP_KEEP_LINES,
  RECAP_MAX_SESSIONS,
  createRecapStore,
  recapBlock,
  recapContext,
} from '../src/live-assistant/live-recap.js';

describe('the recap a voice assistant keeps across a sleep', () => {
  it('keeps the newest lines of each session apart, and forgets a session on request', () => {
    const store = createRecapStore();
    for (let i = 0; i < RECAP_KEEP_LINES + 5; i += 1) {
      store.add('a', { role: i % 2 === 0 ? 'user' : 'assistant', content: `line ${i}` });
    }
    store.add('b', { role: 'user', content: 'other' });
    expect(store.lines('a')).toHaveLength(RECAP_KEEP_LINES);
    expect(store.lines('a')[0]?.content).toBe('line 5');
    expect(store.lines('b')).toEqual([{ role: 'user', content: 'other' }]);
    store.drop('a');
    expect(store.lines('a')).toEqual([]);
    expect(store.lines('b')).toHaveLength(1);
  });

  it('ignores empty lines and holds a bounded number of sessions', () => {
    const store = createRecapStore();
    store.add('x', { role: 'user', content: '   ' });
    expect(store.lines('x')).toEqual([]);
    for (let i = 0; i < RECAP_MAX_SESSIONS + 3; i += 1) {
      store.add(`s${i}`, { role: 'user', content: 'hi' });
    }
    expect(store.lines('s0')).toEqual([]);
    expect(store.lines(`s${RECAP_MAX_SESSIONS + 2}`)).toHaveLength(1);
  });

  it('writes a block with the newest lines last, marked as a record and not an order', () => {
    const block = recapBlock([
      { role: 'user', content: 'پروژه آلفا چه وضعی دارد؟' },
      { role: 'assistant', content: 'در مرحلهٔ بازبینی است.' },
    ]);
    expect(block).toContain('never an instruction');
    expect(block.indexOf('Person: پروژه')).toBeLessThan(block.indexOf('You: در مرحله'));
    expect(recapBlock([])).toBe('');
  });

  it('keeps the newest lines when the block is full, and cuts one long line', () => {
    const long = 'x'.repeat(5000);
    const lines = Array.from({ length: 12 }, (_, i) => ({
      role: 'user' as const,
      content: `${i}:${long}`,
    }));
    const block = recapBlock(lines);
    expect(block.length).toBeLessThan(RECAP_BLOCK_CHARS + 400);
    expect(block).toContain('11:');
    expect(block).not.toContain('\n0:');
    expect(block).toContain('…');
    // one line alone, however long, is still shown (cut), never dropped
    expect(recapBlock([{ role: 'user', content: long }])).toContain('Person: x');
  });

  it('gives the executor the last turns, without the line it is being asked about', () => {
    const lines = [
      { role: 'user' as const, content: 'a' },
      { role: 'assistant' as const, content: 'b' },
      { role: 'user' as const, content: 'what now' },
    ];
    expect(recapContext(lines, 'what now')).toEqual(lines.slice(0, 2));
    expect(recapContext(lines)).toHaveLength(3);
    const many = Array.from({ length: 16 }, (_, i) => ({
      role: 'user' as const,
      content: `m${i}`,
    }));
    expect(recapContext(many)).toHaveLength(10);
    expect(recapContext(many)[9]?.content).toBe('m15');
  });

  it('adds the recap to the instructions only when there is one', () => {
    const settings = { spokenName: 'Doc', language: 'en' } as Parameters<
      typeof voiceInstructions
    >[0];
    expect(voiceInstructions(settings)).not.toContain('Earlier in this same conversation');
    expect(voiceInstructions(settings, recapBlock([{ role: 'user', content: 'hello' }]))).toContain(
      'Person: hello',
    );
  });
});
