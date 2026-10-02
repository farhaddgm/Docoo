import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import { decodeCursor, encodeCursor, isoColumn } from '../common/pagination.js';
import {
  conflict,
  gone,
  isUniqueViolation,
  notFound,
  preconditionFailed,
} from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';

export type TopicStatus = 'active' | 'archived' | 'deleted';
export type TopicLanguage = 'fa' | 'en';

export interface Topic {
  readonly id: string;
  readonly workspaceId: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly language: TopicLanguage;
  readonly status: TopicStatus;
  readonly version: number;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly purgeAfter: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TopicVersion {
  readonly version: number;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly language: TopicLanguage;
  readonly reason: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export interface TopicDependency {
  readonly projectId: string;
  readonly code: string;
  readonly title: string;
  readonly status: string;
  readonly priority: number;
}

export interface CreateTopicInput {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly language: TopicLanguage;
}

export interface UpdateTopicInput {
  readonly code?: string | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly language?: TopicLanguage | undefined;
  readonly reason?: string | undefined;
}

export interface TopicStateCommand {
  readonly expectedVersion?: number | undefined;
  readonly reason?: string | undefined;
}

export interface ListTopicsInput {
  readonly limit: number;
  readonly cursor?: string | undefined;
  readonly status?: TopicStatus | 'all' | undefined;
}

export interface TopicPage {
  readonly items: readonly Topic[];
  readonly nextCursor: string | null;
}

/** Deleted topics stay recoverable for this long before purge (FR-PRJ-005 parity). */
export const TOPIC_RECOVERY_DAYS = 30;

interface TopicRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  code: string;
  title: string;
  description: string;
  language: TopicLanguage;
  version: number;
  archived_at: string | null;
  deleted_at: string | null;
  purge_after: string | null;
  purge_expired: boolean;
  created_at: string;
  updated_at: string;
}

const topicColumns = `
  id, workspace_id, code, title, description, language, version,
  ${isoColumn('archived_at', 'archived_at')},
  ${isoColumn('deleted_at', 'deleted_at')},
  ${isoColumn('purge_after', 'purge_after')},
  coalesce(purge_after <= now(), false) as purge_expired,
  ${isoColumn('created_at', 'created_at')},
  ${isoColumn('updated_at', 'updated_at')}`;

const statusFilter: Record<TopicStatus, string> = {
  active: 'archived_at is null and deleted_at is null',
  archived: 'archived_at is not null and deleted_at is null',
  deleted: 'deleted_at is not null',
};

@Injectable()
export class TopicsService {
  constructor(private readonly database: WorkspaceDatabase) {}

  async list(context: WorkspaceRequestContext, input: ListTopicsInput): Promise<TopicPage> {
    const status = input.status ?? 'active';
    const scope = `${context.workspaceId}:topics:${status}`;
    const cursor = input.cursor ? decodeCursor(input.cursor, scope, 'TOPIC_CURSOR_INVALID') : null;
    const filter = status === 'all' ? 'true' : statusFilter[status];
    return this.database.run(context, async (client) => {
      const result = await client.query<TopicRow>(
        `select ${topicColumns}
           from topics
          where workspace_id = $1
            and ${filter}
            and ($2::timestamptz is null or (created_at, id) < ($2::timestamptz, $3::uuid))
          order by created_at desc, id desc
          limit $4`,
        [context.workspaceId, cursor?.at ?? null, cursor?.id ?? null, input.limit + 1],
      );
      const rows = result.rows.slice(0, input.limit);
      const last = rows.at(-1);
      return {
        items: rows.map((row) => this.toTopic(row)),
        nextCursor:
          result.rows.length > input.limit && last
            ? encodeCursor(scope, last.created_at, last.id)
            : null,
      };
    });
  }

  async get(context: WorkspaceRequestContext, topicId: string): Promise<Topic> {
    return this.database.run(context, async (client) =>
      this.toTopic(await this.load(client, context, topicId)),
    );
  }

  async create(context: WorkspaceRequestContext, input: CreateTopicInput): Promise<Topic> {
    return this.database.run(context, async (client) => {
      let row: TopicRow | undefined;
      try {
        const result = await client.query<TopicRow>(
          `with inserted as (
             insert into topics (workspace_id, code, title, description, language, created_by)
             values ($1, $2, $3, $4, $5, $6)
             returning *
           )
           select ${topicColumns} from inserted`,
          [
            context.workspaceId,
            input.code,
            input.title,
            input.description,
            input.language,
            context.actorId,
          ],
        );
        row = result.rows[0];
      } catch (error) {
        if (isUniqueViolation(error)) throw this.alreadyExists();
        throw error;
      }
      if (!row) throw new Error('Topic insert did not return a row');
      await this.insertVersion(client, context, row, null);
      await writeAudit(client, context, {
        action: 'topic.create',
        targetType: 'topic',
        targetId: row.id,
        after: this.snapshot(row),
      });
      return this.toTopic(row);
    });
  }

  async update(
    context: WorkspaceRequestContext,
    topicId: string,
    expectedVersion: number,
    input: UpdateTopicInput,
  ): Promise<Topic> {
    return this.database.run(context, async (client) => {
      const current = await this.load(client, context, topicId, true);
      if (current.deleted_at || current.archived_at) {
        throw conflict('TOPIC_READ_ONLY', 'Restore the topic before editing it.');
      }
      this.assertVersion(current, expectedVersion);
      const next = {
        code: input.code ?? current.code,
        title: input.title ?? current.title,
        description: input.description ?? current.description,
        language: input.language ?? current.language,
      };
      const unchanged =
        next.code === current.code &&
        next.title === current.title &&
        next.description === current.description &&
        next.language === current.language;
      if (unchanged) return this.toTopic(current);

      let updated: TopicRow | undefined;
      try {
        const result = await client.query<TopicRow>(
          `with updated as (
             update topics
                set code = $3, title = $4, description = $5, language = $6,
                    version = version + 1
              where workspace_id = $1 and id = $2
              returning *
           )
           select ${topicColumns} from updated`,
          [context.workspaceId, topicId, next.code, next.title, next.description, next.language],
        );
        updated = result.rows[0];
      } catch (error) {
        if (isUniqueViolation(error)) throw this.alreadyExists();
        throw error;
      }
      if (!updated) throw this.notFound();
      await this.insertVersion(client, context, updated, input.reason ?? null);
      await writeAudit(client, context, {
        action: 'topic.update',
        targetType: 'topic',
        targetId: topicId,
        reason: input.reason ?? null,
        before: this.snapshot(current),
        after: this.snapshot(updated),
      });
      return this.toTopic(updated);
    });
  }

  async versions(
    context: WorkspaceRequestContext,
    topicId: string,
  ): Promise<readonly TopicVersion[]> {
    return this.database.run(context, async (client) => {
      await this.load(client, context, topicId);
      const result = await client.query<
        QueryResultRow & {
          version: number;
          code: string;
          title: string;
          description: string;
          language: TopicLanguage;
          reason: string | null;
          created_by: string | null;
          created_at: string;
        }
      >(
        `select version, code, title, description, language, reason, created_by,
                ${isoColumn('created_at', 'created_at')}
           from topic_versions
          where workspace_id = $1 and topic_id = $2
          order by version desc`,
        [context.workspaceId, topicId],
      );
      return result.rows.map((row) => ({
        version: row.version,
        code: row.code,
        title: row.title,
        description: row.description,
        language: row.language,
        reason: row.reason,
        createdBy: row.created_by,
        createdAt: row.created_at,
      }));
    });
  }

  async dependencies(
    context: WorkspaceRequestContext,
    topicId: string,
  ): Promise<readonly TopicDependency[]> {
    return this.database.run(context, async (client) => {
      await this.load(client, context, topicId);
      return this.loadDependencies(client, context, topicId);
    });
  }

  async archive(
    context: WorkspaceRequestContext,
    topicId: string,
    command: TopicStateCommand,
  ): Promise<Topic> {
    return this.changeState(context, topicId, command, 'topic.archive', (current) => {
      if (current.deleted_at) throw conflict('TOPIC_STATE_CONFLICT', 'The topic is deleted.');
      if (current.archived_at) return null;
      return 'archived_at = now()';
    });
  }

  async restore(
    context: WorkspaceRequestContext,
    topicId: string,
    command: TopicStateCommand,
  ): Promise<Topic> {
    return this.changeState(context, topicId, command, 'topic.restore', (current) => {
      if (current.deleted_at) {
        if (current.purge_expired) {
          throw gone('TOPIC_RECOVERY_EXPIRED', 'The recovery window for this topic has ended.');
        }
        // Restores to the state before deletion (archived topics stay archived).
        return 'deleted_at = null, purge_after = null';
      }
      if (current.archived_at) return 'archived_at = null';
      return null;
    });
  }

  async delete(
    context: WorkspaceRequestContext,
    topicId: string,
    command: TopicStateCommand,
  ): Promise<Topic> {
    return this.database.run(context, async (client) => {
      const current = await this.load(client, context, topicId, true);
      if (command.expectedVersion !== undefined)
        this.assertVersion(current, command.expectedVersion);
      if (current.deleted_at) return this.toTopic(current);
      const dependencies = await this.loadDependencies(client, context, topicId);
      const blocking = dependencies.filter((dependency) => dependency.status !== 'deleted');
      if (blocking.length > 0) {
        throw conflict(
          'TOPIC_HAS_DEPENDENCIES',
          'Remove this topic from its projects or delete those projects first.',
          { dependencies: blocking },
        );
      }
      const result = await client.query<TopicRow>(
        `with updated as (
           update topics
              set deleted_at = now(),
                  purge_after = now() + ($3::integer * interval '1 day'),
                  version = version + 1
            where workspace_id = $1 and id = $2
            returning *
         )
         select ${topicColumns} from updated`,
        [context.workspaceId, topicId, TOPIC_RECOVERY_DAYS],
      );
      const updated = result.rows[0];
      if (!updated) throw this.notFound();
      await writeAudit(client, context, {
        action: 'topic.delete',
        targetType: 'topic',
        targetId: topicId,
        reason: command.reason ?? null,
        severity: 'warning',
        before: { status: this.status(current) },
        after: {
          status: 'deleted',
          purgeAfter: updated.purge_after,
          linkedDeletedProjects: dependencies.map((dependency) => dependency.projectId),
        },
      });
      return this.toTopic(updated);
    });
  }

  private async changeState(
    context: WorkspaceRequestContext,
    topicId: string,
    command: TopicStateCommand,
    action: string,
    plan: (current: TopicRow) => string | null,
  ): Promise<Topic> {
    return this.database.run(context, async (client) => {
      const current = await this.load(client, context, topicId, true);
      if (command.expectedVersion !== undefined)
        this.assertVersion(current, command.expectedVersion);
      const assignments = plan(current);
      // Repeating a command that already holds is an idempotent no-op.
      if (!assignments) return this.toTopic(current);
      const result = await client.query<TopicRow>(
        `with updated as (
           update topics set ${assignments}, version = version + 1
            where workspace_id = $1 and id = $2
            returning *
         )
         select ${topicColumns} from updated`,
        [context.workspaceId, topicId],
      );
      const updated = result.rows[0];
      if (!updated) throw this.notFound();
      await writeAudit(client, context, {
        action,
        targetType: 'topic',
        targetId: topicId,
        reason: command.reason ?? null,
        before: { status: this.status(current) },
        after: { status: this.status(updated) },
      });
      return this.toTopic(updated);
    });
  }

  private async load(
    client: PoolClient,
    context: WorkspaceRequestContext,
    topicId: string,
    forUpdate = false,
  ): Promise<TopicRow> {
    const result = await client.query<TopicRow>(
      `select ${topicColumns} from topics
        where workspace_id = $1 and id = $2 ${forUpdate ? 'for update' : ''}`,
      [context.workspaceId, topicId],
    );
    const row = result.rows[0];
    if (!row) throw this.notFound();
    return row;
  }

  private async loadDependencies(
    client: PoolClient,
    context: WorkspaceRequestContext,
    topicId: string,
  ): Promise<TopicDependency[]> {
    const result = await client.query<
      QueryResultRow & { id: string; code: string; title: string; status: string; priority: number }
    >(
      `select p.id, p.code, p.title, p.status, pt.priority
         from project_topics pt
         join projects p on p.id = pt.project_id and p.workspace_id = pt.workspace_id
        where pt.workspace_id = $1 and pt.topic_id = $2
        order by p.code`,
      [context.workspaceId, topicId],
    );
    return result.rows.map((row) => ({
      projectId: row.id,
      code: row.code,
      title: row.title,
      status: row.status,
      priority: row.priority,
    }));
  }

  private async insertVersion(
    client: PoolClient,
    context: WorkspaceRequestContext,
    row: TopicRow,
    reason: string | null,
  ): Promise<void> {
    await client.query(
      `insert into topic_versions (
         workspace_id, topic_id, version, code, title, description, language, reason, created_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        context.workspaceId,
        row.id,
        row.version,
        row.code,
        row.title,
        row.description,
        row.language,
        reason,
        context.actorId,
      ],
    );
  }

  private assertVersion(row: TopicRow, expectedVersion: number): void {
    if (row.version !== expectedVersion) {
      throw preconditionFailed(
        'TOPIC_VERSION_CONFLICT',
        'The topic changed since you loaded it. Reload and try again.',
      );
    }
  }

  private status(row: TopicRow): TopicStatus {
    if (row.deleted_at) return 'deleted';
    if (row.archived_at) return 'archived';
    return 'active';
  }

  private snapshot(row: TopicRow): Record<string, unknown> {
    return {
      code: row.code,
      title: row.title,
      description: row.description,
      language: row.language,
      version: row.version,
    };
  }

  private alreadyExists() {
    return conflict(
      'TOPIC_ALREADY_EXISTS',
      'A topic with this code or title already exists in the workspace.',
    );
  }

  private notFound() {
    return notFound('TOPIC_NOT_FOUND', 'The topic was not found.');
  }

  private toTopic(row: TopicRow): Topic {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      code: row.code,
      title: row.title,
      description: row.description,
      language: row.language,
      status: this.status(row),
      version: row.version,
      archivedAt: row.archived_at,
      deletedAt: row.deleted_at,
      purgeAfter: row.purge_after,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
