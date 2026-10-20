import { z } from 'zod';
import type { Pool } from 'pg';
import { evaluationExperimentIdSchema } from '@docoo/contracts';
import { recoverEvaluationCaseResult } from '@docoo/application';
import {
  PostgresEvaluationExecutionStore,
  PostgresEvaluationInvocationJournal,
} from '@docoo/database';
import { inWorkspace } from './db.js';
import { createStageEvaluationAdapter } from './paired-evaluation-provider.js';
import type { ProviderRuntime } from './runtime.js';

const refSchema = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    actorId: z.uuid(),
    experimentId: evaluationExperimentIdSchema,
    correlationId: z.uuid(),
  })
  .strict();
export type PairedEvaluationRef = z.infer<typeof refSchema>;
export type PairedEvaluationState =
  'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface PairedEvaluationActivities {
  evaluationPlan(
    ref: PairedEvaluationRef,
  ): Promise<{ status: PairedEvaluationState; total: number }>;
  evaluationCase(
    ref: PairedEvaluationRef & { ordinal: number },
  ): Promise<{ status: 'completed' | 'failed' | 'interrupted'; reused: boolean }>;
  evaluationFinish(
    ref: PairedEvaluationRef & { status: 'completed' | 'failed' | 'cancelled' | 'interrupted' },
  ): Promise<void>;
}

/** Retryable activities recover receipts/results; they never retry a pending/unknown external call. */
export function createPairedEvaluationActivities(
  pool: Pool,
  runtime: ProviderRuntime,
  options: {
    enabled: boolean;
    environment: 'development' | 'test' | 'production';
    liveProviderUseApproved: boolean;
  },
): PairedEvaluationActivities {
  const store = (ref: PairedEvaluationRef) =>
    new PostgresEvaluationExecutionStore(pool, ref, ref.projectId);
  const journal = (ref: PairedEvaluationRef) =>
    new PostgresEvaluationInvocationJournal(pool, ref, ref.projectId);
  const owned = async (ref: PairedEvaluationRef) => {
    refSchema.parse(ref);
    const owner = await inWorkspace(
      pool,
      ref,
      async (c) =>
        (
          await c.query<{ created_by: string }>(
            `select created_by from project_evaluation_experiments where workspace_id=$1 and project_id=$2 and experiment_id=$3`,
            [ref.workspaceId, ref.projectId, ref.experimentId],
          )
        ).rows[0],
    );
    if (!owner || owner.created_by !== ref.actorId) throw new Error('EVALUATION_SCOPE_UNAVAILABLE');
    return store(ref).get(ref.experimentId);
  };
  const stop = async (ref: PairedEvaluationRef) => {
    await store(ref).interrupt(ref.experimentId);
    return { status: 'interrupted' as const, reused: true };
  };
  return {
    async evaluationPlan(rawRef) {
      const ref = refSchema.parse(rawRef);
      try {
        const execution = await owned(ref);
        if (!options.enabled && execution.status === 'running')
          return { ...(await stop(ref)), total: 0 };
        return { status: execution.status, total: execution.manifest.dataset.cases.length * 2 };
      } catch {
        return { ...(await stop(ref)), total: 0 };
      }
    },
    async evaluationCase({ ordinal, ...rawRef }) {
      const ref = refSchema.parse(rawRef);
      if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= 1000)
        throw new Error('EVALUATION_ORDINAL_INVALID');
      let execution;
      try {
        execution = await owned(ref);
      } catch {
        return stop(ref);
      }
      const existing = execution.results[ordinal];
      if (existing)
        return { status: existing.status === 'completed' ? 'completed' : 'failed', reused: true };
      if (execution.status !== 'running') return { status: 'interrupted', reused: true };
      if (!options.enabled) return stop(ref);
      const manifest = execution.manifest;
      if (ordinal !== execution.results.length || ordinal >= manifest.dataset.cases.length * 2)
        throw new Error('EVALUATION_ORDINAL_INVALID');
      const index = Math.floor(ordinal / 2);
      const testCase = manifest.dataset.cases[index]!;
      const first = index % 2 === ordinal % 2;
      const arm = first ? manifest.baseline : manifest.candidate;
      const calls = journal(ref);
      let entry = await calls.get(ref.experimentId, arm.runId, testCase.id);
      const reused = entry !== null;
      if (entry?.status === 'pending' || entry?.status === 'unknown') return stop(ref);
      if (!entry) {
        try {
          const adapter = createStageEvaluationAdapter({
            runtime,
            journal: calls,
            scope: ref,
            manifest,
            environment: options.environment,
            liveProviderUseApproved: options.liveProviderUseApproved,
          });
          const signal = AbortSignal.timeout(manifest.timeoutMs);
          await adapter.execute({ arm, testCase, signal });
          if (signal.aborted) return stop(ref);
        } catch {
          // A definite observed error has a receipt; a lost/unknown call must be stopped.
        }
        try {
          entry = await calls.get(ref.experimentId, arm.runId, testCase.id);
        } catch {
          return stop(ref);
        }
      }
      if (
        entry?.status !== 'returned' ||
        !entry.receipt ||
        entry.latencyMs === null ||
        !Number.isFinite(entry.latencyMs) ||
        entry.latencyMs < 0
      )
        return stop(ref);
      const result = recoverEvaluationCaseResult(manifest, {
        runId: arm.runId,
        caseId: testCase.id,
        response: entry.receipt.response,
        latencyMs: entry.latencyMs,
        errorCode: entry.receipt.errorCode,
      });
      // If this acknowledgement is lost, a retry observes the committed result above.
      await store(ref).append(result);
      return { status: result.status === 'completed' ? 'completed' : 'failed', reused };
    },
    async evaluationFinish({ status, ...rawRef }) {
      const ref = refSchema.parse(rawRef);
      if (status === 'interrupted') {
        await stop(ref);
        return;
      }
      const execution = await owned(ref);
      if (execution.status === status) return;
      if (execution.status !== 'running') return;
      await store(ref).finish(ref.experimentId, status);
    },
  };
}
