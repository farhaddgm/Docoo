import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { researchConflicts, trustedPageUrls } from './research-conflicts.js';

const clientOf = (rows: unknown[]) =>
  ({ query: () => Promise.resolve({ rows }) }) as unknown as PoolClient;

describe('trustedPageUrls (ADR-0050)', () => {
  it('maps each trusted ref to its page address in the output it was decided on', async () => {
    const sources = [
      { ref: 'W1', url: 'https://a.test/1' },
      { ref: 'W2', url: 'https://b.test/2' },
    ];
    const urls = await trustedPageUrls(
      clientOf([
        { trustedRef: 'W2', sources },
        { trustedRef: 'W1', sources },
      ]),
    );
    expect(urls).toEqual(['https://b.test/2', 'https://a.test/1']);
  });

  it('skips a ref the output no longer lists, a page with no address and a missing source list', async () => {
    const urls = await trustedPageUrls(
      clientOf([
        { trustedRef: 'W9', sources: [{ ref: 'W1', url: 'https://a.test/1' }] },
        { trustedRef: 'W1', sources: [{ ref: 'W1', url: '' }] },
        { trustedRef: 'W1', sources: null },
      ]),
    );
    expect(urls).toEqual([]);
  });
});

describe('researchConflicts with learned domains (ADR-0050)', () => {
  const content = {
    web: {
      sources: [
        { ref: 'W1', url: 'https://liked.test/a', title: 'A', sourceClass: 'public' },
        { ref: 'W2', url: 'https://other.test/b', title: 'B', sourceClass: 'public' },
        { ref: 'W3', url: 'https://liked.test/c', title: 'C', sourceClass: 'official' },
      ],
    },
    conflicts: [
      { description: 'figures differ', refs: ['W1', 'W2'] },
      { description: 'official vs learned', refs: ['W3', 'W2'] },
    ],
  };

  it('marks pages of a learned domain and lets the advisor prefer them', () => {
    const [first] = researchConflicts(content, new Set(['liked.test']));
    expect(first!.sources.find((source) => source.ref === 'W1')).toMatchObject({ learned: true });
    expect(first!.sources.find((source) => source.ref === 'W2')!.learned).toBeUndefined();
    expect(first!.advice).toEqual({ trustedRef: 'W1', reason: 'learned' });
  });

  it('gives no learned advice without learned domains, and never marks an official page learned', () => {
    const [first, second] = researchConflicts(content);
    expect(first!.advice).toBeNull();
    const withLearned = researchConflicts(content, new Set(['liked.test']));
    expect(withLearned[1]!.sources.find((source) => source.ref === 'W3')!.learned).toBeUndefined();
    expect(second!.advice).toEqual({ trustedRef: 'W3', reason: 'official' });
  });
});
