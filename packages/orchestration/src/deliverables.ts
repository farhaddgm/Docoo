import {
  isSupportedDeliverableKind,
  type DeliverableItemInput,
  type DeliverableKind,
} from '@docoo/domain';
import type { PoolClient } from 'pg';

/** Database side of the plan of expected deliverables (ADR-0031), shared by the API and the worker. */
export interface DeliverablePlanView {
  readonly id: string;
  readonly versionNo: number;
  readonly source: 'system' | 'ai' | 'admin';
  readonly createdAt: string;
  readonly items: readonly (DeliverableItemInput & { readonly id: string })[];
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

/** The newest plan of the project with its items and whether it was confirmed. */
export async function latestPlan(
  client: PoolClient,
  projectId: string,
): Promise<DeliverablePlanView | null> {
  const plan = (
    await client.query<PlanRow>(
      `select p.id, p.version_no as "versionNo", p.source,
              to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
              c.confirmed_by as "confirmedBy",
              to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "confirmedAt",
              c.note
         from deliverable_plans p left join deliverable_confirmations c on c.plan_id = p.id
        where p.project_id = $1 order by p.version_no desc limit 1`,
      [projectId],
    )
  ).rows[0];
  if (!plan) return null;
  const items = (
    await client.query<{
      id: string;
      kind: DeliverableKind;
      title: string;
      purpose: string;
      scopeIn: string;
      scopeOut: string;
    }>(
      `select id, kind, title, purpose, scope_in as "scopeIn", scope_out as "scopeOut"
         from deliverable_items where plan_id = $1 order by ordinal`,
      [plan.id],
    )
  ).rows;
  return {
    id: plan.id,
    versionNo: plan.versionNo,
    source: plan.source,
    createdAt: plan.createdAt,
    items,
    confirmed:
      plan.confirmedBy && plan.confirmedAt
        ? { by: plan.confirmedBy, at: plan.confirmedAt, note: plan.note ?? '' }
        : null,
  };
}

/** What the stages after the confirmation are told, or null when nothing was confirmed. */
export async function confirmedDeliverables(
  client: PoolClient,
  projectId: string,
): Promise<readonly PromptDeliverable[] | null> {
  const plan = await latestPlan(client, projectId);
  if (!plan?.confirmed) return null;
  return plan.items.map((item) => ({
    kind: item.kind,
    title: item.title,
    purpose: item.purpose,
    scopeIn: item.scopeIn,
    scopeOut: item.scopeOut,
    outsideDocoo: !isSupportedDeliverableKind(item.kind),
  }));
}

export interface PromptDeliverable extends DeliverableItemInput {
  readonly outsideDocoo: boolean;
}

/** Appends a new plan version with its items; the caller holds the transaction. */
export async function insertPlan(
  client: PoolClient,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly source: 'system' | 'ai' | 'admin';
    readonly items: readonly DeliverableItemInput[];
    readonly createdBy?: string | null;
    readonly invocationId?: string | null;
  },
): Promise<string> {
  const plan = (
    await client.query<{ id: string }>(
      `insert into deliverable_plans (workspace_id, project_id, version_no, source, invocation_id, created_by)
       values ($1, $2, coalesce((select max(version_no) from deliverable_plans where project_id = $2), 0) + 1,
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
  for (const item of input.items) {
    ordinal += 1;
    await client.query(
      `insert into deliverable_items (workspace_id, plan_id, ordinal, kind, title, purpose, scope_in, scope_out)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.workspaceId,
        plan.id,
        ordinal,
        item.kind,
        item.title,
        item.purpose,
        item.scopeIn,
        item.scopeOut,
      ],
    );
  }
  return plan.id;
}

/**
 * The gate before ideation. Returns true when the stage must wait: no confirmed plan exists yet,
 * so an empty first plan and one task for the administrator are made (once) and the stage and
 * run show that they wait for a person. The stage goes on when the administrator confirms.
 */
export async function deliverableGate(
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
  const plan = await latestPlan(client, ref.projectId);
  if (plan?.confirmed) return { waiting: false, newlyOpened: false };
  if (!plan) {
    await insertPlan(client, {
      workspaceId: ref.workspaceId,
      projectId: ref.projectId,
      source: 'system',
      items: [],
    });
  }
  const open = await client.query(
    `select 1 from human_tasks where project_id = $1 and kind = 'deliverables_confirmation' and status = 'pending'`,
    [ref.projectId],
  );
  let newlyOpened = false;
  if (!open.rowCount) {
    await client.query(
      `insert into human_tasks (workspace_id, project_id, stage_run_id, kind, title, payload)
       values ($1, $2, $3, 'deliverables_confirmation', $4, $5::jsonb)`,
      [
        ref.workspaceId,
        ref.projectId,
        ref.stageRunId,
        'Confirm the expected deliverables',
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
