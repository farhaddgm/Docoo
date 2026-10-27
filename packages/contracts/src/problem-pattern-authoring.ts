import { z } from 'zod';
import { problemPatternDefinitionSchema } from './problem-pattern.js';

export const patternRevisionSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export const patternCreateSchema = z
  .object({
    definition: problemPatternDefinitionSchema,
    idempotencyKey: z.uuid(),
  })
  .strict();
export const patternDraftUpdateSchema = patternRevisionSchema
  .extend({ definition: problemPatternDefinitionSchema })
  .strict();
export const patternAiRequestSchema = patternRevisionSchema
  .extend({
    content: z.string().trim().min(1).max(4_000),
    providerConsent: z.literal(true),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const patternPublishSchema = patternRevisionSchema
  .extend({
    testRunId: z.uuid(),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const patternAiResponseSchema = z
  .object({
    answer: z.string().trim().min(1).max(12_000),
    definition: problemPatternDefinitionSchema.nullable(),
    preview: z
      .object({
        questions: z.array(z.string().min(1).max(2_000)).max(12),
        researchDecision: z.string().min(1).max(2_000),
        sampleOutput: z.string().min(1).max(12_000),
        limitations: z.array(z.string().min(1).max(2_000)).min(1).max(12),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type PatternAiResponse = z.infer<typeof patternAiResponseSchema>;
