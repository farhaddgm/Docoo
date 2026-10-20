import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  evaluationBlindReviewPackSchema,
  evaluationComparisonPageSchema,
  evaluationExperimentIdSchema,
  evaluationExperimentPageSchema,
  type EvaluationBlindReviewInput,
} from '@docoo/contracts';
import {
  createEvaluationBlindReviewPack,
  prepareEvaluationBlindReview,
  prepareEvaluationExperiment,
  EvaluationExecutionError,
} from '@docoo/application';
import { PairedEvaluationError, evaluationCorpusV1 } from '@docoo/domain/evaluation';
import {
  EvaluationStoreError,
  PostgresEvaluationExecutionStore,
  setDatabaseRequestContext,
} from '@docoo/database';
import { captureStageEvaluationArm, pairedEvaluationWorkflowId } from '@docoo/orchestration';
import type { Environment } from '@docoo/config';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { API_CONFIG, DATABASE_POOL } from '../tokens.js';
import type { WorkspaceRequestContext as ProjectRequestContext } from '../common/request-context.js';
import {
  WORKFLOW_ENGINE,
  WorkflowEngineUnavailableError,
  type WorkflowEngine,
} from '../workflow/workflow.engine.js';

const cursorSchema = z
  .object({
    version: z.literal(1),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    createdAt: z.iso.datetime(),
    id: evaluationExperimentIdSchema,
  })
  .strict();

export const evaluationStartInputSchema = z
  .object({
    role: z.enum(['analyst', 'researcher', 'ideator', 'documenter', 'evaluator']),
    repetition: z.number().int().min(1).max(1000).default(1),
    timeoutMs: z.number().int().min(1000).max(300_000).default(90_000),
    baseline: z
      .object({
        definitionVersionId: z.uuid(),
        connectionId: z.uuid(),
        modelId: z.string().min(1).max(200),
      })
      .strict(),
    candidate: z
      .object({
        definitionVersionId: z.uuid(),
        connectionId: z.uuid(),
        modelId: z.string().min(1).max(200),
      })
      .strict(),
  })
  .strict();
type EvaluationStartInput = z.infer<typeof evaluationStartInputSchema>;

@Injectable()
export class EvaluationLabService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEngine,
    @Inject(API_CONFIG) private readonly config: Environment,
  ) {}

  async start(
    context: ProjectRequestContext,
    projectId: string,
    input: EvaluationStartInput,
    commandKey: string,
  ) {
    if (!this.config.EVALUATION_LAB_ENABLED || !this.config.EVALUATION_LAB_LIVE_ENABLED)
      throw new ForbiddenException({
        status: 403,
        code: 'EVALUATION_LAB_DISABLED',
        detail: 'Evaluation runs are disabled by the server operator.',
      });
    return this.safe(async () => {
      projectId = projectId.toLowerCase();
      const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const store = this.store(context, projectId);
      let queued: {
        experimentId: string;
        state: 'pending' | 'started';
        replayed: boolean;
      } | null = await store.findStartCommand(commandKey, requestHash);
      if (!queued) {
        const client = await this.pool.connect();
        let manifest: ReturnType<typeof prepareEvaluationExperiment>;
        try {
          await client.query('begin');
          await setDatabaseRequestContext(client, context);
          const baseline = await this.capture(
            client,
            context,
            projectId,
            input,
            input.baseline,
            'baseline',
          );
          const candidate = await this.capture(
            client,
            context,
            projectId,
            input,
            input.candidate,
            'candidate',
          );
          manifest = prepareEvaluationExperiment({
            experimentId: randomUUID(),
            repetition: input.repetition,
            timeoutMs: input.timeoutMs,
            dataset: evaluationCorpusV1,
            baseline,
            candidate,
          });
          await client.query('commit');
        } catch (error) {
          await client.query('rollback').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
        queued = await store.enqueue(manifest, commandKey, requestHash);
      }
      let state = queued.state;
      if (state === 'pending') {
        try {
          if (!this.engine.startPairedEvaluation) throw new WorkflowEngineUnavailableError();
          await this.engine.startPairedEvaluation(
            pairedEvaluationWorkflowId(context.workspaceId, projectId, queued.experimentId),
            {
              workspaceId: context.workspaceId.toLowerCase(),
              projectId: projectId.toLowerCase(),
              actorId: context.actorId.toLowerCase(),
              experimentId: queued.experimentId.toLowerCase(),
              correlationId: context.correlationId.toLowerCase(),
            },
          );
          state = await store.recordStartAttempt(queued.experimentId, true);
        } catch (error) {
          if (!(error instanceof WorkflowEngineUnavailableError)) throw error;
          state = await store.recordStartAttempt(queued.experimentId, false);
        }
      }
      return {
        experimentId: queued.experimentId,
        status: state === 'started' ? 'running' : 'queued',
        delivery: state,
        replayed: queued.replayed,
      } as const;
    });
  }

  private async capture(
    client: PoolClient,
    context: ProjectRequestContext,
    projectId: string,
    input: EvaluationStartInput,
    selection: EvaluationStartInput['baseline'],
    runId: string,
  ) {
    return captureStageEvaluationArm(client, {
      workspaceId: context.workspaceId,
      projectId,
      runId,
      role: input.role,
      timeoutMs: input.timeoutMs,
      selection,
    });
  }

  async list(context: ProjectRequestContext, projectId: string, limit: number, rawCursor?: string) {
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (rawCursor) {
      try {
        if (!/^[A-Za-z0-9_-]{1,1024}$/.test(rawCursor)) throw new Error('cursor');
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8')) as unknown,
        );
        if (cursor.workspaceId !== context.workspaceId || cursor.projectId !== projectId)
          throw new Error('cursor');
      } catch {
        throw this.invalid('EVALUATION_LAB_INVALID_CURSOR');
      }
    }
    return this.safe(async () => {
      const rows = await this.store(context, projectId).list(limit, cursor);
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      const nextCursor =
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                version: 1,
                workspaceId: context.workspaceId,
                projectId,
                createdAt: last.createdAt,
                id: last.id,
              }),
            ).toString('base64url')
          : null;
      return evaluationExperimentPageSchema.parse({ items, nextCursor });
    });
  }

  async reviewPack(context: ProjectRequestContext, projectId: string, experimentId: string) {
    return this.safe(async () => {
      const execution = await this.store(context, projectId).get(experimentId);
      if (execution.status !== 'completed') throw this.incomplete();
      return evaluationBlindReviewPackSchema.parse(
        createEvaluationBlindReviewPack({ ...execution, status: execution.status }),
      );
    });
  }

  async comparisons(context: ProjectRequestContext, projectId: string, experimentId: string) {
    return this.safe(async () =>
      evaluationComparisonPageSchema.parse({
        items: await this.store(context, projectId).comparisons(experimentId),
      }),
    );
  }

  async review(
    context: ProjectRequestContext,
    projectId: string,
    experimentId: string,
    input: EvaluationBlindReviewInput,
    commandKey: string,
  ) {
    return this.safe(async () => {
      const store = this.store(context, projectId);
      const execution = await store.get(experimentId);
      if (execution.status !== 'completed') throw this.incomplete();
      const mapped = prepareEvaluationBlindReview(
        { ...execution, status: execution.status },
        context.actorId,
        input,
      );
      const saved = await store.review(experimentId, mapped, commandKey);
      return { id: saved.id };
    });
  }

  private store(context: ProjectRequestContext, projectId: string) {
    return new PostgresEvaluationExecutionStore(this.pool, context, projectId);
  }

  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof EvaluationStoreError) {
        if (error.code === 'REVIEW_FORBIDDEN')
          throw new ForbiddenException({
            status: 403,
            code: 'AUTH_PERMISSION_DENIED',
            detail: 'Reviewing requires edit access.',
          });
        if (error.code === 'IDEMPOTENCY_CONFLICT')
          throw new ConflictException({
            status: 409,
            code: 'EVALUATION_LAB_IDEMPOTENCY_CONFLICT',
            detail: 'This command key was already used for a different review.',
          });
        if (error.code === 'NOT_FOUND')
          throw new NotFoundException({
            status: 404,
            code: 'EVALUATION_LAB_NOT_FOUND',
            detail: 'The project or experiment is unavailable.',
          });
        throw this.incomplete();
      }
      if (error instanceof EvaluationExecutionError) {
        if (error.code === 'REVIEW_OUTPUT_MISMATCH' || error.code === 'EXECUTION_CHANGED') {
          throw new ConflictException({
            status: 409,
            code: 'EVALUATION_LAB_REVIEW_CHANGED',
            detail: 'Reload the exact experiment outputs before reviewing.',
          });
        }
        throw this.incomplete();
      }
      if (error instanceof PairedEvaluationError)
        throw this.invalid('EVALUATION_LAB_INVALID_REVIEW');
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '42501'
      ) {
        throw new ForbiddenException({
          status: 403,
          code: 'AUTH_PERMISSION_DENIED',
          detail: 'This project action is not permitted.',
        });
      }
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw new ConflictException({
          status: 409,
          code: 'EVALUATION_LAB_IDEMPOTENCY_CONFLICT',
          detail: 'This command key was already used for a different request.',
        });
      throw error;
    }
  }

  private incomplete() {
    return new ConflictException({
      status: 409,
      code: 'EVALUATION_LAB_INCOMPLETE',
      detail: 'Only a complete, unchanged pair of runs can be reviewed.',
    });
  }
  private invalid(code: string) {
    return new BadRequestException({
      status: 400,
      code,
      detail: 'Provide a valid project-scoped evaluation request.',
    });
  }
}
