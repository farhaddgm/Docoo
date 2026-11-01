import { ForbiddenException, HttpException, Inject, Injectable } from '@nestjs/common';
import { aiBlock, type AiBlock, type AiUsage } from '@docoo/contracts';
import type { Pool, PoolClient } from 'pg';

import { DATABASE_POOL } from '../tokens.js';
import type { AuthUser } from './auth.service.js';

const BLOCK_DETAIL: Record<AiBlock, string> = {
  disabled: 'AI is switched off for this account.',
  tokens: 'The monthly AI token allowance of this account is used up.',
  cost: 'The monthly AI spending allowance of this account is used up.',
  calls: 'The daily AI call allowance of this account is used up.',
};

/**
 * What an account has used and whether it may start more (ADR-0042). Limits are checked when an
 * action starts: a run that already started finishes, and its calls count for the next check.
 */
@Injectable()
export class AccountPolicyService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** Calls counted for an account this month and today (UTC), over the given workspaces. */
  async usageIn(
    client: PoolClient,
    userId: string,
    workspaceIds: readonly string[],
  ): Promise<AiUsage> {
    const total: AiUsage = { monthTokens: 0, monthCostUsd: 0, todayCalls: 0 };
    for (const workspaceId of workspaceIds) {
      await client.query("select set_config('app.workspace_id',$1,true)", [workspaceId]);
      // A workflow's calls carry no person; they count for the one who started the run.
      const { rows } = await client.query<{ tokens: number; cost: number; calls: number }>(
        `select coalesce(sum(i.input_tokens + i.output_tokens), 0)::float8 as tokens,
                coalesce(sum(i.cost_usd), 0)::float8 as cost,
                (count(*) filter (where i.created_at >=
                  (date_trunc('day', now() at time zone 'utc') at time zone 'utc')))::int as calls
           from model_invocations i
           left join stage_runs s on s.id = i.stage_run_id
           left join workflow_runs w on w.id = s.run_id
          where i.workspace_id = $1
            and i.created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')
            and coalesce(i.actor_id, w.created_by) = $2`,
        [workspaceId, userId],
      );
      total.monthTokens += rows[0]?.tokens ?? 0;
      total.monthCostUsd += rows[0]?.cost ?? 0;
      total.todayCalls += rows[0]?.calls ?? 0;
      // Voice calls (ADR-0046) count against the same allowance as text calls.
      const voice = await client.query<{ tokens: number; cost: number; calls: number }>(
        `select coalesce(sum(input_tokens + output_tokens), 0)::float8 as tokens,
                coalesce(sum(cost_usd), 0)::float8 as cost,
                (count(*) filter (where created_at >=
                  (date_trunc('day', now() at time zone 'utc') at time zone 'utc')))::int as calls
           from voice_invocations
          where workspace_id = $1 and actor_id = $2
            and created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')`,
        [workspaceId, userId],
      );
      total.monthTokens += voice.rows[0]?.tokens ?? 0;
      total.monthCostUsd += voice.rows[0]?.cost ?? 0;
      total.todayCalls += voice.rows[0]?.calls ?? 0;
    }
    return total;
  }

  async usage(userId: string, workspaceIds: readonly string[]): Promise<AiUsage> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await this.usageIn(client, userId, workspaceIds);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Refuses the start of an action that calls a model when the account may not. */
  async assertAiAvailable(user: AuthUser, workspaceIds: readonly string[]): Promise<void> {
    const ai = user.access?.ai;
    if (!ai || user.access?.unrestricted) return;
    if (!ai.enabled) {
      throw new ForbiddenException({
        status: 403,
        title: 'Forbidden',
        code: 'AUTH_AI_DISABLED',
        detail: BLOCK_DETAIL.disabled,
      });
    }
    if (ai.monthlyTokens === null && ai.monthlyCostUsd === null && ai.dailyCalls === null) return;
    const reason = aiBlock(ai, await this.usage(user.id, workspaceIds));
    if (reason) {
      throw new HttpException(
        {
          status: 429,
          title: 'Too Many Requests',
          code: 'AUTH_AI_LIMIT_REACHED',
          detail: BLOCK_DETAIL[reason],
          reason,
        },
        429,
      );
    }
  }

  /** Projects the account created and that still exist. */
  private async createdProjects(workspaceId: string, userId: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.workspace_id',$1,true)", [workspaceId]);
      const { rows } = await client.query<{ count: string }>(
        'select count(*) from projects where workspace_id = $1 and created_by = $2 and deleted_at is null',
        [workspaceId, userId],
      );
      await client.query('commit');
      return Number(rows[0]?.count ?? 0);
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async assertCanCreateProject(user: AuthUser, workspaceId: string): Promise<void> {
    const access = user.access;
    if (!access || access.unrestricted) return;
    if (!access.canCreateProjects) {
      throw new ForbiddenException({
        status: 403,
        title: 'Forbidden',
        code: 'AUTH_PROJECT_CREATE_DENIED',
        detail: 'This account may not create projects.',
      });
    }
    if (
      access.maxProjects !== null &&
      (await this.createdProjects(workspaceId, user.id)) >= access.maxProjects
    ) {
      throw new ForbiddenException({
        status: 403,
        title: 'Forbidden',
        code: 'AUTH_PROJECT_LIMIT_REACHED',
        detail: 'This account reached its limit of projects.',
      });
    }
  }
}
