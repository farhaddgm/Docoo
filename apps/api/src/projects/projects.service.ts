import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { criteriaProblem, EXPLORATION_CRITERIA, type Criterion } from '@docoo/documents';
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
  type AnalysisProfile,
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
import { BusinessService, type FetchedBusiness } from '../business/business.service.js';
import { ConfigService } from '../config/config.service.js';
import {
  candidateProblemTemplates,
  type ProblemPatternSnapshot,
  type ProblemTemplate,
} from '@docoo/contracts';

export type OutputLanguage = 'fa' | 'en';

/** Deleted projects stay recoverable for this many days (FR-PRJ-005). */
export const PROJECT_RECOVERY_DAYS = 30;
export const PROJECT_MAX_TOPICS = 20;

/** Whether other projects on a topic may use this project's own knowledge (ADR-0034). */
export const KNOWLEDGE_SHARING_MODES = ['none', 'selected', 'all'] as const;
export type KnowledgeSharing = (typeof KNOWLEDGE_SHARING_MODES)[number];
export const PROJECT_MAX_SHARED_KNOWLEDGE = 500;

export interface ProjectTopicLink {
  readonly topicId: string;
  readonly code: string;
  readonly title: string;
  readonly priority: number;
  readonly conflictInstruction: string | null;
  readonly knowledgeSharing: KnowledgeSharing;
  readonly topicStatus: 'active' | 'archived' | 'deleted';
}

export type ProjectKind = 'standard' | 'exploration';

export interface Project {
  readonly kind: ProjectKind;
  readonly analysisProfile: AnalysisProfile;
  readonly id: string;
  readonly workspaceId: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly initialProblem: string;
  /** What the administrator expects to receive (ADR-0043); empty when not said. */
  readonly expectedOutput: string;
  readonly outputLanguage: OutputLanguage;
  readonly status: ProjectStatus;
  readonly previousStatus: ProjectStatus | null;
  readonly currentStage: string;
  readonly pauseReason: string | null;
  readonly nextAction: ProjectNextAction;
  /** Lifecycle commands the project accepts now; the backoffice offers exactly these. */
  readonly availableCommands: readonly ProjectCommand[];
  readonly topics: readonly ProjectTopicLink[];
  /** Own knowledge items shared on topic links set to `selected`. */
  readonly sharedKnowledgeIds: readonly string[];
  /** The business of Contenter the project belongs to (ADR-0021); null when it has none. */
  readonly business: ProjectBusiness | null;
  readonly problemTemplate: ProblemTemplate | null;
  readonly problemPattern: ProblemPatternSnapshot | null;
  readonly configSnapshotId: string | null;
  readonly clonedFromId: string | null;
  /** `copy`, `continuation` or `pivot` when the project was built on another one. */
  readonly originKind: ProjectOriginKind | null;
  /** The candidate problem of an exploration the project was made from (ADR-0044); null when none. */
  readonly explorationOrigin: ProjectExplorationOrigin | null;
  /** The selected dimension of an exploration the project was made from (ADR-0045); null when none. */
  readonly dimensionOrigin: ProjectDimensionOrigin | null;
  /** The approved analysis output that serves as the problem definition (FR-ANL-005). */
  readonly approvedProblemVersionId: string | null;
  readonly version: number;
  readonly deletedAt: string | null;
  readonly purgeAfter: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The selected dimension of an exploration project this project was made from (ADR-0045). */
export interface ProjectDimensionOrigin {
  readonly projectId: string;
  readonly projectTitle: string | null;
  readonly solutionId: string;
  readonly dimensionTitle: string | null;
}

export interface ProjectExplorationOrigin {
  readonly explorationId: string;
  readonly candidateKey: string;
  readonly explorationTitle: string | null;
  readonly candidateTitle: string | null;
}

export interface ProjectBusiness {
  readonly externalBusinessId: string;
  readonly name: string;
}

export interface TopicLinkInput {
  readonly topicId: string;
  readonly conflictInstruction?: string | undefined;
  readonly knowledgeSharing?: KnowledgeSharing | undefined;
}

export interface CreateProjectInput {
  readonly kind?: ProjectKind;
  readonly analysisProfile?: AnalysisProfile;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly initialProblem: string;
  /** Optional: the output the administrator expects (ADR-0043). */
  readonly expectedOutput?: string | undefined;
  readonly outputLanguage: OutputLanguage;
  readonly topics: readonly TopicLinkInput[];
  /** Project-scope settings saved together with the project (the wizard's choices). */
  readonly settings?: readonly { readonly key: string; readonly value: unknown }[] | undefined;
  /** The weighted solution criteria chosen in the wizard; version 1, in the same transaction. */
  readonly solutionCriteria?: readonly Criterion[] | undefined;
  /** The business of Contenter to link the project to; fetched first, linked in the same transaction. */
  readonly businessId?: string | undefined;
  readonly problemTemplateId?: string | undefined;
  /** Selects one immutable published problem-pattern version for this new project. */
  readonly problemPatternVersionId?: string | undefined;
  /** Makes the project from a candidate problem of an exploration (ADR-0044). */
  readonly explorationCandidate?:
    { readonly explorationId: string; readonly candidateKey: string } | undefined;
  /** Makes the project from a selected dimension of an exploration project (ADR-0045). */
  readonly dimension?: { readonly projectId: string; readonly solutionId: string } | undefined;
}

export interface UpdateProjectInput {
  readonly code?: string | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly initialProblem?: string | undefined;
  /** Can change only while the project is a draft, like the initial problem (ADR-0043). */
  readonly expectedOutput?: string | undefined;
  readonly outputLanguage?: OutputLanguage | undefined;
  readonly topics?: readonly TopicLinkInput[] | undefined;
  /** Replaces the list of own knowledge items shared on `selected` topic links. */
  readonly sharedKnowledgeIds?: readonly string[] | undefined;
  readonly reason?: string | undefined;
}

export interface ProjectCommandInput {
  readonly expectedVersion: number;
  readonly reason?: string | undefined;
}

export type ProjectOriginKind = 'copy' | 'continuation' | 'pivot';

export interface CloneProjectInput {
  readonly code: string;
  readonly title?: string | undefined;
  /** Defaults to a plain copy. A continuation or pivot may start only from a completed project. */
  readonly kind?: ProjectOriginKind | undefined;
  /** The new direction of a pivot; a pivot needs it, the other kinds ignore it. */
  readonly pivotProblem?: string | undefined;
}

export interface ListProjectsInput {
  readonly limit: number;
  readonly cursor?: string | undefined;
  readonly status?: ProjectStatus | 'current' | 'all' | undefined;
  /** Projects that use this topic (UX §4). */
  readonly topicId?: string | undefined;
  readonly language?: OutputLanguage | undefined;
  /** Only projects of this kind (ADR-0045); absent lists every kind. */
  readonly kind?: ProjectKind | undefined;
  /** Last change on or after / on or before this day (`YYYY-MM-DD`). */
  readonly updatedFrom?: string | undefined;
  readonly updatedTo?: string | undefined;
  /** Only projects with a human decision waiting (a gate, an attempt limit, a blocked run). */
  readonly waiting?: boolean | undefined;
  /** Part of the code or title. */
  readonly q?: string | undefined;
}

/** What the list adds to a project: who made it and what, if anything, waits for a person. */
export interface ProjectListItem extends Project {
  readonly owner: { readonly id: string; readonly displayName: string } | null;
  readonly waiting: { readonly kind: string; readonly stage: string | null } | null;
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
  kind: ProjectKind;
  analysis_profile: AnalysisProfile;
  analysis_continuation_session_id: string | null;
  id: string;
  workspace_id: string;
  code: string;
  title: string;
  description: string;
  initial_problem: string;
  expected_output: string;
  output_language: OutputLanguage;
  status: ProjectStatus;
  previous_status: ProjectStatus | null;
  current_stage: string;
  pause_reason: string | null;
  config_snapshot_id: string | null;
  cloned_from_id: string | null;
  origin_kind: ProjectOriginKind | null;
  origin_exploration_id: string | null;
  origin_candidate_key: string | null;
  origin_exploration_title: string | null;
  origin_candidate_title: string | null;
  origin_project_id: string | null;
  origin_solution_id: string | null;
  origin_project_title: string | null;
  origin_dimension_title: string | null;
  approved_problem_version_id: string | null;
  problem_template_snapshot: ProblemTemplate | null;
  problem_pattern_snapshot: ProblemPatternSnapshot | null;
  version: number;
  deleted_at: string | null;
  purge_after: string | null;
  purge_expired: boolean;
  created_at: string;
  updated_at: string;
}

/** The sharing mode per topic, for the audit record (no content). */
function sharingByTopic(
  links: readonly { topicId: string; knowledgeSharing?: KnowledgeSharing | undefined }[],
): Record<string, KnowledgeSharing> {
  return Object.fromEntries(links.map((link) => [link.topicId, link.knowledgeSharing ?? 'none']));
}

interface LinkRow extends QueryResultRow {
  project_id: string;
  topic_id: string;
  code: string;
  title: string;
  priority: number;
  conflict_instruction: string | null;
  knowledge_sharing: KnowledgeSharing;
  archived: boolean;
  deleted: boolean;
}

const projectColumns = `
  id, workspace_id, code, title, description, initial_problem, expected_output, output_language, status, kind, analysis_profile,analysis_continuation_session_id,
  previous_status, current_stage, pause_reason, config_snapshot_id, cloned_from_id, origin_kind,
  origin_exploration_id, origin_candidate_key, origin_project_id, origin_solution_id,
  (select o.title from projects o where o.id = origin_project_id) as origin_project_title,
  (select s.title from solutions s where s.id = origin_solution_id) as origin_dimension_title,
  (select e.title from explorations e where e.id = origin_exploration_id) as origin_exploration_title,
  (select c.title from exploration_candidates c where c.candidate_key = origin_candidate_key
    order by c.version_no desc limit 1) as origin_candidate_title,
  approved_problem_version_id, problem_template_snapshot, problem_pattern_snapshot, version,
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
    private readonly business: BusinessService,
  ) {}

  async list(
    context: WorkspaceRequestContext,
    input: ListProjectsInput,
  ): Promise<{ items: readonly ProjectListItem[]; nextCursor: string | null }> {
    const status = input.status ?? 'current';
    // A cursor belongs to one set of filters: another filter starts a new list.
    const filters = [
      status,
      input.topicId ?? '',
      input.language ?? '',
      input.kind ?? '',
      input.updatedFrom ?? '',
      input.updatedTo ?? '',
      input.waiting ? 'waiting' : '',
      input.q ?? '',
    ].join('|');
    const scope = `${context.workspaceId}:projects:${createHash('sha256').update(filters).digest('hex').slice(0, 16)}`;
    const cursor = input.cursor
      ? decodeCursor(input.cursor, scope, 'PROJECT_CURSOR_INVALID')
      : null;
    return this.database.run(context, async (client) => {
      const params: unknown[] = [
        context.workspaceId,
        cursor?.at ?? null,
        cursor?.id ?? null,
        input.limit + 1,
      ];
      const conditions: string[] = [];
      const bind = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
      };
      if (status === 'current') conditions.push(`status <> 'deleted'`);
      else if (status !== 'all') conditions.push(`status = ${bind(status)}`);
      if (input.topicId)
        conditions.push(
          `exists (select 1 from project_topics pt where pt.project_id = projects.id and pt.topic_id = ${bind(input.topicId)}::uuid)`,
        );
      if (input.kind) conditions.push(`kind = ${bind(input.kind)}`);
      if (input.language) conditions.push(`output_language = ${bind(input.language)}::locale`);
      if (input.updatedFrom) conditions.push(`updated_at >= ${bind(input.updatedFrom)}::date`);
      if (input.updatedTo)
        conditions.push(`updated_at < (${bind(input.updatedTo)}::date + interval '1 day')`);
      if (input.waiting)
        conditions.push(
          `exists (select 1 from human_tasks h where h.project_id = projects.id and h.status = 'pending')`,
        );
      if (input.q) {
        const pattern = `%${input.q.replace(/[\\%_]/gu, (char) => `\\${char}`)}%`;
        const marker = bind(pattern);
        conditions.push(`(code ilike ${marker} or title ilike ${marker})`);
      }
      const result = await client.query<ProjectRow>(
        `select ${projectColumns}
           from projects
          where workspace_id = $1 ${conditions.map((condition) => `and ${condition}`).join(' ')}
            and ($2::timestamptz is null or (updated_at, id) < ($2::timestamptz, $3::uuid))
          order by updated_at desc, id desc
          limit $4`,
        params,
      );
      const rows = result.rows.slice(0, input.limit);
      const ids = rows.map((row) => row.id);
      const links = await this.loadLinks(client, context, ids);
      const shared = await this.loadShared(client, ids);
      const businesses = await this.loadBusinesses(client, ids);
      const owners = await client.query<{ id: string; owner_id: string; display_name: string }>(
        `select p.id, u.id as owner_id, u.display_name
           from projects p join users u on u.id = p.created_by where p.id = any($1::uuid[])`,
        [ids],
      );
      const waiting = await client.query<{
        project_id: string;
        kind: string;
        stage: string | null;
      }>(
        `select distinct on (h.project_id) h.project_id, h.kind, s.stage::text as stage
           from human_tasks h left join stage_runs s on s.id = h.stage_run_id
          where h.project_id = any($1::uuid[]) and h.status = 'pending'
          order by h.project_id, h.created_at desc`,
        [ids],
      );
      const ownerOf = new Map(owners.rows.map((row) => [row.id, row]));
      const waitingOf = new Map(waiting.rows.map((row) => [row.project_id, row]));
      const last = rows.at(-1);
      return {
        items: rows.map((row): ProjectListItem => {
          const owner = ownerOf.get(row.id);
          const task = waitingOf.get(row.id);
          return {
            ...this.toProject(
              row,
              links.get(row.id) ?? [],
              businesses.get(row.id) ?? null,
              shared.get(row.id) ?? [],
            ),
            owner: owner ? { id: owner.owner_id, displayName: owner.display_name } : null,
            waiting: task ? { kind: task.kind, stage: task.stage } : null,
          };
        }),
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

  async listPublishedProblemPatterns(context: WorkspaceRequestContext) {
    return this.database.run(context, async (client) => {
      const result = await client.query<{
        id: string;
        pattern_id: string;
        pattern_key: string;
        version: number;
        definition: ProblemPatternSnapshot['definition'];
        published_at: string;
      }>(
        `select distinct on (v.pattern_id)
                v.id, v.pattern_id, v.definition->>'key' as pattern_key, v.version, v.definition, v.published_at
           from problem_pattern_versions v
          where v.workspace_id = $1 and app.problem_pattern_is_selectable(v.pattern_id, v.workspace_id, false)
          order by v.pattern_id, v.version desc`,
        [context.workspaceId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        patternId: row.pattern_id,
        key: row.pattern_key,
        version: row.version,
        definition: row.definition,
        publishedAt: new Date(row.published_at).toISOString(),
      }));
    });
  }

  async setProblemPattern(
    context: WorkspaceRequestContext,
    projectId: string,
    expectedVersion: number,
    versionId: string | null,
  ): Promise<Project> {
    return this.database.run(context, async (client) => {
      const current = await this.load(client, context, projectId, true);
      this.assertVersion(current, expectedVersion);
      const started = await client.query(
        `select 1 from workflow_runs where project_id = $1 union all select 1 from project_meeting_revisions where project_id = $1 limit 1`,
        [projectId],
      );
      if (current.status !== 'draft' || started.rows.length)
        throw conflict(
          'PROJECT_PATTERN_LOCKED',
          'The pattern cannot change after preparation or execution starts.',
        );
      let snapshot: ProblemPatternSnapshot | null = null;
      if (versionId) {
        const result = await client.query<{
          pattern_id: string;
          workspace_id: string;
          version: number;
          definition: ProblemPatternSnapshot['definition'];
          published_at: string;
        }>(
          `select pattern_id,workspace_id,version,definition,to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as published_at from problem_pattern_versions where id=$1 and workspace_id=$2 and app.problem_pattern_is_selectable(pattern_id,workspace_id,true)`,
          [versionId, context.workspaceId],
        );
        const row = result.rows[0];
        if (!row)
          throw badRequest(
            'PROBLEM_PATTERN_VERSION_UNAVAILABLE',
            'The published pattern is unavailable.',
          );
        snapshot = {
          patternId: row.pattern_id,
          workspaceId: row.workspace_id,
          version: row.version,
          lifecycle: 'published',
          publishedAt: row.published_at,
          definition: row.definition,
        };
      }
      await client.query(
        `update projects set problem_pattern_snapshot=$3::jsonb, version=version+1 where id=$1 and workspace_id=$2`,
        [projectId, context.workspaceId, snapshot ? JSON.stringify(snapshot) : null],
      );
      await writeAudit(client, context, {
        action: 'project.pattern.update',
        targetType: 'project',
        targetId: projectId,
        projectId,
        after: {
          patternId: snapshot?.patternId ?? null,
          patternVersion: snapshot?.version ?? null,
        },
      });
      return this.read(client, context, projectId);
    });
  }

  async create(context: WorkspaceRequestContext, input: CreateProjectInput): Promise<Project> {
    // An exploration starts with the criteria that judge dimensions (ADR-0045).
    const criteria =
      input.solutionCriteria ?? (input.kind === 'exploration' ? EXPLORATION_CRITERIA : undefined);
    const criteriaIssue = criteria ? criteriaProblem(criteria) : null;
    if (criteriaIssue) throw badRequest('SOLUTION_CRITERIA_INVALID', criteriaIssue);
    const problemTemplate = input.problemTemplateId
      ? candidateProblemTemplates.find(({ id }) => id === input.problemTemplateId)
      : null;
    if (input.problemTemplateId && !problemTemplate) {
      throw badRequest('PROBLEM_TEMPLATE_UNKNOWN', 'Unknown candidate problem template.');
    }
    // Contenter is asked before the transaction opens, so a slow answer holds no database connection;
    // if it cannot answer, no project is created and the form can be sent again.
    const business: FetchedBusiness | null = input.businessId
      ? await this.business.fetchBusiness(context, input.businessId)
      : null;
    return this.database.run(context, async (client) => {
      await this.assertTopicsUsable(client, context, input.topics);
      const problemPattern = input.problemPatternVersionId
        ? (
            await client.query<{
              pattern_id: string;
              workspace_id: string;
              version: number;
              definition: ProblemPatternSnapshot['definition'];
              published_at: string;
            }>(
              `select v.pattern_id, v.workspace_id, v.version, v.definition,
                      to_char(v.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as published_at
                 from problem_pattern_versions v
                      where v.id = $1 and v.workspace_id = $2 and app.problem_pattern_is_selectable(v.pattern_id, v.workspace_id, true)`,
              [input.problemPatternVersionId, context.workspaceId],
            )
          ).rows[0]
        : null;
      if (input.problemPatternVersionId && !problemPattern) {
        throw badRequest(
          'PROBLEM_PATTERN_VERSION_UNAVAILABLE',
          'The selected published problem pattern is not available in this workspace.',
        );
      }
      const patternSnapshot: ProblemPatternSnapshot | null = problemPattern
        ? {
            patternId: problemPattern.pattern_id,
            workspaceId: problemPattern.workspace_id,
            version: problemPattern.version,
            lifecycle: 'published',
            publishedAt: problemPattern.published_at,
            definition: problemPattern.definition,
          }
        : null;
      // A project made from a candidate problem (ADR-0044): the candidate must exist in this
      // workspace and not be dropped. The exploration row is locked so two projects made at once
      // cannot both write the "promoted" decision.
      if (input.explorationCandidate && input.dimension) {
        throw badRequest(
          'PROJECT_ORIGIN_AMBIGUOUS',
          'A project comes from a candidate or from a dimension, not both.',
        );
      }
      const origin = input.explorationCandidate
        ? await this.lockCandidate(client, context, input.explorationCandidate)
        : null;
      const dimension = input.dimension
        ? await this.checkDimension(client, context, input.dimension)
        : null;
      let row: ProjectRow | undefined;
      try {
        const result = await client.query<ProjectRow>(
          `with inserted as (
             insert into projects (
               workspace_id, code, title, description, initial_problem, problem_template_snapshot,
               problem_pattern_snapshot,
               output_language, created_by, analysis_profile, expected_output,
               origin_exploration_id, origin_candidate_key, kind,
               origin_project_id, origin_solution_id
             ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             returning *
           )
           select ${projectColumns} from inserted`,
          [
            context.workspaceId,
            input.code,
            input.title,
            input.description,
            input.initialProblem,
            problemTemplate ? JSON.stringify(problemTemplate) : null,
            patternSnapshot ? JSON.stringify(patternSnapshot) : null,
            input.outputLanguage,
            context.actorId,
            input.analysisProfile ?? 'full',
            input.expectedOutput ?? '',
            origin?.explorationId ?? null,
            origin?.candidateKey ?? null,
            input.kind ?? 'standard',
            dimension?.projectId ?? null,
            dimension?.solutionId ?? null,
          ],
        );
        row = result.rows[0];
      } catch (error) {
        if (isUniqueViolation(error)) throw this.alreadyExists();
        throw error;
      }
      if (!row) throw new Error('Project insert did not return a row');
      if (origin) await this.markCandidatePromoted(client, context, origin, row.id);
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
      if (business) {
        await this.business.attach(
          client,
          context,
          row.id,
          business,
          'Set while creating the project',
        );
      }
      if (criteria) {
        const version = (
          await client.query<{ id: string }>(
            `insert into solution_criteria_versions (workspace_id, project_id, version_no, criteria, reason, created_by)
             values ($1, $2, 1, $3::jsonb, $4, $5) returning id`,
            [
              context.workspaceId,
              row.id,
              JSON.stringify(criteria),
              'Set while creating the project',
              context.actorId,
            ],
          )
        ).rows[0]!;
        await writeAudit(client, context, {
          action: 'solution.criteria_set',
          targetType: 'project',
          targetId: row.id,
          projectId: row.id,
          reason: 'Set while creating the project',
          after: { versionId: version.id, versionNo: 1, criteria },
        });
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
          ...(criteria ? { solutionCriteria: true } : {}),
          ...(business ? { businessId: business.content.business.externalId } : {}),
          ...(dimension
            ? {
                dimensionOrigin: {
                  projectId: dimension.projectId,
                  solutionId: dimension.solutionId,
                },
              }
            : {}),
          ...(origin
            ? {
                explorationOrigin: {
                  explorationId: origin.explorationId,
                  candidateKey: origin.candidateKey,
                },
              }
            : {}),
          ...(problemTemplate
            ? { problemTemplate: { id: problemTemplate.id, version: problemTemplate.version } }
            : {}),
          ...(patternSnapshot
            ? {
                problemPattern: {
                  patternId: patternSnapshot.patternId,
                  version: patternSnapshot.version,
                },
              }
            : {}),
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
      if (
        input.expectedOutput !== undefined &&
        input.expectedOutput !== current.expected_output &&
        current.status !== 'draft'
      ) {
        throw conflict(
          'PROJECT_EXPECTED_OUTPUT_LOCKED',
          'The expected output can only change while the project is a draft.',
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
                    output_language = $7, expected_output = $8, version = version + 1
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
            input.expectedOutput ?? current.expected_output,
          ],
        );
        updated = result.rows[0];
      } catch (error) {
        if (isUniqueViolation(error)) throw this.alreadyExists();
        throw error;
      }
      if (!updated) throw this.notFound();
      if (input.topics) await this.replaceLinks(client, context, projectId, input.topics);
      const previousShared = (await this.loadShared(client, [projectId])).get(projectId) ?? [];
      if (input.sharedKnowledgeIds) {
        await this.replaceShared(client, context, projectId, input.sharedKnowledgeIds);
      }
      await writeAudit(client, context, {
        action: 'project.update',
        targetType: 'project',
        targetId: projectId,
        projectId,
        reason: input.reason ?? null,
        before: {
          ...this.snapshot(current),
          topics: previousLinks.map((link) => link.topicId),
          knowledgeSharing: sharingByTopic(previousLinks),
          sharedKnowledgeIds: previousShared,
        },
        after: {
          ...this.snapshot(updated),
          topics: (input.topics ?? previousLinks).map((link) => link.topicId),
          knowledgeSharing: sharingByTopic(input.topics ?? previousLinks),
          sharedKnowledgeIds: input.sharedKnowledgeIds ?? previousShared,
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

  /** Continue the completed optional draft; old questions and documents retain their identities. */
  async continueFullAnalysis(
    context: WorkspaceRequestContext,
    projectId: string,
    input: ProjectCommandInput,
  ) {
    return this.database.run(context, async (client) => {
      const current = await this.load(client, context, projectId, true);
      this.assertVersion(current, input.expectedVersion);
      if (current.analysis_profile !== 'quick' || current.status !== 'completed')
        throw conflict(
          'QUICK_DRAFT_CONTINUATION_UNAVAILABLE',
          'Complete the quick draft workflow before continuing full analysis.',
        );
      if (!input.reason)
        throw badRequest('PROJECT_REASON_REQUIRED', 'A reason is required to continue analysis.');
      const prior = (
        await client.query<{ id: string }>(
          `select s.id from analysis_sessions s join stage_runs sr on sr.id=s.stage_run_id
          join workflow_runs r on r.id=sr.run_id
         where s.project_id=$1 and s.analysis_profile='quick' and r.status='completed'
           and sr.status='completed' and sr.latest_output_id=$2
         order by r.run_no desc limit 1`,
          [projectId, current.approved_problem_version_id],
        )
      ).rows[0];
      if (!prior)
        throw conflict(
          'QUICK_DRAFT_CONTINUATION_UNAVAILABLE',
          'The approved quick analysis is unavailable.',
        );
      const snapshot = await this.configService.snapshot(client, context, 'project', projectId);
      await client.query(
        `update projects set analysis_profile='full',analysis_continuation_session_id=$2,
         approved_problem_version_id=null,status='active',previous_status=null,current_stage='analysis',
         pause_reason=null,config_snapshot_id=$3,version=version+1,updated_at=now() where id=$1`,
        [projectId, prior.id, snapshot.id],
      );
      await writeAudit(client, context, {
        action: 'analysis.full_continued',
        targetType: 'project',
        targetId: projectId,
        projectId,
        reason: input.reason,
        before: {
          analysisProfile: 'quick',
          approvedProblemVersionId: current.approved_problem_version_id,
        },
        after: {
          analysisProfile: 'full',
          continuedFromSessionId: prior.id,
          minimumQuestions: 30,
          preservedQuestionIdentities: true,
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
      const kind = input.kind ?? 'copy';
      if (kind !== 'copy' && source.status !== 'completed') {
        throw conflict(
          'PROJECT_NOT_COMPLETED',
          'A continuation or a pivot can start only from a completed project.',
        );
      }
      if (kind === 'pivot' && !input.pivotProblem?.trim()) {
        throw badRequest('PROJECT_INVALID_REQUEST', 'A pivot needs its new direction.');
      }
      const links = (await this.loadLinks(client, context, [sourceId])).get(sourceId) ?? [];
      const usable = links.filter((link) => link.topicStatus === 'active');
      let row: ProjectRow | undefined;
      try {
        const result = await client.query<ProjectRow>(
          `with inserted as (
             insert into projects (
               workspace_id, code, title, description, initial_problem, output_language,
               created_by, cloned_from_id, origin_kind, problem_template_snapshot,
               problem_pattern_snapshot, expected_output, kind
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13)
             returning *
           )
           select ${projectColumns} from inserted`,
          [
            context.workspaceId,
            input.code,
            input.title ?? source.title,
            source.description,
            kind === 'pivot' ? input.pivotProblem!.trim() : source.initial_problem,
            source.output_language,
            context.actorId,
            sourceId,
            kind,
            source.problem_template_snapshot
              ? JSON.stringify(source.problem_template_snapshot)
              : null,
            source.problem_pattern_snapshot
              ? JSON.stringify(source.problem_pattern_snapshot)
              : null,
            // A pivot is a new direction: what the old problem was meant to give does not carry over.
            kind === 'pivot' ? '' : source.expected_output,
            // A copy or pivot of an exploration is an exploration (ADR-0045).
            source.kind,
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
      // The clone belongs to the same business, at the snapshot the original reads now.
      await this.business.copyLink(client, context, sourceId, row.id);
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
        after: {
          clonedFromId: sourceId,
          kind,
          copiedSettings: copied,
          topics: usable.length,
        },
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
    // A workspace or a topic can require every project to belong to a business (`business.required`).
    const config = await this.configService.resolve(client, context, 'project', project.id);
    if (
      config.values['business.required'] === true &&
      !(await this.business.hasLink(client, project.id))
    ) {
      problems.push('business_missing');
    }
    if (problems.length > 0) {
      throw conflict(
        'PROJECT_NOT_READY',
        'Add the problem, at least one active topic and, when the workspace requires it, a business before activating the project.',
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
      `insert into project_topics (workspace_id, project_id, topic_id, priority, conflict_instruction, knowledge_sharing)
       select $1, $2, link.topic_id, link.priority, link.conflict_instruction, link.knowledge_sharing
         from unnest($3::uuid[], $4::integer[], $5::text[], $6::text[])
           as link(topic_id, priority, conflict_instruction, knowledge_sharing)`,
      [
        context.workspaceId,
        projectId,
        topics.map((topic) => topic.topicId),
        topics.map((_, index) => index + 1),
        topics.map((topic) => topic.conflictInstruction ?? null),
        topics.map((topic) => topic.knowledgeSharing ?? 'none'),
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
    const business = (await this.loadBusinesses(client, [projectId])).get(projectId) ?? null;
    const shared = (await this.loadShared(client, [projectId])).get(projectId) ?? [];
    return this.toProject(row, links, business, shared);
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

  private async loadShared(
    client: PoolClient,
    projectIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const shared = new Map<string, string[]>();
    if (projectIds.length === 0) return shared;
    const result = await client.query<QueryResultRow & { project_id: string; item_id: string }>(
      `select project_id, item_id from project_shared_knowledge
        where project_id = any($1::uuid[]) order by project_id, created_at, item_id`,
      [projectIds],
    );
    for (const row of result.rows) {
      const list = shared.get(row.project_id) ?? [];
      list.push(row.item_id);
      shared.set(row.project_id, list);
    }
    return shared;
  }

  /** Replaces the shared list; only the project's own (project-scope) live knowledge qualifies. */
  private async replaceShared(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string,
    itemIds: readonly string[],
  ): Promise<void> {
    if (new Set(itemIds).size !== itemIds.length) {
      throw badRequest('PROJECT_SHARED_KNOWLEDGE_INVALID', 'List each knowledge item only once.');
    }
    if (itemIds.length > PROJECT_MAX_SHARED_KNOWLEDGE) {
      throw badRequest(
        'PROJECT_SHARED_KNOWLEDGE_INVALID',
        `Share at most ${PROJECT_MAX_SHARED_KNOWLEDGE} knowledge items.`,
      );
    }
    if (itemIds.length > 0) {
      const own = await client.query<QueryResultRow & { id: string }>(
        `select i.id from knowledge_items i
          where i.workspace_id = $1 and i.deleted_at is null and i.id = any($3::uuid[])
            and exists (select 1 from knowledge_scopes s
                         where s.item_id = i.id and s.scope_type = 'project' and s.scope_id = $2)`,
        [context.workspaceId, projectId, itemIds],
      );
      const found = new Set(own.rows.map((row) => row.id));
      const unusable = itemIds.filter((id) => !found.has(id));
      if (unusable.length > 0) {
        throw conflict(
          'PROJECT_SHARED_KNOWLEDGE_INVALID',
          'Only the knowledge of this project can be shared.',
          { itemIds: unusable },
        );
      }
    }
    await client.query('delete from project_shared_knowledge where project_id = $1', [projectId]);
    if (itemIds.length === 0) return;
    await client.query(
      `insert into project_shared_knowledge (workspace_id, project_id, item_id)
       select $1, $2, unnest($3::uuid[])`,
      [context.workspaceId, projectId, itemIds],
    );
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
              pt.knowledge_sharing, t.archived_at is not null as archived, t.deleted_at is not null as deleted
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
        knowledgeSharing: row.knowledge_sharing,
        topicStatus: row.deleted ? 'deleted' : row.archived ? 'archived' : 'active',
      });
      links.set(row.project_id, list);
    }
    return links;
  }

  private async loadBusinesses(
    client: PoolClient,
    projectIds: readonly string[],
  ): Promise<Map<string, ProjectBusiness>> {
    const result = new Map<string, ProjectBusiness>();
    if (projectIds.length === 0) return result;
    const rows = await client.query<{
      project_id: string;
      external_business_id: string;
      name: string;
    }>(
      `select project_id, external_business_id, name from project_businesses where project_id = any($1::uuid[])`,
      [projectIds],
    );
    for (const row of rows.rows) {
      result.set(row.project_id, { externalBusinessId: row.external_business_id, name: row.name });
    }
    return result;
  }

  private assertVersion(row: ProjectRow, expectedVersion: number): void {
    if (row.version !== expectedVersion) {
      throw preconditionFailed(
        'PROJECT_VERSION_CONFLICT',
        'The project changed since you loaded it. Reload and try again.',
      );
    }
  }

  /**
   * A dimension is a solution of an exploration project that its selection chose. The exploration
   * project is locked so a project made now cannot race a new selection (ADR-0045 step E).
   */
  private async checkDimension(
    client: PoolClient,
    context: WorkspaceRequestContext,
    ref: { projectId: string; solutionId: string },
  ): Promise<{ projectId: string; solutionId: string }> {
    const source = (
      await client.query<{ id: string }>(
        `select id from projects
          where id = $1 and workspace_id = $2 and kind = 'exploration' and deleted_at is null
          for share`,
        [ref.projectId, context.workspaceId],
      )
    ).rows[0];
    const solution = source
      ? (
          await client.query<{ id: string }>(
            `select id from solutions where id = $1 and project_id = $2 and workspace_id = $3`,
            [ref.solutionId, ref.projectId, context.workspaceId],
          )
        ).rows[0]
      : undefined;
    if (!source || !solution) {
      throw notFound('DIMENSION_NOT_FOUND', 'The dimension of the exploration was not found.');
    }
    const selected = (
      await client.query<{ selected: { solutionId: string }[] }>(
        `select selected from solution_selections where project_id = $1
          order by created_at desc, id desc limit 1`,
        [ref.projectId],
      )
    ).rows[0]?.selected;
    if (!selected?.some((item) => item.solutionId === ref.solutionId)) {
      throw conflict(
        'DIMENSION_NOT_SELECTED',
        'Select the dimension in the exploration before making a project from it.',
      );
    }
    return ref;
  }

  /** Finds the candidate a project is made from and locks its exploration; refuses a dropped one. */
  private async lockCandidate(
    client: PoolClient,
    context: WorkspaceRequestContext,
    ref: { explorationId: string; candidateKey: string },
  ): Promise<{ explorationId: string; candidateKey: string; state: string }> {
    const locked = await client.query(
      `select 1 from explorations where id = $1 and workspace_id = $2 for update`,
      [ref.explorationId, context.workspaceId],
    );
    const candidate = locked.rowCount
      ? (
          await client.query<{ state: string }>(
            `select coalesce((select d.decision from exploration_candidate_decisions d
                               where d.exploration_id = c.exploration_id and d.candidate_key = c.candidate_key
                               order by d.created_at desc, d.id desc limit 1), 'proposed') as state
               from exploration_candidates c
              where c.exploration_id = $1 and c.workspace_id = $2 and c.candidate_key = $3
              limit 1`,
            [ref.explorationId, context.workspaceId, ref.candidateKey],
          )
        ).rows[0]
      : undefined;
    if (!candidate) {
      throw notFound('EXPLORATION_CANDIDATE_NOT_FOUND', 'The candidate problem was not found.');
    }
    if (candidate.state === 'dropped') {
      throw conflict(
        'EXPLORATION_CANDIDATE_DROPPED',
        'Bring the dropped candidate back before making a project from it.',
      );
    }
    return { ...ref, state: candidate.state };
  }

  /** The candidate becomes "promoted" once; a second project from it adds no second decision. */
  private async markCandidatePromoted(
    client: PoolClient,
    context: WorkspaceRequestContext,
    origin: { explorationId: string; candidateKey: string; state: string },
    projectId: string,
  ): Promise<void> {
    if (origin.state !== 'promoted') {
      await client.query(
        `insert into exploration_candidate_decisions
           (workspace_id, exploration_id, candidate_key, decision, reason, decided_by)
         values ($1, $2, $3, 'promoted', '', $4)`,
        [context.workspaceId, origin.explorationId, origin.candidateKey, context.actorId],
      );
    }
    await client.query(`update explorations set updated_at = now() where id = $1`, [
      origin.explorationId,
    ]);
    await writeAudit(client, context, {
      action: 'exploration.candidate_promoted',
      targetType: 'exploration',
      targetId: origin.explorationId,
      projectId,
      after: {
        candidateKey: origin.candidateKey,
        projectId,
        firstProject: origin.state !== 'promoted',
      },
    });
  }

  private snapshot(row: ProjectRow): Record<string, unknown> {
    return {
      kind: row.kind,
      analysisProfile: row.analysis_profile,
      code: row.code,
      title: row.title,
      description: row.description,
      initialProblem: row.initial_problem,
      expectedOutput: row.expected_output,
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

  private toProject(
    row: ProjectRow,
    topics: readonly ProjectTopicLink[],
    business: ProjectBusiness | null,
    sharedKnowledgeIds: readonly string[],
  ): Project {
    return {
      kind: row.kind,
      analysisProfile: row.analysis_profile,
      id: row.id,
      workspaceId: row.workspace_id,
      code: row.code,
      title: row.title,
      description: row.description,
      initialProblem: row.initial_problem,
      expectedOutput: row.expected_output,
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
      sharedKnowledgeIds,
      business,
      problemTemplate: row.problem_template_snapshot,
      problemPattern: row.problem_pattern_snapshot,
      configSnapshotId: row.config_snapshot_id,
      approvedProblemVersionId: row.approved_problem_version_id,
      clonedFromId: row.cloned_from_id,
      originKind: row.origin_kind,
      dimensionOrigin:
        row.origin_project_id && row.origin_solution_id
          ? {
              projectId: row.origin_project_id,
              projectTitle: row.origin_project_title,
              solutionId: row.origin_solution_id,
              dimensionTitle: row.origin_dimension_title,
            }
          : null,
      explorationOrigin:
        row.origin_exploration_id && row.origin_candidate_key
          ? {
              explorationId: row.origin_exploration_id,
              candidateKey: row.origin_candidate_key,
              explorationTitle: row.origin_exploration_title,
              candidateTitle: row.origin_candidate_title,
            }
          : null,
      version: row.version,
      deletedAt: row.deleted_at,
      purgeAfter: row.purge_after,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
