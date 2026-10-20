import { createHash } from 'node:crypto';
import {
  assertPairedEvaluationConfigurations,
  comparePairedEvaluationRuns,
  readEvaluationConfiguration,
  readEvaluationDataset,
  suggestRegressionCases,
  type EvaluationConfigurationSnapshot,
  type EvaluationDatasetCase,
  type EvaluationDatasetSnapshot,
  type EvaluationProvider,
} from '@docoo/domain/evaluation';

export interface EvaluationAgentSnapshots {
  /** Exact serialized production model/config snapshot, including provider and modelId. */
  readonly model: string;
  readonly prompt: string;
  readonly retrieval: string;
  readonly rubric: string;
  readonly pricing: string | null;
}

export interface EvaluationExecutionArm {
  readonly runId: string;
  readonly configuration: EvaluationConfigurationSnapshot;
  readonly snapshots: EvaluationAgentSnapshots;
}

export interface EvaluationExperimentInput {
  readonly experimentId: string;
  /** Identifies this repetition; it does not imply support for a provider sampling seed. */
  readonly repetition: number;
  readonly timeoutMs: number;
  readonly dataset: EvaluationDatasetSnapshot;
  readonly baseline: EvaluationExecutionArm;
  readonly candidate: EvaluationExecutionArm;
}

export interface EvaluationExperimentManifest extends EvaluationExperimentInput {
  readonly format: 'docoo-evaluation-experiment-v1';
  readonly executionOrder: 'alternating_by_case';
  readonly contentHash: string;
}

export interface EvaluationAgentResponse {
  readonly provider: EvaluationProvider;
  /** The provider's observed model ID must match the pinned version. */
  readonly modelId: string;
  readonly output: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Measured cost only. Estimates belong in a separate ledger, never in this field. */
  readonly costUsd: number | null;
}

export interface EvaluationAgentAdapter {
  /** Credentials and production role-specific request construction remain inside the adapter. */
  execute(input: {
    readonly arm: EvaluationExecutionArm;
    readonly testCase: EvaluationDatasetCase;
    readonly signal: AbortSignal;
  }): Promise<EvaluationAgentResponse>;
}

export type EvaluationExecutionFailure =
  'provider_failure' | 'timeout' | 'cancelled' | 'snapshot_mismatch' | 'invalid_response';

export interface EvaluationExecutionCaseResult {
  readonly experimentId: string;
  readonly runId: string;
  readonly caseId: string;
  readonly requestHash: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly output: string | null;
  readonly outputHash: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  readonly latencyMs: number;
  readonly errorCode: EvaluationExecutionFailure | null;
  readonly contentHash: string;
}

export interface PairedEvaluationExecution {
  readonly manifest: EvaluationExperimentManifest;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly results: readonly EvaluationExecutionCaseResult[];
}

/** A storage implementation must be bound to an authorized workspace by its caller. */
export interface EvaluationExecutionStore {
  /** Insert-only and atomic: a duplicate experiment must fail before any billable invocation. */
  create(manifest: EvaluationExperimentManifest): Promise<void>;
  /** Persist each result before the runner invokes the next case; never overwrite a result. */
  append(result: EvaluationExecutionCaseResult): Promise<void>;
  finish(experimentId: string, status: PairedEvaluationExecution['status']): Promise<void>;
}

export class EvaluationExecutionError extends Error {
  constructor(
    readonly code:
      | 'EXPERIMENT_INVALID'
      | 'SNAPSHOT_HASH_MISMATCH'
      | 'EXECUTION_INCOMPLETE'
      | 'EXECUTION_CHANGED'
      | 'REVIEW_INVALID'
      | 'REVIEW_OUTPUT_MISMATCH'
      | EvaluationExecutionFailure,
  ) {
    super(`EVALUATION_${code}`);
    this.name = 'EvaluationExecutionError';
  }
}

export function hashEvaluationSnapshotText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Validates and detaches every input before persisting a manifest or invoking any agent. */
export function prepareEvaluationExperiment(value: unknown): EvaluationExperimentManifest {
  const input = record(value);
  keys(input, ['experimentId', 'repetition', 'timeoutMs', 'dataset', 'baseline', 'candidate']);
  if (
    !identifier(input['experimentId']) ||
    !integer(input['repetition'], 1, 1000) ||
    !integer(input['timeoutMs'], 1, 300_000)
  )
    throw new EvaluationExecutionError('EXPERIMENT_INVALID');
  const dataset = readEvaluationDataset(input['dataset']);
  const baseline = readArm(input['baseline']);
  const candidate = readArm(input['candidate']);
  if (baseline.runId === candidate.runId) throw new EvaluationExecutionError('EXPERIMENT_INVALID');
  assertPairedEvaluationConfigurations(baseline.configuration, candidate.configuration);
  const manifest = {
    format: 'docoo-evaluation-experiment-v1' as const,
    executionOrder: 'alternating_by_case' as const,
    experimentId: input['experimentId'],
    repetition: input['repetition'],
    timeoutMs: input['timeoutMs'],
    dataset,
    baseline,
    candidate,
  };
  return freeze({ ...manifest, contentHash: hashJson(manifest) });
}

/**
 * Executes each pair sequentially, alternating which arm goes first to reduce order bias.
 * A failed/unknown invocation is recorded and stops the experiment. It is never silently retried.
 * A store failure propagates immediately, preventing subsequent provider spending.
 */
export async function executePairedEvaluation(
  value: unknown,
  dependencies: {
    readonly adapter: EvaluationAgentAdapter;
    readonly store: EvaluationExecutionStore;
    readonly signal: AbortSignal;
    readonly monotonicNow?: () => number;
  },
): Promise<PairedEvaluationExecution> {
  const manifest = prepareEvaluationExperiment(value);
  const { adapter, store, signal } = dependencies;
  const now = dependencies.monotonicNow ?? (() => performance.now());
  await store.create(manifest);
  const results: EvaluationExecutionCaseResult[] = [];
  let status: PairedEvaluationExecution['status'] = 'completed';
  outer: for (const [index, testCase] of manifest.dataset.cases.entries()) {
    const arms =
      index % 2 === 0
        ? [manifest.baseline, manifest.candidate]
        : [manifest.candidate, manifest.baseline];
    for (const arm of arms) {
      if (signal.aborted) {
        status = 'cancelled';
        break outer;
      }
      const started = now();
      const timeout = AbortSignal.timeout(manifest.timeoutMs);
      const invocationSignal = AbortSignal.any([signal, timeout]);
      let response: EvaluationAgentResponse | null;
      let errorCode: EvaluationExecutionFailure | null = null;
      try {
        response = readResponse(
          await invokeWithSignal(adapter, arm, testCase, invocationSignal),
          arm,
        );
        invocationSignal.throwIfAborted();
      } catch (error) {
        errorCode = signal.aborted
          ? 'cancelled'
          : timeout.aborted
            ? 'timeout'
            : error instanceof EvaluationExecutionError &&
                (error.code === 'snapshot_mismatch' || error.code === 'invalid_response')
              ? error.code
              : 'provider_failure';
        response = null;
      }
      const row = {
        experimentId: manifest.experimentId,
        runId: arm.runId,
        caseId: testCase.id,
        requestHash: requestHash(manifest, arm, testCase),
        status:
          errorCode === null
            ? ('completed' as const)
            : errorCode === 'cancelled'
              ? ('cancelled' as const)
              : ('failed' as const),
        output: response?.output ?? null,
        outputHash: response ? hashEvaluationSnapshotText(response.output) : null,
        inputTokens: response?.inputTokens ?? null,
        outputTokens: response?.outputTokens ?? null,
        costUsd: response?.costUsd ?? null,
        latencyMs: Math.max(0, Math.round(now() - started)),
        errorCode,
      };
      const result = freeze({ ...row, contentHash: hashJson(row) });
      await store.append(result);
      results.push(result);
      if (errorCode !== null) {
        status = row.status === 'cancelled' ? 'cancelled' : 'failed';
        break outer;
      }
    }
  }
  await store.finish(manifest.experimentId, status);
  return freeze({ manifest, status, results });
}

/** Human review refers to exact output hashes; execution never supplies an invented human score. */
export function compareReviewedEvaluation(execution: PairedEvaluationExecution, value: unknown) {
  const manifest = readEvaluationExperimentManifest(execution.manifest);
  if (
    execution.status !== 'completed' ||
    execution.results.length !== manifest.dataset.cases.length * 2
  ) {
    throw new EvaluationExecutionError('EXECUTION_INCOMPLETE');
  }
  const review = record(value, 'REVIEW_INVALID');
  keys(
    review,
    ['experimentHash', 'rubricHash', 'reviewerId', 'reviewedAt', 'ratings'],
    'REVIEW_INVALID',
  );
  if (
    review['experimentHash'] !== manifest.contentHash ||
    review['rubricHash'] !== manifest.baseline.configuration.rubricHash ||
    !identifier(review['reviewerId']) ||
    typeof review['reviewedAt'] !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T/.test(review['reviewedAt']) ||
    !Number.isFinite(Date.parse(review['reviewedAt'])) ||
    !Array.isArray(review['ratings']) ||
    review['ratings'].length !== execution.results.length
  ) {
    throw new EvaluationExecutionError('REVIEW_INVALID');
  }
  const ratings = review['ratings'].map((item) => {
    const rating = record(item, 'REVIEW_INVALID');
    keys(
      rating,
      [
        'runId',
        'caseId',
        'outputHash',
        'humanScore',
        'humanAccepted',
        'judgeAccepted',
        'citationErrors',
      ],
      'REVIEW_INVALID',
    );
    return rating;
  });
  const expectedKeys = new Set<string>();
  const runs = [manifest.baseline, manifest.candidate].map((arm) => ({
    id: arm.runId,
    datasetHash: manifest.dataset.contentHash,
    configuration: arm.configuration,
    measurements: manifest.dataset.cases.map((testCase) => {
      const match = execution.results.filter(
        (item) => item.runId === arm.runId && item.caseId === testCase.id,
      );
      const result = match[0] ? readEvaluationExecutionResult(manifest, match[0]) : undefined;
      if (
        match.length !== 1 ||
        !result ||
        result.status !== 'completed' ||
        result.errorCode !== null
      ) {
        throw new EvaluationExecutionError('EXECUTION_INCOMPLETE');
      }
      const { contentHash, ...row } = result;
      if (
        contentHash !== hashJson(row) ||
        result.experimentId !== manifest.experimentId ||
        result.requestHash !== requestHash(manifest, arm, testCase) ||
        typeof result.output !== 'string' ||
        result.outputHash !== hashEvaluationSnapshotText(result.output)
      ) {
        throw new EvaluationExecutionError('EXECUTION_CHANGED');
      }
      const matches = ratings.filter(
        (item) => item['runId'] === arm.runId && item['caseId'] === testCase.id,
      );
      const rating = matches[0];
      if (matches.length !== 1 || !rating || rating['outputHash'] !== result.outputHash) {
        throw new EvaluationExecutionError('REVIEW_OUTPUT_MISMATCH');
      }
      expectedKeys.add(`${arm.runId}:${testCase.id}`);
      return {
        caseId: testCase.id,
        humanScore: rating['humanScore'],
        humanAccepted: rating['humanAccepted'],
        judgeAccepted: rating['judgeAccepted'],
        citationErrors: rating['citationErrors'],
        latencyMs: result.latencyMs,
        costUsd: result.costUsd,
      };
    }),
  }));
  if (
    ratings.some((item) => !expectedKeys.has(`${String(item['runId'])}:${String(item['caseId'])}`))
  ) {
    throw new EvaluationExecutionError('REVIEW_INVALID');
  }
  const comparison = comparePairedEvaluationRuns({
    dataset: manifest.dataset,
    baseline: runs[0],
    candidate: runs[1],
  });
  return {
    reviewHash: hashJson({
      ...review,
      ratings: [...ratings].sort((a, b) => {
        const left = `${String(a['runId'])}:${String(a['caseId'])}`;
        const right = `${String(b['runId'])}:${String(b['caseId'])}`;
        return left < right ? -1 : left > right ? 1 : 0;
      }),
    }),
    review: {
      experimentHash: manifest.contentHash,
      rubricHash: review['rubricHash'],
      reviewerId: review['reviewerId'],
      reviewedAt: review['reviewedAt'],
    },
    comparison,
    regressionSuggestions: suggestRegressionCases(manifest.dataset, comparison),
  };
}

function readArm(value: unknown): EvaluationExecutionArm {
  const arm = record(value);
  keys(arm, ['runId', 'configuration', 'snapshots']);
  if (!identifier(arm['runId'])) throw new EvaluationExecutionError('EXPERIMENT_INVALID');
  const configuration = readEvaluationConfiguration(arm['configuration']);
  const snapshots = record(arm['snapshots']);
  keys(snapshots, ['model', 'prompt', 'retrieval', 'rubric', 'pricing']);
  for (const key of ['model', 'prompt', 'retrieval', 'rubric', 'pricing'] as const) {
    const text = snapshots[key];
    if (key === 'pricing' && text === null && configuration.pricingSnapshotHash === null) continue;
    if (typeof text !== 'string' || text.length === 0 || text.length > 1_000_000) {
      throw new EvaluationExecutionError('EXPERIMENT_INVALID');
    }
    const hashKey =
      key === 'model'
        ? 'modelSnapshotHash'
        : key === 'pricing'
          ? 'pricingSnapshotHash'
          : (`${key}Hash` as const);
    if (hashEvaluationSnapshotText(text) !== configuration[hashKey]) {
      throw new EvaluationExecutionError('SNAPSHOT_HASH_MISMATCH');
    }
  }
  let model: Record<string, unknown>;
  try {
    model = record(JSON.parse(snapshots['model'] as string) as unknown);
  } catch {
    throw new EvaluationExecutionError('EXPERIMENT_INVALID');
  }
  if (model['provider'] !== configuration.provider || model['modelId'] !== configuration.modelId) {
    throw new EvaluationExecutionError('SNAPSHOT_HASH_MISMATCH');
  }
  return {
    runId: arm['runId'],
    configuration,
    snapshots: structuredClone(snapshots) as unknown as EvaluationAgentSnapshots,
  };
}

export function readEvaluationExperimentManifest(manifest: EvaluationExperimentManifest) {
  const { format, executionOrder, contentHash, ...input } = manifest;
  const checked = prepareEvaluationExperiment(input);
  if (
    format !== checked.format ||
    executionOrder !== checked.executionOrder ||
    contentHash !== checked.contentHash
  ) {
    throw new EvaluationExecutionError('EXECUTION_CHANGED');
  }
  return checked;
}

/** Validates imported/persisted result bytes and their exact experiment, arm and case binding. */
export function readEvaluationExecutionResult(
  manifest: EvaluationExperimentManifest,
  value: unknown,
): EvaluationExecutionCaseResult {
  const row = record(value, 'EXECUTION_CHANGED');
  keys(
    row,
    [
      'experimentId',
      'runId',
      'caseId',
      'requestHash',
      'status',
      'output',
      'outputHash',
      'inputTokens',
      'outputTokens',
      'costUsd',
      'latencyMs',
      'errorCode',
      'contentHash',
    ],
    'EXECUTION_CHANGED',
  );
  const arm = [manifest.baseline, manifest.candidate].find((item) => item.runId === row['runId']);
  const testCase = manifest.dataset.cases.find((item) => item.id === row['caseId']);
  const { contentHash, ...body } = row;
  if (
    !arm ||
    !testCase ||
    row['experimentId'] !== manifest.experimentId ||
    contentHash !== hashJson(body) ||
    row['requestHash'] !== requestHash(manifest, arm, testCase) ||
    typeof row['latencyMs'] !== 'number' ||
    !Number.isFinite(row['latencyMs']) ||
    row['latencyMs'] < 0
  ) {
    throw new EvaluationExecutionError('EXECUTION_CHANGED');
  }
  if (row['status'] === 'completed') {
    readResponse(
      {
        provider: arm.configuration.provider,
        modelId: arm.configuration.modelId,
        output: row['output'],
        inputTokens: row['inputTokens'],
        outputTokens: row['outputTokens'],
        costUsd: row['costUsd'],
      },
      arm,
    );
    if (
      row['errorCode'] !== null ||
      row['outputHash'] !== hashEvaluationSnapshotText(row['output'] as string)
    ) {
      throw new EvaluationExecutionError('EXECUTION_CHANGED');
    }
  } else if (
    (row['status'] !== 'failed' && row['status'] !== 'cancelled') ||
    (row['status'] === 'cancelled'
      ? row['errorCode'] !== 'cancelled'
      : !['provider_failure', 'timeout', 'snapshot_mismatch', 'invalid_response'].includes(
          String(row['errorCode']),
        )) ||
    ['output', 'outputHash', 'inputTokens', 'outputTokens', 'costUsd'].some(
      (key) => row[key] !== null,
    )
  ) {
    throw new EvaluationExecutionError('EXECUTION_CHANGED');
  }
  return freeze(structuredClone(row)) as unknown as EvaluationExecutionCaseResult;
}

export function evaluationResultOrdinal(
  manifest: EvaluationExperimentManifest,
  result: EvaluationExecutionCaseResult,
): number {
  const index = manifest.dataset.cases.findIndex((item) => item.id === result.caseId);
  const firstRun = index % 2 === 0 ? manifest.baseline.runId : manifest.candidate.runId;
  if (index < 0 || ![manifest.baseline.runId, manifest.candidate.runId].includes(result.runId)) {
    throw new EvaluationExecutionError('EXECUTION_CHANGED');
  }
  return index * 2 + (result.runId === firstRun ? 0 : 1);
}

/** Rebuilds a case result from a verified paid-call receipt; never invokes a model. */
export function recoverEvaluationCaseResult(
  value: EvaluationExperimentManifest,
  input: {
    readonly runId: string;
    readonly caseId: string;
    readonly response: EvaluationAgentResponse | null;
    readonly latencyMs: number;
    readonly errorCode: 'snapshot_mismatch' | 'invalid_response' | null;
  },
): EvaluationExecutionCaseResult {
  const manifest = readEvaluationExperimentManifest(value);
  const arm = [manifest.baseline, manifest.candidate].find((arm) => arm.runId === input.runId);
  const testCase = manifest.dataset.cases.find((item) => item.id === input.caseId);
  if (
    !arm ||
    !testCase ||
    !Number.isFinite(input.latencyMs) ||
    input.latencyMs < 0 ||
    (input.response === null) !== (input.errorCode !== null)
  )
    throw new EvaluationExecutionError('EXECUTION_CHANGED');
  const response = input.response === null ? null : readResponse(input.response, arm);
  const row = {
    experimentId: manifest.experimentId,
    runId: arm.runId,
    caseId: testCase.id,
    requestHash: requestHash(manifest, arm, testCase),
    status: response ? ('completed' as const) : ('failed' as const),
    output: response?.output ?? null,
    outputHash: response ? hashEvaluationSnapshotText(response.output) : null,
    inputTokens: response?.inputTokens ?? null,
    outputTokens: response?.outputTokens ?? null,
    costUsd: response?.costUsd ?? null,
    latencyMs: input.latencyMs,
    errorCode: input.errorCode,
  };
  return readEvaluationExecutionResult(manifest, { ...row, contentHash: hashJson(row) });
}

function readResponse(value: unknown, arm: EvaluationExecutionArm): EvaluationAgentResponse {
  const response = record(value, 'invalid_response');
  keys(
    response,
    ['provider', 'modelId', 'output', 'inputTokens', 'outputTokens', 'costUsd'],
    'invalid_response',
  );
  if (
    response['provider'] !== arm.configuration.provider ||
    response['modelId'] !== arm.configuration.modelId
  ) {
    throw new EvaluationExecutionError('snapshot_mismatch');
  }
  if (
    typeof response['output'] !== 'string' ||
    !response['output'].trim() ||
    response['output'].length > 100_000 ||
    !nullableTokens(response['inputTokens']) ||
    !nullableTokens(response['outputTokens']) ||
    (response['costUsd'] !== null &&
      (typeof response['costUsd'] !== 'number' ||
        !Number.isFinite(response['costUsd']) ||
        response['costUsd'] < 0 ||
        arm.configuration.pricingSnapshotHash === null))
  ) {
    throw new EvaluationExecutionError('invalid_response');
  }
  return structuredClone(response) as unknown as EvaluationAgentResponse;
}

async function invokeWithSignal(
  adapter: EvaluationAgentAdapter,
  arm: EvaluationExecutionArm,
  testCase: EvaluationDatasetCase,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new EvaluationExecutionError('cancelled'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([adapter.execute({ arm, testCase, signal }), cancellation]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function requestHash(
  manifest: EvaluationExperimentManifest,
  arm: EvaluationExecutionArm,
  testCase: EvaluationDatasetCase,
) {
  return hashJson({ manifestHash: manifest.contentHash, runId: arm.runId, testCase });
}

function hashJson(value: unknown): string {
  function canonical(item: unknown): string {
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    if (item !== null && typeof item === 'object') {
      const object = item as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(item) ?? 'null';
  }
  return hashEvaluationSnapshotText(canonical(value));
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function record(
  value: unknown,
  code: EvaluationExecutionError['code'] = 'EXPERIMENT_INVALID',
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EvaluationExecutionError(code);
  return value as Record<string, unknown>;
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: EvaluationExecutionError['code'] = 'EXPERIMENT_INVALID',
) {
  if (
    Object.keys(value).length !== allowed.length ||
    allowed.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new EvaluationExecutionError(code);
  }
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(value);
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function nullableTokens(value: unknown): value is number | null {
  return value === null || integer(value, 0, Number.MAX_SAFE_INTEGER);
}
