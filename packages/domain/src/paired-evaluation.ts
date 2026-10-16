import { createHash } from 'node:crypto';

export type EvaluationCaseLanguage = 'fa' | 'en';
export type EvaluationAgentRole = 'analyst' | 'researcher' | 'ideator' | 'documenter' | 'evaluator';
export type EvaluationProvider = 'openai' | 'gemini' | 'anthropic' | 'deterministic';

export interface EvaluationDatasetCase {
  readonly id: string;
  readonly language: EvaluationCaseLanguage;
  readonly input: string;
  readonly expectedInvariantIds: readonly string[];
}

export interface EvaluationDatasetSnapshot {
  readonly id: string;
  readonly version: number;
  readonly synthetic: true;
  readonly cases: readonly EvaluationDatasetCase[];
  readonly contentHash: string;
}

export interface EvaluationConfigurationSnapshot {
  readonly role: EvaluationAgentRole;
  readonly provider: EvaluationProvider;
  readonly modelId: string;
  readonly modelSnapshotHash: string;
  readonly promptHash: string;
  readonly retrievalHash: string;
  readonly rubricHash: string;
  readonly pricingSnapshotHash: string | null;
}

export interface EvaluationCaseMeasurement {
  readonly caseId: string;
  /** Human-reviewed score using the pinned rubric; model-judge scores are not a substitute. */
  readonly humanScore: number;
  readonly humanAccepted: boolean | null;
  readonly judgeAccepted: boolean | null;
  readonly citationErrors: number;
  readonly latencyMs: number | null;
  readonly costUsd: number | null;
}

export interface EvaluationRunSnapshot {
  readonly id: string;
  readonly datasetHash: string;
  readonly configuration: EvaluationConfigurationSnapshot;
  readonly measurements: readonly EvaluationCaseMeasurement[];
}

export interface PairedEvaluationInput {
  readonly dataset: EvaluationDatasetSnapshot;
  readonly baseline: EvaluationRunSnapshot;
  readonly candidate: EvaluationRunSnapshot;
}

export interface PairedEvaluationLanguageMetrics {
  readonly caseCount: number;
  readonly baselineMeanHumanScore: number;
  readonly candidateMeanHumanScore: number;
  readonly meanHumanScoreDelta: number;
  readonly regressedCaseCount: number;
  readonly improvedCaseCount: number;
  readonly unchangedCaseCount: number;
  readonly regressionRate: number;
  readonly baselineCitationErrors: number;
  readonly candidateCitationErrors: number;
  readonly citationErrorDelta: number;
  readonly baselineLatency: EvaluationLatencySummary;
  readonly candidateLatency: EvaluationLatencySummary;
  readonly cost: PairedEvaluationCostSummary;
  readonly judgeHumanAgreement: PairedEvaluationAgreementSummary;
}

export interface EvaluationLatencySummary {
  readonly measuredCaseCount: number;
  readonly meanMs: number | null;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
}

export interface EvaluationCostSummary {
  readonly measuredCaseCount: number;
  readonly missingCaseCount: number;
  /** Sum of costs actually supplied; null means no cost was measured. */
  readonly knownCostUsd: number | null;
  /** Only present when cost was measured for every paired case. */
  readonly completeCostUsd: number | null;
}

export interface EvaluationAgreementSummary {
  readonly reviewedCaseCount: number;
  readonly matchingCaseCount: number;
  readonly agreementRate: number | null;
}

export interface PairedEvaluationCostSummary {
  readonly baseline: EvaluationCostSummary;
  readonly candidate: EvaluationCostSummary;
  readonly candidateMinusBaselineUsd: number | null;
}

export interface PairedEvaluationAgreementSummary {
  readonly baseline: EvaluationAgreementSummary;
  readonly candidate: EvaluationAgreementSummary;
}

export interface PairedEvaluationCaseDifference {
  readonly caseId: string;
  readonly language: EvaluationCaseLanguage;
  readonly baselineHumanScore: number;
  readonly candidateHumanScore: number;
  readonly humanScoreDelta: number;
  readonly baselineCitationErrors: number;
  readonly candidateCitationErrors: number;
  readonly citationErrorDelta: number;
  readonly regressed: boolean;
  readonly improved: boolean;
}

export interface PairedEvaluationComparison {
  readonly format: 'docoo-paired-evaluation-v1';
  readonly dataset: { readonly id: string; readonly version: number; readonly contentHash: string };
  readonly baseline: {
    readonly id: string;
    readonly configuration: EvaluationConfigurationSnapshot;
  };
  readonly candidate: {
    readonly id: string;
    readonly configuration: EvaluationConfigurationSnapshot;
  };
  readonly metrics: {
    readonly fa: PairedEvaluationLanguageMetrics;
    readonly en: PairedEvaluationLanguageMetrics;
    readonly all: PairedEvaluationLanguageMetrics;
  };
  readonly cases: readonly PairedEvaluationCaseDifference[];
  /** Reports evidence only; it never changes a default or produces a pass/fail decision. */
  readonly decision: null;
}

export interface RegressionCaseSuggestion {
  readonly sourceDatasetId: string;
  readonly sourceDatasetVersion: number;
  readonly sourceCaseId: string;
  readonly baselineRunId: string;
  readonly candidateRunId: string;
  readonly candidateSnapshotHash: string;
  readonly language: EvaluationCaseLanguage;
  readonly status: 'needs_human_review';
}

export type PairedEvaluationErrorCode =
  | 'INPUT_INVALID'
  | 'DATASET_INVALID'
  | 'DATASET_HASH_MISMATCH'
  | 'DATASET_CASE_DUPLICATE'
  | 'DATASET_MUST_BE_BILINGUAL'
  | 'RUN_INVALID'
  | 'RUN_DATASET_MISMATCH'
  | 'RUN_CASE_SET_MISMATCH'
  | 'RUN_MEASUREMENT_INVALID'
  | 'RUN_SNAPSHOT_INVALID'
  | 'RUNS_MUST_BE_PAIRED'
  | 'RUBRIC_MISMATCH';

export class PairedEvaluationError extends Error {
  constructor(readonly code: PairedEvaluationErrorCode) {
    super(code);
    this.name = 'PairedEvaluationError';
  }
}

/** Hashes only the synthetic, versioned test inputs and expected invariants. */
export function hashEvaluationDataset(value: unknown): string {
  const input = asRecord(value, 'DATASET_INVALID');
  const withoutHash = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== 'contentHash'),
  );
  const dataset = parseDataset(withoutHash, false);
  const canonicalDataset = {
    id: dataset.id,
    version: dataset.version,
    synthetic: dataset.synthetic,
    cases: dataset.cases,
  };
  return createHash('sha256').update(canonicalJson(canonicalDataset), 'utf8').digest('hex');
}

/** Validates persisted inputs before any agent execution or provider spending. */
export function readEvaluationDataset(value: unknown): EvaluationDatasetSnapshot {
  const dataset = parseDataset(value, true);
  if (dataset.contentHash !== hashEvaluationDataset(dataset)) {
    throw new PairedEvaluationError('DATASET_HASH_MISMATCH');
  }
  return structuredClone(dataset);
}

export function readEvaluationConfiguration(value: unknown): EvaluationConfigurationSnapshot {
  return structuredClone(parseConfiguration(value));
}

export function assertPairedEvaluationConfigurations(
  baseline: EvaluationConfigurationSnapshot,
  candidate: EvaluationConfigurationSnapshot,
): void {
  parseConfiguration(baseline);
  parseConfiguration(candidate);
  if (baseline.role !== candidate.role) throw new PairedEvaluationError('RUNS_MUST_BE_PAIRED');
  if (baseline.rubricHash !== candidate.rubricHash) {
    throw new PairedEvaluationError('RUBRIC_MISMATCH');
  }
  if (
    baseline.provider === candidate.provider &&
    baseline.modelId === candidate.modelId &&
    baseline.modelSnapshotHash === candidate.modelSnapshotHash &&
    baseline.promptHash === candidate.promptHash &&
    baseline.retrievalHash === candidate.retrievalHash
  ) {
    throw new PairedEvaluationError('RUNS_MUST_BE_PAIRED');
  }
}

/**
 * Compares two pinned runs on exactly the same bilingual cases and rubric.
 * Metrics are descriptive only: no threshold, automatic acceptance, or default change is applied.
 */
export function comparePairedEvaluationRuns(value: unknown): PairedEvaluationComparison {
  const input = asRecord(value, 'INPUT_INVALID');
  exactKeys(input, ['dataset', 'baseline', 'candidate'], 'INPUT_INVALID');

  const dataset = readEvaluationDataset(input['dataset']);
  const baseline = parseRun(input['baseline'], dataset);
  const candidate = parseRun(input['candidate'], dataset);

  if (
    baseline.datasetHash !== candidate.datasetHash ||
    baseline.datasetHash !== dataset.contentHash
  ) {
    throw new PairedEvaluationError('RUN_DATASET_MISMATCH');
  }
  if (baseline.id === candidate.id) throw new PairedEvaluationError('RUNS_MUST_BE_PAIRED');
  assertPairedEvaluationConfigurations(baseline.configuration, candidate.configuration);

  const baselineById = new Map(baseline.measurements.map((item) => [item.caseId, item]));
  const candidateById = new Map(candidate.measurements.map((item) => [item.caseId, item]));
  const differences = dataset.cases.map((item): PairedEvaluationCaseDifference => {
    const left = baselineById.get(item.id)!;
    const right = candidateById.get(item.id)!;
    const humanScoreDelta = round(right.humanScore - left.humanScore);
    const citationErrorDelta = right.citationErrors - left.citationErrors;
    const acceptanceRegressed = left.humanAccepted === true && right.humanAccepted === false;
    const acceptanceImproved = left.humanAccepted === false && right.humanAccepted === true;
    const regressed = humanScoreDelta < 0 || citationErrorDelta > 0 || acceptanceRegressed;
    return {
      caseId: item.id,
      language: item.language,
      baselineHumanScore: left.humanScore,
      candidateHumanScore: right.humanScore,
      humanScoreDelta,
      baselineCitationErrors: left.citationErrors,
      candidateCitationErrors: right.citationErrors,
      citationErrorDelta,
      regressed,
      improved: !regressed && (humanScoreDelta > 0 || citationErrorDelta < 0 || acceptanceImproved),
    };
  });

  const metricsFor = (
    language: EvaluationCaseLanguage | 'all',
  ): PairedEvaluationLanguageMetrics => {
    const selectedCases = dataset.cases.filter(
      (item) => language === 'all' || item.language === language,
    );
    const selectedIds = new Set(selectedCases.map((item) => item.id));
    const left = baseline.measurements.filter((item) => selectedIds.has(item.caseId));
    const right = candidate.measurements.filter((item) => selectedIds.has(item.caseId));
    const selectedDifferences = differences.filter((item) => selectedIds.has(item.caseId));
    const baselineScores = left.map((item) => item.humanScore);
    const candidateScores = right.map((item) => item.humanScore);
    const regressedCaseCount = selectedDifferences.filter((item) => item.regressed).length;
    const improvedCaseCount = selectedDifferences.filter((item) => item.improved).length;
    const baselineCitationErrors = sum(left.map((item) => item.citationErrors));
    const candidateCitationErrors = sum(right.map((item) => item.citationErrors));
    const baselineCost = costSummary(left.map((item) => item.costUsd));
    const candidateCost = costSummary(right.map((item) => item.costUsd));
    const baselineAgreement = agreementSummary(left);
    const candidateAgreement = agreementSummary(right);

    return {
      caseCount: selectedCases.length,
      baselineMeanHumanScore: mean(baselineScores),
      candidateMeanHumanScore: mean(candidateScores),
      meanHumanScoreDelta: round(mean(candidateScores) - mean(baselineScores)),
      regressedCaseCount,
      improvedCaseCount,
      unchangedCaseCount: selectedCases.length - regressedCaseCount - improvedCaseCount,
      regressionRate: round(regressedCaseCount / selectedCases.length),
      baselineCitationErrors,
      candidateCitationErrors,
      citationErrorDelta: candidateCitationErrors - baselineCitationErrors,
      baselineLatency: latencySummary(left.map((item) => item.latencyMs)),
      candidateLatency: latencySummary(right.map((item) => item.latencyMs)),
      cost: {
        baseline: baselineCost,
        candidate: candidateCost,
        candidateMinusBaselineUsd:
          baselineCost.completeCostUsd !== null && candidateCost.completeCostUsd !== null
            ? round(candidateCost.completeCostUsd - baselineCost.completeCostUsd, 6)
            : null,
      },
      judgeHumanAgreement: { baseline: baselineAgreement, candidate: candidateAgreement },
    };
  };

  return {
    format: 'docoo-paired-evaluation-v1',
    dataset: { id: dataset.id, version: dataset.version, contentHash: dataset.contentHash },
    baseline: { id: baseline.id, configuration: baseline.configuration },
    candidate: { id: candidate.id, configuration: candidate.configuration },
    metrics: { fa: metricsFor('fa'), en: metricsFor('en'), all: metricsFor('all') },
    cases: differences,
    decision: null,
  };
}

/** Suggests regression cases without copying user inputs or generated output into a corpus. */
export function suggestRegressionCases(
  input: unknown,
  comparison: PairedEvaluationComparison,
): readonly RegressionCaseSuggestion[] {
  const dataset = parseDataset(input, true);
  if (dataset.contentHash !== hashEvaluationDataset(dataset)) {
    throw new PairedEvaluationError('DATASET_HASH_MISMATCH');
  }
  if (dataset.contentHash !== comparison.dataset.contentHash) {
    throw new PairedEvaluationError('RUN_DATASET_MISMATCH');
  }
  return comparison.cases
    .filter((item) => item.regressed)
    .map((item) => ({
      sourceDatasetId: dataset.id,
      sourceDatasetVersion: dataset.version,
      sourceCaseId: item.caseId,
      baselineRunId: comparison.baseline.id,
      candidateRunId: comparison.candidate.id,
      candidateSnapshotHash: hashConfigurationSnapshot(comparison.candidate.configuration),
      language: item.language,
      status: 'needs_human_review',
    }));
}

export function hashConfigurationSnapshot(configuration: EvaluationConfigurationSnapshot): string {
  return createHash('sha256').update(canonicalJson(configuration), 'utf8').digest('hex');
}

interface ParsedDataset extends Omit<EvaluationDatasetSnapshot, 'contentHash'> {
  readonly contentHash: string;
}

function parseDataset(value: unknown, requireHash: boolean): ParsedDataset {
  const input = asRecord(value, 'DATASET_INVALID');
  exactKeys(
    input,
    ['id', 'version', 'synthetic', 'cases', ...(requireHash ? ['contentHash'] : [])],
    'DATASET_INVALID',
  );
  if (
    !validIdentifier(input['id']) ||
    typeof input['version'] !== 'number' ||
    !Number.isSafeInteger(input['version']) ||
    input['version'] < 1
  ) {
    throw new PairedEvaluationError('DATASET_INVALID');
  }
  if (
    input['synthetic'] !== true ||
    !Array.isArray(input['cases']) ||
    input['cases'].length < 2 ||
    input['cases'].length > 500
  ) {
    throw new PairedEvaluationError('DATASET_INVALID');
  }

  const cases = input['cases'].map((value): EvaluationDatasetCase => {
    const item = asRecord(value, 'DATASET_INVALID');
    exactKeys(item, ['id', 'language', 'input', 'expectedInvariantIds'], 'DATASET_INVALID');
    if (
      !validIdentifier(item['id']) ||
      (item['language'] !== 'fa' && item['language'] !== 'en') ||
      typeof item['input'] !== 'string' ||
      !item['input'].trim() ||
      item['input'].length > 10_000 ||
      !Array.isArray(item['expectedInvariantIds']) ||
      item['expectedInvariantIds'].length < 1 ||
      item['expectedInvariantIds'].length > 50 ||
      !item['expectedInvariantIds'].every((id) => validIdentifier(id)) ||
      new Set(item['expectedInvariantIds']).size !== item['expectedInvariantIds'].length
    ) {
      throw new PairedEvaluationError('DATASET_INVALID');
    }
    return {
      id: item['id'],
      language: item['language'],
      input: item['input'],
      expectedInvariantIds: item['expectedInvariantIds'],
    };
  });

  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new PairedEvaluationError('DATASET_CASE_DUPLICATE');
  }
  if (
    !cases.some((item) => item.language === 'fa') ||
    !cases.some((item) => item.language === 'en')
  ) {
    throw new PairedEvaluationError('DATASET_MUST_BE_BILINGUAL');
  }
  const canonicalDataset = {
    id: input['id'],
    version: input['version'],
    synthetic: true as const,
    cases,
  };
  const contentHash = createHash('sha256')
    .update(canonicalJson(canonicalDataset), 'utf8')
    .digest('hex');
  if (requireHash && !isSha256(input['contentHash'])) {
    throw new PairedEvaluationError('DATASET_INVALID');
  }
  return {
    ...canonicalDataset,
    contentHash: requireHash ? (input['contentHash'] as string) : contentHash,
  };
}

function parseRun(value: unknown, dataset: ParsedDataset): EvaluationRunSnapshot {
  const run = asRecord(value, 'RUN_INVALID');
  exactKeys(run, ['id', 'datasetHash', 'configuration', 'measurements'], 'RUN_INVALID');
  if (
    !validIdentifier(run['id']) ||
    !isSha256(run['datasetHash']) ||
    !Array.isArray(run['measurements'])
  ) {
    throw new PairedEvaluationError('RUN_INVALID');
  }
  const configuration = parseConfiguration(run['configuration']);
  if (
    run['datasetHash'] !== dataset.contentHash ||
    run['measurements'].length !== dataset.cases.length
  ) {
    throw new PairedEvaluationError('RUN_DATASET_MISMATCH');
  }
  const measurements = run['measurements'].map(parseMeasurement);
  if (new Set(measurements.map((item) => item.caseId)).size !== measurements.length) {
    throw new PairedEvaluationError('RUN_CASE_SET_MISMATCH');
  }
  const expected = new Set(dataset.cases.map((item) => item.id));
  if (
    measurements.some((item) => !expected.has(item.caseId)) ||
    measurements.some((item) => !dataset.cases.some((c) => c.id === item.caseId))
  ) {
    throw new PairedEvaluationError('RUN_CASE_SET_MISMATCH');
  }
  if (
    measurements.some((item) => item.costUsd !== null) &&
    configuration.pricingSnapshotHash === null
  ) {
    throw new PairedEvaluationError('RUN_SNAPSHOT_INVALID');
  }
  return { id: run['id'], datasetHash: run['datasetHash'], configuration, measurements };
}

function parseConfiguration(value: unknown): EvaluationConfigurationSnapshot {
  const item = asRecord(value, 'RUN_SNAPSHOT_INVALID');
  exactKeys(
    item,
    [
      'role',
      'provider',
      'modelId',
      'modelSnapshotHash',
      'promptHash',
      'retrievalHash',
      'rubricHash',
      'pricingSnapshotHash',
    ],
    'RUN_SNAPSHOT_INVALID',
  );
  if (
    !isAgentRole(item['role']) ||
    !isProvider(item['provider']) ||
    typeof item['modelId'] !== 'string' ||
    !item['modelId'].trim() ||
    item['modelId'].length > 200 ||
    !isSha256(item['modelSnapshotHash']) ||
    !isSha256(item['promptHash']) ||
    !isSha256(item['retrievalHash']) ||
    !isSha256(item['rubricHash']) ||
    (item['pricingSnapshotHash'] !== null && !isSha256(item['pricingSnapshotHash']))
  ) {
    throw new PairedEvaluationError('RUN_SNAPSHOT_INVALID');
  }
  return item as unknown as EvaluationConfigurationSnapshot;
}

function parseMeasurement(value: unknown): EvaluationCaseMeasurement {
  const item = asRecord(value, 'RUN_MEASUREMENT_INVALID');
  exactKeys(
    item,
    [
      'caseId',
      'humanScore',
      'humanAccepted',
      'judgeAccepted',
      'citationErrors',
      'latencyMs',
      'costUsd',
    ],
    'RUN_MEASUREMENT_INVALID',
  );
  if (
    !validIdentifier(item['caseId']) ||
    typeof item['humanScore'] !== 'number' ||
    !Number.isFinite(item['humanScore']) ||
    item['humanScore'] < 0 ||
    item['humanScore'] > 100 ||
    !isNullableBoolean(item['humanAccepted']) ||
    !isNullableBoolean(item['judgeAccepted']) ||
    typeof item['citationErrors'] !== 'number' ||
    !Number.isSafeInteger(item['citationErrors']) ||
    item['citationErrors'] < 0 ||
    !isNullableNonNegativeNumber(item['latencyMs']) ||
    !isNullableNonNegativeNumber(item['costUsd'])
  ) {
    throw new PairedEvaluationError('RUN_MEASUREMENT_INVALID');
  }
  return item as unknown as EvaluationCaseMeasurement;
}

function latencySummary(values: readonly (number | null)[]): EvaluationLatencySummary {
  const sorted = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  return {
    measuredCaseCount: sorted.length,
    meanMs: sorted.length > 0 ? round(mean(sorted)) : null,
    p50Ms: percentileNearestRank(sorted, 0.5),
    p95Ms: percentileNearestRank(sorted, 0.95),
  };
}

function costSummary(values: readonly (number | null)[]): EvaluationCostSummary {
  const measured = values.filter((value): value is number => value !== null);
  const knownCostUsd = measured.length > 0 ? round(sum(measured), 6) : null;
  return {
    measuredCaseCount: measured.length,
    missingCaseCount: values.length - measured.length,
    knownCostUsd,
    completeCostUsd: measured.length === values.length ? knownCostUsd : null,
  };
}

function agreementSummary(
  values: readonly EvaluationCaseMeasurement[],
): EvaluationAgreementSummary {
  const reviewed = values.filter(
    (item) => item.judgeAccepted !== null && item.humanAccepted !== null,
  );
  const matching = reviewed.filter((item) => item.judgeAccepted === item.humanAccepted).length;
  return {
    reviewedCaseCount: reviewed.length,
    matchingCaseCount: matching,
    agreementRate: reviewed.length > 0 ? round(matching / reviewed.length) : null,
  };
}

function percentileNearestRank(sorted: readonly number[], percentile: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(percentile * sorted.length) - 1] ?? null;
}

function mean(values: readonly number[]): number {
  return round(sum(values) / values.length);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function asRecord(value: unknown, code: PairedEvaluationErrorCode): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PairedEvaluationError(code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  code: PairedEvaluationErrorCode,
): void {
  const actual = Object.keys(record);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !expected.includes(key)) ||
    expected.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new PairedEvaluationError(code);
  }
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isAgentRole(value: unknown): value is EvaluationAgentRole {
  return (
    value === 'analyst' ||
    value === 'researcher' ||
    value === 'ideator' ||
    value === 'documenter' ||
    value === 'evaluator'
  );
}

function isProvider(value: unknown): value is EvaluationProvider {
  return (
    value === 'openai' || value === 'gemini' || value === 'anthropic' || value === 'deterministic'
  );
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean';
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}
