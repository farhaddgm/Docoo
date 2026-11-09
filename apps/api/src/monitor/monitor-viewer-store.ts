import type {
  ViewerSourceAction,
  ViewerSourceAgent,
  ViewerSourceDocument,
  ViewerSourceGate,
  ViewerSourceStage,
  ViewerSourceUsage,
} from '@docoo/contracts';
import type { PoolClient } from 'pg';

import { isoColumn } from '../common/pagination.js';
import { contentTitle, contentToText, researchSourcesOf } from './monitor-text.js';

/** The reads of the viewer monitor (ADR-0056 §7): one project, nothing written. */

export async function viewerProject(client: PoolClient, workspaceId: string, projectId: string) {
  const row = (
    await client.query<{ code: string; title: string; status: string; current_stage: string }>(
      `select code, title, status::text as status, current_stage from projects
        where workspace_id = $1 and id = $2 and deleted_at is null`,
      [workspaceId, projectId],
    )
  ).rows[0];
  return row
    ? { code: row.code, title: row.title, status: row.status, currentStage: row.current_stage }
    : null;
}

/** The stages of the newest run of the project, each with its latest output as text. */
export async function viewerStages(
  client: PoolClient,
  projectId: string,
): Promise<ViewerSourceStage[]> {
  const rows = (
    await client.query<{
      stage: string;
      status: string;
      attempts_used: number;
      started_at: string | null;
      completed_at: string | null;
      content: unknown;
      output_at: string | null;
      error_code: string | null;
    }>(
      `select s.stage::text as stage, s.status::text as status, s.attempts_used,
              ${isoColumn('s.started_at', 'started_at')}, ${isoColumn('s.completed_at', 'completed_at')},
              o.content, ${isoColumn('o.created_at', 'output_at')},
              (select a.error_code from stage_attempts a where a.stage_run_id = s.id
                order by a.attempt_no desc limit 1) as error_code
         from stage_runs s left join stage_outputs o on o.id = s.latest_output_id
        where s.project_id = $1
          and s.run_id = (select run_id from stage_runs where project_id = $1
                           order by created_at desc limit 1)
        order by s.sequence`,
      [projectId],
    )
  ).rows;
  return rows.map((row) => ({
    stage: row.stage,
    status: row.status,
    attempts: row.attempts_used,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    outputTitle: row.content === null ? null : contentTitle(row.content),
    outputText: row.content === null ? null : contentToText(row.content),
    outputAt: row.output_at,
    errorCode: row.error_code,
    errorText: row.error_code,
  }));
}

export async function viewerGates(
  client: PoolClient,
  projectId: string,
): Promise<ViewerSourceGate[]> {
  const rows = (
    await client.query<{ title: string; status: string; created_at: string }>(
      `select title, status::text as status, ${isoColumn('created_at', 'created_at')}
         from human_tasks where project_id = $1 and status = 'pending'
        order by created_at desc limit 12`,
      [projectId],
    )
  ).rows;
  return rows.map((row) => ({ title: row.title, status: row.status, createdAt: row.created_at }));
}

export async function viewerDocuments(
  client: PoolClient,
  projectId: string,
): Promise<ViewerSourceDocument[]> {
  const rows = (
    await client.query<{
      title: string;
      status: string;
      content: unknown;
      updated_at: string;
      quality_status: string | null;
      quality_overall: number | null;
    }>(
      `select d.title, d.status::text as status, v.content, ${isoColumn('d.updated_at', 'updated_at')},
              e.status::text as quality_status, e.overall::float8 as quality_overall
         from documents d left join document_versions v on v.id = d.current_version_id
         left join lateral (select status, overall from evaluations
                             where document_id = d.id order by created_at desc limit 1) e on true
        where d.project_id = $1 order by d.priority, d.created_at, d.id limit 12`,
      [projectId],
    )
  ).rows;
  return rows.map((row) => ({
    title: row.title,
    status: row.status,
    preview: row.content === null ? null : contentToText(row.content).slice(0, 600),
    updatedAt: row.updated_at,
    quality:
      row.quality_status === null || row.quality_overall === null
        ? null
        : { status: row.quality_status, overall: row.quality_overall },
  }));
}

/** The sources cited by the newest research output of the project. */
export async function viewerResearch(client: PoolClient, projectId: string) {
  const row = (
    await client.query<{ content: unknown }>(
      `select o.content from stage_runs s join stage_outputs o on o.id = s.latest_output_id
        where s.project_id = $1 and s.stage = 'research'
        order by s.created_at desc limit 1`,
      [projectId],
    )
  ).rows[0];
  return researchSourcesOf(row?.content);
}

export async function viewerAgents(
  client: PoolClient,
  projectId: string,
): Promise<ViewerSourceAgent[]> {
  const rows = (
    await client.query<{
      role: string;
      calls: number;
      last_tool: string | null;
      last_decision: string | null;
      last_at: string | null;
    }>(
      `select role::text as role, count(*)::int as calls,
              (array_agg(tool order by created_at desc))[1] as last_tool,
              (array_agg(decision::text order by created_at desc))[1] as last_decision,
              ${isoColumn('max(created_at)', 'last_at')}
         from agent_tool_calls where project_id = $1 group by role order by role`,
      [projectId],
    )
  ).rows;
  return rows.map((row) => ({
    role: row.role,
    calls: row.calls,
    lastTool: row.last_tool,
    lastDecision: row.last_decision,
    lastAt: row.last_at,
  }));
}

/** What the voice assistant proposed about this project (the person's own rows only, by RLS). */
export async function viewerActions(
  client: PoolClient,
  projectId: string,
): Promise<{ actions: ViewerSourceAction[]; live: boolean }> {
  const rows = (
    await client.query<{
      status: string;
      summary: string;
      target_name: string | null;
      proposed_at: string;
    }>(
      `select status, summary, target_name, ${isoColumn('proposed_at', 'proposed_at')}
         from live_actions where project_id = $1 order by proposed_at desc limit 30`,
      [projectId],
    )
  ).rows;
  const live = (
    await client.query<{ n: number }>(
      `select count(*)::int as n from live_sessions where status = 'active'`,
    )
  ).rows[0];
  return {
    actions: rows.reverse().map((row) => ({
      status: row.status,
      summary: row.summary,
      targetName: row.target_name,
      proposedAt: row.proposed_at,
    })),
    live: (live?.n ?? 0) > 0,
  };
}

export async function viewerUsage(
  client: PoolClient,
  projectId: string,
): Promise<ViewerSourceUsage[]> {
  const rows = (
    await client.query<{
      provider: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    }>(
      `select provider::text as provider, model,
              coalesce(sum(input_tokens), 0)::float8 as input_tokens,
              coalesce(sum(output_tokens), 0)::float8 as output_tokens,
              coalesce(sum(cost_usd), 0)::float8 as cost_usd
         from model_invocations where project_id = $1 group by provider, model
        order by sum(coalesce(cost_usd, 0)) desc, model limit 10`,
      [projectId],
    )
  ).rows;
  return rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
  }));
}
