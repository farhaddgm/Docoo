import { z } from 'zod';

export const evaluationExperimentIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const evaluationReviewCommandKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/);
const count = z.number().int().nonnegative();
const nonnegative = z.number().finite().nonnegative();
const score = z.number().finite().min(0).max(100);

export const evaluationExperimentSummarySchema = z
  .object({
    id: evaluationExperimentIdSchema,
    status: z.enum(['running', 'completed', 'failed', 'cancelled']),
    createdAt: z.iso.datetime(),
    datasetId: evaluationExperimentIdSchema,
    datasetVersion: z.number().int().positive(),
    synthetic: z.literal(true),
    caseCount: z.number().int().min(2).max(500),
    resultCount: count.max(1000),
    reviewCount: count,
    role: z.enum(['analyst', 'researcher', 'ideator', 'documenter', 'evaluator']),
  })
  .strict();

export const evaluationExperimentPageSchema = z
  .object({
    items: z.array(evaluationExperimentSummarySchema).max(50),
    nextCursor: z.string().max(1024).nullable(),
  })
  .strict();

const blindOutput = z
  .object({
    itemId: hash,
    label: z.enum(['A', 'B']),
    output: z.string().min(1).max(100_000),
    outputHash: hash,
  })
  .strict();

export const evaluationBlindReviewPackSchema = z
  .object({
    experimentId: evaluationExperimentIdSchema,
    experimentHash: hash,
    rubricHash: hash,
    rubric: z.string().min(1).max(1_000_000),
    cases: z
      .array(
        z
          .object({
            caseId: evaluationExperimentIdSchema,
            language: z.enum(['fa', 'en']),
            input: z.string().min(1).max(10_000),
            expectedInvariantIds: z.array(evaluationExperimentIdSchema).min(1).max(50),
            variants: z
              .tuple([blindOutput, blindOutput])
              .refine(([a, b]) => a.label === 'A' && b.label === 'B' && a.itemId !== b.itemId),
          })
          .strict(),
      )
      .min(2)
      .max(500),
  })
  .strict()
  .refine((pack) => new Set(pack.cases.map((item) => item.caseId)).size === pack.cases.length);

export const evaluationBlindReviewInputSchema = z
  .object({
    experimentHash: hash,
    rubricHash: hash,
    /** Retained by the client on retry; authoritative receipt time is recorded by PostgreSQL. */
    reviewedAt: z.iso.datetime(),
    ratings: z
      .array(
        z
          .object({
            itemId: hash,
            outputHash: hash,
            humanScore: score,
            humanAccepted: z.boolean().nullable(),
            citationErrors: count,
          })
          .strict(),
      )
      .min(4)
      .max(1000),
  })
  .strict()
  .refine(
    (input) => new Set(input.ratings.map((rating) => rating.itemId)).size === input.ratings.length,
  );

const config = z
  .object({
    role: z.enum(['analyst', 'researcher', 'ideator', 'documenter', 'evaluator']),
    provider: z.enum(['openai', 'gemini', 'anthropic', 'deterministic']),
    modelId: z.string().min(1).max(200),
    modelSnapshotHash: hash,
    promptHash: hash,
    retrievalHash: hash,
    rubricHash: hash,
    pricingSnapshotHash: hash.nullable(),
  })
  .strict();
const latency = z
  .object({
    measuredCaseCount: count,
    meanMs: nonnegative.nullable(),
    p50Ms: nonnegative.nullable(),
    p95Ms: nonnegative.nullable(),
  })
  .strict();
const cost = z
  .object({
    measuredCaseCount: count,
    missingCaseCount: count,
    knownCostUsd: nonnegative.nullable(),
    completeCostUsd: nonnegative.nullable(),
  })
  .strict();
const agreement = z
  .object({
    reviewedCaseCount: count,
    matchingCaseCount: count,
    agreementRate: z.number().min(0).max(1).nullable(),
  })
  .strict();
const metrics = z
  .object({
    caseCount: count,
    baselineMeanHumanScore: score,
    candidateMeanHumanScore: score,
    meanHumanScoreDelta: z.number().finite().min(-100).max(100),
    regressedCaseCount: count,
    improvedCaseCount: count,
    unchangedCaseCount: count,
    regressionRate: z.number().min(0).max(1),
    baselineCitationErrors: count,
    candidateCitationErrors: count,
    citationErrorDelta: z.number().int(),
    baselineLatency: latency,
    candidateLatency: latency,
    cost: z
      .object({
        baseline: cost,
        candidate: cost,
        candidateMinusBaselineUsd: z.number().finite().nullable(),
      })
      .strict(),
    judgeHumanAgreement: z.object({ baseline: agreement, candidate: agreement }).strict(),
  })
  .strict();

export const pairedEvaluationComparisonSchema = z
  .object({
    format: z.literal('docoo-paired-evaluation-v1'),
    dataset: z
      .object({
        id: evaluationExperimentIdSchema,
        version: z.number().int().positive(),
        contentHash: hash,
      })
      .strict(),
    baseline: z.object({ id: evaluationExperimentIdSchema, configuration: config }).strict(),
    candidate: z.object({ id: evaluationExperimentIdSchema, configuration: config }).strict(),
    metrics: z.object({ fa: metrics, en: metrics, all: metrics }).strict(),
    cases: z
      .array(
        z
          .object({
            caseId: evaluationExperimentIdSchema,
            language: z.enum(['fa', 'en']),
            baselineHumanScore: score,
            candidateHumanScore: score,
            humanScoreDelta: z.number().finite(),
            baselineCitationErrors: count,
            candidateCitationErrors: count,
            citationErrorDelta: z.number().int(),
            regressed: z.boolean(),
            improved: z.boolean(),
          })
          .strict(),
      )
      .max(500),
    decision: z.null(),
  })
  .strict();

export const evaluationSavedComparisonSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    reviewerId: z.uuid(),
    comparison: pairedEvaluationComparisonSchema,
  })
  .strict();
export const evaluationComparisonPageSchema = z
  .object({ items: z.array(evaluationSavedComparisonSchema).max(20) })
  .strict();

export type EvaluationExperimentSummary = z.infer<typeof evaluationExperimentSummarySchema>;
export type EvaluationBlindReviewPack = z.infer<typeof evaluationBlindReviewPackSchema>;
export type EvaluationBlindReviewInput = z.infer<typeof evaluationBlindReviewInputSchema>;
export type EvaluationSavedComparison = z.infer<typeof evaluationSavedComparisonSchema>;
