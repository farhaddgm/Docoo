import { expect, it } from 'vitest';
import {
  evaluationBlindReviewInputSchema,
  evaluationExperimentSummarySchema,
} from './evaluation-lab.js';

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
it('represents an interrupted execution without labelling unknown work completed', () => {
  const summary = {
    id: 'interrupted-run',
    status: 'interrupted',
    createdAt: '2026-10-16T12:00:00Z',
    datasetId: 'synthetic-corpus',
    datasetVersion: 1,
    synthetic: true,
    caseCount: 30,
    resultCount: 1,
    reviewCount: 0,
    role: 'researcher',
  };
  expect(evaluationExperimentSummarySchema.parse(summary).status).toBe('interrupted');
  expect(
    evaluationExperimentSummarySchema.safeParse({ ...summary, status: 'assumed-success' }).success,
  ).toBe(false);
});
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
