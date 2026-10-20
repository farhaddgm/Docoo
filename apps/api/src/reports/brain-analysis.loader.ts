import type { PoolClient } from 'pg';

import { STAGE_ROLE } from './brain.js';
import type { AnalysisInput } from './brain-analysis.js';

const ROW_LIMIT = 200;
const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface AnalysisPeriod {
  readonly projectId: string | null;
  readonly from: string;
  readonly to: string;
}

/**
 * Reads the rows `analyse` needs (ADR-0033), under the caller's own RLS. Every query only
 * reads; the first half of the period is the baseline the second half is compared with.
 */
export async function loadAnalysisInput(
  client: PoolClient,
  period: AnalysisPeriod,
): Promise<AnalysisInput> {
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  const middle = new Date(from + (to - from) / 2).toISOString();
  const now = new Date().toISOString();
  const scope = [period.projectId];
  const rows = async <T extends Record<string, unknown>>(sql: string, params: unknown[]) =>
    (await client.query<T>(sql, params)).rows;
  // Knowledge is shared by the workspace; a project's own knowledge is what is scoped to it or
  // was retrieved for it.
  const scoped = `select ki.id from knowledge_items ki
     where ki.deleted_at is null and ($1::uuid is null
       or exists (select 1 from knowledge_scopes s where s.item_id = ki.id and s.scope_type = 'project' and s.scope_id = $1)
       or exists (select 1 from retrieval_snapshots rs where rs.project_id = $1
                   and rs.results @> jsonb_build_array(jsonb_build_object('knowledgeId', ki.id::text))))`;

  const weak = await rows<{ id: string; itemId: string; overall: number; at: string }>(
    `with scoped as (${scoped})
     select ki.id, ki.id as "itemId", r.overall::float8 as overall, ${iso('r.created_at')} as at
       from knowledge_items ki
       join knowledge_versions v on v.id = ki.current_version_id and v.status = 'approved'
       join lateral (select overall, created_at from audit_reviews where knowledge_version_id = v.id
                      order by created_at desc, id desc limit 1) r on true
      where ki.id in (select id from scoped) and r.overall < 70
        and not exists (select 1 from audit_overrides o where o.knowledge_version_id = v.id)
      order by r.overall, ki.id limit ${ROW_LIMIT}`,
    scope,
  );
  const unaudited = await rows<{ id: string; itemId: string; ageDays: number; at: string }>(
    `with scoped as (${scoped})
     select ki.id, ki.id as "itemId", floor(extract(epoch from ($2::timestamptz - v.created_at)) / 86400)::int as "ageDays",
            ${iso('v.created_at')} as at
       from knowledge_items ki join knowledge_versions v on v.id = ki.current_version_id
      where ki.id in (select id from scoped) and v.status in ('draft', 'pending') and v.stale_reason is null
        and v.created_at < $2::timestamptz - interval '3 days'
      order by v.created_at, ki.id limit ${ROW_LIMIT}`,
    [...scope, now],
  );
  const stale = await rows<{
    id: string;
    itemId: string;
    reason: 'expired' | 'expiring' | 'source_changed';
    at: string;
  }>(
    `with scoped as (${scoped})
     select ki.id, ki.id as "itemId",
            case when v.valid_until is not null and v.valid_until < $2::timestamptz then 'expired'
                 when v.stale_reason is not null then 'source_changed'
                 else 'expiring' end as reason,
            ${iso('coalesce(v.valid_until, v.updated_at)')} as at
       from knowledge_items ki join knowledge_versions v on v.id = ki.current_version_id and v.status = 'approved'
      where ki.id in (select id from scoped)
        and (v.stale_reason is not null or v.valid_until < $2::timestamptz + interval '14 days')
      order by v.valid_until nulls last, ki.id limit ${ROW_LIMIT}`,
    [...scope, now],
  );
  const conflicts = await rows<{
    id: string;
    itemId: string;
    severity: 'low' | 'medium' | 'high';
    at: string;
  }>(
    `with scoped as (${scoped})
     select c.id, va.item_id as "itemId", c.severity::text as severity, ${iso('c.created_at')} as at
       from knowledge_conflicts c
       join claims a on a.id = c.claim_a_id join knowledge_versions va on va.id = a.knowledge_version_id
       join claims b on b.id = c.claim_b_id join knowledge_versions vb on vb.id = b.knowledge_version_id
      where c.status = 'open' and (va.item_id in (select id from scoped) or vb.item_id in (select id from scoped))
      order by c.severity desc, c.created_at, c.id limit ${ROW_LIMIT}`,
    scope,
  );

  // Windows: $2 from, $3 middle, $4 to.
  const windows = [...scope, period.from, middle, period.to];
  const ofProject = (column: string) => `($1::uuid is null or ${column} = $1)`;
  const reviewCounts = await rows<{
    stage: string;
    recent: boolean;
    reviewed: number;
    rejected: number;
  }>(
    `select s.stage::text as stage, r.created_at >= $3 as recent,
            count(distinct r.output_id)::int as reviewed,
            count(distinct r.output_id) filter (where r.action = 'reject')::int as rejected
       from stage_reviews r join stage_runs s on s.id = r.stage_run_id
      where r.action in ('approve', 'reject') and ${ofProject('s.project_id')}
        and r.created_at >= $2 and r.created_at < $4
      group by 1, 2`,
    windows,
  );
  const attemptCounts = await rows<{
    stage: string;
    recent: boolean;
    attempts: number;
    incomplete: number;
  }>(
    `select s.stage::text as stage, coalesce(a.started_at, a.created_at) >= $3 as recent,
            count(*)::int as attempts, count(*) filter (where a.status = 'incomplete')::int as incomplete
       from stage_attempts a join stage_runs s on s.id = a.stage_run_id
      where ${ofProject('s.project_id')} and coalesce(a.started_at, a.created_at) >= $2
        and coalesce(a.started_at, a.created_at) < $4
      group by 1, 2`,
    windows,
  );
  const rejections = await rows<{ stage: string; id: string; at: string }>(
    `select s.stage::text as stage, r.id, ${iso('r.created_at')} as at
       from stage_reviews r join stage_runs s on s.id = r.stage_run_id
      where r.action = 'reject' and ${ofProject('s.project_id')} and r.created_at >= $2 and r.created_at < $3
      order by r.created_at desc, r.id limit ${ROW_LIMIT}`,
    [scope[0], middle, period.to],
  );
  const incomplete = await rows<{ stage: string; id: string; at: string }>(
    `select s.stage::text as stage, a.id, ${iso('coalesce(a.started_at, a.created_at)')} as at
       from stage_attempts a join stage_runs s on s.id = a.stage_run_id
      where a.status = 'incomplete' and ${ofProject('s.project_id')}
        and coalesce(a.started_at, a.created_at) >= $2 and coalesce(a.started_at, a.created_at) < $3
      order by 3 desc, a.id limit ${ROW_LIMIT}`,
    [scope[0], middle, period.to],
  );
  const waiting = await rows<{
    stage: string;
    projectId: string;
    stageRunId: string;
    outputId: string;
  }>(
    `select s.stage::text as stage, s.project_id as "projectId", s.id as "stageRunId", s.latest_output_id as "outputId"
       from stage_runs s join projects p on p.id = s.project_id and p.deleted_at is null and p.status = 'active'
      where s.status = 'waiting_for_human' and s.latest_output_id is not null and ${ofProject('s.project_id')}
      order by s.updated_at desc, s.id limit ${ROW_LIMIT}`,
    scope,
  );
  const empty = { reviewed: 0, rejected: 0, attempts: 0, incomplete: 0 };
  const stages = Object.entries(STAGE_ROLE).map(([stage, role]) => {
    const pick = (recent: boolean) => ({
      ...empty,
      ...(reviewCounts.find((row) => row.stage === stage && row.recent === recent) ?? {}),
      ...(attemptCounts.find((row) => row.stage === stage && row.recent === recent) ?? {}),
    });
    const window = (recent: boolean) => {
      const value = pick(recent);
      return {
        reviewed: value.reviewed,
        rejected: value.rejected,
        attempts: value.attempts,
        incomplete: value.incomplete,
      };
    };
    return {
      stage,
      role,
      recent: window(true),
      previous: window(false),
      recentRejections: rejections.filter((row) => row.stage === stage),
      recentIncomplete: incomplete.filter((row) => row.stage === stage),
      waiting: waiting.filter((row) => row.stage === stage),
    };
  });

  const inPeriod = (column: string) => `${column} >= $2 and ${column} < $4`;
  const inWholePeriod = (column: string) => `${column} >= $2 and ${column} < $3`;
  const whole = [scope[0], period.from, period.to];
  const passedStages = await rows<{ id: string; projectId: string; at: string }>(
    `select s.id, s.project_id as "projectId", ${iso('coalesce(s.completed_at, s.updated_at)')} as at
       from stage_runs s
      where s.passed_by_decision and ${ofProject('s.project_id')} and ${inWholePeriod('coalesce(s.completed_at, s.updated_at)')}
      order by 3 desc, s.id limit ${ROW_LIMIT}`,
    whole,
  );
  const exceptions = await rows<{ id: string; projectId: string; at: string }>(
    `select e.id, d.project_id as "projectId", ${iso('x.created_at')} as at
       from evaluation_exceptions x join evaluations e on e.id = x.evaluation_id join documents d on d.id = e.document_id
      where ${ofProject('d.project_id')} and ${inWholePeriod('x.created_at')}
      order by x.created_at desc, e.id limit ${ROW_LIMIT}`,
    whole,
  );
  const overrides = await rows<{ id: string; itemId: string; at: string }>(
    `with scoped as (${scoped})
     select o.id, kv.item_id as "itemId", ${iso('o.created_at')} as at
       from audit_overrides o
       join audit_reviews rv on rv.id = o.review_id
       join knowledge_versions kv on kv.id = o.knowledge_version_id
      where o.decision = 'approve' and rv.decision <> 'approved'
        and kv.item_id in (select id from scoped) and ${inWholePeriod('o.created_at')}
      order by o.created_at desc, o.id limit ${ROW_LIMIT}`,
    whole,
  );

  const costProjects = await rows<{
    projectId: string;
    status: string;
    version: number;
    recentUsd: number;
    previousUsd: number;
  }>(
    `select p.id as "projectId", p.status::text as status, p.version,
            coalesce(sum(i.cost_usd) filter (where i.created_at >= $3), 0)::float8 as "recentUsd",
            coalesce(sum(i.cost_usd) filter (where i.created_at < $3), 0)::float8 as "previousUsd"
       from model_invocations i join projects p on p.id = i.project_id and p.deleted_at is null
      where ${ofProject('i.project_id')} and ${inPeriod('i.created_at')}
      group by p.id, p.status, p.version
      order by 4 desc, p.id limit ${ROW_LIMIT}`,
    windows,
  );
  const unpriced = await rows<{ id: string; at: string }>(
    `select i.id, ${iso('i.created_at')} as at from model_invocations i
      where i.status = 'succeeded' and i.price_id is null and i.provider <> 'fake'
        and ${ofProject('i.project_id')} and ${inWholePeriod('i.created_at')}
      order by i.created_at desc, i.id limit ${ROW_LIMIT}`,
    whole,
  );

  const invocations = await rows<{ id: string; provider: string; errorCode: string; at: string }>(
    `select i.id, i.provider::text as provider, coalesce(i.error_code, 'unknown') as "errorCode", ${iso('i.created_at')} as at
       from model_invocations i
      where i.status in ('transient_failed', 'permanent_failed') and ${ofProject('i.project_id')} and ${inWholePeriod('i.created_at')}
      order by i.created_at desc, i.id limit ${ROW_LIMIT}`,
    whole,
  );
  const exhaustedStages = await rows<{ id: string; stage: string; projectId: string; at: string }>(
    `select s.id, s.stage::text as stage, s.project_id as "projectId", ${iso('coalesce(s.completed_at, s.updated_at)')} as at
       from stage_runs s
      where s.attempts_used >= s.attempt_limit and ${ofProject('s.project_id')}
        and ${inWholePeriod('coalesce(s.completed_at, s.updated_at)')}
      order by 4 desc, s.id limit ${ROW_LIMIT}`,
    whole,
  );

  return {
    now,
    projectId: period.projectId,
    knowledge: { weak, unaudited, stale, conflicts },
    stages,
    decisions: { passedStages, exceptions, overrides },
    costs: { projects: costProjects, unpriced },
    failures: { invocations, exhaustedStages },
  };
}
