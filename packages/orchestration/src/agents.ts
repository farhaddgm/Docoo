import {
  AGENT_ROLES,
  defaultDefinition,
  type AgentDefinitionContent,
  type AgentRole,
  type AgentSection,
  type AgentTool,
  type ModelPolicy,
} from '@docoo/domain';
import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

/**
 * Database side of the agent definitions (ADR-0015). The API and the workflow worker both use
 * it, so a role resolves to the same version in the screen and in a run.
 */
export interface AgentDefinitionRecord extends AgentDefinitionContent {
  readonly id: string;
  readonly role: AgentRole;
  /** `null` is a version of the workspace default; otherwise the project's own copy. */
  readonly projectId: string | null;
  readonly sequence: number;
  readonly changedSections: readonly AgentSection[];
  readonly baseVersionId: string | null;
  readonly reason: string;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export interface AgentVersionRow {
  id: string;
  project_id: string | null;
  role: AgentRole;
  sequence: number;
  principles: string[];
  duties: string[];
  prompt_template: string;
  tools: AgentTool[];
  model_policy: ModelPolicy | null;
  output_schema_id: string;
  changed_sections: AgentSection[];
  base_version_id: string | null;
  reason: string;
  created_by: string | null;
  created_at: Date | string;
}

/** Selected columns of one version, to be used with the alias `v`. */
export const VERSION_COLUMNS = `v.id, v.project_id, v.role::text as role, v.sequence, v.principles, v.duties,
  v.prompt_template, v.tools, v.model_policy, v.output_schema_id, v.changed_sections,
  v.base_version_id, v.reason, v.created_by, v.created_at`;

export function toDefinition(row: AgentVersionRow): AgentDefinitionRecord {
  return {
    id: row.id,
    role: row.role,
    projectId: row.project_id,
    sequence: row.sequence,
    principles: row.principles,
    duties: row.duties,
    promptTemplate: row.prompt_template,
    tools: row.tools,
    modelPolicy: row.model_policy,
    outputSchemaId: row.output_schema_id,
    changedSections: row.changed_sections,
    baseVersionId: row.base_version_id,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Gives a workspace its first version of every role (FR-AGT-001): the approved charter text,
 * active. Safe to call any number of times and from concurrent requests.
 */
export async function ensureAgentDefaults(client: PoolClient, workspaceId: string): Promise<void> {
  const present = await client.query<{ count: number }>(
    'select count(*)::int as count from agent_roles where workspace_id = $1',
    [workspaceId],
  );
  if ((present.rows[0]?.count ?? 0) >= AGENT_ROLES.length) return;
  for (const role of AGENT_ROLES) {
    const content = defaultDefinition(role);
    await client.query(
      `insert into agent_definition_versions
         (workspace_id, project_id, role, sequence, principles, duties, prompt_template, tools,
          model_policy, output_schema_id, changed_sections, reason)
       values ($1, null, $2::agent_role, 1, $3::jsonb, $4::jsonb, $5, $6::jsonb, null, $7, '[]'::jsonb, 'default')
       on conflict (workspace_id, role, sequence) where project_id is null do nothing`,
      [
        workspaceId,
        role,
        JSON.stringify(content.principles),
        JSON.stringify(content.duties),
        content.promptTemplate,
        JSON.stringify(content.tools),
        content.outputSchemaId,
      ],
    );
    await client.query(
      `insert into agent_roles (workspace_id, role, active_version_id)
       select $1, $2::agent_role, id from agent_definition_versions
        where workspace_id = $1 and role = $2::agent_role and project_id is null and sequence = 1
       on conflict (workspace_id, role) do nothing`,
      [workspaceId, role],
    );
  }
}

export async function loadAgentVersion(
  client: PoolClient,
  workspaceId: string,
  versionId: string,
): Promise<AgentDefinitionRecord | null> {
  const row = (
    await client.query<AgentVersionRow>(
      `select ${VERSION_COLUMNS} from agent_definition_versions v where v.workspace_id = $1 and v.id = $2`,
      [workspaceId, versionId],
    )
  ).rows[0];
  return row ? toDefinition(row) : null;
}

/** The active version of the workspace default stream of a role. */
export async function activeAgentVersion(
  client: PoolClient,
  workspaceId: string,
  role: AgentRole,
): Promise<AgentDefinitionRecord> {
  await ensureAgentDefaults(client, workspaceId);
  const row = (
    await client.query<AgentVersionRow>(
      `select ${VERSION_COLUMNS}
         from agent_roles r join agent_definition_versions v
           on v.id = r.active_version_id and v.workspace_id = r.workspace_id
        where r.workspace_id = $1 and r.role = $2::agent_role`,
      [workspaceId, role],
    )
  ).rows[0];
  if (!row) throw new Error(`No active definition for the role ${role}.`);
  return toDefinition(row);
}

/** The digest of the exact text sent to the model; the text itself holds project data and is not stored. */
export function promptDigest(prompt: { instructions: string; message: string }): string {
  return createHash('sha256')
    .update(prompt.instructions)
    .update('\n')
    .update(prompt.message)
    .digest('hex');
}

export interface AgentProfile {
  readonly definition: AgentDefinitionRecord;
  /** True when the project runs its own copy rather than a default version. */
  readonly customized: boolean;
}

/**
 * The definition a project runs a role with. A project that never chose is pinned to the
 * active default now and stays on that version until an administrator moves it, so a later
 * change of the default cannot alter a run that is already going (FR-AGT-003).
 */
export async function resolveAgentProfile(
  client: PoolClient,
  ref: { workspaceId: string; projectId: string; role: AgentRole },
): Promise<AgentProfile> {
  await ensureAgentDefaults(client, ref.workspaceId);
  const select = () =>
    client.query<AgentVersionRow & { customized: boolean }>(
      `select ${VERSION_COLUMNS}, p.customized
         from project_agent_profiles p join agent_definition_versions v
           on v.id = p.definition_version_id and v.workspace_id = p.workspace_id
        where p.workspace_id = $1 and p.project_id = $2 and p.role = $3::agent_role`,
      [ref.workspaceId, ref.projectId, ref.role],
    );
  let row = (await select()).rows[0];
  if (!row) {
    await client.query(
      `insert into project_agent_profiles (workspace_id, project_id, role, definition_version_id, customized)
       select $1, $2, $3::agent_role, active_version_id, false from agent_roles
        where workspace_id = $1 and role = $3::agent_role
       on conflict (project_id, role) do nothing`,
      [ref.workspaceId, ref.projectId, ref.role],
    );
    row = (await select()).rows[0];
  }
  if (!row) throw new Error(`No definition could be pinned for the role ${ref.role}.`);
  return { definition: toDefinition(row), customized: row.customized };
}
