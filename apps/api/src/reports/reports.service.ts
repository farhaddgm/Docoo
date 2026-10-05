import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import { notFound } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { CHARTER_VERSION, evaluateRules, STAGE_ROLE, type RuleInput } from './brain.js';
import { RoleEvaluationService } from './role-evaluation.service.js';

export interface Range {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export type UsageGroup = 'project' | 'stage' | 'day' | 'model';

const DAY_MS = 86_400_000;

/** Default report window: the last 30 days up to now. */
function window(range: Range): { from: string; to: string } {
  const to = range.to ?? new Date().toISOString();
  const from = range.from ?? new Date(new Date(to).getTime() - 30 * DAY_MS).toISOString();
  return { from, to };
}

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

/** Dashboard, cost report and Brain reports (REP-001, REP-002, REP-004). */
@Injectable()
export class ReportsService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly evaluation: RoleEvaluationService,
  ) {}

  /** Cards of the back-office dashboard (docs/01-product/05-backoffice-ux.md §3). */
  async dashboard(context: WorkspaceRequestContext, range: Range) {
    const period = window(range);
    return this.database.run(context, async (client) => {
      const waiting = (
        await client.query<Record<string, unknown>>(
          `select t.id, t.kind, t.title, t.project_id as "projectId", p.title as "projectTitle", ${isoColumn('t.created_at', '"createdAt"')}
             from human_tasks t left join projects p on p.id = t.project_id
            where t.status = 'pending' order by t.created_at, t.id limit 10`,
        )
      ).rows;
      const waitingTotal = (
        await client.query<{ count: number }>(
          `select count(*)::int as count from human_tasks where status = 'pending'`,
        )
      ).rows[0]!.count;
      const workflows = Object.fromEntries(
        (
          await client.query<{ status: string; count: number }>(
            `select r.status::text as status, count(*)::int as count
               from workflow_runs r join projects p on p.id = r.project_id and p.deleted_at is null
              where r.run_no = (select max(run_no) from workflow_runs latest where latest.project_id = r.project_id)
              group by 1`,
          )
        ).rows.map((row) => [row.status, row.count]),
      ) as Record<string, number>;
      const knowledge = (
        await client.query<{
          pending: number;
          expired: number;
          needs_revision: number;
          conflicted: number;
        }>(
          `select count(*) filter (where v.status in ('pending', 'in_review'))::int as pending,
                  count(*) filter (where v.status = 'expired' or (v.status = 'approved' and v.valid_until is not null and v.valid_until <= now()))::int as expired,
                  count(*) filter (where v.status = 'needs_revision')::int as needs_revision,
                  -- only conflicts between claims still in use, as the conflicts screen lists them
                  (select count(*) from knowledge_conflicts k
                     join claims ca on ca.id = k.claim_a_id
                     join knowledge_versions va on va.id = ca.knowledge_version_id
                     join knowledge_items ia on ia.id = va.item_id
                     join claims cb on cb.id = k.claim_b_id
                     join knowledge_versions vb on vb.id = cb.knowledge_version_id
                     join knowledge_items ib on ib.id = vb.item_id
                    where k.status = 'open'
                      and ia.deleted_at is null and ia.current_version_id = va.id
                      and ib.deleted_at is null and ib.current_version_id = vb.id)::int as conflicted
             from knowledge_items i join knowledge_versions v on v.id = i.current_version_id
            where i.deleted_at is null`,
        )
      ).rows[0]!;
      const providers = (
        await client.query<Record<string, unknown>>(
          `select id, provider, name, status, ${isoColumn('last_checked_at', '"lastCheckedAt"')}, last_latency_ms as "lastLatencyMs",
                  last_error as "lastError"
             from provider_connections where disabled_at is null order by name, id`,
        )
      ).rows;
      const costWarnings = await this.costWarnings(client);
      const retries = (
        await client.query<Record<string, unknown>>(
          `select s.id, s.project_id as "projectId", p.title as "projectTitle", s.stage, s.status,
                  s.attempts_used as "attemptsUsed", s.attempt_limit as "attemptLimit"
             from stage_runs s join projects p on p.id = s.project_id
            where s.status not in ('completed', 'cancelled', 'failed') and s.attempts_used >= s.attempt_limit - 2
            order by s.attempts_used desc, s.id limit 10`,
        )
      ).rows;
      const usage = (
        await client.query<{ invocations: number; tokens: number; cost_usd: number }>(
          `select count(*)::int as invocations,
                  coalesce(sum(input_tokens + output_tokens + coalesce(reasoning_tokens, 0)), 0)::bigint::float8 as tokens,
                  coalesce(sum(cost_usd), 0)::float8 as cost_usd
             from model_invocations where created_at >= $1 and created_at < $2`,
          [period.from, period.to],
        )
      ).rows[0]!;
      const brain = (
        await client.query<{
          id: string;
          scope: string;
          project_id: string | null;
          created_at: string;
          deviations: number;
          high: number;
        }>(
          `select id, scope, project_id, ${isoColumn('created_at', 'created_at')}, jsonb_array_length(deviations) as deviations,
                  (select count(*) from jsonb_array_elements(deviations) item where item->>'severity' = 'high')::int as high
             from brain_reports order by created_at desc, id desc limit 1`,
        )
      ).rows[0];
      return {
        period,
        waiting: { total: waitingTotal, items: waiting },
        workflows: {
          active: (workflows['starting'] ?? 0) + (workflows['running'] ?? 0),
          waitingForHuman: workflows['waiting_for_human'] ?? 0,
          paused: workflows['paused'] ?? 0,
          failed: workflows['failed'] ?? 0,
        },
        knowledge: {
          pending: knowledge.pending,
          expired: knowledge.expired,
          needsRevision: knowledge.needs_revision,
          conflicted: knowledge.conflicted,
        },
        providers: {
          items: providers,
          unhealthy: providers.filter((item) =>
            ['invalid', 'degraded', 'unavailable'].includes(String(item['status'])),
          ).length,
          costWarnings,
        },
        retriesNearLimit: retries,
        usage: {
          invocations: usage.invocations,
          tokens: usage.tokens,
          costUsd: round(usage.cost_usd),
        },
        latestBrainReport: brain
          ? {
              id: brain.id,
              scope: brain.scope,
              projectId: brain.project_id,
              createdAt: brain.created_at,
              deviations: brain.deviations,
              high: brain.high,
            }
          : null,
      };
    });
  }

  /** Projects whose current run spend reached 80 % of `ai.max_cost_usd_per_run`. */
  private async costWarnings(client: PoolClient) {
    const rows = (
      await client.query<{
        project_id: string;
        title: string;
        spent: number;
        resolved: Record<string, unknown> | null;
      }>(
        `select p.id as project_id, p.title, coalesce(sum(i.cost_usd), 0)::float8 as spent, s.resolved
           from projects p
           join workflow_runs r on r.project_id = p.id and r.run_no = (select max(run_no) from workflow_runs latest where latest.project_id = p.id)
           left join config_snapshots s on s.id = r.config_snapshot_id
           left join stage_runs sr on sr.run_id = r.id
           left join model_invocations i on i.stage_run_id = sr.id
          where p.status = 'active' and p.deleted_at is null
          group by p.id, p.title, s.resolved`,
      )
    ).rows;
    return rows
      .map((row) => {
        const limit = Number(row.resolved?.['ai.max_cost_usd_per_run'] ?? 20);
        return {
          projectId: row.project_id,
          projectTitle: row.title,
          spentUsd: round(row.spent),
          limitUsd: limit,
        };
      })
      .filter((row) => row.limitUsd > 0 && row.spentUsd >= row.limitUsd * 0.8);
  }

  /** REP-004: tokens and estimated cost grouped by project, stage, day or model in a period. */
  async usage(
    context: WorkspaceRequestContext,
    input: Range & { projectId?: string | undefined; groupBy: UsageGroup },
  ) {
    const period = window(input);
    const key = {
      project: `coalesce(i.project_id::text, 'none')`,
      stage: `coalesce(s.stage::text, i.purpose)`,
      day: `to_char(date_trunc('day', i.created_at at time zone 'UTC'), 'YYYY-MM-DD')`,
      model: `i.provider::text || ':' || i.model`,
    }[input.groupBy];
    return this.database.run(context, async (client) => {
      if (input.projectId) {
        const project = await client.query('select 1 from projects where id = $1', [
          input.projectId,
        ]);
        if (!project.rowCount) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');
      }
      const params = [period.from, period.to, input.projectId ?? null];
      const filter = `i.created_at >= $1 and i.created_at < $2 and ($3::uuid is null or i.project_id = $3)`;
      const select = `count(*)::int as invocations,
              coalesce(sum(i.input_tokens), 0)::bigint::float8 as "inputTokens",
              coalesce(sum(i.output_tokens), 0)::bigint::float8 as "outputTokens",
              coalesce(sum(i.reasoning_tokens), 0)::bigint::float8 as "reasoningTokens",
              coalesce(sum(i.cost_usd), 0)::float8 as "costUsd",
              count(*) filter (where i.status <> 'succeeded')::int as failures,
              count(*) filter (where i.status = 'succeeded' and i.price_id is null)::int as "unpricedInvocations",
              round(avg(i.latency_ms))::int as "avgLatencyMs"`;
      const groups = (
        await client.query<Record<string, unknown> & { key: string; costUsd: number }>(
          `select ${key} as key, ${select}
             from model_invocations i left join stage_runs s on s.id = i.stage_run_id
            where ${filter} group by 1 order by 1`,
          params,
        )
      ).rows;
      const totals = (
        await client.query<Record<string, unknown> & { costUsd: number }>(
          `select ${select} from model_invocations i where ${filter}`,
          params,
        )
      ).rows[0]!;
      let labels: Record<string, string> = {};
      if (input.groupBy === 'project') {
        const ids = groups.map((group) => group.key).filter((id) => id !== 'none');
        labels = Object.fromEntries(
          (
            await client.query<{ id: string; title: string }>(
              'select id, title from projects where id = any($1::uuid[])',
              [ids],
            )
          ).rows.map((row) => [row.id, row.title]),
        );
      }
      return {
        period,
        projectId: input.projectId ?? null,
        groupBy: input.groupBy,
        currency: 'USD',
        estimate: true,
        totals: { ...totals, costUsd: round(totals.costUsd) },
        groups: groups.map((group) => ({
          ...group,
          label: labels[group.key] ?? group.key,
          costUsd: round(group.costUsd),
        })),
      };
    });
  }

  /**
   * REP-002: builds a project or workspace Brain report from recorded evidence and stores it
   * append-only. It reads every role's work and never pauses, edits or reconfigures anything
   * (FR-BRN-004); recommendations are for an administrator to act on. With `modelEvaluation`
   * the Brain also judges each stage role against its charter with the model (ADR-0017): the
   * calls run between two transactions, never inside one, and a role that cannot be judged is
   * reported with the reason instead of failing the report.
   */
  async generateBrainReport(
    context: WorkspaceRequestContext,
    input: Range & { projectId?: string | undefined; modelEvaluation?: boolean | undefined },
  ) {
    const to = input.to ?? new Date().toISOString();
    const from = input.from ?? null;
    const analysed = await this.database.run(context, async (client) => {
      if (input.projectId) {
        const project = await client.query(
          'select 1 from projects where id = $1 and deleted_at is null',
          [input.projectId],
        );
        if (!project.rowCount) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');
      }
      const params = [input.projectId ?? null, from, to];
      const inPeriod = (column: string) =>
        `($2::timestamptz is null or ${column} >= $2) and ${column} < $3`;
      const ofProject = (column: string) => `($1::uuid is null or ${column} = $1)`;
      const rows = async <T extends Record<string, unknown>>(sql: string) =>
        (await client.query<T>(sql, params)).rows;

      const incompleteAttempts = await rows<{ stage: string; id: string }>(
        `select s.stage::text as stage, a.id from stage_attempts a join stage_runs s on s.id = a.stage_run_id
          where a.status = 'incomplete' and ${ofProject('s.project_id')} and ${inPeriod('a.started_at')} order by a.started_at, a.id`,
      );
      const rejections = await rows<{ stage: string; id: string }>(
        `select s.stage::text as stage, r.id from stage_reviews r join stage_runs s on s.id = r.stage_run_id
          where r.action = 'reject' and ${ofProject('s.project_id')} and ${inPeriod('r.created_at')} order by r.created_at, r.id`,
      );
      const reviewed = await rows<{ stage: string; count: number }>(
        `select s.stage::text as stage, count(distinct r.output_id)::int as count from stage_reviews r join stage_runs s on s.id = r.stage_run_id
          where r.action in ('approve', 'reject') and ${ofProject('s.project_id')} and ${inPeriod('r.created_at')} group by 1`,
      );
      const exhaustedStages = await rows<{ stage: string; id: string; passedByDecision: boolean }>(
        `select s.stage::text as stage, s.id, s.passed_by_decision is not null as "passedByDecision" from stage_runs s
          where s.attempts_used >= s.attempt_limit and ${ofProject('s.project_id')}
            and ${inPeriod('coalesce(s.completed_at, s.started_at, now())')} order by s.id`,
      );
      const findings = await rows<{
        id: string;
        targetStage: string;
        severity: string;
        evidence: string;
        location: string;
      }>(
        `select f.id, f.target_stage as "targetStage", f.severity::text as severity, f.evidence, f.location
           from evaluation_findings f join evaluations e on e.id = f.evaluation_id join documents d on d.id = e.document_id
          where ${ofProject('d.project_id')} and ${inPeriod('f.created_at')} order by f.created_at, f.id`,
      );
      const nonCompliantDocuments = await rows<{ id: string }>(
        `select distinct a.target_id as id from audit_events a join documents d on d.id = a.target_id
          where a.action = 'document.submit' and a.after->>'status' = 'non_compliant' and ${ofProject('d.project_id')}
            and ${inPeriod('a.occurred_at')} order by 1`,
      );
      const exceptions = await rows<{ id: string }>(
        `select e.id from evaluation_exceptions x join evaluations e on e.id = x.evaluation_id join documents d on d.id = e.document_id
          where ${ofProject('d.project_id')} and ${inPeriod('x.created_at')} order by x.created_at, e.id`,
      );
      const workspaceWide = !input.projectId;
      const openConflicts = workspaceWide
        ? await rows<{ id: string }>(
            `select id from knowledge_conflicts where status = 'open' and severity = 'high' and $1::uuid is null and ${inPeriod('created_at')} order by created_at, id`,
          )
        : [];
      const overrides = workspaceWide
        ? await rows<{ id: string }>(
            `select id from audit_overrides where $1::uuid is null and ${inPeriod('created_at')} order by created_at, id`,
          )
        : [];
      const failedInvocations = await rows<{ id: string; provider: string }>(
        `select id, provider::text as provider from model_invocations
          where status = 'permanent_failed' and ${ofProject('project_id')} and ${inPeriod('created_at')} order by created_at, id`,
      );
      const input_: RuleInput = {
        incompleteAttempts,
        rejections,
        reviewedOutputs: Object.fromEntries(reviewed.map((row) => [row.stage, row.count])),
        exhaustedStages,
        findings,
        nonCompliantDocuments,
        exceptions,
        openConflicts,
        overrides,
        failedInvocations,
      };
      const { deviations, recommendations } = evaluateRules(input_);

      const performance = await rows<{
        stage: string;
        invocations: number;
        costUsd: number;
        avgLatencyMs: number | null;
        retries: number;
      }>(
        `select coalesce(s.stage::text, i.purpose) as stage, count(*)::int as invocations, coalesce(sum(i.cost_usd), 0)::float8 as "costUsd",
                round(avg(i.latency_ms))::int as "avgLatencyMs", count(*) filter (where i.retry_no > 0)::int as retries
           from model_invocations i left join stage_runs s on s.id = i.stage_run_id
          where ${ofProject('i.project_id')} and ${inPeriod('i.created_at')} group by 1 order by 1`,
      );
      const summary = {
        roles: Object.entries(STAGE_ROLE).map(([stage, role]) => ({
          stage,
          role,
          deviations: deviations.filter((deviation) => deviation.role === role).length,
          ...(performance.find((row) => row.stage === stage) ?? {
            invocations: 0,
            costUsd: 0,
            avgLatencyMs: null,
            retries: 0,
          }),
        })),
        totals: {
          deviations: deviations.length,
          high: deviations.filter((deviation) => deviation.severity === 'high').length,
          invocations: performance.reduce((sum, row) => sum + row.invocations, 0),
          costUsd: round(performance.reduce((sum, row) => sum + row.costUsd, 0)),
        },
      };
      const plan = input.modelEvaluation
        ? await this.evaluation.plan(
            client,
            context,
            { projectId: input.projectId ?? null, from, to },
            deviations,
          )
        : null;
      return { summary, deviations, recommendations, plan };
    });
    const outcome = analysed.plan
      ? await this.evaluation.evaluate(
          context,
          { projectId: input.projectId ?? null },
          analysed.plan,
        )
      : null;
    const { deviations, recommendations } = analysed;
    const summary = outcome
      ? { ...analysed.summary, modelEvaluation: outcome.summary }
      : analysed.summary;
    return this.database.run(context, async (client) => {
      const report = (
        await client.query<{ id: string }>(
          `insert into brain_reports (workspace_id, scope, project_id, charter_version, period_from, period_to, summary, deviations,
                                      recommendations, evaluations, created_by)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11) returning id`,
          [
            context.workspaceId,
            input.projectId ? 'project' : 'workspace',
            input.projectId ?? null,
            CHARTER_VERSION,
            from,
            to,
            JSON.stringify(summary),
            JSON.stringify(deviations),
            JSON.stringify(recommendations),
            JSON.stringify(outcome?.evaluations ?? []),
            context.actorId,
          ],
        )
      ).rows[0]!;
      await writeAudit(client, context, {
        action: 'brain.report_generated',
        targetType: 'brain_report',
        targetId: report.id,
        projectId: input.projectId ?? null,
        after: {
          scope: input.projectId ? 'project' : 'workspace',
          deviations: deviations.length,
          charterVersion: CHARTER_VERSION,
          ...(outcome
            ? {
                modelEvaluation: {
                  completed: outcome.summary.completed,
                  skipped: outcome.summary.skipped,
                  failed: outcome.summary.failed,
                },
              }
            : {}),
        },
      });
      return this.loadBrainReport(client, report.id);
    });
  }

  async brainReports(
    context: WorkspaceRequestContext,
    input: { projectId?: string | undefined; limit: number },
  ) {
    return this.database.run(
      context,
      async (client) =>
        (
          await client.query<Record<string, unknown>>(
            `select id, scope, project_id as "projectId", charter_version as "charterVersion", ${isoColumn('period_from', '"periodFrom"')},
                  ${isoColumn('period_to', '"periodTo"')}, summary->'totals' as totals, summary->'modelEvaluation' as "modelEvaluation", ${isoColumn('created_at', '"createdAt"')}
             from brain_reports where ($1::uuid is null or project_id = $1)
            order by created_at desc, id desc limit $2`,
            [input.projectId ?? null, input.limit],
          )
        ).rows,
    );
  }

  async brainReport(context: WorkspaceRequestContext, reportId: string) {
    return this.database.run(context, async (client) => this.loadBrainReport(client, reportId));
  }

  private async loadBrainReport(client: PoolClient, reportId: string) {
    const row = (
      await client.query<Record<string, unknown>>(
        `select id, scope, project_id as "projectId", charter_version as "charterVersion", ${isoColumn('period_from', '"periodFrom"')},
                ${isoColumn('period_to', '"periodTo"')}, summary, deviations, recommendations, evaluations, created_by as "createdBy",
                ${isoColumn('created_at', '"createdAt"')}
           from brain_reports where id = $1`,
        [reportId],
      )
    ).rows[0];
    if (!row) throw notFound('BRAIN_REPORT_NOT_FOUND', 'The Brain report was not found.');
    return row;
  }
}
