import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { defaultDefinition, ROLE_STAGE } from '@docoo/domain';
import { evaluationCorpusV1, type EvaluationAgentRole } from '@docoo/domain/evaluation';
import {
  prepareEvaluationExperiment,
  hashEvaluationSnapshotText,
  EvaluationInvocationError,
  type EvaluationInvocationJournal,
} from '@docoo/application';
import type { EvaluationInvocationIntent, EvaluationInvocationReceipt } from '@docoo/contracts';
import type { NormalizedModelResponse } from '@docoo/providers';
import {
  createStageEvaluationAdapter,
  prepareStageEvaluationArm,
} from './paired-evaluation-provider.js';
import { STAGE_SCHEMAS, stagePrompt } from './stages.js';

const connectionId = randomUUID();
const scope = {
  workspaceId: randomUUID(),
  projectId: randomUUID(),
  actorId: randomUUID(),
  correlationId: randomUUID(),
};
function fixture(role: EvaluationAgentRole = 'researcher') {
  const definition = defaultDefinition(role);
  const common = {
    role,
    definition,
    connectionId,
    provider: 'fake' as const,
    modelId: 'fake-standard',
    modelMaxOutputTokens: 4096,
    catalogSnapshotHash: null,
    timeoutMs: 1000,
    dataset: evaluationCorpusV1,
    rubricText: 'Human scoring on supplied evidence.',
    pricingText: null,
  };
  const baseline = prepareStageEvaluationArm({
    ...common,
    runId: 'baseline-01',
    definitionVersionId: randomUUID(),
  });
  const candidate = prepareStageEvaluationArm({
    ...common,
    runId: 'candidate-01',
    definitionVersionId: randomUUID(),
    definition: {
      ...definition,
      promptTemplate: definition.promptTemplate + ' Explain missing evidence explicitly.',
    },
  });
  const manifest = prepareEvaluationExperiment({
    experimentId: 'stage-experiment',
    repetition: 1,
    timeoutMs: 1000,
    dataset: evaluationCorpusV1,
    baseline,
    candidate,
  });
  const entries = new Map<string, { status: string; receipt?: EvaluationInvocationReceipt }>();
  const key = (intent: EvaluationInvocationIntent) => `${intent.runId}:${intent.caseId}`;
  const journal: EvaluationInvocationJournal = {
    begin(intent) {
      if (entries.has(key(intent))) throw new EvaluationInvocationError('ALREADY_STARTED');
      entries.set(key(intent), { status: 'pending' });
      return Promise.resolve();
    },
    returned(intent, receipt) {
      entries.set(key(intent), { status: 'returned', receipt });
      return Promise.resolve();
    },
    unknown(intent) {
      entries.set(key(intent), { status: 'unknown' });
      return Promise.resolve();
    },
  };
  const response: NormalizedModelResponse = {
    provider: 'fake',
    model: 'fake-standard',
    text: '{"answer":"synthetic"}',
    json: { answer: 'synthetic' },
    toolCalls: [],
    finishReason: 'stop',
    rawFinishReason: 'stop',
    usage: { inputTokens: 24, outputTokens: 6, reasoningTokens: null, cachedInputTokens: null },
    providerRequestId: 'synthetic',
    latencyMs: 7,
  };
  const runtime = {
    invoke: vi.fn(() => Promise.resolve({ response, invocationId: randomUUID(), costUsd: 999 })),
  };
  const create = (options = {}) =>
    createStageEvaluationAdapter({
      runtime,
      journal,
      scope,
      manifest,
      environment: 'test',
      liveProviderUseApproved: false,
      ...options,
    });
  const execute = (adapter = create()) =>
    adapter.execute({
      arm: manifest.baseline,
      testCase: manifest.dataset.cases[0]!,
      signal: new AbortController().signal,
    });
  return { common, manifest, definition, entries, journal, runtime, response, create, execute };
}

describe('production stage snapshots and invocation fencing', () => {
  it.each(['analyst', 'researcher', 'ideator', 'documenter', 'evaluator'] as const)(
    'uses the actual %s stage prompt/schema in both languages with exact pinned limits',
    async (role) => {
      const f = fixture(role);
      const adapter = f.create();
      for (const testCase of f.manifest.dataset.cases.slice(0, 2)) {
        const result = await adapter.execute({
          arm: f.manifest.baseline,
          testCase,
          signal: new AbortController().signal,
        });
        const [invocationScope, selectedConnection, request] = f.runtime.invoke.mock.calls.at(
          -1,
        )! as unknown as [Record<string, unknown>, string, Record<string, unknown>];
        const stage = ROLE_STAGE[role]!;
        const prompt = stagePrompt({
          stage,
          definition: f.definition,
          language: testCase.language,
          projectTitle: 'Synthetic paired evaluation',
          problem: testCase.input,
          topics: [],
          previous: [],
          feedback: [],
        });
        expect(request).toMatchObject({
          model: 'fake-standard',
          instructions: prompt.instructions,
          messages: [{ role: 'user', content: prompt.message }],
          responseSchema: { name: `${stage}_output`, schema: STAGE_SCHEMAS[stage] },
          maxOutputTokens: 4096,
          timeoutMs: 1000,
        });
        expect(request['tools']).toBeUndefined();
        expect(invocationScope).toMatchObject({
          ...scope,
          purpose: 'evaluation:paired',
          expectedProvider: 'fake',
        });
        expect(selectedConnection).toBe(connectionId);
        expect(invocationScope['promptSha256']).toBe(
          hashEvaluationSnapshotText(JSON.stringify(request)),
        );
        expect(result.costUsd).toBeNull(); // The deliberately huge estimate is not an invoice.
      }
    },
  );

  it('writes the intent before a call and the response receipt before exposing a result', async () => {
    const f = fixture();
    const order: string[] = [];
    vi.spyOn(f.journal, 'begin').mockImplementation(() => {
      order.push('intent');
      return Promise.resolve();
    });
    f.runtime.invoke.mockImplementation(() => {
      order.push('invoke');
      return Promise.resolve({ response: f.response, invocationId: randomUUID(), costUsd: 999 });
    });
    vi.spyOn(f.journal, 'returned').mockImplementation(() => {
      order.push('receipt');
      return Promise.resolve();
    });
    await f.execute();
    expect(order).toEqual(['intent', 'invoke', 'receipt']);
  });

  it('does not replay an acknowledged intent or a lost receipt acknowledgement', async () => {
    const f = fixture();
    const adapter = f.create();
    await f.execute(adapter);
    await expect(f.execute(adapter)).rejects.toMatchObject({ code: 'ALREADY_STARTED' });
    expect(f.runtime.invoke).toHaveBeenCalledTimes(1);
    const g = fixture();
    vi.spyOn(g.journal, 'returned').mockRejectedValue(new Error('lost storage acknowledgement'));
    await expect(g.execute()).rejects.toThrow('lost storage acknowledgement');
    expect([...g.entries.values()][0]?.status).toBe('pending');
    await expect(g.execute()).rejects.toMatchObject({ code: 'ALREADY_STARTED' });
    expect(g.runtime.invoke).toHaveBeenCalledTimes(1);
  });

  it('fences provider failure as unknown without storing private exception details or retrying', async () => {
    const f = fixture();
    f.runtime.invoke.mockRejectedValue(new Error('private-api-key-and-content'));
    await expect(f.execute()).rejects.toMatchObject({ code: 'provider_failure' });
    expect([...f.entries.values()]).toEqual([{ status: 'unknown' }]);
    await expect(f.execute()).rejects.toMatchObject({ code: 'ALREADY_STARTED' });
    expect(f.runtime.invoke).toHaveBeenCalledTimes(1);
  });

  it.each(['model', 'finish'] as const)(
    'records an observed %s failure, not a successful quality output',
    async (kind) => {
      const f = fixture();
      f.runtime.invoke.mockResolvedValue({
        response:
          kind === 'model'
            ? { ...f.response, model: 'unexpected-model' }
            : { ...f.response, finishReason: 'length' },
        invocationId: randomUUID(),
        costUsd: 999,
      });
      await expect(f.execute()).rejects.toMatchObject({
        code: kind === 'model' ? 'snapshot_mismatch' : 'invalid_response',
      });
      const receipt = [...f.entries.values()][0]?.receipt;
      expect(receipt?.response).toBeNull();
      expect(receipt?.invocationId).toBeDefined();
    },
  );

  it('rejects edited cases, code/prompt drift, fake production and unapproved live calls before spending', async () => {
    const f = fixture();
    await expect(
      f.create().execute({
        arm: f.manifest.baseline,
        testCase: { ...f.manifest.dataset.cases[0]!, input: 'changed' },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'snapshot_mismatch' });
    expect(() => f.create({ environment: 'production' })).toThrow('EXPERIMENT_INVALID');
    const changed = {
      ...f.manifest.baseline,
      snapshots: { ...f.manifest.baseline.snapshots, prompt: 'changed code' },
    };
    changed.configuration = {
      ...changed.configuration,
      promptHash: hashEvaluationSnapshotText(changed.snapshots.prompt),
    };
    const experimentInput = {
      experimentId: f.manifest.experimentId,
      repetition: f.manifest.repetition,
      timeoutMs: f.manifest.timeoutMs,
      dataset: f.manifest.dataset,
      baseline: f.manifest.baseline,
      candidate: f.manifest.candidate,
    };
    const drift = prepareEvaluationExperiment({ ...experimentInput, baseline: changed });
    expect(() => f.create({ manifest: drift })).toThrow('snapshot_mismatch');
    const live = prepareStageEvaluationArm({
      ...f.common,
      provider: 'openai',
      runId: 'baseline-live',
      definitionVersionId: randomUUID(),
    });
    const liveManifest = prepareEvaluationExperiment({ ...experimentInput, baseline: live });
    expect(() => f.create({ manifest: liveManifest })).toThrow('EXPERIMENT_INVALID');
    expect(f.runtime.invoke).not.toHaveBeenCalled();
    expect(f.entries.size).toBe(0);
  });

  it('does not call after cancellation, including cancellation while an intent commits', async () => {
    const f = fixture();
    const controller = new AbortController();
    vi.spyOn(f.journal, 'begin').mockImplementation(() => {
      controller.abort();
      return Promise.resolve();
    });
    await expect(
      f.create().execute({
        arm: f.manifest.baseline,
        testCase: f.manifest.dataset.cases[0]!,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(f.runtime.invoke).not.toHaveBeenCalled();
  });
});
