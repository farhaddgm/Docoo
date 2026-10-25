import {
  requirementReachesStage,
  type OutputRequirementKind,
  type PromptRequirement,
  type RequirementStage,
} from '@docoo/domain';
import type { PoolClient } from 'pg';

/** Database side of the output requirements of a project (ADR-0037), shared by the API and the worker. */
export interface OutputRequirementRow {
  readonly id: string;
  readonly kind: OutputRequirementKind;
  readonly text: string;
  readonly source: 'admin' | 'chat';
  readonly stage: RequirementStage | null;
  /** The stage it binds; null: the final output as a whole (every stage reads it). */
  readonly target: RequirementStage | null;
  readonly messageId: string | null;
  readonly supersedesId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

const COLUMNS = `r.id, r.kind, r.body as text, r.source, r.stage::text as stage,
  r.target_stage::text as target, r.message_id as "messageId", r.supersedes_id as "supersedesId", r.created_by as "createdBy",
  to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"`;

/** The requirements in force: those no withdrawal or edit has ended, oldest first. */
export async function activeRequirements(
  client: PoolClient,
  projectId: string,
): Promise<OutputRequirementRow[]> {
  return (
    await client.query<OutputRequirementRow>(
      `select ${COLUMNS} from output_requirements r
        where r.project_id = $1
          and not exists (select 1 from output_requirement_withdrawals w where w.requirement_id = r.id)
        order by r.created_at, r.id`,
      [projectId],
    )
  ).rows;
}

/** The prompt form of requirements; `appliesTo` appears only on a targeted one. */
export function toPromptRequirements(rows: readonly OutputRequirementRow[]): PromptRequirement[] {
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    text: row.text,
    ...(row.target ? { appliesTo: row.target } : {}),
  }));
}

/**
 * What the agents are told, or undefined when there is nothing for them. With a stage, only the
 * requirements that reach it: those for the final output as a whole and those aimed at that stage.
 */
export async function promptRequirements(
  client: PoolClient,
  projectId: string,
  stage?: string,
): Promise<readonly PromptRequirement[] | undefined> {
  const rows = (await activeRequirements(client, projectId)).filter(
    (row) => stage === undefined || requirementReachesStage(row.target, stage),
  );
  if (rows.length === 0) return undefined;
  return toPromptRequirements(rows);
}

export { COLUMNS as OUTPUT_REQUIREMENT_COLUMNS };
