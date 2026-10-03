import { createHash } from 'node:crypto';

import { checkCostLimit, ProviderError, retryDelaySeconds } from '@docoo/providers';
import type { Pool, PoolClient } from 'pg';

import { audit, inWorkspace } from './db.js';
import type { ProviderRuntime } from './runtime.js';
import { MAX_ATTEMPTS, STAGE_SCHEMAS, stagePrompt, STAGES, type Stage } from './stages.js';

export interface RunRef {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly runId: string;
}

export interface StageRef extends RunRef {
  readonly stageRunId: string;
}

export interface StageStart {
  readonly stageRunId: string;
  readonly status: string;
  readonly attemptsUsed: number;
  readonly attemptLimit: number;
  /** A gate already waiting for a decision (the workflow resumes into it after a restart). */
  readonly pendingGate: boolean;
}

export type AttemptResult =
  | { readonly status: 'succeeded'; readonly outputId: string; readonly reused: boolean }
  | { readonly status: 'retry'; readonly code: string; readonly delaySeconds: number }
  | {
      readonly status: 'blocked';
      readonly code: string;
      readonly reason: 'provider_failure' | 'configuration' | 'cost_limit';
    };

export interface OrchestrationActivities {
  startRun(ref: RunRef): Promise<{ paused: boolean }>;
  startStage(ref: RunRef & { stage: Stage }): Promise<StageStart>;
  runAttempt(ref: StageRef & { attemptNo: number; retryNo: number }): Promise<AttemptResult>;
  openGate(ref: StageRef): Promise<{ mode: 'manual' | 'automatic' }>;
  completeStage(ref: StageRef & { passedByDecision: boolean }): Promise<void>;
  requestAttemptDecision(ref: StageRef & { attemptsUsed: number }): Promise<void>;
  extendAttemptLimit(ref: StageRef): Promise<number>;
  blockRun(ref: RunRef & { stageRunId: string; code: string; reason: string }): Promise<void>;
  setRunStatus(ref: RunRef & { status: 'running' | 'paused' }): Promise<void>;
  completeRun(ref: RunRef): Promise<void>;
  cancelRun(ref: RunRef & { reason: string | null }): Promise<void>;
}

interface Settings {
  connectionId: string;
  model: string;
  manualGate: boolean;
  attemptLimit: number;
  costLimitUsd: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function settings(client: PoolClient, runId: string): Promise<Settings> {
  const row = (
    await client.query<{ resolved: Record<string, unknown> | null }>(
      `select s.resolved from workflow_runs r left join config_snapshots s on s.id = r.config_snapshot_id where r.id = $1`,
      [runId],
    )
  ).rows[0];
  const values = row?.resolved ?? {};
  const limit = Number(values['workflow.max_attempts_per_stage'] ?? MAX_ATTEMPTS);
  return {
    connectionId: typeof values['ai.connection_id'] === 'string' ? values['ai.connection_id'] : '',
    model: typeof values['ai.model'] === 'string' ? values['ai.model'] : '',
    manualGate: values['workflow.require_human_approval'] !== false,
    attemptLimit: Math.max(
      1,
      Math.min(MAX_ATTEMPTS, Number.isFinite(limit) ? limit : MAX_ATTEMPTS),
    ),
    costLimitUsd: Number(values['ai.max_cost_usd_per_run'] ?? 20),
  };
}

/**
 * Temporal activities of the project workflow. Each one is idempotent: a retry after a
 * worker crash finds the rows it already wrote and returns the same result (WF-002).
 */
export function createOrchestrationActivities(
  pool: Pool,
  runtime: ProviderRuntime,
  options: {
    /** Scales the provider retry schedule; 1 in production, small in tests. */ delayScale?: number;
  } = {},
): OrchestrationActivities {
  const delayScale = options.delayScale ?? 1;
  const run = <T>(workspaceId: string, work: (client: PoolClient) => Promise<T>) =>
    inWorkspace(pool, { workspaceId }, work);

  return {
    startRun: (ref) =>
      run(ref.workspaceId, async (client) => {
        const updated = await client.query<{ status: string }>(
          `update workflow_runs set status = 'running', started_at = coalesce(started_at, now())
            where id = $1 and status = 'starting' returning status`,
          [ref.runId],
        );
        if (updated.rowCount) {
          await audit(client, ref.workspaceId, {
            action: 'workflow.started',
            targetType: 'workflow_run',
            targetId: ref.runId,
            projectId: ref.projectId,
            after: { stages: STAGES },
          });
        }
        const project = await client.query<{ status: string }>(
          'select status from projects where id = $1',
          [ref.projectId],
        );
        return { paused: project.rows[0]?.status === 'paused' };
      }),

    startStage: (ref) =>
      run(ref.workspaceId, async (client) => {
        const config = await settings(client, ref.runId);
        const sequence = STAGES.indexOf(ref.stage) + 1;
        await client.query(
          `insert into stage_runs (workspace_id, run_id, project_id, stage, sequence, status, gate_mode, attempt_limit, started_at)
           values ($1, $2, $3, $4, $5, 'ready', $6, $7, now())
           on conflict (run_id, stage) do nothing`,
          [
            ref.workspaceId,
            ref.runId,
            ref.projectId,
            ref.stage,
            sequence,
            config.manualGate ? 'manual' : 'automatic',
            config.attemptLimit,
          ],
        );
        const stage = (
          await client.query<{
            id: string;
            status: string;
            attempts_used: number;
            attempt_limit: number;
          }>(
            'select id, status, attempts_used, attempt_limit from stage_runs where run_id = $1 and stage = $2',
            [ref.runId, ref.stage],
          )
        ).rows[0]!;
        await client.query(`update workflow_runs set current_stage = $2 where id = $1`, [
          ref.runId,
          ref.stage,
        ]);
        await client.query(`update projects set current_stage = $2 where id = $1`, [
          ref.projectId,
          ref.stage,
        ]);
        const pending = await client.query(
          `select 1 from gate_decisions where stage_run_id = $1 and status = 'pending'`,
          [stage.id],
        );
        if (stage.status === 'ready' && stage.attempts_used === 0) {
          await audit(client, ref.workspaceId, {
            action: 'workflow.stage_started',
            targetType: 'stage_run',
            targetId: stage.id,
            projectId: ref.projectId,
            after: { stage: ref.stage, sequence },
          });
        }
        return {
          stageRunId: stage.id,
          status: stage.status,
          attemptsUsed: stage.attempts_used,
          attemptLimit: stage.attempt_limit,
          pendingGate: Boolean(pending.rowCount),
        };
      }),

    async runAttempt(ref) {
      const key = `${ref.stageRunId}:${ref.attemptNo}`;
      const prepared = await run(ref.workspaceId, async (client) => {
        const existing = (
          await client.query<{ id: string; status: string; output_id: string | null }>(
            'select id, status, output_id from stage_attempts where idempotency_key = $1',
            [key],
          )
        ).rows[0];
        // A repeated command after success returns the stored output; no second provider call.
        if (existing?.output_id) return { reuse: existing.output_id } as const;
        const config = await settings(client, ref.runId);
        const spent =
          (
            await client.query<{ total: number | null }>(
              `select sum(i.cost_usd)::real as total from model_invocations i
               join stage_runs s on s.id = i.stage_run_id where s.run_id = $1`,
              [ref.runId],
            )
          ).rows[0]?.total ?? 0;
        const cost = checkCostLimit(spent, config.costLimitUsd);
        if (cost.status === 'exceeded') return { blocked: 'cost_limit' as const, cost };
        if (!config.connectionId || !config.model)
          return { blocked: 'configuration' as const, cost };
        const stage = (
          await client.query<{
            stage: Stage;
            project_title: string;
            problem: string;
            language: 'fa' | 'en';
          }>(
            `select s.stage, p.title as project_title, p.initial_problem as problem, p.output_language as language
               from stage_runs s join projects p on p.id = s.project_id where s.id = $1`,
            [ref.stageRunId],
          )
        ).rows[0]!;
        const topics = await client.query<{ title: string }>(
          `select t.title from project_topics pt join topics t on t.id = pt.topic_id where pt.project_id = $1 order by pt.priority`,
          [ref.projectId],
        );
        const previous = await client.query<{ stage: Stage; content: unknown }>(
          `select s.stage, o.content from stage_runs s join stage_outputs o on o.id = s.latest_output_id
            where s.run_id = $1 and s.status = 'completed' order by s.sequence`,
          [ref.runId],
        );
        const feedback = await client.query<{ comment: string }>(
          `select comment from stage_reviews where stage_run_id = $1 and action = 'reject' and comment is not null order by created_at`,
          [ref.stageRunId],
        );
        let attemptId = existing?.id;
        if (!attemptId) {
          attemptId = (
            await client.query<{ id: string }>(
              `insert into stage_attempts (workspace_id, stage_run_id, attempt_no, idempotency_key, status, retry_of, started_at)
               values ($1, $2, $3, $4, 'dispatched',
                       (select id from stage_attempts where stage_run_id = $2 and attempt_no = $3 - 1), now())
               returning id`,
              [ref.workspaceId, ref.stageRunId, ref.attemptNo, key],
            )
          ).rows[0]!.id;
          await client.query(
            `update stage_runs set status = 'running', attempts_used = greatest(attempts_used, $2) where id = $1`,
            [ref.stageRunId, ref.attemptNo],
          );
        }
        await client.query(
          `update stage_attempts set status = 'executing', provider_retries = $2 where id = $1`,
          [attemptId, ref.retryNo],
        );
        if (cost.status === 'warning' && ref.retryNo === 0) {
          await audit(client, ref.workspaceId, {
            action: 'workflow.cost_warning',
            targetType: 'workflow_run',
            targetId: ref.runId,
            projectId: ref.projectId,
            severity: 'warning',
            after: { ...cost },
          });
        }
        return {
          attemptId,
          config,
          prompt: stagePrompt({
            stage: stage.stage,
            language: stage.language,
            projectTitle: stage.project_title,
            problem: stage.problem,
            topics: topics.rows.map((row) => row.title),
            previous: previous.rows,
            feedback: feedback.rows.map((row) => row.comment),
          }),
          stage: stage.stage,
        } as const;
      });
      if ('reuse' in prepared)
        return { status: 'succeeded', outputId: prepared.reuse, reused: true };
      if ('blocked' in prepared) {
        return {
          status: 'blocked',
          code: prepared.blocked === 'cost_limit' ? 'cost_limit_exceeded' : 'ai_not_configured',
          reason: prepared.blocked,
        };
      }

      try {
        const { response } = await runtime.invoke(
          {
            workspaceId: ref.workspaceId,
            projectId: ref.projectId,
            stageRunId: ref.stageRunId,
            attemptId: prepared.attemptId,
            purpose: `stage:${prepared.stage}`,
            retryNo: ref.retryNo,
          },
          prepared.config.connectionId,
          {
            model: prepared.config.model,
            instructions: prepared.prompt.instructions,
            messages: [{ role: 'user', content: prepared.prompt.message }],
            responseSchema: {
              name: `${prepared.stage}_output`,
              schema: STAGE_SCHEMAS[prepared.stage],
            },
            idempotencyKey: `${key}:${ref.retryNo}`,
          },
        );
        if (response.finishReason !== 'stop' || response.json === null) {
          throw new ProviderError('invalid_output', `output_${response.finishReason}`);
        }
        const outputId = await run(ref.workspaceId, async (client) => {
          const content = JSON.stringify(response.json);
          const output = (
            await client.query<{ id: string }>(
              `insert into stage_outputs (workspace_id, stage_run_id, attempt_id, version_no, content, content_sha256, origin)
               values ($1, $2, $3, (select coalesce(max(version_no), 0) + 1 from stage_outputs where stage_run_id = $2),
                       $4::jsonb, $5, 'model')
               returning id`,
              [ref.workspaceId, ref.stageRunId, prepared.attemptId, content, sha256(content)],
            )
          ).rows[0]!.id;
          await client.query(
            `update stage_attempts set status = 'succeeded', output_id = $2, error_code = null, finished_at = now() where id = $1`,
            [prepared.attemptId, output],
          );
          await client.query(`update stage_runs set latest_output_id = $2 where id = $1`, [
            ref.stageRunId,
            output,
          ]);
          await audit(client, ref.workspaceId, {
            action: 'workflow.attempt_succeeded',
            targetType: 'stage_run',
            targetId: ref.stageRunId,
            projectId: ref.projectId,
            after: { attemptNo: ref.attemptNo, outputId: output, providerRetries: ref.retryNo },
          });
          return output;
        });
        return { status: 'succeeded', outputId, reused: false };
      } catch (error) {
        const providerError =
          error instanceof ProviderError
            ? error
            : new ProviderError('transient', 'stage_execution_failed');
        const delay = retryDelaySeconds(ref.retryNo + 1, providerError);
        await run(ref.workspaceId, (client) =>
          client.query(
            `update stage_attempts set status = $2::attempt_status, error_code = $3,
                    finished_at = case when $2::text = 'permanent_failed' then now() end where id = $1`,
            [
              prepared.attemptId,
              delay === null ? 'permanent_failed' : 'scheduled_retry',
              providerError.code,
            ],
          ),
        );
        if (delay !== null)
          return { status: 'retry', code: providerError.code, delaySeconds: delay * delayScale };
        return { status: 'blocked', code: providerError.code, reason: 'provider_failure' };
      }
    },

    openGate: (ref) =>
      run(ref.workspaceId, async (client) => {
        const stage = (
          await client.query<{
            gate_mode: 'manual' | 'automatic';
            latest_output_id: string;
            stage: Stage;
          }>('select gate_mode, latest_output_id, stage from stage_runs where id = $1', [
            ref.stageRunId,
          ])
        ).rows[0]!;
        const existing = await client.query<{ status: string }>(
          `select status from gate_decisions where stage_run_id = $1 and output_id = $2 order by created_at desc limit 1`,
          [ref.stageRunId, stage.latest_output_id],
        );
        if (stage.gate_mode === 'automatic') {
          if (!existing.rowCount) {
            await client.query(
              `insert into gate_decisions (workspace_id, stage_run_id, output_id, mode, status, reason, decided_at)
               values ($1, $2, $3, 'automatic', 'approved', 'automatic gate', now())`,
              [ref.workspaceId, ref.stageRunId, stage.latest_output_id],
            );
          }
          return { mode: 'automatic' as const };
        }
        if (!existing.rowCount) {
          await client.query(
            `insert into gate_decisions (workspace_id, stage_run_id, output_id, mode, status) values ($1, $2, $3, 'manual', 'pending')`,
            [ref.workspaceId, ref.stageRunId, stage.latest_output_id],
          );
          await client.query(`update stage_runs set status = 'waiting_for_human' where id = $1`, [
            ref.stageRunId,
          ]);
          await client.query(
            `update workflow_runs set status = 'waiting_for_human' where id = $1`,
            [ref.runId],
          );
          await client.query(
            `insert into human_tasks (workspace_id, project_id, stage_run_id, kind, title, payload)
             values ($1, $2, $3, 'gate_review', $4, $5::jsonb)`,
            [
              ref.workspaceId,
              ref.projectId,
              ref.stageRunId,
              `Review ${stage.stage} output`,
              JSON.stringify({ outputId: stage.latest_output_id, stage: stage.stage }),
            ],
          );
          await audit(client, ref.workspaceId, {
            action: 'workflow.waiting_for_human',
            targetType: 'stage_run',
            targetId: ref.stageRunId,
            projectId: ref.projectId,
            after: { stage: stage.stage, outputId: stage.latest_output_id, task: 'gate_review' },
          });
        }
        return { mode: 'manual' as const };
      }),

    completeStage: (ref) =>
      run(ref.workspaceId, async (client) => {
        const updated = await client.query<{ stage: Stage }>(
          `update stage_runs set status = 'completed', completed_at = now(), passed_by_decision = $2
            where id = $1 and status <> 'completed' returning stage`,
          [ref.stageRunId, ref.passedByDecision],
        );
        await client.query(
          `update workflow_runs set status = 'running' where id = $1 and status = 'waiting_for_human'`,
          [ref.runId],
        );
        await client.query(
          `update human_tasks set status = 'resolved', resolved_at = coalesce(resolved_at, now())
            where stage_run_id = $1 and status = 'pending'`,
          [ref.stageRunId],
        );
        if (updated.rowCount) {
          await audit(client, ref.workspaceId, {
            action: 'workflow.stage_completed',
            targetType: 'stage_run',
            targetId: ref.stageRunId,
            projectId: ref.projectId,
            after: { stage: updated.rows[0]!.stage, passedByDecision: ref.passedByDecision },
          });
        }
      }),

    requestAttemptDecision: (ref) =>
      run(ref.workspaceId, async (client) => {
        const open = await client.query(
          `select 1 from human_tasks where stage_run_id = $1 and kind = 'attempt_limit' and status = 'pending'`,
          [ref.stageRunId],
        );
        if (open.rowCount) return;
        await client.query(`update stage_runs set status = 'waiting_for_human' where id = $1`, [
          ref.stageRunId,
        ]);
        await client.query(`update workflow_runs set status = 'waiting_for_human' where id = $1`, [
          ref.runId,
        ]);
        await client.query(
          `insert into human_tasks (workspace_id, project_id, stage_run_id, kind, title, payload)
           values ($1, $2, $3, 'attempt_limit', 'Attempt limit reached', $4::jsonb)`,
          [
            ref.workspaceId,
            ref.projectId,
            ref.stageRunId,
            JSON.stringify({ attemptsUsed: ref.attemptsUsed }),
          ],
        );
        await audit(client, ref.workspaceId, {
          action: 'workflow.attempt_limit_reached',
          targetType: 'stage_run',
          targetId: ref.stageRunId,
          projectId: ref.projectId,
          severity: 'warning',
          after: { attemptsUsed: ref.attemptsUsed },
        });
      }),

    extendAttemptLimit: (ref) =>
      run(ref.workspaceId, async (client) => {
        const row = (
          await client.query<{ attempt_limit: number }>(
            'select attempt_limit from stage_runs where id = $1',
            [ref.stageRunId],
          )
        ).rows[0]!;
        return row.attempt_limit;
      }),

    blockRun: (ref) =>
      run(ref.workspaceId, async (client) => {
        const project = await client.query(
          `update projects set status = 'paused', previous_status = status, pause_reason = $2, version = version + 1
            where id = $1 and status = 'active' returning id`,
          [ref.projectId, `${ref.reason}: ${ref.code}`],
        );
        await client.query(`update workflow_runs set status = 'paused' where id = $1`, [ref.runId]);
        await client.query(
          `update stage_runs set status = 'retrying' where id = $1 and status = 'running'`,
          [ref.stageRunId],
        );
        const open = await client.query(
          `select 1 from human_tasks where stage_run_id = $1 and kind = $2 and status = 'pending'`,
          [ref.stageRunId, ref.reason],
        );
        if (!open.rowCount) {
          await client.query(
            `insert into human_tasks (workspace_id, project_id, stage_run_id, kind, title, payload)
             values ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
              ref.workspaceId,
              ref.projectId,
              ref.stageRunId,
              ref.reason,
              `Run paused: ${ref.reason}`,
              JSON.stringify({ code: ref.code }),
            ],
          );
        }
        if (project.rowCount) {
          await audit(client, ref.workspaceId, {
            action: 'project.pause',
            targetType: 'project',
            targetId: ref.projectId,
            projectId: ref.projectId,
            reason: `${ref.reason}: ${ref.code}`,
            severity: 'warning',
            after: { status: 'paused', automatic: true },
          });
        }
      }),

    setRunStatus: (ref) =>
      run(ref.workspaceId, async (client) => {
        await client.query(
          `update workflow_runs set status = $2 where id = $1 and status in ('running', 'paused', 'waiting_for_human')`,
          [ref.runId, ref.status],
        );
        if (ref.status === 'running') {
          await client.query(
            `update human_tasks set status = 'resolved', resolved_at = now(), resolution = '{"by":"resume"}'::jsonb
              where project_id = $1 and status = 'pending' and kind in ('provider_failure', 'configuration', 'cost_limit')`,
            [ref.projectId],
          );
        }
      }),

    completeRun: (ref) =>
      run(ref.workspaceId, async (client) => {
        const updated = await client.query(
          `update workflow_runs set status = 'completed', ended_at = now() where id = $1 and status <> 'completed' returning id`,
          [ref.runId],
        );
        if (!updated.rowCount) return;
        await client.query(
          `update projects set status = 'completed', previous_status = status, version = version + 1
            where id = $1 and status in ('active', 'paused')`,
          [ref.projectId],
        );
        await audit(client, ref.workspaceId, {
          action: 'workflow.completed',
          targetType: 'workflow_run',
          targetId: ref.runId,
          projectId: ref.projectId,
          after: { status: 'completed' },
        });
      }),

    cancelRun: (ref) =>
      run(ref.workspaceId, async (client) => {
        const updated = await client.query(
          `update workflow_runs set status = 'cancelled', ended_at = now() where id = $1 and status not in ('completed', 'cancelled') returning id`,
          [ref.runId],
        );
        if (!updated.rowCount) return;
        await client.query(
          `update stage_runs set status = 'cancelled' where run_id = $1 and status not in ('completed', 'cancelled')`,
          [ref.runId],
        );
        await client.query(
          `update gate_decisions set status = 'expired', reason = 'run cancelled', decided_at = now()
            where status = 'pending' and stage_run_id in (select id from stage_runs where run_id = $1)`,
          [ref.runId],
        );
        await client.query(
          `update human_tasks set status = 'cancelled', resolved_at = now() where project_id = $1 and status = 'pending'`,
          [ref.projectId],
        );
        await audit(client, ref.workspaceId, {
          action: 'workflow.cancelled',
          targetType: 'workflow_run',
          targetId: ref.runId,
          projectId: ref.projectId,
          reason: ref.reason,
          severity: 'warning',
        });
      }),
  };
}
