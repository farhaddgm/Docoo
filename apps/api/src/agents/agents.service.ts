import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  AGENT_LIMITS,
  AGENT_ROLES,
  AGENT_TOOLS,
  ROLE_STAGE,
  ROLE_TOOL_CEILING,
  changedSections,
  normalizeDefinition,
  validateDefinition,
  type AgentDefinitionContent,
  type AgentRole,
  type ModelPolicy,
} from '@docoo/domain';
import {
  STAGE_SCHEMAS,
  activeAgentVersion,
  ensureAgentDefaults,
  loadAgentVersion,
  toDefinition,
  VERSION_COLUMNS,
  type AgentDefinitionRecord,
  type AgentVersionRow,
} from '@docoo/orchestration';
import type { PoolClient } from 'pg';

import { writeAudit } from '../common/audit.js';
import { decodeCursor, encodeCursor, isoColumn } from '../common/pagination.js';
import {
  badRequest,
  conflict,
  notFound,
  preconditionFailed,
  unprocessable,
} from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { CommandRunner } from '../workflow/command-runner.js';

/** The part of a definition an edit may change; omitted keys keep the base value. */
export interface DefinitionChanges {
  readonly principles?: readonly string[];
  readonly duties?: readonly string[];
  readonly promptTemplate?: string;
  readonly tools?: readonly string[];
  readonly modelPolicy?: ModelPolicy | null;
}

export type ModelWarning =
  'connection_unavailable' | 'catalog_missing' | 'model_not_in_catalog' | 'no_structured_output';

function view(definition: AgentDefinitionRecord, activeId?: string | null) {
  return {
    id: definition.id,
    role: definition.role,
    projectId: definition.projectId,
    sequence: definition.sequence,
    principles: definition.principles,
    duties: definition.duties,
    promptTemplate: definition.promptTemplate,
    tools: definition.tools,
    modelPolicy: definition.modelPolicy,
    outputSchemaId: definition.outputSchemaId,
    changedSections: definition.changedSections,
    baseVersionId: definition.baseVersionId,
    reason: definition.reason,
    createdBy: definition.createdBy,
    createdAt: definition.createdAt,
    ...(activeId === undefined ? {} : { active: definition.id === activeId }),
  };
}

function summary(definition: AgentDefinitionRecord) {
  return {
    id: definition.id,
    sequence: definition.sequence,
    createdAt: definition.createdAt,
    reason: definition.reason,
    changedSections: definition.changedSections,
    counts: {
      principles: definition.principles.length,
      duties: definition.duties.length,
      tools: definition.tools.length,
    },
    modelPolicy: definition.modelPolicy,
  };
}

function contentOf(definition: AgentDefinitionRecord): AgentDefinitionContent {
  return {
    principles: definition.principles,
    duties: definition.duties,
    promptTemplate: definition.promptTemplate,
    tools: definition.tools,
    modelPolicy: definition.modelPolicy,
    outputSchemaId: definition.outputSchemaId,
  };
}

function digest(content: AgentDefinitionContent): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/** The base with the given changes applied, trimmed so equal text compares equal. */
function merge(base: AgentDefinitionRecord, changes: DefinitionChanges): AgentDefinitionContent {
  return normalizeDefinition({
    principles: changes.principles ?? base.principles,
    duties: changes.duties ?? base.duties,
    promptTemplate: changes.promptTemplate ?? base.promptTemplate,
    tools: (changes.tools as AgentDefinitionContent['tools'] | undefined) ?? base.tools,
    modelPolicy: changes.modelPolicy === undefined ? base.modelPolicy : changes.modelPolicy,
    outputSchemaId: base.outputSchemaId,
  });
}

@Injectable()
export class AgentsService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly commands: CommandRunner,
  ) {}

  // ---- workspace roles ---------------------------------------------------------------------

  async listRoles(context: WorkspaceRequestContext) {
    return this.database.run(context, async (client) => {
      await ensureAgentDefaults(client, context.workspaceId);
      const rows = (
        await client.query<AgentVersionRow & { latest: number; versions: number }>(
          `select ${VERSION_COLUMNS},
                  (select max(x.sequence) from agent_definition_versions x
                    where x.workspace_id = r.workspace_id and x.role = r.role and x.project_id is null)::int as latest,
                  (select count(*) from agent_definition_versions x
                    where x.workspace_id = r.workspace_id and x.role = r.role and x.project_id is null)::int as versions
             from agent_roles r join agent_definition_versions v
               on v.id = r.active_version_id and v.workspace_id = r.workspace_id
            where r.workspace_id = $1`,
          [context.workspaceId],
        )
      ).rows;
      return {
        items: AGENT_ROLES.map((role) => {
          const row = rows.find((candidate) => candidate.role === role)!;
          return {
            role,
            stage: ROLE_STAGE[role],
            active: summary(toDefinition(row)),
            latestSequence: row.latest,
            versionCount: row.versions,
            toolCeiling: ROLE_TOOL_CEILING[role],
          };
        }),
      };
    });
  }

  async getRole(context: WorkspaceRequestContext, role: AgentRole) {
    return this.database.run(context, async (client) => {
      const active = await activeAgentVersion(client, context.workspaceId, role);
      const latest = await this.latestSequence(client, context.workspaceId, role, null);
      return {
        role,
        stage: ROLE_STAGE[role],
        definition: view(active, active.id),
        latestSequence: latest,
        ...this.reference(role),
        modelWarnings: await this.modelWarnings(client, context.workspaceId, active.modelPolicy),
        performance: await this.performance(client, context.workspaceId, role),
      };
    });
  }

  async versions(
    context: WorkspaceRequestContext,
    role: AgentRole,
    options: { limit: number; before?: number | undefined },
  ) {
    return this.database.run(context, async (client) => {
      const active = await activeAgentVersion(client, context.workspaceId, role);
      const rows = (
        await client.query<AgentVersionRow>(
          `select ${VERSION_COLUMNS} from agent_definition_versions v
            where v.workspace_id = $1 and v.role = $2::agent_role and v.project_id is null
              and ($3::int is null or v.sequence < $3)
            order by v.sequence desc limit $4`,
          [context.workspaceId, role, options.before ?? null, options.limit + 1],
        )
      ).rows;
      const page = rows.slice(0, options.limit).map(toDefinition);
      return {
        items: page.map((definition) => view(definition, active.id)),
        activeVersionId: active.id,
        nextBefore: rows.length > options.limit ? page[page.length - 1]!.sequence : null,
      };
    });
  }

  /** Appends a version built from a base plus changes; it is not active until activated. */
  async createVersion(
    context: WorkspaceRequestContext,
    role: AgentRole,
    input: {
      changes: DefinitionChanges;
      reason: string;
      baseVersionId?: string | undefined;
      expectedSequence?: number | undefined;
      idempotencyKey?: string | undefined;
    },
  ) {
    const { idempotencyKey, ...request } = input;
    return this.commands.run(
      context,
      idempotencyKey,
      'agent-version',
      { role, ...request },
      async (client) => {
        await ensureAgentDefaults(client, context.workspaceId);
        // Serialises writers of one role so sequences stay gapless.
        await client.query(
          'select 1 from agent_roles where workspace_id = $1 and role = $2::agent_role for update',
          [context.workspaceId, role],
        );
        const base = input.baseVersionId
          ? await this.workspaceVersion(client, context, role, input.baseVersionId)
          : await activeAgentVersion(client, context.workspaceId, role);
        const latest = await this.latestSequence(client, context.workspaceId, role, null);
        this.checkExpected(input.expectedSequence, latest);
        const content = await this.validated(client, context, role, base, input.changes);
        const created = await this.insertVersion(client, context, {
          role,
          projectId: null,
          sequence: latest + 1,
          content,
          base,
          reason: input.reason,
        });
        await writeAudit(client, context, {
          action: 'agent_definition.version_created',
          targetType: 'agent_definition',
          targetId: created.id,
          reason: input.reason,
          after: {
            role,
            sequence: created.sequence,
            changedSections: created.changedSections,
            sha256: digest(content),
          },
        });
        return { signal: null, result: { definition: view(created) } };
      },
    );
  }

  /** Makes a version the default of its role (also how an earlier one is restored). */
  async activate(
    context: WorkspaceRequestContext,
    role: AgentRole,
    versionId: string,
    input: { reason: string; idempotencyKey?: string | undefined },
  ) {
    return this.commands.run(
      context,
      input.idempotencyKey,
      'agent-activate',
      { role, versionId, reason: input.reason },
      async (client) => {
        await ensureAgentDefaults(client, context.workspaceId);
        await client.query(
          'select 1 from agent_roles where workspace_id = $1 and role = $2::agent_role for update',
          [context.workspaceId, role],
        );
        const version = await this.workspaceVersion(client, context, role, versionId);
        const previous = await activeAgentVersion(client, context.workspaceId, role);
        if (previous.id === version.id) {
          return {
            signal: null,
            result: { definition: view(version, version.id), changed: false },
          };
        }
        await client.query(
          `update agent_roles set active_version_id = $3, activated_by = $4
            where workspace_id = $1 and role = $2::agent_role`,
          [context.workspaceId, role, version.id, context.actorId],
        );
        await writeAudit(client, context, {
          action: 'agent_definition.activated',
          targetType: 'agent_definition',
          targetId: version.id,
          reason: input.reason,
          before: { role, sequence: previous.sequence },
          after: { role, sequence: version.sequence },
        });
        return { signal: null, result: { definition: view(version, version.id), changed: true } };
      },
    );
  }

  /**
   * The outputs a role produced anywhere in the workspace: what was made, for which project
   * and with which definition version. Never the content (FR-AGT-004): reading content goes
   * through the project and its policy.
   */
  async outputs(
    context: WorkspaceRequestContext,
    role: AgentRole,
    options: { limit: number; cursor?: string | undefined },
  ) {
    return this.database.run(context, async (client) => {
      const scope = `${context.workspaceId}:agent-outputs:${role}`;
      const cursor = options.cursor
        ? decodeCursor(options.cursor, scope, 'AGENT_INVALID_CURSOR')
        : null;
      const stage = ROLE_STAGE[role];
      const rows =
        stage === null
          ? (
              await client.query<Record<string, unknown> & { at: string; id: string }>(
                `select r.id, r.scope::text as scope, r.project_id as "projectId", p.title as "projectTitle",
                        r.charter_version as "charterVersion", ${isoColumn('r.created_at', 'at')}
                   from brain_reports r left join projects p on p.id = r.project_id and p.workspace_id = r.workspace_id
                  where r.workspace_id = $1
                    and ($2::timestamptz is null or (r.created_at, r.id) < ($2::timestamptz, $3::uuid))
                  order by r.created_at desc, r.id desc limit $4`,
                [context.workspaceId, cursor?.at ?? null, cursor?.id ?? null, options.limit + 1],
              )
            ).rows
          : (
              await client.query<Record<string, unknown> & { at: string; id: string }>(
                `select o.id, o.stage_run_id as "stageRunId", s.stage::text as stage, o.version_no as "versionNo", o.origin,
                        p.id as "projectId", p.title as "projectTitle",
                        v.id as "definitionVersionId", v.sequence as "definitionSequence",
                        ${isoColumn('o.created_at', 'at')}
                   from stage_outputs o
                   join stage_runs s on s.id = o.stage_run_id and s.workspace_id = o.workspace_id
                   join projects p on p.id = s.project_id and p.workspace_id = s.workspace_id
                   left join stage_attempts a on a.id = o.attempt_id
                   left join agent_definition_versions v on v.id = a.agent_definition_version_id and v.workspace_id = a.workspace_id
                  where o.workspace_id = $1 and s.stage::text = $2 and p.status <> 'deleted'
                    and ($3::timestamptz is null or (o.created_at, o.id) < ($3::timestamptz, $4::uuid))
                  order by o.created_at desc, o.id desc limit $5`,
                [
                  context.workspaceId,
                  stage,
                  cursor?.at ?? null,
                  cursor?.id ?? null,
                  options.limit + 1,
                ],
              )
            ).rows;
      const page = rows.slice(0, options.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(({ at, ...rest }) => ({ ...rest, createdAt: at })),
        nextCursor:
          rows.length > options.limit && last ? encodeCursor(scope, last.at, last.id) : null,
      };
    });
  }

  // ---- projects ----------------------------------------------------------------------------

  async projectProfiles(context: WorkspaceRequestContext, projectId: string) {
    return this.database.run(context, async (client) => {
      await this.requireProject(client, context, projectId);
      await ensureAgentDefaults(client, context.workspaceId);
      const profiles = (
        await client.query<AgentVersionRow & { customized: boolean }>(
          `select ${VERSION_COLUMNS}, p.customized
             from project_agent_profiles p join agent_definition_versions v
               on v.id = p.definition_version_id and v.workspace_id = p.workspace_id
            where p.workspace_id = $1 and p.project_id = $2`,
          [context.workspaceId, projectId],
        )
      ).rows;
      const items = [];
      for (const role of AGENT_ROLES) {
        const defaultVersion = await activeAgentVersion(client, context.workspaceId, role);
        const pinned = profiles.find((row) => row.role === role);
        const effective = pinned ? toDefinition(pinned) : defaultVersion;
        items.push({
          role,
          stage: ROLE_STAGE[role],
          pinned: Boolean(pinned),
          customized: pinned?.customized ?? false,
          version: summary(effective),
          defaultVersion: { id: defaultVersion.id, sequence: defaultVersion.sequence },
          // A default pinned earlier is not moved by a newer default; the screen says so.
          behindDefault: Boolean(pinned && !pinned.customized && pinned.id !== defaultVersion.id),
        });
      }
      return { items };
    });
  }

  async projectRole(context: WorkspaceRequestContext, projectId: string, role: AgentRole) {
    return this.database.run(context, async (client) => {
      await this.requireProject(client, context, projectId);
      const defaultVersion = await activeAgentVersion(client, context.workspaceId, role);
      const pinned = await this.pinned(client, context, projectId, role);
      const effective = pinned?.definition ?? defaultVersion;
      const own = (
        await client.query<AgentVersionRow>(
          `select ${VERSION_COLUMNS} from agent_definition_versions v
            where v.workspace_id = $1 and v.project_id = $2 and v.role = $3::agent_role
            order by v.sequence desc limit 100`,
          [context.workspaceId, projectId, role],
        )
      ).rows.map(toDefinition);
      return {
        role,
        stage: ROLE_STAGE[role],
        pinned: Boolean(pinned),
        customized: pinned?.customized ?? false,
        definition: view(effective, effective.id),
        defaultDefinition: view(defaultVersion, defaultVersion.id),
        behindDefault: Boolean(
          pinned && !pinned.customized && pinned.definition.id !== defaultVersion.id,
        ),
        ownVersions: own.map((definition) => view(definition, effective.id)),
        latestSequence: own[0]?.sequence ?? 0,
        ...this.reference(role),
        modelWarnings: await this.modelWarnings(client, context.workspaceId, effective.modelPolicy),
      };
    });
  }

  /** An independent copy of the current default for this project (UX §9). */
  async copyDefault(
    context: WorkspaceRequestContext,
    projectId: string,
    role: AgentRole,
    input: { reason: string; idempotencyKey?: string | undefined },
  ) {
    return this.commands.run(
      context,
      input.idempotencyKey,
      'agent-copy-default',
      { projectId, role, reason: input.reason },
      async (client) => {
        await this.lockProject(client, context, projectId);
        const existing = await this.pinned(client, context, projectId, role);
        if (existing?.customized) {
          throw conflict(
            'AGENT_ALREADY_CUSTOMIZED',
            'This project already has its own copy of the role.',
          );
        }
        const base = await activeAgentVersion(client, context.workspaceId, role);
        const latest = await this.latestSequence(client, context.workspaceId, role, projectId);
        const copy = await this.insertVersion(client, context, {
          role,
          projectId,
          sequence: latest + 1,
          content: contentOf(base),
          base,
          reason: input.reason,
          // A copy starts equal to its source; only later edits name changed sections.
        });
        await this.pin(client, context, projectId, role, copy.id, true);
        await writeAudit(client, context, {
          action: 'project.agent_customized',
          targetType: 'project',
          targetId: projectId,
          projectId,
          reason: input.reason,
          after: { role, copiedFromSequence: base.sequence, sequence: copy.sequence },
        });
        return {
          signal: null,
          result: { definition: view(copy, copy.id), customized: true },
        };
      },
    );
  }

  /** Edits the project's own copy by appending a version of it. */
  async updateProjectCopy(
    context: WorkspaceRequestContext,
    projectId: string,
    role: AgentRole,
    input: {
      changes: DefinitionChanges;
      reason: string;
      expectedSequence?: number | undefined;
      idempotencyKey?: string | undefined;
    },
  ) {
    const { idempotencyKey, ...request } = input;
    return this.commands.run(
      context,
      idempotencyKey,
      'agent-project-update',
      { projectId, role, ...request },
      async (client) => {
        await this.lockProject(client, context, projectId);
        const current = await this.pinned(client, context, projectId, role);
        if (!current?.customized) {
          throw conflict(
            'AGENT_NOT_CUSTOMIZED',
            'Copy the default first; the project edits only its own copy, never the workspace default.',
          );
        }
        const latest = await this.latestSequence(client, context.workspaceId, role, projectId);
        this.checkExpected(input.expectedSequence, latest);
        const content = await this.validated(
          client,
          context,
          role,
          current.definition,
          input.changes,
        );
        const created = await this.insertVersion(client, context, {
          role,
          projectId,
          sequence: latest + 1,
          content,
          base: current.definition,
          reason: input.reason,
        });
        await this.pin(client, context, projectId, role, created.id, true);
        await writeAudit(client, context, {
          action: 'project.agent_updated',
          targetType: 'project',
          targetId: projectId,
          projectId,
          reason: input.reason,
          after: {
            role,
            sequence: created.sequence,
            changedSections: created.changedSections,
            sha256: digest(content),
          },
        });
        return {
          signal: null,
          result: { definition: view(created, created.id), customized: true },
        };
      },
    );
  }

  /**
   * Moves the project to a default version (the current one when none is named: "update to the
   * new default") or back to one of its own earlier copies. Only an administrator does this.
   */
  async pinProject(
    context: WorkspaceRequestContext,
    projectId: string,
    role: AgentRole,
    input: {
      versionId?: string | undefined;
      reason: string;
      idempotencyKey?: string | undefined;
    },
  ) {
    return this.commands.run(
      context,
      input.idempotencyKey,
      'agent-project-pin',
      { projectId, role, versionId: input.versionId ?? null, reason: input.reason },
      async (client) => {
        await this.lockProject(client, context, projectId);
        const target = input.versionId
          ? await loadAgentVersion(client, context.workspaceId, input.versionId)
          : await activeAgentVersion(client, context.workspaceId, role);
        if (
          !target ||
          target.role !== role ||
          (target.projectId !== null && target.projectId !== projectId)
        ) {
          throw notFound('AGENT_VERSION_NOT_FOUND', 'That version does not exist for this role.');
        }
        const current = await this.pinned(client, context, projectId, role);
        if (current?.definition.id === target.id) {
          return {
            signal: null,
            result: {
              definition: view(target, target.id),
              customized: target.projectId !== null,
              changed: false,
            },
          };
        }
        await this.pin(client, context, projectId, role, target.id, target.projectId !== null);
        await writeAudit(client, context, {
          action: 'project.agent_pinned',
          targetType: 'project',
          targetId: projectId,
          projectId,
          reason: input.reason,
          before: current ? { role, sequence: current.definition.sequence } : null,
          after: { role, sequence: target.sequence, customized: target.projectId !== null },
        });
        return {
          signal: null,
          result: {
            definition: view(target, target.id),
            customized: target.projectId !== null,
            changed: true,
          },
        };
      },
    );
  }

  // ---- helpers -----------------------------------------------------------------------------

  /** What the editor shows next to a definition and never lets the administrator change. */
  private reference(role: AgentRole) {
    const stage = ROLE_STAGE[role];
    return {
      tools: AGENT_TOOLS,
      toolCeiling: ROLE_TOOL_CEILING[role],
      limits: AGENT_LIMITS,
      outputSchema: stage === null ? null : STAGE_SCHEMAS[stage],
    };
  }

  private checkExpected(expected: number | undefined, latest: number): void {
    if (expected !== undefined && expected !== latest) {
      throw preconditionFailed(
        'AGENT_VERSION_STALE',
        'Another change was saved first; reload the role and apply your edit again.',
      );
    }
  }

  private async latestSequence(
    client: PoolClient,
    workspaceId: string,
    role: AgentRole,
    projectId: string | null,
  ): Promise<number> {
    const row = (
      await client.query<{ latest: number | null }>(
        `select max(sequence)::int as latest from agent_definition_versions
          where workspace_id = $1 and role = $2::agent_role
            and ((project_id is null and $3::uuid is null) or project_id = $3)`,
        [workspaceId, role, projectId],
      )
    ).rows[0];
    return row?.latest ?? 0;
  }

  private async workspaceVersion(
    client: PoolClient,
    context: WorkspaceRequestContext,
    role: AgentRole,
    versionId: string,
  ): Promise<AgentDefinitionRecord> {
    const version = await loadAgentVersion(client, context.workspaceId, versionId);
    if (!version || version.role !== role || version.projectId !== null) {
      throw notFound('AGENT_VERSION_NOT_FOUND', 'That version does not exist for this role.');
    }
    return version;
  }

  /** The merged definition, or 422 with every issue (and no change when nothing differs). */
  private async validated(
    client: PoolClient,
    context: WorkspaceRequestContext,
    role: AgentRole,
    base: AgentDefinitionRecord,
    changes: DefinitionChanges,
  ): Promise<AgentDefinitionContent> {
    const content = merge(base, changes);
    const issues = validateDefinition(role, content);
    if (content.modelPolicy) {
      const connection = await client.query(
        `select 1 from provider_connections where workspace_id = $1 and id = $2 and disabled_at is null`,
        [context.workspaceId, content.modelPolicy.connectionId],
      );
      if (!connection.rowCount) issues.push({ field: 'modelPolicy', code: 'invalid' });
    }
    if (issues.length > 0) {
      throw unprocessable('AGENT_INVALID_DEFINITION', 'The definition is not valid.', {
        issues,
        // The same reasons as short strings (`field:code[:index]`) for clients that show them.
        problems: issues.map((issue) =>
          [issue.field, issue.code, issue.index].filter((part) => part !== undefined).join(':'),
        ),
      });
    }
    if (changedSections(contentOf(base), content).length === 0) {
      throw badRequest('AGENT_NO_CHANGES', 'Nothing differs from the version it starts from.');
    }
    return content;
  }

  private async insertVersion(
    client: PoolClient,
    context: WorkspaceRequestContext,
    input: {
      role: AgentRole;
      projectId: string | null;
      sequence: number;
      content: AgentDefinitionContent;
      base: AgentDefinitionRecord;
      reason: string;
    },
  ): Promise<AgentDefinitionRecord> {
    const sections = changedSections(contentOf(input.base), input.content);
    const row = (
      await client.query<AgentVersionRow>(
        `insert into agent_definition_versions
           (workspace_id, project_id, role, sequence, principles, duties, prompt_template, tools,
            model_policy, output_schema_id, changed_sections, base_version_id, reason, created_by)
         values ($1, $2, $3::agent_role, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10, $11::jsonb, $12, $13, $14)
         returning id, project_id, role::text as role, sequence, principles, duties, prompt_template, tools,
                   model_policy, output_schema_id, changed_sections, base_version_id, reason, created_by, created_at`,
        [
          context.workspaceId,
          input.projectId,
          input.role,
          input.sequence,
          JSON.stringify(input.content.principles),
          JSON.stringify(input.content.duties),
          input.content.promptTemplate,
          JSON.stringify(input.content.tools),
          input.content.modelPolicy ? JSON.stringify(input.content.modelPolicy) : null,
          input.content.outputSchemaId,
          JSON.stringify(sections),
          input.base.id,
          input.reason,
          context.actorId,
        ],
      )
    ).rows[0]!;
    return toDefinition(row);
  }

  private async requireProject(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string,
  ): Promise<void> {
    const project = await client.query(
      `select 1 from projects where workspace_id = $1 and id = $2 and status <> 'deleted'`,
      [context.workspaceId, projectId],
    );
    if (!project.rowCount) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');
  }

  /** Serialises the writers of one project's profiles. */
  private async lockProject(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string,
  ): Promise<void> {
    const project = await client.query(
      `select 1 from projects where workspace_id = $1 and id = $2 and status <> 'deleted' for update`,
      [context.workspaceId, projectId],
    );
    if (!project.rowCount) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');
    await ensureAgentDefaults(client, context.workspaceId);
  }

  private async pinned(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string,
    role: AgentRole,
  ): Promise<{ definition: AgentDefinitionRecord; customized: boolean } | null> {
    const row = (
      await client.query<AgentVersionRow & { customized: boolean }>(
        `select ${VERSION_COLUMNS}, p.customized
           from project_agent_profiles p join agent_definition_versions v
             on v.id = p.definition_version_id and v.workspace_id = p.workspace_id
          where p.workspace_id = $1 and p.project_id = $2 and p.role = $3::agent_role`,
        [context.workspaceId, projectId, role],
      )
    ).rows[0];
    return row ? { definition: toDefinition(row), customized: row.customized } : null;
  }

  private async pin(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string,
    role: AgentRole,
    versionId: string,
    customized: boolean,
  ): Promise<void> {
    await client.query(
      `insert into project_agent_profiles (workspace_id, project_id, role, definition_version_id, customized, pinned_by)
       values ($1, $2, $3::agent_role, $4, $5, $6)
       on conflict (project_id, role) do update
         set definition_version_id = excluded.definition_version_id,
             customized = excluded.customized, pinned_by = excluded.pinned_by`,
      [context.workspaceId, projectId, role, versionId, customized, context.actorId],
    );
  }

  /** Why the chosen model may not suit the role; empty when the default is used. */
  private async modelWarnings(
    client: PoolClient,
    workspaceId: string,
    policy: ModelPolicy | null,
  ): Promise<ModelWarning[]> {
    if (!policy) return [];
    const connection = await client.query(
      `select 1 from provider_connections where workspace_id = $1 and id = $2 and disabled_at is null`,
      [workspaceId, policy.connectionId],
    );
    if (!connection.rowCount) return ['connection_unavailable'];
    const snapshot = (
      await client.query<{
        models: { id: string; capabilities?: { structuredOutput?: boolean } }[];
      }>(
        `select models from model_catalog_snapshots
          where workspace_id = $1 and connection_id = $2 order by created_at desc limit 1`,
        [workspaceId, policy.connectionId],
      )
    ).rows[0];
    if (!snapshot) return ['catalog_missing'];
    const model = snapshot.models.find((candidate) => candidate.id === policy.model);
    if (!model) return ['model_not_in_catalog'];
    return model.capabilities?.structuredOutput === false ? ['no_structured_output'] : [];
  }

  /** The newest workspace Brain report's findings about the role (UX §9). */
  private async performance(client: PoolClient, workspaceId: string, role: AgentRole) {
    const report = (
      await client.query<{
        id: string;
        charter_version: string;
        at: string;
        summary: { roles?: Record<string, unknown>[] };
        deviations: {
          role: string;
          rule: string;
          severity: string;
          count: number;
          detail: string;
        }[];
      }>(
        `select id, charter_version, ${isoColumn('created_at', 'at')}, summary, deviations
           from brain_reports where workspace_id = $1 and scope = 'workspace'
          order by created_at desc, id desc limit 1`,
        [workspaceId],
      )
    ).rows[0];
    if (!report) return null;
    return {
      reportId: report.id,
      createdAt: report.at,
      charterVersion: report.charter_version,
      role: report.summary.roles?.find((entry) => entry['role'] === role) ?? null,
      deviations: report.deviations
        .filter((deviation) => deviation.role === role)
        .slice(0, 5)
        .map(({ rule, severity, count, detail }) => ({ rule, severity, count, detail })),
    };
  }
}
