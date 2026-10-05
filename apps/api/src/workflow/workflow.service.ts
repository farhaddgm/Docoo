import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { projectWorkflowId, STAGES } from '@docoo/orchestration';
import type { PoolClient, QueryResultRow } from 'pg';

import { BusinessService } from '../business/business.service.js';
import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import { badRequest, conflict, notFound } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { CommandRunner, engineUnavailable, type PendingSignal } from './command-runner.js';
import {
  WORKFLOW_ENGINE,
  WorkflowEngineUnavailableError,
  type WorkflowEngine,
  type WorkflowSignal,
} from './workflow.engine.js';

interface RunRow extends QueryResultRow {
  id: string;
  run_no: number;
  temporal_workflow_id: string;
  status: string;
  current_stage: string | null;
  config_snapshot_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

interface StageRow extends QueryResultRow {
  id: string;
  run_id: string;
  stage: string;
  sequence: number;
  status: string;
  gate_mode: string;
  attempt_limit: number;
  attempts_used: number;
  latest_output_id: string | null;
  passed_by_decision: boolean;
  started_at: string | null;
  completed_at: string | null;
}

const runColumns = `id, run_no, temporal_workflow_id, status, current_stage, config_snapshot_id,
  ${isoColumn('started_at', 'started_at')}, ${isoColumn('ended_at', 'ended_at')}, ${isoColumn('created_at', 'created_at')}`;
const stageColumns = `id, run_id, stage, sequence, status, gate_mode, attempt_limit, attempts_used, latest_output_id,
  passed_by_decision, ${isoColumn('started_at', 'started_at')}, ${isoColumn('completed_at', 'completed_at')}`;

const LIVE = ['starting', 'running', 'paused', 'waiting_for_human'];

export interface ReviewResult {
  stageRunId: string;
  outputId: string;
  action: string;
  gate: string | null;
}

/** Human control of project workflows (WF-001..006). */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly database: WorkspaceDatabase,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEngine,
    private readonly commands: CommandRunner,
    private readonly business: BusinessService,
  ) {}

  // ------------------------------------------------------------------ lifecycle

  /** WF-001: an active project gets exactly one live run of the fixed stage sequence. */
  async start(context: WorkspaceRequestContext, projectId: string) {
    // The business is read before the run row is made: Contenter is asked first (when the project
    // asks for it), and the snapshot the agents will read is pinned to the run (ADR-0021).
    const business = await this.business.resolveForUse(context, projectId);
    const run = await this.database.run(context, async (client) => {
      const project = (
        await client.query<{ status: string; config_snapshot_id: string | null }>(
          'select status, config_snapshot_id from projects where id = $1 and deleted_at is null for update',
          [projectId],
        )
      ).rows[0];
      if (!project) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');
      if (project.status !== 'active') {
        throw conflict(
          'WORKFLOW_PROJECT_NOT_ACTIVE',
          'Only an active project can run its workflow.',
        );
      }
      const live = (
        await client.query<RunRow>(
          `select ${runColumns} from workflow_runs where project_id = $1 and status = any($2::workflow_status[])`,
          [projectId, LIVE],
        )
      ).rows[0];
      if (live) return live;
      const runNo = (
        await client.query<{ next: number }>(
          'select coalesce(max(run_no), 0) + 1 as next from workflow_runs where project_id = $1',
          [projectId],
        )
      ).rows[0]!.next;
      const created = (
        await client.query<RunRow>(
          `insert into workflow_runs (workspace_id, project_id, run_no, temporal_workflow_id, config_snapshot_id, created_by,
                                      business_snapshot_id)
           values ($1, $2, $3, $4, $5, $6, $7) returning ${runColumns}`,
          [
            context.workspaceId,
            projectId,
            runNo,
            projectWorkflowId(projectId, runNo),
            project.config_snapshot_id,
            context.actorId,
            business.snapshotId,
          ],
        )
      ).rows[0]!;
      await writeAudit(client, context, {
        action: 'workflow.run_created',
        targetType: 'workflow_run',
        targetId: created.id,
        projectId,
        after: {
          runNo,
          stages: STAGES,
          configSnapshotId: project.config_snapshot_id,
          businessSnapshotId: business.snapshotId,
          // Contenter could not be asked: the run reads the last saved snapshot.
          ...(business.syncError ? { businessSyncError: business.syncError } : {}),
        },
      });
      return created;
    });
    try {
      await this.engine.start(run.temporal_workflow_id, {
        workspaceId: context.workspaceId,
        projectId,
        runId: run.id,
      });
    } catch (error) {
      if (error instanceof WorkflowEngineUnavailableError) throw engineUnavailable();
      throw error;
    }
    return this.overview(context, projectId);
  }

  /** Keeps the engine in line with the project after a command (pause, resume, cancel). */
  async onProjectCommand(
    context: WorkspaceRequestContext,
    projectId: string,
    command: string,
  ): Promise<void> {
    try {
      if (command === 'activate' || command === 'reopen') {
        await this.start(context, projectId);
        return;
      }
      const signal: WorkflowSignal | null =
        command === 'pause'
          ? 'pause'
          : command === 'resume'
            ? 'resume'
            : ['archive', 'delete'].includes(command)
              ? 'cancel'
              : null;
      if (!signal) return;
      const live = await this.liveRun(context, projectId);
      if (live)
        await this.engine.signal(
          live.temporal_workflow_id,
          signal,
          signal === 'cancel' ? { reason: `project ${command}` } : undefined,
        );
    } catch (error) {
      // The project change is committed; workflow/sync re-sends the signal later.
      this.logger.warn(
        `workflow sync after ${command} failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /** Re-sends the signal the project state implies; safe to repeat. */
  async sync(context: WorkspaceRequestContext, projectId: string) {
    const status = await this.database.run(context, async (client) => {
      const row = (
        await client.query<{ status: string }>(
          'select status from projects where id = $1 and deleted_at is null',
          [projectId],
        )
      ).rows[0];
      if (!row) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');
      return row.status;
    });
    const live = await this.liveRun(context, projectId);
    try {
      if (!live) {
        if (status === 'active') return this.start(context, projectId);
        return this.overview(context, projectId);
      }
      if (live.status === 'starting') {
        await this.engine.start(live.temporal_workflow_id, {
          workspaceId: context.workspaceId,
          projectId,
          runId: live.id,
        });
      }
      await this.engine.signal(
        live.temporal_workflow_id,
        status === 'paused' ? 'pause' : status === 'active' ? 'resume' : 'cancel',
        status === 'active' || status === 'paused' ? undefined : { reason: `project ${status}` },
      );
      await this.resendAnswers(context, live);
    } catch (error) {
      if (error instanceof WorkflowEngineUnavailableError) throw engineUnavailable();
      throw error;
    }
    return this.overview(context, projectId);
  }

  /**
   * A fully answered batch the analyst has not read yet means the "answers" signal was lost
   * (engine outage after the commit); sending it again is harmless because the workflow
   * re-checks the batch before going on.
   */
  private async resendAnswers(context: WorkspaceRequestContext, live: RunRow): Promise<void> {
    const pending = await this.database.run(
      context,
      async (client) =>
        (
          await client.query<{ id: string; stage_run_id: string }>(
            `select b.id, b.stage_run_id from question_batches b
               join stage_runs sr on sr.id = b.stage_run_id
              where sr.run_id = $1 and b.status = 'submitted'
                and not exists (select 1 from analysis_rounds r where r.based_on_batch_id = b.id)
              order by b.batch_no desc limit 1`,
            [live.id],
          )
        ).rows[0],
    );
    if (pending) {
      await this.engine.signal(live.temporal_workflow_id, 'answers', {
        stageRunId: pending.stage_run_id,
        batchId: pending.id,
      });
    }
  }

  async cancel(context: WorkspaceRequestContext, projectId: string, reason: string) {
    const live = await this.liveRun(context, projectId);
    if (!live) throw conflict('WORKFLOW_NOT_RUNNING', 'The project has no live workflow run.');
    await this.database.run(context, (client) =>
      writeAudit(client, context, {
        action: 'workflow.cancel_requested',
        targetType: 'workflow_run',
        targetId: live.id,
        projectId,
        reason,
        severity: 'warning',
      }),
    );
    await this.send(live.temporal_workflow_id, 'cancel', { reason });
    return this.overview(context, projectId);
  }

  // ------------------------------------------------------------------ reads

  async overview(context: WorkspaceRequestContext, projectId: string) {
    return this.database.run(context, async (client) => {
      const project = await client.query('select 1 from projects where id = $1', [projectId]);
      if (!project.rowCount) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');
      const runs = (
        await client.query<RunRow>(
          `select ${runColumns} from workflow_runs where project_id = $1 order by run_no desc`,
          [projectId],
        )
      ).rows;
      const current = runs[0] ?? null;
      const stages = current
        ? (
            await client.query<StageRow>(
              `select ${stageColumns} from stage_runs where run_id = $1 order by sequence`,
              [current.id],
            )
          ).rows
        : [];
      const gates = current
        ? (
            await client.query<{ stage_run_id: string; output_id: string; status: string }>(
              `select stage_run_id, output_id, status from gate_decisions
                where status = 'pending' and stage_run_id in (select id from stage_runs where run_id = $1)`,
              [current.id],
            )
          ).rows
        : [];
      const tasks = (
        await client.query<Record<string, unknown>>(
          `select id, stage_run_id as "stageRunId", kind, title, payload, ${isoColumn('created_at', '"createdAt"')}
             from human_tasks where project_id = $1 and status = 'pending' order by created_at`,
          [projectId],
        )
      ).rows;
      return {
        run: current ? this.toRun(current) : null,
        previousRuns: runs.slice(1).map((run) => this.toRun(run)),
        stages: STAGES.map((stage, index) => {
          const row = stages.find((item) => item.stage === stage);
          return row
            ? {
                ...this.toStage(row),
                pendingGateOutputId:
                  gates.find((gate) => gate.stage_run_id === row.id)?.output_id ?? null,
              }
            : { stage, sequence: index + 1, status: 'pending', id: null };
        }),
        humanTasks: tasks,
      };
    });
  }

  async stage(context: WorkspaceRequestContext, projectId: string, stageRunId: string) {
    return this.database.run(context, async (client) => {
      const stage = await this.loadStage(client, projectId, stageRunId);
      const outputs = (
        await client.query<Record<string, unknown>>(
          `select id, version_no as "versionNo", content, content_sha256 as "contentSha256", origin,
                  edited_from_id as "editedFromId", attempt_id as "attemptId", created_by as "createdBy",
                  ${isoColumn('created_at', '"createdAt"')}
             from stage_outputs where stage_run_id = $1 order by version_no desc`,
          [stageRunId],
        )
      ).rows as { id: string }[];
      const reviews = (
        await client.query<Record<string, unknown>>(
          `select id, output_id as "outputId", action, comment, created_by as "createdBy", ${isoColumn('created_at', '"createdAt"')}
             from stage_reviews where stage_run_id = $1 order by created_at, id`,
          [stageRunId],
        )
      ).rows as { outputId: string; action: string }[];
      const gates = (
        await client.query<Record<string, unknown>>(
          `select id, output_id as "outputId", mode, status, reason, decided_by as "decidedBy",
                  ${isoColumn('decided_at', '"decidedAt"')}, ${isoColumn('created_at', '"createdAt"')}
             from gate_decisions where stage_run_id = $1 order by created_at, id`,
          [stageRunId],
        )
      ).rows;
      const attempts = (
        await client.query<Record<string, unknown>>(
          `select id, attempt_no as "attemptNo", status, retry_of as "retryOf", provider_retries as "providerRetries",
                  output_id as "outputId", error_code as "errorCode", ${isoColumn('started_at', '"startedAt"')},
                  ${isoColumn('finished_at', '"finishedAt"')}
             from stage_attempts where stage_run_id = $1 order by attempt_no`,
          [stageRunId],
        )
      ).rows;
      return {
        ...this.toStage(stage),
        // An approval is valid only for the output version it was given to (WF-006).
        outputs: outputs.map((output) => ({
          ...output,
          current: output.id === stage.latest_output_id,
          approvalValid:
            output.id === stage.latest_output_id &&
            reviews.some((review) => review.outputId === output.id && review.action === 'approve'),
        })),
        reviews,
        gates,
        attempts,
      };
    });
  }

  async humanTasks(context: WorkspaceRequestContext, status: 'pending' | 'resolved' | 'cancelled') {
    return this.database.run(
      context,
      async (client) =>
        (
          await client.query<Record<string, unknown>>(
            `select id, project_id as "projectId", stage_run_id as "stageRunId", kind, status, title, payload, resolution,
                  resolved_by as "resolvedBy", ${isoColumn('resolved_at', '"resolvedAt"')}, ${isoColumn('created_at', '"createdAt"')}
             from human_tasks where status = $1 order by created_at desc, id desc limit 200`,
            [status],
          )
        ).rows,
    );
  }

  // ------------------------------------------------------------------ review (WF-003, WF-006)

  async review(
    context: WorkspaceRequestContext,
    projectId: string,
    stageRunId: string,
    outputId: string,
    input: {
      action: 'approve' | 'reject' | 'comment';
      comment?: string | undefined;
      idempotencyKey?: string | undefined;
    },
  ) {
    if (input.action === 'reject' && !input.comment) {
      throw badRequest(
        'WORKFLOW_FEEDBACK_REQUIRED',
        'A rejection needs feedback for the next attempt.',
      );
    }
    return this.idempotent<ReviewResult>(
      context,
      input.idempotencyKey,
      `review:${input.action}`,
      { projectId, stageRunId, outputId, input: { ...input, idempotencyKey: undefined } },
      async (client) => {
        const stage = await this.loadStage(client, projectId, stageRunId, true);
        if (stage.latest_output_id !== outputId) {
          throw conflict(
            'WORKFLOW_OUTPUT_SUPERSEDED',
            'This output version was replaced; review the current version.',
          );
        }
        await client.query<Record<string, unknown>>(
          `insert into stage_reviews (workspace_id, stage_run_id, output_id, action, comment, created_by) values ($1, $2, $3, $4, $5, $6)`,
          [
            context.workspaceId,
            stageRunId,
            outputId,
            input.action,
            input.comment ?? null,
            context.actorId,
          ],
        );
        if (input.action === 'comment') {
          await writeAudit(client, context, {
            action: 'workflow.comment',
            targetType: 'stage_run',
            targetId: stageRunId,
            projectId,
            after: { outputId },
          });
          return {
            signal: null,
            result: { stageRunId, outputId, action: 'comment', gate: null },
          };
        }
        const gate = await client.query<{ id: string }>(
          `update gate_decisions set status = $3, reason = $4, decided_by = $5, decided_at = now()
          where stage_run_id = $1 and output_id = $2 and status = 'pending' returning id`,
          [
            stageRunId,
            outputId,
            input.action === 'approve' ? 'approved' : 'rejected',
            input.comment ?? null,
            context.actorId,
          ],
        );
        if (!gate.rowCount)
          throw conflict('WORKFLOW_GATE_NOT_PENDING', 'No decision is pending for this output.');
        if (input.action === 'reject') {
          await client.query(`update stage_runs set status = 'rejected' where id = $1`, [
            stageRunId,
          ]);
          if (stage.stage === 'analysis') {
            // A rejected definition sends the analysis back to the analyst, who may ask more
            // questions: an earlier "finish" request no longer applies.
            await client.query(
              `update analysis_sessions
                  set finish_requested_at = null, finish_requested_by = null, finish_reason = null
                where stage_run_id = $1`,
              [stageRunId],
            );
          }
          await client.query<Record<string, unknown>>(
            `update stage_attempts set feedback = $2 where stage_run_id = $1 and output_id = $3`,
            [stageRunId, input.comment ?? null, outputId],
          );
        }
        await client.query<Record<string, unknown>>(
          `update human_tasks set status = 'resolved', resolved_by = $2, resolved_at = now(), resolution = $3::jsonb
          where stage_run_id = $1 and kind = 'gate_review' and status = 'pending'`,
          [stageRunId, context.actorId, JSON.stringify({ decision: input.action, outputId })],
        );
        await writeAudit(client, context, {
          action: input.action === 'approve' ? 'workflow.approve' : 'workflow.reject',
          targetType: 'stage_run',
          targetId: stageRunId,
          projectId,
          reason: input.comment ?? null,
          after: { stage: stage.stage, outputId, gateId: gate.rows[0]!.id },
        });
        const run = await this.runOf(client, stage.run_id);
        return {
          signal: {
            workflowId: run.temporal_workflow_id,
            name: 'gate' as const,
            payload: { stageRunId, decision: input.action === 'approve' ? 'approved' : 'rejected' },
          },
          result: {
            stageRunId,
            outputId,
            action: input.action,
            gate: input.action === 'approve' ? 'approved' : 'rejected',
          },
        };
      },
    );
  }

  /** WF-006: an edit is a new output version; the earlier version's approval and evaluation no longer count. */
  async edit(
    context: WorkspaceRequestContext,
    projectId: string,
    stageRunId: string,
    outputId: string,
    input: {
      content: Record<string, unknown>;
      reason: string;
      idempotencyKey?: string | undefined;
    },
  ) {
    return this.idempotent(
      context,
      input.idempotencyKey,
      'edit',
      { projectId, stageRunId, outputId, content: input.content, reason: input.reason },
      async (client) => {
        const stage = await this.loadStage(client, projectId, stageRunId, true);
        if (stage.latest_output_id !== outputId) {
          throw conflict(
            'WORKFLOW_OUTPUT_SUPERSEDED',
            'This output version was replaced; edit the current version.',
          );
        }
        if (stage.status !== 'waiting_for_human') {
          throw conflict(
            'WORKFLOW_STAGE_NOT_EDITABLE',
            'Only an output waiting for review can be edited.',
          );
        }
        const content = JSON.stringify(input.content);
        const created = (
          await client.query<{ id: string; version_no: number }>(
            `insert into stage_outputs (workspace_id, stage_run_id, version_no, content, content_sha256, origin, edited_from_id, created_by)
           values ($1, $2, (select max(version_no) + 1 from stage_outputs where stage_run_id = $2), $3::jsonb, $4, 'edit', $5, $6)
           returning id, version_no`,
            [
              context.workspaceId,
              stageRunId,
              content,
              createHash('sha256').update(content).digest('hex'),
              outputId,
              context.actorId,
            ],
          )
        ).rows[0]!;
        await client.query<Record<string, unknown>>(
          `insert into stage_reviews (workspace_id, stage_run_id, output_id, action, comment, created_by) values ($1, $2, $3, 'edit', $4, $5)`,
          [context.workspaceId, stageRunId, outputId, input.reason, context.actorId],
        );
        const invalidated = await client.query<{ id: string }>(
          `update gate_decisions set status = 'expired', reason = 'output edited', decided_at = now()
          where stage_run_id = $1 and output_id = $2 and status in ('pending', 'approved') returning id`,
          [stageRunId, outputId],
        );
        await client.query<Record<string, unknown>>(
          `insert into gate_decisions (workspace_id, stage_run_id, output_id, mode, status) values ($1, $2, $3, $4, 'pending')`,
          [context.workspaceId, stageRunId, created.id, stage.gate_mode],
        );
        await client.query(`update stage_runs set latest_output_id = $2 where id = $1`, [
          stageRunId,
          created.id,
        ]);
        await client.query<Record<string, unknown>>(
          `update human_tasks set payload = jsonb_set(payload, '{outputId}', to_jsonb($2::text))
          where stage_run_id = $1 and kind = 'gate_review' and status = 'pending'`,
          [stageRunId, created.id],
        );
        await writeAudit(client, context, {
          action: 'workflow.output_edited',
          targetType: 'stage_run',
          targetId: stageRunId,
          projectId,
          reason: input.reason,
          after: {
            previousOutputId: outputId,
            outputId: created.id,
            versionNo: created.version_no,
            invalidatedGateIds: invalidated.rows.map((row) => row.id),
          },
        });
        return {
          signal: null,
          result: {
            stageRunId,
            outputId: created.id,
            versionNo: created.version_no,
            invalidatedGates: invalidated.rowCount,
          },
        };
      },
    );
  }

  /** WF-005: past the attempt limit only a recorded decision with a reason continues. */
  async attemptDecision(
    context: WorkspaceRequestContext,
    projectId: string,
    stageRunId: string,
    input: { decision: 'extend' | 'pass'; reason: string; idempotencyKey?: string | undefined },
  ) {
    return this.idempotent(
      context,
      input.idempotencyKey,
      'attempt-decision',
      { projectId, stageRunId, decision: input.decision, reason: input.reason },
      async (client) => {
        const stage = await this.loadStage(client, projectId, stageRunId, true);
        const task = await client.query<{ id: string }>(
          `update human_tasks set status = 'resolved', resolved_by = $2, resolved_at = now(), resolution = $3::jsonb
          where stage_run_id = $1 and kind = 'attempt_limit' and status = 'pending' returning id`,
          [
            stageRunId,
            context.actorId,
            JSON.stringify({ decision: input.decision, reason: input.reason }),
          ],
        );
        if (!task.rowCount)
          throw conflict('WORKFLOW_NO_DECISION_PENDING', 'The attempt limit has not been reached.');
        if (input.decision === 'extend') {
          await client.query<Record<string, unknown>>(
            `update stage_runs set attempt_limit = attempt_limit + 1 where id = $1`,
            [stageRunId],
          );
        }
        await writeAudit(client, context, {
          action: 'workflow.attempt_decision',
          targetType: 'stage_run',
          targetId: stageRunId,
          projectId,
          reason: input.reason,
          severity: 'warning',
          securityRelevant: true,
          after: {
            decision: input.decision,
            attemptsUsed: stage.attempts_used,
            attemptLimit: stage.attempt_limit + (input.decision === 'extend' ? 1 : 0),
          },
        });
        const run = await this.runOf(client, stage.run_id);
        return {
          signal: {
            workflowId: run.temporal_workflow_id,
            name: 'attemptDecision' as const,
            payload: { stageRunId, decision: input.decision },
          },
          result: { stageRunId, decision: input.decision },
        };
      },
    );
  }

  // ------------------------------------------------------------------ internals

  private idempotent<T>(
    context: WorkspaceRequestContext,
    key: string | undefined,
    command: string,
    request: unknown,
    work: (client: PoolClient) => Promise<{ signal: PendingSignal | null; result: T }>,
  ): Promise<T & { replayed: boolean }> {
    return this.commands.run(context, key, command, request, work);
  }

  private send(workflowId: string, name: WorkflowSignal, payload?: unknown): Promise<void> {
    return this.commands.send(workflowId, name, payload);
  }

  private async liveRun(
    context: WorkspaceRequestContext,
    projectId: string,
  ): Promise<RunRow | undefined> {
    return this.database.run(
      context,
      async (client) =>
        (
          await client.query<RunRow>(
            `select ${runColumns} from workflow_runs where project_id = $1 and status = any($2::workflow_status[])`,
            [projectId, LIVE],
          )
        ).rows[0],
    );
  }

  private async runOf(client: PoolClient, runId: string): Promise<RunRow> {
    return (
      await client.query<RunRow>(`select ${runColumns} from workflow_runs where id = $1`, [runId])
    ).rows[0]!;
  }

  private async loadStage(
    client: PoolClient,
    projectId: string,
    stageRunId: string,
    forUpdate = false,
  ): Promise<StageRow> {
    const row = (
      await client.query<StageRow>(
        `select ${stageColumns} from stage_runs where id = $1 and project_id = $2 ${forUpdate ? 'for update' : ''}`,
        [stageRunId, projectId],
      )
    ).rows[0];
    if (!row) throw notFound('WORKFLOW_STAGE_NOT_FOUND', 'The stage was not found.');
    return row;
  }

  private toRun(row: RunRow) {
    return {
      id: row.id,
      runNo: row.run_no,
      workflowId: row.temporal_workflow_id,
      status: row.status,
      currentStage: row.current_stage,
      configSnapshotId: row.config_snapshot_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      createdAt: row.created_at,
    };
  }

  private toStage(row: StageRow) {
    return {
      id: row.id,
      stage: row.stage,
      sequence: row.sequence,
      status: row.status,
      gateMode: row.gate_mode,
      attemptLimit: row.attempt_limit,
      attemptsUsed: row.attempts_used,
      latestOutputId: row.latest_output_id,
      passedByDecision: row.passed_by_decision,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }
}
