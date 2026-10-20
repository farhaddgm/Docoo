import { z } from 'zod';
import {
  defaultDefinition,
  ROLE_STAGE,
  validateDefinition,
  type AgentDefinitionContent,
} from '@docoo/domain';
import {
  readEvaluationDataset,
  hashConfigurationSnapshot,
  evaluationCorpusV1,
  type EvaluationAgentRole,
  type EvaluationDatasetSnapshot,
} from '@docoo/domain/evaluation';
import {
  evaluationInvocationReceiptSchema,
  type EvaluationInvocationIntent,
} from '@docoo/contracts';
import {
  EvaluationExecutionError,
  hashEvaluationSnapshotText,
  readEvaluationExperimentManifest,
  type EvaluationAgentAdapter,
  type EvaluationExecutionArm,
  type EvaluationExperimentManifest,
  type EvaluationInvocationJournal,
} from '@docoo/application';
import {
  outputBudgetTokens,
  type ProviderKind,
  type NormalizedModelRequest,
} from '@docoo/providers';
import { STAGE_SCHEMAS, stagePrompt, type Stage } from './stages.js';
import type { ProviderRuntime } from './runtime.js';
import type { PoolClient } from 'pg';
import { loadAgentVersion } from './agents.js';

const roleSchema = z.enum(['analyst', 'researcher', 'ideator', 'documenter', 'evaluator']);
const definitionSchema = z
  .object({
    principles: z.array(z.string()).max(30),
    duties: z.array(z.string()).max(30),
    promptTemplate: z.string().max(8000),
    tools: z.array(z.string()).max(20),
    modelPolicy: z
      .object({ connectionId: z.uuid(), model: z.string().min(1).max(200) })
      .strict()
      .nullable(),
    outputSchemaId: z.string().min(1).max(200),
  })
  .strict();
const modelSchema = z
  .object({
    format: z.literal('docoo-stage-evaluation-model-v1'),
    mode: z.literal('stage-structured-output'),
    role: roleSchema,
    provider: z.enum(['openai', 'gemini', 'anthropic', 'deterministic']),
    runtimeProvider: z.enum(['openai', 'gemini', 'anthropic', 'fake']),
    modelId: z.string().min(1).max(200),
    connectionId: z.uuid(),
    definitionVersionId: z.uuid(),
    catalogSnapshotHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    definition: definitionSchema,
    maxOutputTokens: z.number().int().min(1024).max(16000),
    timeoutMs: z.number().int().min(1).max(300000),
  })
  .strict();
const evaluationProvider = (kind: ProviderKind) =>
  kind === 'fake' ? ('deterministic' as const) : kind;

/** Server-owned capture, not an HTTP body. A later API resolves these immutable versions in RLS. */
export function prepareStageEvaluationArm(input: {
  runId: string;
  role: EvaluationAgentRole;
  definitionVersionId: string;
  definition: AgentDefinitionContent;
  connectionId: string;
  provider: ProviderKind;
  modelId: string;
  modelMaxOutputTokens: number | null;
  catalogSnapshotHash: string | null;
  timeoutMs: number;
  dataset: EvaluationDatasetSnapshot;
  rubricText: string;
  pricingText: string | null;
}): EvaluationExecutionArm {
  const role = roleSchema.parse(input.role);
  const dataset = readEvaluationDataset(input.dataset);
  const stage = ROLE_STAGE[role]!;
  if (
    validateDefinition(role, input.definition).length ||
    input.definition.outputSchemaId !== defaultDefinition(role).outputSchemaId ||
    (input.modelMaxOutputTokens !== null &&
      (!Number.isSafeInteger(input.modelMaxOutputTokens) || input.modelMaxOutputTokens < 1024))
  )
    throw new EvaluationExecutionError('EXPERIMENT_INVALID');
  const model = modelSchema.parse({
    format: 'docoo-stage-evaluation-model-v1',
    mode: 'stage-structured-output',
    role,
    provider: evaluationProvider(input.provider),
    runtimeProvider: input.provider,
    modelId: input.modelId,
    connectionId: input.connectionId,
    definitionVersionId: input.definitionVersionId,
    definition: input.definition,
    catalogSnapshotHash: input.catalogSnapshotHash,
    maxOutputTokens: outputBudgetTokens(`stage:${stage}`, input.modelMaxOutputTokens),
    timeoutMs: input.timeoutMs,
  });
  const snapshots = {
    model: JSON.stringify(model),
    // Both languages and the exact owned schema are pinned. No generic alternate role prompt.
    prompt: JSON.stringify(
      dataset.cases.map((item) => ({
        caseId: item.id,
        ...stagePrompt({
          stage,
          definition: input.definition,
          language: item.language,
          projectTitle: 'Synthetic paired evaluation',
          problem: item.input,
          topics: [],
          previous: [],
          feedback: [],
        }),
        responseSchema: { name: `${stage}_output`, schema: STAGE_SCHEMAS[stage] },
      })),
    ),
    retrieval: JSON.stringify({
      mode: 'synthetic-only',
      datasetHash: dataset.contentHash,
      externalTools: false,
      projectData: false,
    }),
    rubric: input.rubricText,
    pricing: input.pricingText,
  };
  if (Object.values(snapshots).some((text) => text !== null && (!text || text.length > 1000000)))
    throw new EvaluationExecutionError('EXPERIMENT_INVALID');
  return structuredClone({
    runId: input.runId,
    snapshots,
    configuration: {
      role,
      provider: model.provider,
      modelId: model.modelId,
      modelSnapshotHash: hashEvaluationSnapshotText(snapshots.model),
      promptHash: hashEvaluationSnapshotText(snapshots.prompt),
      retrievalHash: hashEvaluationSnapshotText(snapshots.retrieval),
      rubricHash: hashEvaluationSnapshotText(snapshots.rubric),
      pricingSnapshotHash:
        snapshots.pricing === null ? null : hashEvaluationSnapshotText(snapshots.pricing),
    },
  });
}

/**
 * The ordinary stage request path with pinned versions, not a tool/workflow benchmark.
 * begin() must commit before invoke(); neither a timeout nor lost storage acknowledgement is retried.
 */
export function createStageEvaluationAdapter(input: {
  runtime: Pick<ProviderRuntime, 'invoke'>;
  journal: EvaluationInvocationJournal;
  scope: { workspaceId: string; projectId: string; actorId: string; correlationId: string };
  manifest: EvaluationExperimentManifest;
  environment: 'test' | 'development' | 'production';
  liveProviderUseApproved: boolean;
}): EvaluationAgentAdapter {
  const manifest = readEvaluationExperimentManifest(input.manifest);
  const arms = [manifest.baseline, manifest.candidate].map((arm) => {
    const model = modelSchema.parse(JSON.parse(arm.snapshots.model) as unknown);
    const definition = model.definition as AgentDefinitionContent;
    if (
      model.role !== arm.configuration.role ||
      model.provider !== evaluationProvider(model.runtimeProvider) ||
      model.timeoutMs !== manifest.timeoutMs ||
      (model.runtimeProvider === 'fake' && input.environment === 'production') ||
      (model.runtimeProvider !== 'fake' && !input.liveProviderUseApproved)
    )
      throw new EvaluationExecutionError('EXPERIMENT_INVALID');
    const rebuilt = prepareStageEvaluationArm({
      runId: arm.runId,
      role: model.role,
      definitionVersionId: model.definitionVersionId,
      definition,
      connectionId: model.connectionId,
      provider: model.runtimeProvider,
      modelId: model.modelId,
      catalogSnapshotHash: model.catalogSnapshotHash,
      modelMaxOutputTokens: model.maxOutputTokens,
      timeoutMs: model.timeoutMs,
      dataset: manifest.dataset,
      rubricText: arm.snapshots.rubric,
      pricingText: arm.snapshots.pricing,
    });
    if (
      hashConfigurationSnapshot(rebuilt.configuration) !==
        hashConfigurationSnapshot(arm.configuration) ||
      (Object.keys(rebuilt.snapshots) as (keyof typeof rebuilt.snapshots)[]).some(
        (key) => rebuilt.snapshots[key] !== arm.snapshots[key],
      )
    )
      throw new EvaluationExecutionError('snapshot_mismatch');
    return { arm, model, stage: ROLE_STAGE[model.role] as Stage, definition };
  });
  return {
    async execute({ arm, testCase, signal }) {
      signal.throwIfAborted();
      const pinned = arms.find((item) => item.arm.runId === arm.runId);
      const expectedCase = manifest.dataset.cases.find((item) => item.id === testCase.id);
      if (
        !pinned ||
        JSON.stringify(pinned.arm) !== JSON.stringify(arm) ||
        JSON.stringify(expectedCase) !== JSON.stringify(testCase)
      )
        throw new EvaluationExecutionError('snapshot_mismatch');
      const prompt = stagePrompt({
        stage: pinned.stage,
        definition: pinned.definition,
        language: testCase.language,
        projectTitle: 'Synthetic paired evaluation',
        problem: testCase.input,
        topics: [],
        previous: [],
        feedback: [],
      });
      const request: NormalizedModelRequest = {
        model: pinned.model.modelId,
        instructions: prompt.instructions,
        messages: [{ role: 'user', content: prompt.message }],
        responseSchema: { name: `${pinned.stage}_output`, schema: STAGE_SCHEMAS[pinned.stage] },
        maxOutputTokens: pinned.model.maxOutputTokens,
        timeoutMs: pinned.model.timeoutMs,
        idempotencyKey: hashEvaluationSnapshotText(
          `${manifest.contentHash}:${arm.runId}:${testCase.id}`,
        ),
      };
      const intent: EvaluationInvocationIntent = {
        experimentId: manifest.experimentId,
        experimentHash: manifest.contentHash,
        runId: arm.runId,
        caseId: testCase.id,
        modelSnapshotHash: arm.configuration.modelSnapshotHash,
        requestHash: hashEvaluationSnapshotText(JSON.stringify(request)),
      };
      await input.journal.begin(intent);
      signal.throwIfAborted();
      let invoked: Awaited<ReturnType<ProviderRuntime['invoke']>>;
      try {
        invoked = await input.runtime.invoke(
          {
            ...input.scope,
            stageRunId: null,
            attemptId: null,
            purpose: 'evaluation:paired',
            retryNo: 0,
            expectedProvider: pinned.model.runtimeProvider,
            agentDefinitionVersionId: pinned.model.definitionVersionId,
            promptSha256: intent.requestHash,
          },
          pinned.model.connectionId,
          request,
        );
      } catch {
        await input.journal.unknown(intent);
        throw new EvaluationExecutionError('provider_failure');
      }
      const { response, invocationId } = invoked;
      const observedProvider = evaluationProvider(response.provider);
      const output = JSON.stringify(response.json) ?? response.text;
      const errorCode =
        observedProvider !== pinned.model.provider || response.model !== pinned.model.modelId
          ? ('snapshot_mismatch' as const)
          : response.finishReason !== 'stop' ||
              response.json === null ||
              typeof response.json !== 'object' ||
              Array.isArray(response.json) ||
              !output?.trim() ||
              output.length > 100000
            ? ('invalid_response' as const)
            : null;
      const receipt = evaluationInvocationReceiptSchema.parse({
        invocationId,
        observedProvider,
        observedModelId: response.model,
        outputHash: hashEvaluationSnapshotText(output),
        errorCode,
        response: errorCode
          ? null
          : {
              provider: observedProvider,
              modelId: response.model,
              output,
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              costUsd: null,
            },
      });
      // A price estimate from runtime is intentionally not copied to measured cost.
      await input.journal.returned(intent, receipt);
      if (errorCode) throw new EvaluationExecutionError(errorCode);
      return receipt.response!;
    },
  };
}

export const STAGE_EVALUATION_RUBRIC = JSON.stringify({
  format: 'docoo-stage-evaluation-rubric-v1',
  mode: 'stage-structured-output',
  scoreRange: [0, 100],
  guidance: {
    fa: 'هر خروجی را با ورودی و انتظارات پرونده بسنجید؛ صحت، ارجاع و محدودیت‌ها را بررسی کنید. نبود داده را صفر یا یقین حساب نکنید.',
    en: 'Review each output against its input and case invariants for correctness, citations and limitations. Missing data is not zero or certainty.',
  },
  limitations:
    'Synthetic self-contained stage calls, no external tools, upstream workflow outputs, or real project knowledge. Not a full-agent workflow benchmark.',
});

/** Resolves allowed immutable definitions and the current catalog under the initiating actor RLS. */
export async function captureStageEvaluationArm(
  client: PoolClient,
  input: {
    workspaceId: string;
    projectId: string;
    runId: string;
    role: EvaluationAgentRole;
    timeoutMs: number;
    selection: { definitionVersionId: string; connectionId: string; modelId: string };
  },
) {
  const selection = z
    .object({
      definitionVersionId: z.uuid(),
      connectionId: z.uuid(),
      modelId: z.string().min(1).max(200),
    })
    .strict()
    .parse(input.selection);
  const project = (
    await client.query(
      `select 1 from projects where id=$1 and workspace_id=$2 and deleted_at is null
    and status not in ('archived','deleted') and app.actor_role($2) in ('super_admin','editor')
    and app.resource_access('project',$2,$1)='EDIT'`,
      [input.projectId, input.workspaceId],
    )
  ).rowCount;
  if (!project) throw new EvaluationExecutionError('EXPERIMENT_INVALID');
  const definition = await loadAgentVersion(
    client,
    input.workspaceId,
    selection.definitionVersionId,
  );
  if (
    !definition ||
    definition.role !== input.role ||
    (definition.projectId !== null && definition.projectId !== input.projectId)
  )
    throw new EvaluationExecutionError('EXPERIMENT_INVALID');
  const rows = (
    await client.query<{ provider: ProviderKind; model: unknown; hash: string; price: unknown }>(
      `select * from app.evaluation_model_snapshot($1,$2,$3,$4)`,
      [input.workspaceId, input.projectId, selection.connectionId, selection.modelId],
    )
  ).rows;
  if (rows.length !== 1) throw new EvaluationExecutionError('EXPERIMENT_INVALID');
  const row = rows[0]!;
  const descriptorSchema = z
    .object({
      id: z.string(),
      capabilities: z
        .object({ text: z.literal(true), structuredOutput: z.literal(true) })
        .passthrough(),
      maxOutputTokens: z.number().int().positive().nullable(),
    })
    .passthrough();
  const descriptor = descriptorSchema.safeParse(row.model);
  if (!descriptor.success || descriptor.data.id !== selection.modelId)
    throw new EvaluationExecutionError('EXPERIMENT_INVALID');
  const content: AgentDefinitionContent = {
    principles: definition.principles,
    duties: definition.duties,
    promptTemplate: definition.promptTemplate,
    tools: definition.tools,
    modelPolicy: definition.modelPolicy,
    outputSchemaId: definition.outputSchemaId,
  };
  return prepareStageEvaluationArm({
    runId: input.runId,
    role: input.role,
    definitionVersionId: definition.id,
    definition: content,
    connectionId: selection.connectionId,
    provider: row.provider,
    modelId: selection.modelId,
    modelMaxOutputTokens: descriptor.data.maxOutputTokens,
    catalogSnapshotHash: row.hash,
    timeoutMs: input.timeoutMs,
    dataset: evaluationCorpusV1,
    rubricText: STAGE_EVALUATION_RUBRIC,
    pricingText: row.price === null ? null : JSON.stringify(row.price),
  });
}
