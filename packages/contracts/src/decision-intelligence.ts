import { z } from 'zod';

export const adaptiveResearchOptionsSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/u),
            text: z.string().trim().min(2).max(500),
            importance: z.number().int().min(1).max(5),
          })
          .strict(),
      )
      .min(1)
      .max(20)
      .refine((questions) => new Set(questions.map((q) => q.id)).size === questions.length),
    maxRounds: z.number().int().min(1).max(20),
    maxClaimVisits: z.number().int().min(1).max(400),
    targetCoverage: z.number().int().min(1).max(100),
    perQuestionLimit: z.number().int().min(1).max(20),
  })
  .strict();

export const intelligenceSearchSchema = z
  .object({
    query: z.string().trim().min(2).max(500),
    mode: z.enum(['hybrid', 'lexical']).default('hybrid'),
    languages: z
      .array(z.enum(['fa', 'en']))
      .min(1)
      .max(2)
      .default(['fa', 'en'])
      .refine((values) => new Set(values).size === values.length),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export const evidenceLinkInputSchema = z
  .object({
    targetType: z.enum(['solution', 'document']),
    targetVersionId: z.uuid(),
    blockIndex: z.number().int().min(0).max(10000).nullable(),
    assertion: z.string().trim().min(2).max(2000),
    claimId: z.uuid(),
    relation: z.enum(['supports', 'opposes', 'context']),
    applicabilityReviewed: z.boolean(),
    reason: z.string().trim().min(3).max(1000),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/u),
  })
  .strict()
  .refine(
    (input) =>
      input.targetType === 'solution' ? input.blockIndex === null : input.blockIndex !== null,
    { message: 'Document links require a block; solution links cannot refer to one.' },
  );

export const conflictSuggestionReviewSchema = z
  .object({
    claimAId: z.uuid(),
    claimBId: z.uuid(),
    expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    decision: z.enum(['confirmed', 'dismissed', 'conditioned']),
    applicabilityCondition: z.string().trim().min(3).max(2000).nullable(),
    reason: z.string().trim().min(3).max(1000),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/u),
  })
  .strict()
  .refine((input) => input.claimAId !== input.claimBId)
  .refine((input) => input.decision !== 'conditioned' || input.applicabilityCondition !== null);

export const intelligenceClaimSchema = z
  .object({
    id: z.uuid(),
    text: z.string(),
    language: z.enum(['fa', 'en']),
    knowledgeVersionId: z.uuid(),
    sourceVersionId: z.uuid(),
    title: z.string(),
    quote: z.string(),
    quoteHash: z.string().regex(/^[0-9a-f]{64}$/u),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    auditScore: z.number().min(0).max(100),
    evidenceAdequacy: z.number().min(0).max(100),
    freshness: z.number().min(0).max(100),
    publishedAt: z.string().nullable(),
    finalUrl: z.string().nullable(),
    confidentiality: z.enum(['public', 'internal', 'restricted']),
  })
  .strict();

export const evidenceAssessmentSchema = z
  .object({
    status: z.enum(['insufficient', 'conflicted', 'supported_with_limits']),
    coverage: z.number().min(0).max(100),
    supportingClaimIds: z.array(z.uuid()),
    opposingClaimIds: z.array(z.uuid()),
    sourceCount: z.number().int().nonnegative(),
    independence: z.literal('unknown'),
    freshness: z.enum(['unknown', 'reviewed']),
    applicability: z.enum(['unknown', 'reviewed']),
    reasons: z.array(z.string()),
    probabilityOfTruth: z.null(),
  })
  .strict();

export const intelligenceSearchResultSchema = z
  .object({
    model: z.string(),
    candidateCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    items: z.array(
      z
        .object({
          claim: intelligenceClaimSchema,
          score: z.number().finite(),
          lexicalScore: z.number().finite(),
          semanticScore: z.number().finite(),
          matchedTerms: z.array(z.string()),
          matchedConcepts: z.array(z.number().int()),
        })
        .strict(),
    ),
    embeddingStatus: z.enum(['local', 'provider', 'not_permitted']),
    fallbackReason: z.literal('provider_unavailable').optional(),
  })
  .strict();

export type EvidenceLinkInput = z.infer<typeof evidenceLinkInputSchema>;
export type ConflictSuggestionReviewInput = z.infer<typeof conflictSuggestionReviewSchema>;
export type IntelligenceSearchInput = z.infer<typeof intelligenceSearchSchema>;
export type IntelligenceSearchResult = z.infer<typeof intelligenceSearchResultSchema>;
