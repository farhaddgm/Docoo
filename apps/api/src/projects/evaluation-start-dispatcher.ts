import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Environment } from '@docoo/config';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PostgresEvaluationExecutionStore } from '@docoo/database';
import { pairedEvaluationWorkflowId } from '@docoo/orchestration';
import { API_CONFIG, DATABASE_POOL } from '../tokens.js';
import {
  WORKFLOW_ENGINE,
  WorkflowEngineUnavailableError,
  type WorkflowEngine,
} from '../workflow/workflow.engine.js';

interface ClaimedEvaluationStart {
  workspace_id: string;
  project_id: string;
  experiment_id: string;
  actor_id: string;
}

/** Retries committed API outbox rows after process or Temporal outages. */
@Injectable()
export class EvaluationStartDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvaluationStartDispatcher.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private dispatching = false;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEngine,
    @Inject(API_CONFIG) private readonly config: Environment,
  ) {}

  onModuleInit(): void {
    if (!this.config.EVALUATION_LAB_ENABLED || !this.config.EVALUATION_LAB_LIVE_ENABLED) return;
    this.timer = setInterval(() => void this.drain(), 5_000);
    this.timer.unref();
    void this.drain();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async drain(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      for (let count = 0; count < 10; count += 1) {
        const claim = (
          await this.pool.query<ClaimedEvaluationStart>(
            'select * from app.claim_evaluation_start()',
          )
        ).rows[0];
        if (!claim) break;
        const context = {
          workspaceId: claim.workspace_id,
          actorId: claim.actor_id,
          correlationId: randomUUID(),
        };
        try {
          if (!this.engine.startPairedEvaluation) throw new WorkflowEngineUnavailableError();
          await this.engine.startPairedEvaluation(
            pairedEvaluationWorkflowId(claim.workspace_id, claim.project_id, claim.experiment_id),
            {
              workspaceId: claim.workspace_id.toLowerCase(),
              projectId: claim.project_id.toLowerCase(),
              actorId: claim.actor_id.toLowerCase(),
              experimentId: claim.experiment_id.toLowerCase(),
              correlationId: context.correlationId,
            },
          );
          await new PostgresEvaluationExecutionStore(
            this.pool,
            context,
            claim.project_id,
          ).completeStartDelivery(claim.experiment_id);
        } catch {
          this.logger.warn('A paired evaluation start is still pending and will be retried.');
        }
      }
    } catch {
      this.logger.warn('The paired evaluation outbox is temporarily unavailable.');
    } finally {
      this.dispatching = false;
    }
  }
}
