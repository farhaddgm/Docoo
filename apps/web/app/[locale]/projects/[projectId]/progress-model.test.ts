import { describe, expect, it } from 'vitest';

import { summarizeProgress, type ProgressStep } from './progress-model';

const step = (kind: string, data: Record<string, unknown> = {}): ProgressStep => ({ kind, data });

describe('summarizeProgress', () => {
  it('has nothing to say before the first step', () => {
    expect(summarizeProgress([])).toBeNull();
  });

  it('reports the phase of the latest step and the counts of the latest round', () => {
    const summary = summarizeProgress([
      step('start', { maxRounds: 3, questions: 3 }),
      step('round', { side: 'primary', round: 1, searches: 2, pages: 5 }),
      step('gaps', { side: 'primary', round: 1, open: ['Q2'] }),
      step('round', { side: 'primary', round: 2, searches: 4, pages: 9 }),
    ]);
    expect(summary).toMatchObject({
      phase: 'searching',
      round: 2,
      maxRounds: 3,
      sides: { primary: { searches: 4, pages: 9 } },
      open: ['Q2'],
    });
  });

  it('follows the stage through checking, judging and writing', () => {
    const base = [step('start', {}), step('round', { round: 1, searches: 1, pages: 1 })];
    expect(summarizeProgress([...base, step('gaps', { open: [] })])!.phase).toBe('checking');
    expect(summarizeProgress([...base, step('judge')])!.phase).toBe('judging');
    expect(summarizeProgress([...base, step('writing')])!.phase).toBe('writing');
    expect(summarizeProgress([step('start', {})])!.phase).toBe('starting');
  });

  it('keeps the counts of each model apart, and calls a question open only while both have it open', () => {
    const summary = summarizeProgress([
      step('start', { maxRounds: 2 }),
      step('round', { side: 'primary', round: 1, searches: 2, pages: 4 }),
      step('round', { side: 'second', round: 1, searches: 3, pages: 6 }),
      step('gaps', { side: 'primary', open: ['Q1', 'Q2'] }),
      step('gaps', { side: 'second', open: ['Q2', 'Q3'] }),
    ])!;
    expect(summary.sides).toEqual({
      primary: { searches: 2, pages: 4 },
      second: { searches: 3, pages: 6 },
    });
    expect(summary.open).toEqual(['Q2']);
  });

  it('says nothing about open questions when the gap finder did not report, and survives odd data', () => {
    expect(
      summarizeProgress([step('round', { round: 1, searches: 1, pages: 2 })])!.open,
    ).toBeNull();
    const odd = summarizeProgress([
      step('start', { maxRounds: 'x' }),
      step('round', { round: 'one', searches: null, pages: {} }),
      step('gaps', { open: 'no' }),
    ])!;
    expect(odd).toMatchObject({ maxRounds: 1, round: 0, open: [] });
  });

  it('shows the reading phase while the key pages are being read', () => {
    const summary = summarizeProgress([
      step('round', { round: 1, searches: 2, pages: 4 }),
      step('reading', { pages: 4 }),
    ])!;
    expect(summary.phase).toBe('reading');
  });
});
