import { expect, it } from 'vitest';
import { evaluationBlindReviewInputSchema } from './evaluation-lab.js';

const input = {
  experimentHash: 'a'.repeat(64),
  rubricHash: 'b'.repeat(64),
  reviewedAt: '2026-10-16T12:00:00Z',
  ratings: ['a', 'b', 'c', 'd'].map((id) => ({
    itemId: id.repeat(64),
    outputHash: 'e'.repeat(64),
    humanScore: 80,
    humanAccepted: null,
    citationErrors: 0,
  })),
};
it('requires complete human labels and rejects spoofed scope, reviewer, cost and judge fields', () => {
  expect(evaluationBlindReviewInputSchema.safeParse(input).success).toBe(true);
  for (const extra of [
    { reviewerId: 'spoofed' },
    { workspaceId: 'foreign' },
    { apiKey: 'secret' },
  ]) {
    expect(evaluationBlindReviewInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  }
  for (const extra of [
    { costUsd: 0 },
    { judgeAccepted: true },
    { humanScore: null },
    { humanScore: 101 },
    { citationErrors: 0.5 },
  ]) {
    expect(
      evaluationBlindReviewInputSchema.safeParse({
        ...input,
        ratings: input.ratings.map((row) => ({ ...row, ...extra })),
      }).success,
    ).toBe(false);
  }
  expect(
    evaluationBlindReviewInputSchema.safeParse({
      ...input,
      ratings: input.ratings.map(() => input.ratings[0]),
    }).success,
  ).toBe(false);
});
