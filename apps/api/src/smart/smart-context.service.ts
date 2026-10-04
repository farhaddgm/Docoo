import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { isoColumn } from '../common/pagination.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { scrubMessage, scrubStack } from './error-classifier.js';
import { WalkerProgressService } from './walker-progress.service.js';
import type { WalkerStepKey } from './walker-steps.js';

export interface ContextTarget {
  readonly route: string;
  readonly projectId: string | null;
  readonly walkerStep: WalkerStepKey | null;
  readonly errorId: string | null;
}

export const CONTEXT_LIMIT = 12_000;

/**
 * Builds the read-only snapshot the Smart assistant reasons over (SMT-003). Code assembles it;
 * the model cannot query anything itself. It carries ids, statuses, counters, error codes and
 * the admin's recent action names, but never project titles, problem statements, document or
 * knowledge content, nor before/after values of audit events (docs/05-security).
 */
@Injectable()
export class SmartContextBuilder {
  constructor(private readonly walker: WalkerProgressService) {}

  async build(
    client: PoolClient,
    context: WorkspaceRequestContext,
    target: ContextTarget,
  ): Promise<string> {
    const walker = await this.walker.progressIn(client, context, target.projectId);
    const snapshot: Record<string, unknown> = {
      page: target.route.slice(0, 200),
      walkerStep: target.walkerStep,
      walker: {
        projectId: walker.projectId,
        doneCount: walker.doneCount,
        total: walker.total,
        nextStep: walker.nextStep,
        steps: walker.steps.map((step) => ({
          key: step.key,
          status: step.status,
          blockedBy: step.blockedBy,
          counter: step.counter,
          attention: step.attention,
        })),
      },
      providers: await this.providers(client),
      openErrors: await this.openErrors(client),
      recentActions: await this.recentActions(client, context),
    };
    if (target.projectId) snapshot['project'] = await this.project(client, target.projectId);
    if (target.errorId) snapshot['error'] = await this.errorDetail(client, target.errorId);
    const text = JSON.stringify(snapshot);
    return text.length > CONTEXT_LIMIT ? `${text.slice(0, CONTEXT_LIMIT)}…[truncated]` : text;
  }

  private async providers(client: PoolClient) {
    const rows = (
      await client.query<Record<string, unknown>>(
        `select provider, status::text as status, last_error as "lastError",
                ${isoColumn('last_checked_at', '"lastCheckedAt"')}
           from provider_connections where disabled_at is null order by created_at limit 10`,
      )
    ).rows;
    return rows.map((row) => ({
      ...row,
      lastError: typeof row['lastError'] === 'string' ? scrubMessage(row['lastError'], 200) : null,
    }));
  }

  private async openErrors(client: PoolClient) {
    return (
      await client.query<Record<string, unknown>>(
        `select id, category::text as category, source::text as source, message, occurrences,
                route, ${isoColumn('last_seen_at', '"lastSeenAt"')}
           from app_errors where status in ('new', 'seen')
          order by last_seen_at desc, id desc limit 10`,
      )
    ).rows;
  }

  private async recentActions(client: PoolClient, context: WorkspaceRequestContext) {
    return (
      await client.query<Record<string, unknown>>(
        `select action, target_type as "targetType", ${isoColumn('occurred_at', '"at"')}
           from audit_events where actor_id = $1
          order by occurred_at desc, id desc limit 30`,
        [context.actorId],
      )
    ).rows;
  }

  private async project(client: PoolClient, projectId: string) {
    const base = (
      await client.query<Record<string, unknown>>(
        `select id, status::text as status, current_stage as "currentStage",
                output_language::text as "outputLanguage"
           from projects where id = $1`,
        [projectId],
      )
    ).rows[0];
    const stages = (
      await client.query<Record<string, unknown>>(
        `select s.stage::text as stage, s.status::text as status, s.attempts_used as "attemptsUsed",
                s.attempt_limit as "attemptLimit"
           from stage_runs s
          where s.run_id = (select id from workflow_runs where project_id = $1 order by run_no desc limit 1)
          order by s.sequence`,
        [projectId],
      )
    ).rows;
    const tasks = (
      await client.query<Record<string, unknown>>(
        `select kind, ${isoColumn('created_at', '"createdAt"')} from human_tasks
          where project_id = $1 and status = 'pending' order by created_at limit 10`,
        [projectId],
      )
    ).rows;
    const failedAttempts = (
      await client.query<Record<string, unknown>>(
        `select s.stage::text as stage, a.attempt_no as "attemptNo", a.status::text as status,
                a.error_code as "errorCode", ${isoColumn('a.created_at', '"at"')}
           from stage_attempts a join stage_runs s on s.id = a.stage_run_id
          where s.project_id = $1 and a.error_code is not null
          order by a.created_at desc limit 10`,
        [projectId],
      )
    ).rows;
    const failedInvocations = (
      await client.query<Record<string, unknown>>(
        `select purpose, provider::text as provider, model, status::text as status,
                error_code as "errorCode", ${isoColumn('created_at', '"at"')}
           from model_invocations
          where project_id = $1 and status <> 'succeeded'
          order by created_at desc limit 10`,
        [projectId],
      )
    ).rows;
    const documents = (
      await client.query<Record<string, unknown>>(
        `select id, status::text as status, level from documents where project_id = $1
          order by priority, created_at limit 20`,
        [projectId],
      )
    ).rows;
    return { ...base, stages, pendingTasks: tasks, failedAttempts, failedInvocations, documents };
  }

  private async errorDetail(client: PoolClient, errorId: string) {
    const row = (
      await client.query<Record<string, unknown>>(
        `select id, source::text as source, category::text as category, status::text as status,
                message, occurrences, http_method as method, route, http_status as "httpStatus",
                page, stack, context,
                ${isoColumn('first_seen_at', '"firstSeenAt"')}, ${isoColumn('last_seen_at', '"lastSeenAt"')}
           from app_errors where id = $1`,
        [errorId],
      )
    ).rows[0];
    if (!row) return null;
    return { ...row, stack: scrubStack(typeof row['stack'] === 'string' ? row['stack'] : null) };
  }
}
