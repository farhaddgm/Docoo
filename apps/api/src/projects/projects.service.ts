import { Injectable } from '@nestjs/common';
import {
  availableProjectCommands,
  InvalidProjectTransitionError,
  isProjectReadOnly,
  nextProjectAction,
  planProjectCommand,
  projectCommandRequiresReason,
  type ProjectCommand,
  type ProjectNextAction,
  type ProjectStatus,
} from '@docoo/domain';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import { decodeCursor, encodeCursor, isoColumn } from '../common/pagination.js';
import {
  badRequest,
  conflict,
  gone,
  isUniqueViolation,
  notFound,
  preconditionFailed,
} from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';

export type OutputLanguage = 'fa' | 'en';

/** Deleted projects stay recoverable for this many days (FR-PRJ-005). */
export const PROJECT_RECOVERY_DAYS = 30;
export const PROJECT_MAX_TOPICS = 20;

export interface ProjectTopicLink {
  readonly topicId: string;
  readonly code: string;
  readonly title: string;
  readonly priority: number;
  readonly conflictInstruction: string | null;
  readonly topicStatus: 'active' | 'archived' | 'deleted';
}

export interface Project {
  readonly id: string;
  readonly workspaceId: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly initialProblem: string;
  readonly outputLanguage: OutputLanguage;
  readonly status: ProjectStatus;
  readonly previousStatus: ProjectStatus | null;
  readonly currentStage: string;
  readonly pauseReason: string | null;
  readonly nextAction: ProjectNextAction;
  /** Lifecycle commands the project accepts now; the backoffice offers exactly these. */
  readonly availableCommands: readonly ProjectCommand[];
  readonly topics: readonly ProjectTopicLink[];
  readonly configSnapshotId: string | null;
  readonly clonedFromId: string | null;
  /** The approved analysis output that serves as the problem definition (FR-ANL-005). */
  readonly approvedProblemVersionId: string | null;
  readonly version: number;
  readonly deletedAt: string | null;
  readonly purgeAfter: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TopicLinkInput {
  readonly topicId: string;
  readonly conflictInstruction?: string | undefined;
}

export interface CreateProjectInput {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly initialProblem: string;
  readonly outputLanguage: OutputLanguage;
  readonly topics: readonly TopicLinkInput[];
  /** Project-scope settings saved together with the project (the wizard's choices). */
  readonly settings?: readonly { readonly key: string; readonly value: unknown }[] | undefined;
}

export interface UpdateProjectInput {
  readonly code?: string | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly initialProblem?: string | undefined;
  readonly outputLanguage?: OutputLanguage | undefined;
  readonly topics?: readonly TopicLinkInput[] | undefined;
  readonly reason?: string | undefined;
}

export interface ProjectCommandInput {
  readonly expectedVersion: number;
  readonly reason?: string | undefined;
}

export interface CloneProjectInput {
  readonly code: string;
  readonly title?: string | undefined;
}

export interface ListProjectsInput {
  readonly limit: number;
  readonly cursor?: string | undefined;
  readonly status?: ProjectStatus | 'current' | 'all' | undefined;
}

export interface TimelineEntry {
  readonly id: string;
  readonly action: string;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly severity: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly correlationId: string;
  readonly occurredAt: string;
}

interface ProjectRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  code: string;
  title: string;
  description: string;
  initial_problem: string;
  output_language: OutputLanguage;
  status: ProjectStatus;
  previous_status: ProjectStatus | null;
  current_stage: string;
  pause_reason: string | null;
  config_snapshot_id: string | null;
  cloned_from_id: string | null;
  approved_problem_version_id: string | null;
  version: number;
  deleted_at: string | null;
  purge_after: string | null;
  purge_expired: boolean;
  created_at: string;
  updated_at: string;
}

interface LinkRow extends QueryResultRow {
  project_id: string;
  topic_id: string;
  code: string;
  title: string;
  priority: number;
  conflict_instruction: string | null;
  archived: boolean;
  deleted: boolean;
}

const projectColumns = `
  id, workspace_id, code, title, description, initial_problem, output_language, status,
  previous_status, current_stage, pause_reason, config_snapshot_id, cloned_from_id,
  approved_problem_version_id, version,
  ${isoColumn('deleted_at', 'deleted_at')},
  ${isoColumn('purge_after', 'purge_after')},
  coalesce(purge_after <= now(), false) as purge_expired,
  ${isoColumn('created_at', 'created_at')},
  ${isoColumn('updated_at', 'updated_at')}`;

/** Commands that start or continue execution and therefore pin a config snapshot. */
const runBoundaryCommands: ReadonlySet<ProjectCommand> = new Set(['activate', 'resume', 'reopen']);
const pauseClearingCommands: ReadonlySet<ProjectCommand> = new Set([
  'activate',
  'resume',
  'reopen',
  'complete',
]);

@Injectable()
export class ProjectsService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly configService: ConfigService,
  ) {}

  async list(
    context: WorkspaceRequestContext,
    input: ListProjectsInput,
  ): Promise<{ items: readonly Project[]; nextCursor: string | null }> {
    const status = input.status ?? 'current';
    const scope = `${context.workspaceId}:projects:${status}`;
    const cursor = input.cursor
      ? decodeCursor(input.cursor, scope, 'PROJECT_CURSOR_INVALID')
      : null;
    const filter =
      status === 'all' ? 'true' : status === 'current' ? `status <> 'deleted'` : 'status = $5';
    return this.database.run(context, async (client) => {
      const params: unknown[] = [
        context.workspaceId,
        cursor?.at ?? null,
        cursor?.id ?? null,
        input.limit + 1,
      ];
      if (status !== 'all' && status !== 'current') params.push(status);
      const result = await client.query<ProjectRow>(
        `select ${projectColumns}
           from projects
          where workspace_id = $1 and ${filter}
            and ($2::timestamptz is null or (updated_at, id) < ($2::timestamptz, $3::uuid))
          order by updated_at desc, id desc
          limit $4`,
        params,
      );
      const rows = result.rows.slice(0, input.limit);
      const links = await this.loadLinks(
        client,
        context,
        rows.map((row) => row.id),
      );
      const last = rows.at(-1);
      return {
        items: rows.map((row) => this.toProject(row, links.get(row.id) ?? [])),
        nextCursor:
          result.rows.length > input.limit && last
            ? encodeCursor(scope, last.updated_at, last.id)
            : null,
      };
    });
  }

  async get(context: WorkspaceRequestContext, projectId: string): Promise<Project> {
    return this.database.run(context, async (client) => this.read(client, context, projectId));
  }

  async create(context: WorkspaceRequestContext, input: CreateProjectInput): Promise<Project> {
    return this.database.run(context, async (client) => {
      await this.assertTopicsUsable(client, context, input.topics);
      let row: ProjectRow | undefined;
      try {
        const result = await client.query<ProjectRow>(
          `with inserted as (
             insert into projects (
               workspace_id, code, title, description, initial_problem, output_language, created_by
             ) values ($1, $2, $3, $4, $5, $6, $7)
             returning *
           )
           select ${projectColumns} from inserted`,
          [
            context.workspaceId,
            input.code,
            input.title,
            input.description,
            input.initialProblem,
            input.outputLanguage,
            context.actorId,
          ],
        );
        row = result.rows[0];
      } catch (error) {
        if (isUniqueViolation(error)) throw this.alreadyExists();
        throw error;
      }
      if (!row) throw new Error('Project insert did not return a row');
      await this.replaceLinks(client, context, row.id, input.topics);
      // The wizard's choices are saved in the same transaction: a bad value creates nothing.
      const settings = input.settings ?? [];
      if (settings.length > 0) {
        await this.configService.applyProjectSettings(
          client,
          context,
          row.id,
          settings,
          'Set while creating the project',
        );
      }
      await writeAudit(client, context, {
        action: 'project.create',
        targetType: 'project',
        targetId: row.id,
        projectId: row.id,
        after: {
          ...this.snapshot(row),
          topics: input.topics.map((topic) => topic.topicId),
          settings: settings.map((setting) => setting.key),
        },
      });
      return this.read(client, context, row.id);
    });
  }

  async update(
    context: WorkspaceRequestContext,
    projectId: string,
    expectedVersion: number,
    input: UpdateProjectInput,
  ): Promise<Project> {
    return this.database.run(context, async (client) => {
      const current = await this.load(client, context, projectId, true);
      if (isProjectReadOnly(current.status)) {
        throw conflict('PROJECT_READ_ONLY', 'Restore or unarchive the project before editing it.');
      }
      this.assertVersion(current, expectedVersion);
      if (
        input.initialProblem !== undefined &&
        input.initialProblem !== current.initial_problem &&
        current.status !== 'draft'
      ) {
        throw conflict(
          'PROJECT_PROBLEM_LOCKED',
          'The initial problem can only change while the project is a draft.',
        );
      }
      const previousLinks =
        (await this.loadLinks(client, context, [projectId])).get(projectId) ?? [];
      if (input.topics) await this.assertTopicsUsable(client, context, input.topics, previousLinks);

      let updated: ProjectRow | undefined;
      try {
        const result = await client.query<ProjectRow>(
          `with updated as (
             update projects
                set code = $3, title = $4, description = $5, initial_problem = $6,
                    output_language = $7, version = version + 1
              where workspace_id = $1 and id = $2
              returning *
           )
           select ${projectColumns} from updated`,
          [
            context.workspaceId,
            projectId,
            input.code ?? current.code,
            input.title ?? current.title,
            input.description ?? current.description,
            input.initialProblem ?? current.initial_problem,
            input.outputLanguage ?? current.output_language,
          ],
        );
        updated = result.rows[0];
      } catch (error) {
        if (isUniqueViolation(error)) throw this.alreadyExists();
        throw error;
      }
      if (!updated) throw this.notFound();
      if (input.topics) await this.replaceLinks(client, context, projectId, input.topics);
      await writeAudit(client, context, {
        action: 'project.update',
        targetType: 'project',
        targetId: projectId,
        projectId,
        reason: input.reason ?? null,
        before: { ...this.snapshot(current), topics: previousLinks.map((link) => link.topicId) },
        after: {
          ...this.snapshot(updated),
          topics: (input.topics ?? previousLinks).map((link) => link.topicId),
        },
      });
      return this.read(client, context, projectId);
    });
  }

  async command(
    context: WorkspaceRequestContext,
    projectId: string,
    command: ProjectCommand,
    input: ProjectCommandInput,
  ): Promise<Project> {
    return this.database.run(context, async (client) => {
      const current = await this.load(client, context, projectId, true);
      this.assertVersion(current, input.expectedVersion);
      let plan;
      try {
        plan = planProjectCommand(
          { status: current.status, previousStatus: current.previous_status },
          command,
        );
      } catch (error) {
        if (error instanceof InvalidProjectTransitionError) {
          throw conflict(
            'PROJECT_STATE_CONFLICT',
            `A ${current.status} project cannot be changed with "${command}".`,
          );
        }
        throw error;
      }
      // Repeating a command that already holds is an idempotent no-op.
      if (!plan) return this.read(client, context, projectId);
      if (projectCommandRequiresReason(command) && !input.reason) {
        throw badRequest(
          'PROJECT_REASON_REQUIRED',
          `A reason is required to ${command} a project.`,
        );
      }
      if (command === 'restore' && current.purge_expired) {
        throw gone('PROJECT_RECOVERY_EXPIRED', 'The 30-day recovery window has ended.');
      }
      if (command === 'activate') await this.assertReadyToActivate(client, context, current);

      const snapshotId = runBoundaryCommands.has(command)
        ? (await this.configService.snapshot(client, context, 'project', projectId)).id
        : current.config_snapshot_id;
      const pauseReason =
        command === 'pause'
          ? (input.reason ?? null)
          : pauseClearingCommands.has(command)
            ? null
            : current.pause_reason;
      const deleting = command === 'delete';
      const restoring = command === 'restore';

      const result = await client.query<ProjectRow>(
        `with updated as (
           update projects
              set status = $3, previous_status = $4, pause_reason = $5, config_snapshot_id = $6,
                  deleted_at = case when $7 then now() when $8 then null else deleted_at end,
                  purge_after = case
                    when $7 then now() + ($9::integer * interval '1 day')
                    when $8 then null
                    else purge_after
                  end,
                  version = version + 1
            where workspace_id = $1 and id = $2
            returning *
         )
         select ${projectColumns} from updated`,
        [
          context.workspaceId,
          projectId,
          plan.status,
          plan.previousStatus,
          pauseReason,
          snapshotId,
          deleting,
          restoring,
          PROJECT_RECOVERY_DAYS,
        ],
      );
      const updated = result.rows[0];
      if (!updated) throw this.notFound();
      await writeAudit(client, context, {
        action: `project.${command}`,
        targetType: 'project',
        targetId: projectId,
        projectId,
        reason: input.reason ?? null,
        severity: deleting ? 'warning' : 'info',
        before: { status: current.status, version: current.version },
        after: {
          status: updated.status,
          version: updated.version,
          configSnapshotId: updated.config_snapshot_id,
          purgeAfter: updated.purge_after,
        },
      });
      return this.read(client, context, projectId);
    });
  }

  async clone(
    context: WorkspaceRequestContext,
    sourceId: string,
    input: CloneProjectInput,
  ): Promise<{ project: Project; skippedTopicIds: readonly string[] }> {
    return this.database.run(context, async (client) => {
      const source = await this.load(client, context, sourceId);
      if (source.status === 'deleted') {
        throw conflict('PROJECT_READ_ONLY', 'Restore the project before cloning it.');
      }
      const links = (await this.loadLinks(client, context, [sourceId])).get(sourceId) ?? [];
      const usable = links.filter((link) => link.topicStatus === 'active');
      let row: ProjectRow | undefined;
      try {
        const result = await client.query<ProjectRow>(
          `with inserted as (
             insert into projects (
               workspace_id, code, title, description, initial_problem, output_language,
               created_by, cloned_from_id
             ) values ($1, $2, $3, $4, $5, $6, $7, $8)
             returning *
           )
           select ${projectColumns} from inserted`,
          [
            context.workspaceId,
            input.code,
            input.title ?? source.title,
            source.description,
            source.initial_problem,
            source.output_language,
            context.actorId,
            sourceId,
          ],
        );
        row = result.rows[0];
      } catch (error) {
        if (isUniqueViolation(error)) throw this.alreadyExists();
        throw error;
      }
      if (!row) throw new Error('Project clone did not return a row');
      await this.replaceLinks(
        client,
        context,
        row.id,
        usable.map((link) => ({
          topicId: link.topicId,
          conflictInstruction: link.conflictInstruction ?? undefined,
        })),
      );
      // Settings are copied; audit, history, runs and secrets are not (FR-PRJ-006).
      const copied = await this.configService.copyProjectAssignments(
        client,
        context,
        sourceId,
        row.id,
        `Cloned from project ${source.code}`,
      );
      await writeAudit(client, context, {
        action: 'project.clone',
        targetType: 'project',
        targetId: row.id,
        projectId: row.id,
        after: { clonedFromId: sourceId, copiedSettings: copied, topics: usable.length },
      });
      return {
        project: await this.read(client, context, row.id),
        skippedTopicIds: links
          .filter((link) => link.topicStatus !== 'active')
          .map((link) => link.topicId),
      };
    });
  }

  async timeline(
    context: WorkspaceRequestContext,
    projectId: string,
    page: { limit: number; cursor?: string | undefined },
  ): Promise<{ items: readonly TimelineEntry[]; nextCursor: string | null }> {
    const scope = `${context.workspaceId}:timeline:${projectId}`;
    const cursor = page.cursor ? decodeCursor(page.cursor, scope, 'PROJECT_CURSOR_INVALID') : null;
    return this.database.run(context, async (client) => {
      await this.load(client, context, projectId);
      const result = await client.query<
        QueryResultRow & {
          id: string;
          action: string;
          actor_id: string | null;
          reason: string | null;
          severity: string;
          before: unknown;
          after: unknown;
          correlation_id: string;
          occurred_at: string;
        }
      >(
        `select id, action, actor_id, reason, severity, before, after, correlation_id,
                ${isoColumn('occurred_at', 'occurred_at')}
           from audit_events
          where workspace_id = $1 and project_id = $2
            and ($3::timestamptz is null or (occurred_at, id) < ($3::timestamptz, $4::uuid))
          order by occurred_at desc, id desc
          limit $5`,
        [context.workspaceId, projectId, cursor?.at ?? null, cursor?.id ?? null, page.limit + 1],
      );
      const rows = result.rows.slice(0, page.limit);
      const last = rows.at(-1);
      return {
        items: rows.map((row) => ({
          id: row.id,
          action: row.action,
          actorId: row.actor_id,
          reason: row.reason,
          severity: row.severity,
          before: row.before,
          after: row.after,
          correlationId: row.correlation_id,
          occurredAt: row.occurred_at,
        })),
        nextCursor:
          result.rows.length > page.limit && last
            ? encodeCursor(scope, last.occurred_at, last.id)
            : null,
      };
    });
  }

  private async assertReadyToActivate(
    client: PoolClient,
    context: WorkspaceRequestContext,
    project: ProjectRow,
  ): Promise<void> {
    const links = (await this.loadLinks(client, context, [project.id])).get(project.id) ?? [];
    const problems: string[] = [];
    if (project.initial_problem.trim().length === 0) problems.push('initial_problem_missing');
    if (links.length === 0) problems.push('topics_missing');
    if (links.some((link) => link.topicStatus !== 'active')) problems.push('topic_unavailable');
    if (problems.length > 0) {
      throw conflict(
        'PROJECT_NOT_READY',
        'Add the problem and at least one active topic before activating the project.',
        { problems },
      );
    }
  }

  private async assertTopicsUsable(
    client: PoolClient,
    context: WorkspaceRequestContext,
    topics: readonly TopicLinkInput[],
    existing: readonly ProjectTopicLink[] = [],
  ): Promise<void> {
    const ids = topics.map((topic) => topic.topicId);
    if (new Set(ids).size !== ids.length) {
      throw badRequest('PROJECT_TOPIC_DUPLICATE', 'Each topic can be linked only once.');
    }
    if (ids.length > PROJECT_MAX_TOPICS) {
      throw badRequest('PROJECT_TOO_MANY_TOPICS', `Link at most ${PROJECT_MAX_TOPICS} topics.`);
    }
    if (ids.length === 0) return;
    const result = await client.query<
      QueryResultRow & { id: string; archived: boolean; deleted: boolean }
    >(
      `select id, archived_at is not null as archived, deleted_at is not null as deleted
         from topics where workspace_id = $1 and id = any($2::uuid[])`,
      [context.workspaceId, ids],
    );
    const found = new Map(result.rows.map((row) => [row.id, row]));
    const alreadyLinked = new Set(existing.map((link) => link.topicId));
    const unavailable = ids.filter((id) => {
      const row = found.get(id);
      // Topics already on the project may stay even if archived since; new ones must be active.
      return !row || row.deleted || (row.archived && !alreadyLinked.has(id));
    });
    if (unavailable.length > 0) {
      throw conflict('PROJECT_TOPIC_UNAVAILABLE', 'Some topics are missing, archived or deleted.', {
        topicIds: unavailable,
      });
    }
  }

  private async replaceLinks(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string,
    topics: readonly TopicLinkInput[],
  ): Promise<void> {
    await client.query('delete from project_topics where workspace_id = $1 and project_id = $2', [
      context.workspaceId,
      projectId,
    ]);
    if (topics.length === 0) return;
    await client.query(
      `insert into project_topics (workspace_id, project_id, topic_id, priority, conflict_instruction)
       select $1, $2, link.topic_id, link.priority, link.conflict_instruction
         from unnest($3::uuid[], $4::integer[], $5::text[])
           as link(topic_id, priority, conflict_instruction)`,
      [
        context.workspaceId,
        projectId,
        topics.map((topic) => topic.topicId),
        topics.map((_, index) => index + 1),
        topics.map((topic) => topic.conflictInstruction ?? null),
      ],
    );
  }

  private async read(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string,
  ): Promise<Project> {
    const row = await this.load(client, context, projectId);
    const links = (await this.loadLinks(client, context, [projectId])).get(projectId) ?? [];
    return this.toProject(row, links);
  }

  private async load(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string,
    forUpdate = false,
  ): Promise<ProjectRow> {
    const result = await client.query<ProjectRow>(
      `select ${projectColumns} from projects
        where workspace_id = $1 and id = $2 ${forUpdate ? 'for update' : ''}`,
      [context.workspaceId, projectId],
    );
    const row = result.rows[0];
    if (!row) throw this.notFound();
    return row;
  }

  private async loadLinks(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectIds: readonly string[],
  ): Promise<Map<string, ProjectTopicLink[]>> {
    const links = new Map<string, ProjectTopicLink[]>();
    if (projectIds.length === 0) return links;
    const result = await client.query<LinkRow>(
      `select pt.project_id, pt.topic_id, t.code, t.title, pt.priority, pt.conflict_instruction,
              t.archived_at is not null as archived, t.deleted_at is not null as deleted
         from project_topics pt
         join topics t on t.id = pt.topic_id and t.workspace_id = pt.workspace_id
        where pt.workspace_id = $1 and pt.project_id = any($2::uuid[])
        order by pt.project_id, pt.priority`,
      [context.workspaceId, projectIds],
    );
    for (const row of result.rows) {
      const list = links.get(row.project_id) ?? [];
      list.push({
        topicId: row.topic_id,
        code: row.code,
        title: row.title,
        priority: row.priority,
        conflictInstruction: row.conflict_instruction,
        topicStatus: row.deleted ? 'deleted' : row.archived ? 'archived' : 'active',
      });
      links.set(row.project_id, list);
    }
    return links;
  }

  private assertVersion(row: ProjectRow, expectedVersion: number): void {
    if (row.version !== expectedVersion) {
      throw preconditionFailed(
        'PROJECT_VERSION_CONFLICT',
        'The project changed since you loaded it. Reload and try again.',
      );
    }
  }

  private snapshot(row: ProjectRow): Record<string, unknown> {
    return {
      code: row.code,
      title: row.title,
      description: row.description,
      initialProblem: row.initial_problem,
      outputLanguage: row.output_language,
      status: row.status,
      version: row.version,
    };
  }

  private alreadyExists() {
    return conflict('PROJECT_ALREADY_EXISTS', 'A project with this code already exists.');
  }

  private notFound() {
    return notFound('PROJECT_NOT_FOUND', 'The project was not found.');
  }

  private toProject(row: ProjectRow, topics: readonly ProjectTopicLink[]): Project {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      code: row.code,
      title: row.title,
      description: row.description,
      initialProblem: row.initial_problem,
      outputLanguage: row.output_language,
      status: row.status,
      previousStatus: row.previous_status,
      currentStage: row.current_stage,
      pauseReason: row.pause_reason,
      nextAction: nextProjectAction(row.status),
      availableCommands: availableProjectCommands(row.status).filter(
        (command) => !(command === 'restore' && row.purge_expired),
      ),
      topics,
      configSnapshotId: row.config_snapshot_id,
      approvedProblemVersionId: row.approved_problem_version_id,
      clonedFromId: row.cloned_from_id,
      version: row.version,
      deletedAt: row.deleted_at,
      purgeAfter: row.purge_after,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
