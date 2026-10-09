import { expect, it } from 'vitest';
import {
  adaptiveResearchOptionsSchema,
  evidenceLinkInputSchema,
  intelligenceSearchSchema,
} from './decision-intelligence.js';
it('requires bounded unique research questions and explicit valid language policy', () => {
  const options = {
    questions: [{ id: 'a', text: 'customer churn', importance: 3 }],
    maxRounds: 10,
    maxClaimVisits: 40,
    targetCoverage: 80,
    perQuestionLimit: 5,
  };
  expect(adaptiveResearchOptionsSchema.safeParse(options).success).toBe(true);
  expect(adaptiveResearchOptionsSchema.safeParse({ ...options, maxRounds: 21 }).success).toBe(
    false,
  );
  expect(
    adaptiveResearchOptionsSchema.safeParse({
      ...options,
      questions: [...options.questions, ...options.questions],
    }).success,
  ).toBe(false);
  expect(
    intelligenceSearchSchema.safeParse({ query: 'churn', languages: ['en', 'en'] }).success,
  ).toBe(false);
});
it('requires the immutable document block and a human reason for a link', () => {
  const input = {
    targetType: 'document',
    targetVersionId: '11111111-1111-4111-8111-111111111111',
    blockIndex: 0,
    assertion: 'Customer churn',
    claimId: '22222222-2222-4222-8222-222222222222',
    relation: 'supports',
    applicabilityReviewed: false,
    reason: 'Reviewed applicability',
    idempotencyKey: 'link-123456',
  };
  expect(evidenceLinkInputSchema.safeParse(input).success).toBe(true);
  expect(evidenceLinkInputSchema.safeParse({ ...input, blockIndex: null }).success).toBe(false);
  expect(evidenceLinkInputSchema.safeParse({ ...input, targetType: 'solution' }).success).toBe(
    false,
  );
});
