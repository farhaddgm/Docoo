import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluationCorpusV1, hashEvaluationDataset } from '@docoo/domain/evaluation';
import {
  createEvaluationBlindReviewPack,
  prepareEvaluationBlindReview,
} from './paired-evaluation-review.js';
import {
  compareReviewedEvaluation,
  executePairedEvaluation,
  hashEvaluationSnapshotText,
  prepareEvaluationExperiment,
  recoverEvaluationCaseResult,
  type EvaluationAgentAdapter,
  type EvaluationExecutionArm,
  type EvaluationExecutionStore,
  type EvaluationExperimentInput,
  type PairedEvaluationExecution,
} from './paired-evaluation-runner.js';

it('reconstructs a paid receipt with the same request binding and rejects inconsistent recovery', () => {
  const manifest = prepareEvaluationExperiment({
    experimentId: 'recovery-test',
    repetition: 1,
    timeoutMs: 1000,
    dataset: evaluationCorpusV1,
    baseline: arm('baseline-recover', 'Baseline prompt.'),
    candidate: arm('candidate-recover', 'Candidate prompt.'),
  });
  const input = {
    runId: manifest.baseline.runId,
    caseId: manifest.dataset.cases[0]!.id,
    response: {
      provider: manifest.baseline.configuration.provider,
      modelId: manifest.baseline.configuration.modelId,
      output: 'Saved paid output',
      inputTokens: 10,
      outputTokens: 4,
      costUsd: null,
    },
    latencyMs: 7,
    errorCode: null,
  };
  const result = recoverEvaluationCaseResult(manifest, input);
  expect(result.status).toBe('completed');
  expect(result.output).toBe('Saved paid output');
  expect(result.latencyMs).toBe(7);
  expect(recoverEvaluationCaseResult(manifest, input)).toEqual(result);
  expect(() => recoverEvaluationCaseResult(manifest, { ...input, latencyMs: -1 })).toThrow();
  expect(() =>
    recoverEvaluationCaseResult(manifest, { ...input, caseId: 'unknown-case' }),
  ).toThrow();
  expect(() => recoverEvaluationCaseResult(manifest, { ...input, response: null })).toThrow();
  expect(
    recoverEvaluationCaseResult(manifest, {
      ...input,
      response: null,
      errorCode: 'invalid_response',
    }).status,
  ).toBe('failed');
});

function arm(runId: string, prompt: string): EvaluationExecutionArm {
  const snapshots = {
    model: JSON.stringify({ provider: 'deterministic', modelId: 'offline-fixture-v1', seed: 17 }),
    prompt,
    retrieval: JSON.stringify({ evidence: [], scope: 'synthetic_corpus_only' }),
    rubric: JSON.stringify({ id: 'evidence-v1', humanScale: [0, 100] }),
    pricing: null,
  };
  return {
    runId,
    snapshots,
    configuration: {
      role: 'researcher',
      provider: 'deterministic',
      modelId: 'offline-fixture-v1',
      modelSnapshotHash: hashEvaluationSnapshotText(snapshots.model),
      promptHash: hashEvaluationSnapshotText(snapshots.prompt),
      retrievalHash: hashEvaluationSnapshotText(snapshots.retrieval),
      rubricHash: hashEvaluationSnapshotText(snapshots.rubric),
      pricingSnapshotHash: null,
    },
  };
}

function request(): EvaluationExperimentInput {
  return {
    experimentId: 'experiment-01',
    repetition: 1,
    timeoutMs: 10_000,
    dataset: structuredClone(evaluationCorpusV1),
    baseline: arm('baseline-01', 'Compare supplied evidence and cite exact sources.'),
    candidate: arm(
      'candidate-01',
      'Compare evidence, identify reprints and list unanswered questions.',
    ),
  };
}

function setup() {
  const events: string[] = [];
  const create = vi.fn<EvaluationExecutionStore['create']>(() => {
    events.push('create');
    return Promise.resolve();
  });
  const append = vi.fn<EvaluationExecutionStore['append']>((row) => {
    events.push(`save:${row.runId}:${row.caseId}`);
    return Promise.resolve();
  });
  const finish = vi.fn<EvaluationExecutionStore['finish']>((_id, status) => {
    events.push(`finish:${status}`);
    return Promise.resolve();
  });
  const execute = vi.fn<EvaluationAgentAdapter['execute']>(({ arm, testCase }) => {
    events.push(`invoke:${arm.runId}:${testCase.id}`);
    return Promise.resolve({
      provider: arm.configuration.provider,
      modelId: arm.configuration.modelId,
      output: `Offline fixture output for ${arm.runId} / ${testCase.id}`,
      inputTokens: 12,
      outputTokens: 8,
      costUsd: null,
    });
  });
  let tick = 0;
  const controller = new AbortController();
  return {
    events,
    execute,
    create,
    append,
    finish,
    controller,
    dependencies: {
      adapter: { execute },
      store: { create, append, finish },
      signal: controller.signal,
      monotonicNow: () => {
        tick += 10;
        return tick;
      },
    },
  };
}

/** Test labels exercise aggregation; they are never published as empirical human reviews. */
function review(execution: PairedEvaluationExecution) {
  return {
    experimentHash: execution.manifest.contentHash,
    rubricHash: execution.manifest.baseline.configuration.rubricHash,
    reviewerId: 'synthetic-test-reviewer',
    reviewedAt: '2026-10-16T12:00:00.000Z',
    ratings: execution.results.map((result) => ({
      runId: result.runId,
      caseId: result.caseId,
      outputHash: result.outputHash,
      humanScore: result.runId === 'baseline-01' ? 80 : result.caseId === 'COST-FA-01' ? 60 : 90,
      humanAccepted: true,
      judgeAccepted: null,
      citationErrors: 0,
    })),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('pinned paired agent execution', () => {
  it('builds reproducible blinded review packs without exposing model/configuration metadata', async () => {
    const execution = await executePairedEvaluation(request(), setup().dependencies);
    const pack = createEvaluationBlindReviewPack(execution);
    expect(pack.cases).toHaveLength(30);
    expect(pack).toEqual(
      createEvaluationBlindReviewPack({ ...execution, results: [...execution.results].reverse() }),
    );
    expect(JSON.stringify(pack)).not.toContain('offline-fixture-v1');
    expect(pack.cases[0]?.variants.map((item) => Object.keys(item).sort())).toEqual([
      ['itemId', 'label', 'output', 'outputHash'],
      ['itemId', 'label', 'output', 'outputHash'],
    ]);
    expect(
      new Set(pack.cases.flatMap((item) => item.variants.map((variant) => variant.itemId))).size,
    ).toBe(60);
    expect(pack.cases[0]?.input).toBe(execution.manifest.dataset.cases[0]?.input);
    expect(() => createEvaluationBlindReviewPack({ ...execution, status: 'failed' })).toThrow(
      'EXECUTION_INCOMPLETE',
    );
  });

  it('binds blinded human ratings to the authenticated reviewer and exact output, excluding judge inputs', async () => {
    const execution = await executePairedEvaluation(request(), setup().dependencies);
    const pack = createEvaluationBlindReviewPack(execution);
    const input = {
      experimentHash: pack.experimentHash,
      rubricHash: pack.rubricHash,
      reviewedAt: '2026-10-16T12:00:00Z',
      ratings: pack.cases.flatMap((item) =>
        item.variants.map((variant) => ({
          itemId: variant.itemId,
          outputHash: variant.outputHash,
          humanScore: 75,
          humanAccepted: true,
          citationErrors: 0,
        })),
      ),
    };
    const mapped = prepareEvaluationBlindReview(execution, 'authenticated-reviewer', input);
    expect(mapped.reviewerId).toBe('authenticated-reviewer');
    expect(mapped.ratings.every((rating) => rating.judgeAccepted === null)).toBe(true);
    expect(compareReviewedEvaluation(execution, mapped).comparison.metrics.all.caseCount).toBe(30);
    expect(() =>
      prepareEvaluationBlindReview(execution, 'reviewer', {
        ...input,
        ratings: input.ratings.map((rating, index) =>
          index ? rating : { ...rating, outputHash: 'f'.repeat(64) },
        ),
      }),
    ).toThrow('REVIEW_OUTPUT_MISMATCH');
    expect(() =>
      prepareEvaluationBlindReview(execution, 'reviewer', {
        ...input,
        ratings: input.ratings.slice(1),
      }),
    ).toThrow('REVIEW_OUTPUT_MISMATCH');
    expect(() =>
      prepareEvaluationBlindReview(execution, 'reviewer', {
        ...input,
        ratings: input.ratings.map((rating) => ({ ...rating, judgeAccepted: true })),
      }),
    ).toThrow();
  });
  it('executes all 60 requests, alternating order, persisting each result before the next call', async () => {
    const s = setup();
    const execution = await executePairedEvaluation(request(), s.dependencies);
    expect(execution.status).toBe('completed');
    expect(execution.results).toHaveLength(60);
    expect(s.execute).toHaveBeenCalledTimes(60);
    expect(s.events.slice(0, 9)).toEqual([
      'create',
      'invoke:baseline-01:COST-FA-01',
      'save:baseline-01:COST-FA-01',
      'invoke:candidate-01:COST-FA-01',
      'save:candidate-01:COST-FA-01',
      'invoke:candidate-01:COST-EN-02',
      'save:candidate-01:COST-EN-02',
      'invoke:baseline-01:COST-EN-02',
      'save:baseline-01:COST-EN-02',
    ]);
    expect(s.finish).toHaveBeenCalledWith('experiment-01', 'completed');
    expect(execution.results[0]).toMatchObject({ latencyMs: 10, costUsd: null, errorCode: null });
    expect(execution.results[0]).not.toHaveProperty('humanScore');
    expect(execution.manifest).toMatchObject({
      repetition: 1,
      executionOrder: 'alternating_by_case',
    });
  });

  it('rejects a changed dataset, unbound snapshots, identical arms or different rubrics before storage and spending', async () => {
    const s = setup();
    const input = request();
    await expect(
      executePairedEvaluation(
        { ...input, dataset: { ...input.dataset, contentHash: 'a'.repeat(64) } },
        s.dependencies,
      ),
    ).rejects.toThrow('DATASET_HASH_MISMATCH');
    await expect(
      executePairedEvaluation(
        {
          ...input,
          candidate: {
            ...input.candidate,
            snapshots: { ...input.candidate.snapshots, prompt: 'modified outside the snapshot' },
          },
        },
        s.dependencies,
      ),
    ).rejects.toThrow('SNAPSHOT_HASH_MISMATCH');
    await expect(
      executePairedEvaluation(
        { ...input, candidate: { ...input.baseline, runId: 'another-run' } },
        s.dependencies,
      ),
    ).rejects.toThrow('RUNS_MUST_BE_PAIRED');
    const differentRubric = '{"humanScale":[0,10]}';
    await expect(
      executePairedEvaluation(
        {
          ...input,
          candidate: {
            ...input.candidate,
            snapshots: { ...input.candidate.snapshots, rubric: differentRubric },
            configuration: {
              ...input.candidate.configuration,
              rubricHash: hashEvaluationSnapshotText(differentRubric),
            },
          },
        },
        s.dependencies,
      ),
    ).rejects.toThrow('RUBRIC_MISMATCH');
    expect(s.create).not.toHaveBeenCalled();
    expect(s.execute).not.toHaveBeenCalled();
  });

  it('detaches inputs before awaiting storage, freezing only the captured experiment', async () => {
    const s = setup();
    const input = request();
    s.create.mockImplementationOnce(() => {
      (input.baseline.snapshots as { prompt: string }).prompt = 'changed while awaiting';
      (input.dataset.cases[0] as { input: string }).input = 'changed case';
      return Promise.resolve();
    });
    const execution = await executePairedEvaluation(input, s.dependencies);
    expect(execution.manifest.baseline.snapshots.prompt).toBe(
      'Compare supplied evidence and cite exact sources.',
    );
    expect(hashEvaluationDataset(execution.manifest.dataset)).toBe(evaluationCorpusV1.contentHash);
    expect(Object.isFrozen(input.baseline.snapshots)).toBe(false);
    expect(Object.isFrozen(s.execute.mock.calls[0]?.[0].arm.snapshots)).toBe(true);
  });

  it('makes no provider call if insert-only storage rejects an existing experiment', async () => {
    const s = setup();
    s.create.mockRejectedValueOnce(new Error('duplicate experiment'));
    await expect(executePairedEvaluation(request(), s.dependencies)).rejects.toThrow(
      'duplicate experiment',
    );
    expect(s.execute).not.toHaveBeenCalled();
  });

  it('stops after an append failure so no additional billable case runs', async () => {
    const s = setup();
    s.append.mockRejectedValueOnce(new Error('store unavailable'));
    await expect(executePairedEvaluation(request(), s.dependencies)).rejects.toThrow(
      'store unavailable',
    );
    expect(s.execute).toHaveBeenCalledOnce();
    expect(s.finish).not.toHaveBeenCalled();
  });

  it('records a safe failure once, retaining unknown cost and never retrying rejected credentials', async () => {
    const s = setup();
    s.execute.mockRejectedValueOnce(new Error('private provider error with api-key=secret'));
    const execution = await executePairedEvaluation(request(), s.dependencies);
    expect(execution.status).toBe('failed');
    expect(execution.results).toHaveLength(1);
    expect(execution.results[0]).toMatchObject({
      status: 'failed',
      output: null,
      costUsd: null,
      errorCode: 'provider_failure',
    });
    expect(JSON.stringify(execution)).not.toContain('api-key=secret');
    expect(s.execute).toHaveBeenCalledOnce();
    expect(() => compareReviewedEvaluation(execution, {})).toThrow('EXECUTION_INCOMPLETE');
  });

  it('rejects an observed model drift or a cost with no price snapshot', async () => {
    for (const change of [{ modelId: 'different-model' }, { costUsd: 0.02 }, { inputTokens: -1 }]) {
      const s = setup();
      const original = s.execute.getMockImplementation()!;
      s.execute.mockImplementationOnce(async (input) => ({
        ...(await original(input)),
        ...change,
      }));
      const execution = await executePairedEvaluation(request(), s.dependencies);
      expect(execution.status).toBe('failed');
      expect(execution.results[0]?.errorCode).toBe(
        'modelId' in change ? 'snapshot_mismatch' : 'invalid_response',
      );
      expect(s.execute).toHaveBeenCalledOnce();
    }
  });

  it('propagates cancellation to the adapter and rejects its late output', async () => {
    const s = setup();
    s.execute.mockImplementationOnce(({ signal }) => {
      s.controller.abort();
      expect(signal.aborted).toBe(true);
      return Promise.resolve({
        provider: 'deterministic',
        modelId: 'offline-fixture-v1',
        output: 'late output',
        inputTokens: 12,
        outputTokens: 5,
        costUsd: null,
      });
    });
    const execution = await executePairedEvaluation(request(), s.dependencies);
    expect(execution.status).toBe('cancelled');
    expect(execution.results[0]).toMatchObject({
      status: 'cancelled',
      output: null,
      errorCode: 'cancelled',
    });
    expect(s.execute).toHaveBeenCalledOnce();
  });

  it('bounds an unresponsive adapter and stops further calls even when it ignores its abort signal', async () => {
    const s = setup();
    s.execute.mockImplementationOnce(() => new Promise(() => undefined));
    const execution = await executePairedEvaluation({ ...request(), timeoutMs: 5 }, s.dependencies);
    expect(execution.status).toBe('failed');
    expect(execution.results[0]?.errorCode).toBe('timeout');
    expect(s.execute).toHaveBeenCalledOnce();
  });

  it('records cancellation before the first case and between cases without starting another call', async () => {
    const s = setup();
    s.controller.abort();
    expect((await executePairedEvaluation(request(), s.dependencies)).status).toBe('cancelled');
    expect(s.execute).not.toHaveBeenCalled();
    const mid = setup();
    mid.append.mockImplementationOnce(() => {
      mid.controller.abort();
      return Promise.resolve();
    });
    const execution = await executePairedEvaluation(request(), mid.dependencies);
    expect(execution.status).toBe('cancelled');
    expect(execution.results).toHaveLength(1);
    expect(mid.execute).toHaveBeenCalledOnce();
  });

  it('generates language-separated metrics only from complete output-bound human reviews', async () => {
    const s = setup();
    const execution = await executePairedEvaluation(request(), s.dependencies);
    const result = compareReviewedEvaluation(execution, review(execution));
    expect(result.comparison.metrics.fa.caseCount).toBe(15);
    expect(result.comparison.metrics.en.caseCount).toBe(15);
    expect(result.comparison.metrics.all.regressedCaseCount).toBe(1);
    expect(result.comparison.metrics.all.cost.candidateMinusBaselineUsd).toBeNull();
    expect(result.comparison.metrics.all.judgeHumanAgreement.candidate.agreementRate).toBeNull();
    expect(result.comparison.decision).toBeNull();
    expect(result.regressionSuggestions).toHaveLength(1);
    expect(result.regressionSuggestions[0]).toMatchObject({
      sourceCaseId: 'COST-FA-01',
      status: 'needs_human_review',
    });
    expect(result.regressionSuggestions[0]).not.toHaveProperty('output');
  });

  it('rejects incomplete, duplicated, stale-output and judge-only reviews', async () => {
    const s = setup();
    const execution = await executePairedEvaluation(request(), s.dependencies);
    const input = review(execution);
    expect(() =>
      compareReviewedEvaluation(execution, { ...input, ratings: input.ratings.slice(1) }),
    ).toThrow('REVIEW_INVALID');
    const duplicate = [input.ratings[0], ...input.ratings.slice(0, -1)];
    expect(() => compareReviewedEvaluation(execution, { ...input, ratings: duplicate })).toThrow(
      'REVIEW_OUTPUT_MISMATCH',
    );
    const stale = input.ratings.map((rating, index) =>
      index ? rating : { ...rating, outputHash: 'f'.repeat(64) },
    );
    expect(() => compareReviewedEvaluation(execution, { ...input, ratings: stale })).toThrow(
      'REVIEW_OUTPUT_MISMATCH',
    );
    const judgeOnly = input.ratings.map((rating) => ({
      ...rating,
      humanScore: null,
      judgeAccepted: true,
    }));
    expect(() => compareReviewedEvaluation(execution, { ...input, ratings: judgeOnly })).toThrow(
      'RUN_MEASUREMENT_INVALID',
    );
    expect(() =>
      compareReviewedEvaluation(execution, { ...input, experimentHash: 'a'.repeat(64) }),
    ).toThrow('REVIEW_INVALID');
  });

  it('detects changed persisted output, cost, latency or manifest before comparison', async () => {
    const s = setup();
    const execution = await executePairedEvaluation(request(), s.dependencies);
    const input = review(execution);
    for (const change of [{ output: 'replaced' }, { costUsd: 0 }, { latencyMs: 0 }]) {
      const results = execution.results.map((row, index) => (index ? row : { ...row, ...change }));
      expect(() => compareReviewedEvaluation({ ...execution, results }, input)).toThrow(
        'EXECUTION_CHANGED',
      );
    }
    expect(() =>
      compareReviewedEvaluation(
        { ...execution, manifest: { ...execution.manifest, repetition: 99 } },
        input,
      ),
    ).toThrow('EXECUTION_CHANGED');
    expect(() =>
      compareReviewedEvaluation({ ...execution, results: execution.results.slice(1) }, input),
    ).toThrow('EXECUTION_INCOMPLETE');
    expect(prepareEvaluationExperiment(request()).contentHash).toBe(execution.manifest.contentHash);
  });
});
