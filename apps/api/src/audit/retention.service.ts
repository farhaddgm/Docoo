import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';

export interface PurgeResult {
  readonly dryRun: boolean;
  readonly projectIds: readonly string[];
  readonly topicIds: readonly string[];
  /** Expired topics still referenced by a (deleted) project; purged with that project later. */
  readonly blockedTopicIds: readonly string[];
  /** Closed error-log entries not seen for `retention.app_errors_days`. */
  readonly appErrors: number;
}

/**
 * Permanently removes soft-deleted projects and topics whose recovery window ended, and closed
 * entries of the Smart error log that are older than the retention setting.
 * Each purge leaves a minimal audit tombstone (FR-AUD-005, FR-PRJ-005).
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly config: ConfigService,
  ) {}

  async purge(
    context: WorkspaceRequestContext,
    reason: string,
    dryRun: boolean,
  ): Promise<PurgeResult> {
    return this.database.run(context, async (client) => {
      await client.query("select set_config('app.retention_purge', 'on', true)");
      const projects = await client.query<{ id: string } & QueryResultRow>(
        `select id from projects
          where workspace_id = $1 and status = 'deleted' and purge_after <= now()
          order by purge_after
          for update`,
        [context.workspaceId],
      );
      const projectIds = projects.rows.map((row) => row.id);
      if (!dryRun && projectIds.length > 0) {
        await client.query(
          'delete from projects where workspace_id = $1 and id = any($2::uuid[])',
          [context.workspaceId, projectIds],
        );
      }

      const topics = await client.query<{ id: string; referenced: boolean } & QueryResultRow>(
        `select t.id, exists (
                  select 1 from project_topics pt
                   where pt.workspace_id = t.workspace_id and pt.topic_id = t.id
                ) as referenced
           from topics t
          where t.workspace_id = $1 and t.deleted_at is not null and t.purge_after <= now()
          order by t.purge_after
          for update`,
        [context.workspaceId],
      );
      const topicIds = topics.rows.filter((row) => !row.referenced).map((row) => row.id);
      const blockedTopicIds = topics.rows.filter((row) => row.referenced).map((row) => row.id);
      if (!dryRun && topicIds.length > 0) {
        await client.query('delete from topics where workspace_id = $1 and id = any($2::uuid[])', [
          context.workspaceId,
          topicIds,
        ]);
      }

      const effective = await this.config.resolve(
        client,
        context,
        'workspace',
        context.workspaceId,
      );
      const rawDays = effective.values['retention.app_errors_days'];
      const days = typeof rawDays === 'number' && rawDays >= 7 ? Math.floor(rawDays) : 90;
      const errors = await client.query<{ id: string } & QueryResultRow>(
        `select id from app_errors
          where workspace_id = $1 and status in ('fixed', 'ignored')
            and last_seen_at < now() - make_interval(days => $2)
          for update`,
        [context.workspaceId, days],
      );
      const appErrors = errors.rows.length;
      if (!dryRun && appErrors > 0) {
        await client.query(
          'delete from app_errors where workspace_id = $1 and id = any($2::uuid[])',
          [context.workspaceId, errors.rows.map((row) => row.id)],
        );
      }

      if (!dryRun) {
        for (const id of projectIds) {
          await writeAudit(client, context, {
            action: 'project.purge',
            targetType: 'project',
            targetId: id,
            projectId: id,
            reason,
            severity: 'critical',
            securityRelevant: true,
            after: { purged: true },
          });
        }
        for (const id of topicIds) {
          await writeAudit(client, context, {
            action: 'topic.purge',
            targetType: 'topic',
            targetId: id,
            reason,
            severity: 'critical',
            securityRelevant: true,
            after: { purged: true },
          });
        }
        await writeAudit(client, context, {
          action: 'retention.purge',
          targetType: 'workspace',
          targetId: context.workspaceId,
          reason,
          severity: 'critical',
          securityRelevant: true,
          after: {
            projects: projectIds.length,
            topics: topicIds.length,
            blockedTopics: blockedTopicIds.length,
            appErrors,
          },
        });
      }
      return { dryRun, projectIds, topicIds, blockedTopicIds, appErrors };
    });
  }
}
