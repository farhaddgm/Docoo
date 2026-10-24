import {
  questionRef,
  type PromptResearchQuestion,
  type ResearchChannel,
  type ResearchQuestionInput,
} from '@docoo/domain';
import type { PoolClient } from 'pg';

/** Database side of the research plan (ADR-0038), shared by the API and the worker. */
export interface ResearchPlanQuestionView extends PromptResearchQuestion {
  readonly ordinal: number;
}

export interface ResearchPlanView {
  readonly id: string;
  readonly versionNo: number;
  readonly source: 'system' | 'ai' | 'admin';
  readonly createdAt: string;
  readonly questions: readonly ResearchPlanQuestionView[];
  readonly confirmed: { readonly by: string; readonly at: string; readonly note: string } | null;
}

interface PlanRow {
  id: string;
  versionNo: number;
  source: 'system' | 'ai' | 'admin';
  createdAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  note: string | null;
}

/** The newest plan of the project with its questions and whether it was confirmed. */
export async function latestResearchPlan(
  client: PoolClient,
  projectId: string,
): Promise<ResearchPlanView | null> {
  const plan = (
    await client.query<PlanRow>(
      `select p.id, p.version_no as "versionNo", p.source,
              to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
              c.confirmed_by as "confirmedBy",
              to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "confirmedAt",
              c.note
         from research_plans p left join research_plan_confirmations c on c.plan_id = p.id
        where p.project_id = $1 order by p.version_no desc limit 1`,
      [projectId],
    )
  ).rows[0];
  if (!plan) return null;
  const rows = (
    await client.query<{
      ordinal: number;
      question: string;
      why: string;
      channel: ResearchChannel;
    }>(
      `select ordinal, question, why, channel from research_questions where plan_id = $1 order by ordinal`,
      [plan.id],
    )
  ).rows;
  return {
    id: plan.id,
    versionNo: plan.versionNo,
    source: plan.source,
    createdAt: plan.createdAt,
    questions: rows.map((row) => ({
      id: questionRef(row.ordinal),
      ordinal: row.ordinal,
      question: row.question,
      why: row.why,
      channel: row.channel,
    })),
    confirmed:
      plan.confirmedBy && plan.confirmedAt
        ? { by: plan.confirmedBy, at: plan.confirmedAt, note: plan.note ?? '' }
        : null,
  };
}

/**
 * What the research stage works to: the newest plan when the administrator confirmed it and it
 * holds at least one question. Null means "research as before", from the problem statement.
 */
export async function confirmedResearchPlan(
  client: PoolClient,
  projectId: string,
): Promise<{ versionNo: number; questions: readonly PromptResearchQuestion[] } | null> {
  const plan = await latestResearchPlan(client, projectId);
  if (!plan?.confirmed || plan.questions.length === 0) return null;
  return {
    versionNo: plan.versionNo,
    questions: plan.questions.map(({ id, question, why, channel }) => ({
      id,
      question,
      why,
      channel,
    })),
  };
}

/** Appends a new plan version with its questions; the caller holds the transaction. */
export async function insertResearchPlan(
  client: PoolClient,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly source: 'system' | 'ai' | 'admin';
    readonly questions: readonly ResearchQuestionInput[];
    readonly createdBy?: string | null;
    readonly invocationId?: string | null;
  },
): Promise<string> {
  const plan = (
    await client.query<{ id: string }>(
      `insert into research_plans (workspace_id, project_id, version_no, source, invocation_id, created_by)
       values ($1, $2, coalesce((select max(version_no) from research_plans where project_id = $2), 0) + 1,
               $3, $4, $5) returning id`,
      [
        input.workspaceId,
        input.projectId,
        input.source,
        input.invocationId ?? null,
        input.createdBy ?? null,
      ],
    )
  ).rows[0]!;
  let ordinal = 0;
  for (const item of input.questions) {
    ordinal += 1;
    await client.query(
      `insert into research_questions (workspace_id, plan_id, ordinal, question, why, channel)
       values ($1, $2, $3, $4, $5, $6)`,
      [input.workspaceId, plan.id, ordinal, item.question, item.why, item.channel],
    );
  }
  return plan.id;
}

/**
 * The gate before research. Returns true when the stage must wait: the newest plan is not
 * confirmed yet, so an empty first plan and one task for the administrator are made (once) and
 * the stage and run show that they wait for a person. The stage goes on when the administrator
 * confirms, even a plan with no question: that is the choice to research as before.
 */
export async function researchPlanGate(
  client: PoolClient,
  ref: { workspaceId: string; projectId: string; stageRunId: string; runId: string },
): Promise<{ waiting: boolean; newlyOpened: boolean }> {
  const project = (
    await client.query<{ profile: string }>(
      'select analysis_profile as profile from projects where id = $1',
      [ref.projectId],
    )
  ).rows[0];
  // The quick draft keeps its short path; a stage that already produced an output is not held.
  if (!project || project.profile === 'quick') return { waiting: false, newlyOpened: false };
  const stage = (
    await client.query<{ latest: string | null }>(
      'select latest_output_id as latest from stage_runs where id = $1',
      [ref.stageRunId],
    )
  ).rows[0];
  if (stage?.latest) return { waiting: false, newlyOpened: false };
  const plan = await latestResearchPlan(client, ref.projectId);
  if (plan?.confirmed) return { waiting: false, newlyOpened: false };
  if (!plan) {
    await insertResearchPlan(client, {
      workspaceId: ref.workspaceId,
      projectId: ref.projectId,
      source: 'system',
      questions: [],
    });
  }
  const open = await client.query(
    `select 1 from human_tasks where project_id = $1 and kind = 'research_plan_confirmation' and status = 'pending'`,
    [ref.projectId],
  );
  let newlyOpened = false;
  if (!open.rowCount) {
    await client.query(
      `insert into human_tasks (workspace_id, project_id, stage_run_id, kind, title, payload)
       values ($1, $2, $3, 'research_plan_confirmation', $4, $5::jsonb)`,
      [
        ref.workspaceId,
        ref.projectId,
        ref.stageRunId,
        'Confirm the research plan',
        JSON.stringify({ stageRunId: ref.stageRunId }),
      ],
    );
    newlyOpened = true;
  }
  await client.query(`update stage_runs set status = 'waiting_for_human' where id = $1`, [
    ref.stageRunId,
  ]);
  await client.query(`update workflow_runs set status = 'waiting_for_human' where id = $1`, [
    ref.runId,
  ]);
  return { waiting: true, newlyOpened };
}
