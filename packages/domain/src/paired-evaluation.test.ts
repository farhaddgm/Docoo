import { describe, expect, it } from 'vitest';

import {
  comparePairedEvaluationRuns,
  hashEvaluationDataset,
  suggestRegressionCases,
  type EvaluationDatasetSnapshot,
  type EvaluationRunSnapshot,
} from './paired-evaluation.js';

const datasetCases = [
  {
    id: 'COST-FA-001',
    language: 'fa',
    input: 'سناریوی ساختگی کاهش هزینه: دو دوره را با واحد یکسان مقایسه کن.',
    expectedInvariantIds: ['preserve_units', 'no_unsupported_causality'],
  },
  {
    id: 'COST-EN-001',
    language: 'en',
    input: 'Synthetic cost-reduction case: compare both periods using the same units.',
    expectedInvariantIds: ['preserve_units', 'no_unsupported_causality'],
  },
  {
    id: 'CHURN-FA-001',
    language: 'fa',
    input: 'سناریوی ساختگی ریزش مشتری: نبود خط مبنا را صریح اعلام کن.',
    expectedInvariantIds: ['surface_missing_baseline'],
  },
  {
    id: 'CHURN-EN-001',
    language: 'en',
    input: 'Synthetic churn case: explicitly state when no baseline is supplied.',
    expectedInvariantIds: ['surface_missing_baseline'],
  },
] as const;

const datasetWithoutHash = {
  id: 'docoo-agent-smoke',
  version: 1,
  synthetic: true,
  cases: datasetCases,
} as const;

const dataset: EvaluationDatasetSnapshot = {
  ...datasetWithoutHash,
  contentHash: hashEvaluationDataset(datasetWithoutHash),
};

const baselineConfiguration = {
  role: 'analyst',
  provider: 'deterministic',
  modelId: 'fixture-v1',
  modelSnapshotHash: 'a'.repeat(64),
  promptHash: 'b'.repeat(64),
  retrievalHash: 'c'.repeat(64),
  rubricHash: 'd'.repeat(64),
  pricingSnapshotHash: 'e'.repeat(64),
} as const;

const candidateConfiguration = {
  ...baselineConfiguration,
  modelId: 'fixture-v2',
  modelSnapshotHash: 'f'.repeat(64),
} as const;

function run(
  id: string,
  configuration: EvaluationRunSnapshot['configuration'],
  scores: readonly number[],
  costs: readonly (number | null)[],
): EvaluationRunSnapshot {
  return {
    id,
    datasetHash: dataset.contentHash,
    configuration,
    measurements: datasetCases.map((item, index) => ({
      caseId: item.id,
      humanScore: scores[index]!,
      humanAccepted: scores[index]! >= 75,
      judgeAccepted: index === 1 ? null : scores[index]! >= 75,
      citationErrors: index === 1 ? 1 : 0,
      latencyMs: [100, 300, null, 200][index]!,
      costUsd: costs[index]!,
    })),
  };
}

const baseline = run(
  'run-baseline',
  baselineConfiguration,
  [80, 70, 90, 60],
  [0.01, 0.02, 0.01, 0.02],
);
const candidate = run(
  'run-candidate',
  candidateConfiguration,
  [85, 65, 90, 75],
  [0.009, 0.018, 0.01, null],
);

function compare(overrides: Record<string, unknown> = {}) {
  return comparePairedEvaluationRuns({ dataset, baseline, candidate, ...overrides });
}

describe('paired evaluation comparison', () => {
  it('hashes an immutable bilingual dataset independent of object key order', () => {
    expect(hashEvaluationDataset(dataset)).toBe(dataset.contentHash);
    expect(
      hashEvaluationDataset({
        cases: dataset.cases,
        synthetic: true,
        version: 1,
        id: 'docoo-agent-smoke',
        contentHash: dataset.contentHash,
      }),
    ).toBe(dataset.contentHash);
  });

  it('compares paired, pinned runs by language with human quality, citations, cost and latency', () => {
    const result = compare();

    expect(result).toMatchObject({
      format: 'docoo-paired-evaluation-v1',
      dataset: { id: 'docoo-agent-smoke', version: 1, contentHash: dataset.contentHash },
      decision: null,
      metrics: {
        fa: {
          caseCount: 2,
          baselineMeanHumanScore: 85,
          candidateMeanHumanScore: 87.5,
          meanHumanScoreDelta: 2.5,
          regressedCaseCount: 0,
          improvedCaseCount: 1,
          unchangedCaseCount: 1,
          regressionRate: 0,
          baselineCitationErrors: 0,
          candidateCitationErrors: 0,
          citationErrorDelta: 0,
          baselineLatency: { measuredCaseCount: 1, meanMs: 100, p50Ms: 100, p95Ms: 100 },
          candidateLatency: { measuredCaseCount: 1, meanMs: 100, p50Ms: 100, p95Ms: 100 },
          cost: {
            baseline: {
              measuredCaseCount: 2,
              missingCaseCount: 0,
              knownCostUsd: 0.02,
              completeCostUsd: 0.02,
            },
            candidate: {
              measuredCaseCount: 2,
              missingCaseCount: 0,
              knownCostUsd: 0.019,
              completeCostUsd: 0.019,
            },
            candidateMinusBaselineUsd: -0.001,
          },
        },
        en: {
          caseCount: 2,
          baselineMeanHumanScore: 65,
          candidateMeanHumanScore: 70,
          meanHumanScoreDelta: 5,
          regressedCaseCount: 1,
          improvedCaseCount: 1,
          unchangedCaseCount: 0,
          regressionRate: 0.5,
          baselineCitationErrors: 1,
          candidateCitationErrors: 1,
          citationErrorDelta: 0,
          baselineLatency: { measuredCaseCount: 2, meanMs: 250, p50Ms: 200, p95Ms: 300 },
          candidateLatency: { measuredCaseCount: 2, meanMs: 250, p50Ms: 200, p95Ms: 300 },
          cost: {
            baseline: {
              measuredCaseCount: 2,
              missingCaseCount: 0,
              knownCostUsd: 0.04,
              completeCostUsd: 0.04,
            },
            candidate: {
              measuredCaseCount: 1,
              missingCaseCount: 1,
              knownCostUsd: 0.018,
              completeCostUsd: null,
            },
            candidateMinusBaselineUsd: null,
          },
        },
      },
    });
    expect(result.metrics.all.caseCount).toBe(4);
    expect(result.metrics.all.regressedCaseCount).toBe(1);
    expect(result.metrics.all.candidateMeanHumanScore).toBe(78.75);
    expect(result.cases.find((item) => item.caseId === 'COST-EN-001')).toMatchObject({
      humanScoreDelta: -5,
      regressed: true,
    });
    expect(JSON.stringify(result)).not.toContain('سناریوی ساختگی');
    expect(JSON.stringify(result)).not.toContain('Synthetic cost-reduction case');
  });

  it('requires approval before cost can be attributed to a pinned pricing snapshot', () => {
    const unpricedRun = {
      ...candidate,
      configuration: { ...candidate.configuration, pricingSnapshotHash: null },
    };
    expect(() => compare({ candidate: unpricedRun })).toThrowError(
      expect.objectContaining({ code: 'RUN_SNAPSHOT_INVALID' }),
    );
  });

  it('counts a citation-only regression even when the human score is unchanged', () => {
    const citationCandidate = {
      ...candidate,
      id: 'run-citation-regression',
      measurements: candidate.measurements.map((item) =>
        item.caseId === 'CHURN-FA-001' ? { ...item, citationErrors: 1 } : item,
      ),
    };
    const result = compare({ candidate: citationCandidate });

    expect(result.cases.find((item) => item.caseId === 'CHURN-FA-001')).toMatchObject({
      humanScoreDelta: 0,
      citationErrorDelta: 1,
      regressed: true,
      improved: false,
    });
    expect(result.metrics.fa.regressedCaseCount).toBe(1);
  });

  it('rejects tampered, non-bilingual, duplicate, or non-synthetic datasets', () => {
    const changedInput = {
      ...dataset,
      cases: dataset.cases.map((item, index) =>
        index === 0 ? { ...item, input: 'changed' } : item,
      ),
    };
    expect(() => compare({ dataset: changedInput })).toThrowError(
      expect.objectContaining({ code: 'DATASET_HASH_MISMATCH' }),
    );

    const duplicate = { ...datasetWithoutHash, cases: [datasetCases[0], datasetCases[0]] };
    expect(() => hashEvaluationDataset(duplicate)).toThrowError(
      expect.objectContaining({ code: 'DATASET_CASE_DUPLICATE' }),
    );

    const oneLanguage = {
      ...datasetWithoutHash,
      cases: datasetCases.filter((item) => item.language === 'fa'),
    };
    expect(() => hashEvaluationDataset(oneLanguage)).toThrowError(
      expect.objectContaining({ code: 'DATASET_MUST_BE_BILINGUAL' }),
    );

    expect(() => hashEvaluationDataset({ ...datasetWithoutHash, synthetic: false })).toThrowError(
      expect.objectContaining({ code: 'DATASET_INVALID' }),
    );
  });

  it('rejects incomplete case pairing, different rubrics, unpinned snapshots and unknown fields', () => {
    expect(() =>
      compare({ candidate: { ...candidate, measurements: candidate.measurements.slice(1) } }),
    ).toThrowError(expect.objectContaining({ code: 'RUN_DATASET_MISMATCH' }));

    expect(() =>
      compare({
        candidate: {
          ...candidate,
          configuration: { ...candidate.configuration, rubricHash: '9'.repeat(64) },
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'RUBRIC_MISMATCH' }));

    const sameSnapshot = {
      ...baseline,
      id: 'run-identical',
      configuration: baseline.configuration,
    };
    expect(() => compare({ candidate: sameSnapshot })).toThrowError(
      expect.objectContaining({ code: 'RUNS_MUST_BE_PAIRED' }),
    );

    expect(() => compare({ extra: true })).toThrowError(
      expect.objectContaining({ code: 'INPUT_INVALID' }),
    );
  });

  it('turns regressions into review-only suggestions without copying case text or output', () => {
    const comparison = compare();
    const suggestions = suggestRegressionCases(dataset, comparison);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      sourceDatasetId: dataset.id,
      sourceDatasetVersion: dataset.version,
      sourceCaseId: 'COST-EN-001',
      baselineRunId: baseline.id,
      candidateRunId: candidate.id,
      language: 'en',
      status: 'needs_human_review',
    });
    expect(JSON.stringify(suggestions)).not.toContain('input');
    expect(JSON.stringify(suggestions)).not.toContain('output');

    const tamperedDataset = {
      ...dataset,
      cases: dataset.cases.map((item, index) =>
        index === 0 ? { ...item, input: 'different synthetic input' } : item,
      ),
    };
    expect(() => suggestRegressionCases(tamperedDataset, comparison)).toThrowError(
      expect.objectContaining({ code: 'DATASET_HASH_MISMATCH' }),
    );
  });
});
