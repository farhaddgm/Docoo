import {
  evaluationBlindReviewInputSchema,
  evaluationBlindReviewPackSchema,
  type EvaluationBlindReviewInput,
} from '@docoo/contracts';
import {
  compareReviewedEvaluation,
  EvaluationExecutionError,
  hashEvaluationSnapshotText,
  readEvaluationExperimentManifest,
  readEvaluationExecutionResult,
  type PairedEvaluationExecution,
} from './paired-evaluation-runner.js';

function itemId(manifestHash: string, runId: string, caseId: string) {
  return hashEvaluationSnapshotText(`docoo-blind-item-v1:${manifestHash}:${runId}:${caseId}`);
}

/** Reveals the common input/rubric and outputs, without run IDs, model IDs, timing or prices. */
export function createEvaluationBlindReviewPack(execution: PairedEvaluationExecution) {
  const manifest = readEvaluationExperimentManifest(execution.manifest);
  if (
    execution.status !== 'completed' ||
    execution.results.length !== manifest.dataset.cases.length * 2
  ) {
    throw new EvaluationExecutionError('EXECUTION_INCOMPLETE');
  }
  const results = execution.results.map((row) => readEvaluationExecutionResult(manifest, row));
  const pack = evaluationBlindReviewPackSchema.parse({
    experimentId: manifest.experimentId,
    experimentHash: manifest.contentHash,
    rubricHash: manifest.baseline.configuration.rubricHash,
    rubric: manifest.baseline.snapshots.rubric,
    cases: manifest.dataset.cases.map((testCase) => {
      const order =
        Number.parseInt(
          hashEvaluationSnapshotText(
            `docoo-blind-order-v1:${manifest.contentHash}:${testCase.id}`,
          ).slice(0, 2),
          16,
        ) % 2;
      const arms =
        order === 0
          ? [manifest.baseline, manifest.candidate]
          : [manifest.candidate, manifest.baseline];
      return {
        caseId: testCase.id,
        language: testCase.language,
        input: testCase.input,
        expectedInvariantIds: testCase.expectedInvariantIds,
        variants: arms.map((arm, index) => {
          const matches = results.filter(
            (row) => row.runId === arm.runId && row.caseId === testCase.id,
          );
          const result = matches[0];
          if (matches.length !== 1 || !result || result.status !== 'completed')
            throw new EvaluationExecutionError('EXECUTION_INCOMPLETE');
          return {
            itemId: itemId(manifest.contentHash, arm.runId, testCase.id),
            label: index === 0 ? 'A' : 'B',
            output: result.output,
            outputHash: result.outputHash,
          };
        }),
      };
    }),
  });
  if (
    new Set(pack.cases.flatMap((item) => item.variants.map((variant) => variant.itemId))).size !==
    results.length
  ) {
    throw new EvaluationExecutionError('EXECUTION_INCOMPLETE');
  }
  return pack;
}

/** Maps human labels to the original immutable outputs; a caller cannot submit judge scores. */
export function prepareEvaluationBlindReview(
  execution: PairedEvaluationExecution,
  actorId: string,
  input: EvaluationBlindReviewInput,
) {
  const review = evaluationBlindReviewInputSchema.parse(input);
  const pack = createEvaluationBlindReviewPack(execution);
  if (
    pack.experimentHash !== review.experimentHash ||
    pack.rubricHash !== review.rubricHash ||
    review.ratings.length !== execution.results.length
  )
    throw new EvaluationExecutionError('REVIEW_OUTPUT_MISMATCH');
  const byId = new Map(
    execution.results.map((row) => [itemId(pack.experimentHash, row.runId, row.caseId), row]),
  );
  const mapped = {
    experimentHash: review.experimentHash,
    rubricHash: review.rubricHash,
    reviewerId: actorId,
    reviewedAt: review.reviewedAt,
    ratings: review.ratings.map((rating) => {
      const result = byId.get(rating.itemId);
      if (!result || result.outputHash !== rating.outputHash)
        throw new EvaluationExecutionError('REVIEW_OUTPUT_MISMATCH');
      return {
        runId: result.runId,
        caseId: result.caseId,
        outputHash: result.outputHash,
        humanScore: rating.humanScore,
        humanAccepted: rating.humanAccepted,
        citationErrors: rating.citationErrors,
        judgeAccepted: null,
      };
    }),
  };
  compareReviewedEvaluation(execution, mapped);
  return mapped;
}
