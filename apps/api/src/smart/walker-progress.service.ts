import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { notFound } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';
import { evaluateWalker, type WalkerFacts, type WalkerProgress } from './walker-steps.js';

export interface WalkerProgressResult extends WalkerProgress {
  readonly projectId: string | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Reads the facts the walker needs and lets {@link evaluateWalker} decide (SMT-004). */
@Injectable()
export class WalkerProgressService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly config: ConfigService,
  ) {}

  progress(
    context: WorkspaceRequestContext,
    projectId: string | null,
  ): Promise<WalkerProgressResult> {
    return this.database.run(context, (client) => this.progressIn(client, context, projectId));
  }

  /** Same as {@link progress} inside an open tenant transaction (used by the chat context). */
  async progressIn(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string | null,
  ): Promise<WalkerProgressResult> {
    const facts = await this.facts(client, context, projectId);
    return { projectId, ...evaluateWalker(facts) };
  }

  private async facts(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string | null,
  ): Promise<WalkerFacts> {
    const workspace = (
      await client.query<{
        healthy: number;
        total: number;
        topics: number;
        sources: number;
        knowledge: number;
        projects: number;
      }>(
        `select
           (select count(*)::int from provider_connections
             where disabled_at is null and status in ('healthy', 'degraded')) as healthy,
           (select count(*)::int from provider_connections where disabled_at is null) as total,
           (select count(*)::int from topics where archived_at is null and deleted_at is null) as topics,
           (select count(*)::int from source_assets a
              join source_versions v on v.id = a.current_version_id
             where a.deleted_at is null and v.status = 'indexed') as sources,
           (select count(*)::int from knowledge_items i
              join knowledge_versions v on v.id = i.current_version_id
             where i.deleted_at is null and v.status = 'approved') as knowledge,
           (select count(*)::int from projects where deleted_at is null) as projects`,
      )
    ).rows[0]!;
    const effective = await this.config.resolve(
      client,
      context,
      projectId ? 'project' : 'workspace',
      projectId ?? context.workspaceId,
    );
    return {
      providers: { healthy: workspace.healthy, total: workspace.total },
      aiConfigured:
        text(effective.values['ai.connection_id']) !== '' &&
        text(effective.values['ai.model']) !== '',
      topics: workspace.topics,
      indexedSources: workspace.sources,
      approvedKnowledge: workspace.knowledge,
      projects: workspace.projects,
      project: projectId ? await this.projectFacts(client, projectId) : null,
    };
  }

  private async projectFacts(
    client: PoolClient,
    projectId: string,
  ): Promise<NonNullable<WalkerFacts['project']>> {
    const row = (
      await client.query<{
        status: string;
        completed: number;
        pending: number;
        selections: number;
        documents: number;
        approved: number;
        passed: number;
        brain: number;
      }>(
        `select p.status::text as status,
           (select count(*)::int from stage_runs s
             where s.status = 'completed'
               and s.run_id = (select id from workflow_runs where project_id = p.id
                                order by run_no desc limit 1)) as completed,
           (select count(*)::int from human_tasks where project_id = p.id and status = 'pending') as pending,
           (select count(*)::int from solution_selections where project_id = p.id) as selections,
           (select count(*)::int from documents where project_id = p.id) as documents,
           (select count(*)::int from documents
             where project_id = p.id and status in ('approved', 'locked')) as approved,
           (select count(distinct e.document_id)::int from evaluations e
              join documents d on d.id = e.document_id
             where d.project_id = p.id and e.status = 'passed') as passed,
           (select count(*)::int from brain_reports
             where scope = 'workspace' or project_id = p.id) as brain
         from projects p where p.id = $1 and p.deleted_at is null`,
        [projectId],
      )
    ).rows[0];
    if (!row) throw notFound('SMART_PROJECT_NOT_FOUND', 'The project was not found.');
    return {
      status: row.status,
      completedStages: row.completed,
      pendingTasks: row.pending,
      selections: row.selections,
      documents: row.documents,
      approvedDocuments: row.approved,
      passedEvaluations: row.passed,
      brainReports: row.brain,
    };
  }
}
