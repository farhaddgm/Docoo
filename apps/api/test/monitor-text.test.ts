import { describe, expect, it } from 'vitest';

import { contentTitle, contentToText } from '../src/monitor/monitor-text.js';

describe('content as text', () => {
  it('keeps a string, writes numbers, and drops nothing but empty parts', () => {
    expect(contentToText('plain')).toBe('plain');
    expect(contentToText(7)).toBe('7');
    expect(contentToText(null)).toBe('');
    expect(contentToText({ a: 'x', b: '', c: null })).toBe('a: x');
  });

  it('turns lists into lines and nested objects into indented-free key lines', () => {
    expect(contentToText({ goals: ['one', 'two'], note: 'n' })).toBe(
      'goals:\n• one\n• two\nnote: n',
    );
    expect(contentToText([{ a: 1 }, 'x'])).toBe('• a: 1\n• x');
  });

  it('stops at a deep nesting and at a long text', () => {
    let deep: unknown = 'bottom';
    for (let i = 0; i < 10; i += 1) deep = { k: deep };
    expect(contentToText(deep)).toBe('');
    expect(contentToText('x'.repeat(30_000)).length).toBe(30_000);
    expect(contentToText(['y'.repeat(30_000)]).length).toBeLessThanOrEqual(20_000);
  });

  it('finds a headline in the usual fields only', () => {
    expect(contentTitle({ problemStatement: ' The problem ' })).toBe('The problem');
    expect(contentTitle({ other: 'x' })).toBeNull();
    expect(contentTitle('text')).toBeNull();
    expect(contentTitle([1])).toBeNull();
  });
});
