import { z } from 'zod';
import { evaluationExperimentIdSchema } from './evaluation-lab.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const provider = z.enum(['openai', 'gemini', 'anthropic', 'deterministic']);

/** Written before a provider can be called. No credentials or request text belong here. */
export const evaluationInvocationIntentSchema = z
  .object({
    experimentId: evaluationExperimentIdSchema,
    experimentHash: hash,
    runId: evaluationExperimentIdSchema,
    caseId: evaluationExperimentIdSchema,
    modelSnapshotHash: hash,
    requestHash: hash,
  })
  .strict();

const agentResponse = z
  .object({
    provider,
    modelId: z.string().min(1).max(200),
    output: z.string().min(1).max(100_000),
    inputTokens: z.number().int().min(0).max(1_000_000_000).nullable(),
    outputTokens: z.number().int().min(0).max(1_000_000_000).nullable(),
    // ProviderRuntime returns estimated prices, not a measured invoice.
    costUsd: z.null(),
  })
  .strict();

/** Kept independently of the case result so a crash between those commits is recoverable. */
export const evaluationInvocationReceiptSchema = z
  .object({
    invocationId: z.uuid(),
    observedProvider: provider,
    observedModelId: z.string().min(1).max(200),
    outputHash: hash,
    response: agentResponse.nullable(),
    errorCode: z.enum(['snapshot_mismatch', 'invalid_response']).nullable(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if ((receipt.response === null) !== (receipt.errorCode !== null))
      context.addIssue({ code: 'custom', message: 'A receipt has a response or a safe error.' });
    if (
      receipt.response &&
      (receipt.response.provider !== receipt.observedProvider ||
        receipt.response.modelId !== receipt.observedModelId)
    )
      context.addIssue({ code: 'custom', message: 'Observed model and response must agree.' });
  });

export type EvaluationInvocationIntent = z.infer<typeof evaluationInvocationIntentSchema>;
export type EvaluationInvocationReceipt = z.infer<typeof evaluationInvocationReceiptSchema>;
