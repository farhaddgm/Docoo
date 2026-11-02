import { describe, expect, it } from 'vitest';

import {
  mergeWebRuns,
  normalizeWebPolicy,
  webRunFrom,
  webSearchPrompt,
  webStopReason,
  type WebSearchPolicy,
} from './web-research.js';

const policy = (over: Partial<WebSearchPolicy> = {}): WebSearchPolicy => ({
  minSearches: 2,
  maxSearches: 8,
  minRounds: 2,
  maxRounds: 4,
  targetSources: 10,
  ...over,
});
const state = (over: Partial<Parameters<typeof webStopReason>[1]> = {}) => ({
  rounds: 1,
  searches: 1,
  sources: 0,
  newSources: 0,
  ...over,
});

describe('webStopReason', () => {
  it('keeps going below the minimum searches or rounds, even at the target', () => {
    expect(webStopReason(policy(), state({ rounds: 1, searches: 5, sources: 20 }))).toBeNull();
    expect(webStopReason(policy(), state({ rounds: 3, searches: 1, sources: 20 }))).toBeNull();
  });

  it('stops at the target once the minima are met', () => {
    expect(
      webStopReason(policy(), state({ rounds: 2, searches: 3, sources: 10, newSources: 4 })),
    ).toBe('target_reached');
  });

  it('stops when a round finds nothing new once the minima are met', () => {
    expect(webStopReason(policy(), state({ rounds: 2, searches: 3, sources: 4 }))).toBe(
      'no_new_findings',
    );
    expect(
      webStopReason(policy(), state({ rounds: 2, searches: 3, sources: 4, newSources: 2 })),
    ).toBeNull();
  });

  it('lets the maxima win over the minima', () => {
    expect(webStopReason(policy({ minSearches: 20 }), state({ searches: 8, newSources: 3 }))).toBe(
      'max_searches',
    );
    expect(
      webStopReason(policy({ minRounds: 9 }), state({ rounds: 4, searches: 4, newSources: 3 })),
    ).toBe('max_rounds');
  });

  it('never stops early on a target of 0', () => {
    expect(
      webStopReason(
        policy({ targetSources: 0 }),
        state({ rounds: 2, searches: 3, sources: 99, newSources: 5 }),
      ),
    ).toBeNull();
  });
});

describe('normalizeWebPolicy', () => {
  it('clamps each minimum to its maximum', () => {
    expect(
      normalizeWebPolicy({
        minSearches: 9,
        maxSearches: 3,
        minRounds: 5,
        maxRounds: 2,
        targetSources: -1,
      }),
    ).toEqual({ minSearches: 3, maxSearches: 3, minRounds: 2, maxRounds: 2, targetSources: 0 });
  });
});

describe('webRunFrom limit and mergeWebRuns', () => {
  const pages = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      url: `https://example.test/${from + i}`,
      title: `t${from + i}`,
      text: 'x',
    }));

  it('keeps more than 12 pages when the administrator asks', () => {
    expect(webRunFrom({ queries: ['q'], sources: pages(0, 40) }, 0, [], 30).sources).toHaveLength(
      30,
    );
  });

  it('merges rounds: pages once per address, refs renumbered, capped', () => {
    const one = webRunFrom({ queries: ['a'], sources: pages(0, 3) });
    const two = webRunFrom({ queries: ['b'], sources: pages(2, 3) }, 3);
    const merged = mergeWebRuns([one, two], 4, { rounds: 2, stop: 'max_rounds' });
    expect(merged.sources.map((s) => s.ref)).toEqual(['W1', 'W2', 'W3', 'W4']);
    expect(merged.sources.map((s) => s.url)).toEqual(
      [0, 1, 2, 3].map((i) => `https://example.test/${i}`),
    );
    expect(merged).toMatchObject({
      status: 'used',
      queries: ['a', 'b'],
      rounds: 2,
      stop: 'max_rounds',
    });
  });
});

describe('webSearchPrompt in a later round', () => {
  it('lists what earlier rounds used and asks for something new', () => {
    const prompt = webSearchPrompt({
      language: 'en',
      projectTitle: 'p',
      problem: 'q',
      topics: [],
      analysis: null,
      earlier: { queries: ['old query'], urls: ['https://old.test/'] },
    });
    expect(prompt.instructions).toContain('Do not repeat them');
    expect(prompt.message).toContain('old query');
    expect(prompt.message).toContain('https://old.test/');
  });
});
