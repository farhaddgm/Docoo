import type { OutputRequirementKind, PromptRequirement, RequirementStage } from '@docoo/domain';
import type { PoolClient } from 'pg';

/** Database side of the output requirements of a project (ADR-0037), shared by the API and the worker. */
export interface OutputRequirementRow {
  readonly id: string;
  readonly kind: OutputRequirementKind;
  readonly text: string;
  readonly source: 'admin' | 'chat';
  readonly stage: RequirementStage | null;
  readonly messageId: string | null;
  readonly supersedesId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

const COLUMNS = `r.id, r.kind, r.body as text, r.source, r.stage::text as stage,
  r.message_id as "messageId", r.supersedes_id as "supersedesId", r.created_by as "createdBy",
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

/** What the agents are told, or undefined when the administrator wrote no requirement. */
export async function promptRequirements(
  client: PoolClient,
  projectId: string,
): Promise<readonly PromptRequirement[] | undefined> {
  const rows = await activeRequirements(client, projectId);
  if (rows.length === 0) return undefined;
  return rows.map((row) => ({ id: row.id, kind: row.kind, text: row.text }));
}

export { COLUMNS as OUTPUT_REQUIREMENT_COLUMNS };
