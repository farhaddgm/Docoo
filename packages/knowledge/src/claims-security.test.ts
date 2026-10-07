import { it, expect } from 'vitest';
import { sentenceRanges, extractClaimCandidates } from './claims.js';
it('bounds hostile punctuation processing before the candidate-length filter', () => {
  const text = '!'.repeat(1_000_000) + 'x';
  expect(sentenceRanges(text)).toEqual([{ start: 0, end: text.length }]);
  expect(extractClaimCandidates([{ ordinal: 1, locator: { line: 1 }, text }])).toEqual([]);
}, 2000);
