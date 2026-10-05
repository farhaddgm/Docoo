import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import {
  badRequest,
  conflict,
  isUniqueViolation,
  notFound,
  preconditionFailed,
} from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { settingSemanticProblem } from './setting-semantics.js';
import { canonicalJson, validateSettingValue, type SettingValueSchema } from './setting-value.js';

export type ConfigScope = 'workspace' | 'topic' | 'project';

export interface SettingDefinition {
  readonly key: string;
  readonly valueSchema: SettingValueSchema;
  readonly defaultValue: unknown;
  readonly allowedScopes: readonly ConfigScope[];
  readonly sensitive: boolean;
  readonly description: { readonly fa: string; readonly en: string };
}

export interface ConfigAssignment {
  readonly key: string;
  readonly scopeType: ConfigScope;
  readonly scopeId: string;
  readonly sequence: number;
  readonly value: unknown;
  readonly cleared: boolean;
  readonly reason: string;
  readonly restoredFromSequence: number | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export type ValueSource =
  | { readonly scope: 'system' }
  | { readonly scope: ConfigScope; readonly scopeId: string; readonly sequence: number }
  /** A value chosen in the project wizard that is saved together with the new project. */
  | { readonly scope: 'project'; readonly pending: true };

export interface EffectiveConfig {
  readonly subjectType: ConfigScope;
  readonly subjectId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly sources: Readonly<Record<string, ValueSource>>;
  readonly hash: string;
}

export interface ConfigSnapshot extends EffectiveConfig {
  readonly id: string;
  readonly createdAt: string;
}

export interface SetAssignmentInput {
  readonly key: string;
  readonly scopeType: ConfigScope;
  readonly scopeId: string;
  /** `null` clears the assignment so the value is inherited again. */
  readonly value: unknown;
  readonly reason: string;
  readonly expectedSequence?: number | undefined;
}

export interface RestoreAssignmentInput {
  readonly key: string;
  readonly scopeType: ConfigScope;
  readonly scopeId: string;
  readonly sequence: number;
  readonly reason: string;
}

interface DefinitionRow extends QueryResultRow {
  key: string;
  value_schema: SettingValueSchema;
  default_value: unknown;
  allowed_scopes: string | ConfigScope[];
  sensitive: boolean;
  description_fa: string;
  description_en: string;
}

interface AssignmentRow extends QueryResultRow {
  setting_key: string;
  scope_type: ConfigScope;
  scope_id: string;
  sequence: number;
  value: unknown;
  cleared: boolean;
  reason: string;
  restored_from_sequence: number | null;
  created_by: string | null;
  created_at: string;
}

const assignmentColumns = `
  setting_key, scope_type, scope_id, sequence, value, cleared, reason,
  restored_from_sequence, created_by, ${isoColumn('created_at', 'created_at')}`;

const scopeRank: Readonly<Record<ConfigScope, number>> = { workspace: 1, topic: 2, project: 3 };

@Injectable()
export class ConfigService {
  constructor(private readonly database: WorkspaceDatabase) {}

  async definitions(context: WorkspaceRequestContext): Promise<readonly SettingDefinition[]> {
    return this.database.run(context, async (client) => this.loadDefinitions(client));
  }

  async currentAssignments(
    context: WorkspaceRequestContext,
    scopeType: ConfigScope,
    scopeId: string,
  ): Promise<readonly ConfigAssignment[]> {
    return this.database.run(context, async (client) => {
      await this.assertScope(client, context, scopeType, scopeId, false);
      const definitions = await this.definitionMap(client);
      const result = await client.query<AssignmentRow>(
        `select distinct on (setting_key) ${assignmentColumns}
           from config_assignments
          where workspace_id = $1 and scope_type = $2 and scope_id = $3
          order by setting_key, sequence desc`,
        [context.workspaceId, scopeType, scopeId],
      );
      return result.rows.map((row) => this.toAssignment(row, definitions.get(row.setting_key)));
    });
  }

  async history(
    context: WorkspaceRequestContext,
    key: string,
    scopeType: ConfigScope,
    scopeId: string,
  ): Promise<readonly ConfigAssignment[]> {
    return this.database.run(context, async (client) => {
      const definition = await this.requireDefinition(client, key);
      await this.assertScope(client, context, scopeType, scopeId, false);
      const result = await client.query<AssignmentRow>(
        `select ${assignmentColumns}
           from config_assignments
          where workspace_id = $1 and setting_key = $2 and scope_type = $3 and scope_id = $4
          order by sequence desc`,
        [context.workspaceId, key, scopeType, scopeId],
      );
      return result.rows.map((row) => this.toAssignment(row, definition));
    });
  }

  async set(
    context: WorkspaceRequestContext,
    input: SetAssignmentInput,
  ): Promise<ConfigAssignment> {
    return this.database.run(context, async (client) => {
      const definition = await this.requireDefinition(client, input.key);
      this.assertAllowedScope(definition, input.scopeType);
      await this.assertScope(client, context, input.scopeType, input.scopeId, true);
      const cleared = input.value === null;
      if (!cleared) {
        const problem =
          validateSettingValue(definition.valueSchema, input.value) ??
          settingSemanticProblem(input.key, input.value);
        if (problem) throw badRequest('CONFIG_VALUE_INVALID', `${input.key}: ${problem}`);
      }
      return this.append(client, context, definition, {
        key: input.key,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        value: cleared ? null : input.value,
        cleared,
        reason: input.reason,
        restoredFromSequence: null,
        expectedSequence: input.expectedSequence,
      });
    });
  }

  /** Restoring an old value appends a new sequence; history is never rewritten (FR-CFG-006). */
  async restore(
    context: WorkspaceRequestContext,
    input: RestoreAssignmentInput,
  ): Promise<ConfigAssignment> {
    return this.database.run(context, async (client) => {
      const definition = await this.requireDefinition(client, input.key);
      this.assertAllowedScope(definition, input.scopeType);
      await this.assertScope(client, context, input.scopeType, input.scopeId, true);
      const source = await client.query<AssignmentRow>(
        `select ${assignmentColumns}
           from config_assignments
          where workspace_id = $1 and setting_key = $2 and scope_type = $3
            and scope_id = $4 and sequence = $5`,
        [context.workspaceId, input.key, input.scopeType, input.scopeId, input.sequence],
      );
      const row = source.rows[0];
      if (!row) throw notFound('CONFIG_VERSION_NOT_FOUND', 'That setting version does not exist.');
      return this.append(client, context, definition, {
        key: input.key,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        value: row.value,
        cleared: row.cleared,
        reason: input.reason,
        restoredFromSequence: row.sequence,
        expectedSequence: undefined,
      });
    });
  }

  async effective(
    context: WorkspaceRequestContext,
    subjectType: ConfigScope,
    subjectId: string,
  ): Promise<EffectiveConfig> {
    return this.database.run(context, async (client) => {
      await this.assertScope(client, context, subjectType, subjectId, false);
      return this.resolve(client, context, subjectType, subjectId);
    });
  }

  /**
   * Resolves system → workspace → topic → project. For a project, its topics apply in
   * priority order (priority 1 wins). Sensitive values are masked.
   */
  async resolve(
    client: PoolClient,
    context: WorkspaceRequestContext,
    subjectType: ConfigScope,
    subjectId: string,
  ): Promise<EffectiveConfig> {
    const chain: { scope: ConfigScope; id: string }[] = [
      { scope: 'workspace', id: context.workspaceId },
    ];
    if (subjectType === 'topic') chain.push({ scope: 'topic', id: subjectId });
    if (subjectType === 'project') {
      const topics = await client.query<{ topic_id: string } & QueryResultRow>(
        `select topic_id from project_topics
          where workspace_id = $1 and project_id = $2
          order by priority desc`,
        [context.workspaceId, subjectId],
      );
      // Lowest priority first so the highest-priority topic overrides the rest.
      for (const row of topics.rows) chain.push({ scope: 'topic', id: row.topic_id });
      chain.push({ scope: 'project', id: subjectId });
    }

    return this.resolveChain(client, context, subjectType, subjectId, chain);
  }

  /**
   * Resolves the values of a chain of scopes, lowest to highest. `pending` values are applied on
   * top and marked as not yet saved (the preview of a project that does not exist yet).
   */
  private async resolveChain(
    client: PoolClient,
    context: WorkspaceRequestContext,
    subjectType: ConfigScope,
    subjectId: string,
    chain: readonly { scope: ConfigScope; id: string }[],
    pending: Readonly<Record<string, unknown>> = {},
  ): Promise<EffectiveConfig> {
    const definitions = await this.loadDefinitions(client);
    const latest = await client.query<AssignmentRow>(
      `select distinct on (setting_key, scope_type, scope_id) ${assignmentColumns}
         from config_assignments
        where workspace_id = $1
          and (scope_type, scope_id) in (select * from unnest($2::config_scope[], $3::uuid[]))
        order by setting_key, scope_type, scope_id, sequence desc`,
      [context.workspaceId, chain.map((item) => item.scope), chain.map((item) => item.id)],
    );
    const byScope = new Map<string, AssignmentRow>();
    for (const row of latest.rows) {
      byScope.set(`${row.setting_key}|${row.scope_type}|${row.scope_id}`, row);
    }

    const values: Record<string, unknown> = {};
    const sources: Record<string, ValueSource> = {};
    for (const definition of definitions) {
      let value = definition.defaultValue;
      let source: ValueSource = { scope: 'system' };
      for (const link of chain) {
        if (!definition.allowedScopes.includes(link.scope)) continue;
        const row = byScope.get(`${definition.key}|${link.scope}|${link.id}`);
        if (row && !row.cleared) {
          value = row.value;
          source = { scope: link.scope, scopeId: link.id, sequence: row.sequence };
        }
      }
      if (definition.key in pending) {
        value = pending[definition.key];
        source = { scope: 'project', pending: true };
      }
      values[definition.key] = definition.sensitive ? '[REDACTED]' : value;
      sources[definition.key] = source;
    }
    const hash = createHash('sha256').update(canonicalJson({ values, sources })).digest('hex');
    return { subjectType, subjectId, values, sources, hash };
  }

  /**
   * Freezes the effective config of a subject; runs pin the snapshot ID so changes only
   * apply from the next safe boundary (FR-CFG-005).
   */
  async snapshot(
    client: PoolClient,
    context: WorkspaceRequestContext,
    subjectType: ConfigScope,
    subjectId: string,
  ): Promise<ConfigSnapshot> {
    const effective = await this.resolve(client, context, subjectType, subjectId);
    await client.query(
      `insert into config_snapshots (
         workspace_id, subject_type, subject_id, resolved, source_map, hash, created_by
       ) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
       on conflict (workspace_id, subject_type, subject_id, hash) do nothing`,
      [
        context.workspaceId,
        subjectType,
        subjectId,
        JSON.stringify(effective.values),
        JSON.stringify(effective.sources),
        effective.hash,
        context.actorId,
      ],
    );
    const stored = await client.query<{ id: string; created_at: string } & QueryResultRow>(
      `select id, ${isoColumn('created_at', 'created_at')}
         from config_snapshots
        where workspace_id = $1 and subject_type = $2 and subject_id = $3 and hash = $4`,
      [context.workspaceId, subjectType, subjectId, effective.hash],
    );
    const row = stored.rows[0];
    if (!row) throw new Error('Config snapshot was not stored');
    return { ...effective, id: row.id, createdAt: row.created_at };
  }

  async snapshots(
    context: WorkspaceRequestContext,
    subjectType: ConfigScope,
    subjectId: string,
  ): Promise<readonly ConfigSnapshot[]> {
    return this.database.run(context, async (client) => {
      await this.assertScope(client, context, subjectType, subjectId, false);
      const result = await client.query<
        QueryResultRow & {
          id: string;
          resolved: Record<string, unknown>;
          source_map: Record<string, ValueSource>;
          hash: string;
          created_at: string;
        }
      >(
        `select id, resolved, source_map, hash, ${isoColumn('created_at', 'created_at')}
           from config_snapshots
          where workspace_id = $1 and subject_type = $2 and subject_id = $3
          order by created_at desc
          limit 100`,
        [context.workspaceId, subjectType, subjectId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        subjectType,
        subjectId,
        values: row.resolved,
        sources: row.source_map,
        hash: row.hash,
        createdAt: row.created_at,
      }));
    });
  }

  /**
   * Checks the values a new project is created with: each key must exist, be allowed at project
   * scope, not be sensitive, appear once and pass its type, range and semantic rules.
   */
  private async checkOverrides(
    client: PoolClient,
    settings: readonly { key: string; value: unknown }[],
  ): Promise<readonly { definition: SettingDefinition; value: unknown }[]> {
    const seen = new Set<string>();
    const checked: { definition: SettingDefinition; value: unknown }[] = [];
    for (const setting of settings) {
      if (seen.has(setting.key)) {
        throw badRequest('CONFIG_VALUE_INVALID', `${setting.key}: given more than once.`);
      }
      seen.add(setting.key);
      const definition = await this.requireDefinition(client, setting.key);
      this.assertAllowedScope(definition, 'project');
      if (definition.sensitive) {
        throw badRequest('CONFIG_VALUE_INVALID', `${setting.key}: cannot be set here.`);
      }
      const problem =
        validateSettingValue(definition.valueSchema, setting.value) ??
        settingSemanticProblem(setting.key, setting.value);
      if (problem) throw badRequest('CONFIG_VALUE_INVALID', `${setting.key}: ${problem}`);
      checked.push({ definition, value: setting.value });
    }
    return checked;
  }

  /**
   * The effective configuration a project would start with, before it exists (project wizard,
   * UX §5): the workspace, the chosen topics (the first one has priority 1 and wins) and the
   * values the administrator picked for the project, each with the scope it comes from.
   */
  async preview(
    context: WorkspaceRequestContext,
    input: {
      topicIds: readonly string[];
      settings: readonly { key: string; value: unknown }[];
    },
  ): Promise<EffectiveConfig> {
    return this.database.run(context, async (client) => {
      const checked = await this.checkOverrides(client, input.settings);
      for (const topicId of input.topicIds) {
        await this.assertScope(client, context, 'topic', topicId, false);
      }
      const chain: { scope: ConfigScope; id: string }[] = [
        { scope: 'workspace', id: context.workspaceId },
        // Lowest priority first so the highest-priority topic overrides the rest.
        ...[...input.topicIds].reverse().map((id) => ({ scope: 'topic' as const, id })),
      ];
      return this.resolveChain(
        client,
        context,
        'workspace',
        context.workspaceId,
        chain,
        Object.fromEntries(checked.map((item) => [item.definition.key, item.value])),
      );
    });
  }

  /** Saves the values a project is created with, in the transaction that creates it. */
  async applyProjectSettings(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string,
    settings: readonly { key: string; value: unknown }[],
    reason: string,
  ): Promise<number> {
    const checked = await this.checkOverrides(client, settings);
    for (const item of checked) {
      await this.append(client, context, item.definition, {
        key: item.definition.key,
        scopeType: 'project',
        scopeId: projectId,
        value: item.value,
        cleared: false,
        reason,
        restoredFromSequence: null,
        expectedSequence: undefined,
      });
    }
    return checked.length;
  }

  /** Copies the latest project-scope values to another project (used by clone). */
  async copyProjectAssignments(
    client: PoolClient,
    context: WorkspaceRequestContext,
    fromProjectId: string,
    toProjectId: string,
    reason: string,
  ): Promise<number> {
    const result = await client.query(
      `insert into config_assignments (
         workspace_id, setting_key, scope_type, scope_id, sequence, value, cleared, reason, created_by
       )
       select workspace_id, setting_key, scope_type, $3, 1, value, cleared, $4, $5
         from (
           select distinct on (setting_key) *
             from config_assignments
            where workspace_id = $1 and scope_type = 'project' and scope_id = $2
            order by setting_key, sequence desc
         ) latest
        where not latest.cleared`,
      [context.workspaceId, fromProjectId, toProjectId, reason, context.actorId],
    );
    return result.rowCount ?? 0;
  }

  private async append(
    client: PoolClient,
    context: WorkspaceRequestContext,
    definition: SettingDefinition,
    input: {
      key: string;
      scopeType: ConfigScope;
      scopeId: string;
      value: unknown;
      cleared: boolean;
      reason: string;
      restoredFromSequence: number | null;
      expectedSequence: number | undefined;
    },
  ): Promise<ConfigAssignment> {
    const current = await client.query<AssignmentRow>(
      `select ${assignmentColumns}
         from config_assignments
        where workspace_id = $1 and setting_key = $2 and scope_type = $3 and scope_id = $4
        order by sequence desc
        limit 1`,
      [context.workspaceId, input.key, input.scopeType, input.scopeId],
    );
    const previous = current.rows[0];
    const currentSequence = previous?.sequence ?? 0;
    if (input.expectedSequence !== undefined && input.expectedSequence !== currentSequence) {
      throw preconditionFailed(
        'CONFIG_VERSION_CONFLICT',
        'The setting changed since you loaded it. Reload and try again.',
      );
    }

    let inserted: AssignmentRow | undefined;
    try {
      const result = await client.query<AssignmentRow>(
        `insert into config_assignments (
           workspace_id, setting_key, scope_type, scope_id, sequence, value, cleared, reason,
           restored_from_sequence, created_by
         ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
         returning ${assignmentColumns}`,
        [
          context.workspaceId,
          input.key,
          input.scopeType,
          input.scopeId,
          currentSequence + 1,
          input.cleared ? null : JSON.stringify(input.value),
          input.cleared,
          input.reason,
          input.restoredFromSequence,
          context.actorId,
        ],
      );
      inserted = result.rows[0];
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw preconditionFailed(
          'CONFIG_VERSION_CONFLICT',
          'The setting changed at the same time. Reload and try again.',
        );
      }
      throw error;
    }
    if (!inserted) throw new Error('Config assignment insert did not return a row');

    const shown = (row: AssignmentRow | undefined) =>
      !row || row.cleared ? null : definition.sensitive ? '[REDACTED]' : row.value;
    await writeAudit(client, context, {
      action: input.restoredFromSequence
        ? 'config.restore'
        : input.cleared
          ? 'config.clear'
          : 'config.set',
      targetType: 'config_assignment',
      targetId: input.scopeId,
      projectId: input.scopeType === 'project' ? input.scopeId : null,
      reason: input.reason,
      severity: definition.sensitive ? 'warning' : 'info',
      securityRelevant: definition.sensitive,
      before: {
        key: input.key,
        scope: input.scopeType,
        sequence: previous?.sequence ?? null,
        value: shown(previous),
      },
      after: {
        key: input.key,
        scope: input.scopeType,
        sequence: inserted.sequence,
        value: shown(inserted),
        restoredFromSequence: input.restoredFromSequence,
      },
    });
    return this.toAssignment(inserted, definition);
  }

  private async assertScope(
    client: PoolClient,
    context: WorkspaceRequestContext,
    scopeType: ConfigScope,
    scopeId: string,
    forWrite: boolean,
  ): Promise<void> {
    if (scopeType === 'workspace') {
      if (scopeId !== context.workspaceId) {
        throw notFound('CONFIG_SCOPE_NOT_FOUND', 'The settings scope was not found.');
      }
      return;
    }
    const table = scopeType === 'topic' ? 'topics' : 'projects';
    const state =
      scopeType === 'topic'
        ? `deleted_at is not null as deleted, archived_at is not null as read_only`
        : `status = 'deleted' as deleted, status in ('archived', 'deleted') as read_only`;
    const result = await client.query<{ deleted: boolean; read_only: boolean } & QueryResultRow>(
      `select ${state} from ${table} where workspace_id = $1 and id = $2`,
      [context.workspaceId, scopeId],
    );
    const row = result.rows[0];
    if (!row || (row.deleted && forWrite)) {
      throw notFound('CONFIG_SCOPE_NOT_FOUND', 'The settings scope was not found.');
    }
    if (forWrite && row.read_only) {
      throw conflict('CONFIG_SCOPE_READ_ONLY', 'Restore the item before changing its settings.');
    }
  }

  private assertAllowedScope(definition: SettingDefinition, scope: ConfigScope): void {
    if (!definition.allowedScopes.includes(scope)) {
      throw badRequest(
        'CONFIG_SCOPE_NOT_ALLOWED',
        `${definition.key} can only be set on: ${definition.allowedScopes.join(', ')}.`,
      );
    }
  }

  private async requireDefinition(client: PoolClient, key: string): Promise<SettingDefinition> {
    const definition = (await this.definitionMap(client)).get(key);
    if (!definition) throw notFound('CONFIG_SETTING_NOT_FOUND', 'The setting does not exist.');
    return definition;
  }

  private async definitionMap(client: PoolClient): Promise<Map<string, SettingDefinition>> {
    return new Map((await this.loadDefinitions(client)).map((item) => [item.key, item]));
  }

  private async loadDefinitions(client: PoolClient): Promise<SettingDefinition[]> {
    const result = await client.query<DefinitionRow>(
      `select key, value_schema, default_value, allowed_scopes::text[] as allowed_scopes,
              sensitive, description_fa, description_en
         from setting_definitions
        order by key`,
    );
    return result.rows.map((row) => ({
      key: row.key,
      valueSchema: row.value_schema,
      defaultValue: row.default_value,
      allowedScopes: (Array.isArray(row.allowed_scopes)
        ? row.allowed_scopes
        : parsePgArray(row.allowed_scopes)
      )
        .filter((scope): scope is ConfigScope => scope in scopeRank)
        .sort((a, b) => scopeRank[a] - scopeRank[b]),
      sensitive: row.sensitive,
      description: { fa: row.description_fa, en: row.description_en },
    }));
  }

  private toAssignment(row: AssignmentRow, definition?: SettingDefinition): ConfigAssignment {
    return {
      key: row.setting_key,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      sequence: row.sequence,
      value: row.cleared ? null : definition?.sensitive ? '[REDACTED]' : row.value,
      cleared: row.cleared,
      reason: row.reason,
      restoredFromSequence: row.restored_from_sequence,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }
}

function parsePgArray(value: string): ConfigScope[] {
  return value
    .replace(/^\{|\}$/g, '')
    .split(',')
    .filter(Boolean) as ConfigScope[];
}
