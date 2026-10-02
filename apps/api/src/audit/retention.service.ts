import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';

export interface PurgeResult {
  readonly dryRun: boolean;
  readonly projectIds: readonly string[];
  readonly topicIds: readonly string[];
  /** Expired topics still referenced by a (deleted) project; purged with that project later. */
  readonly blockedTopicIds: readonly string[];
}

/**
 * Permanently removes soft-deleted projects and topics whose recovery window ended.
 * Each purge leaves a minimal audit tombstone (FR-AUD-005, FR-PRJ-005).
 */
@Injectable()
export class RetentionService {
  constructor(private readonly database: WorkspaceDatabase) {}

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
          },
        });
      }
      return { dryRun, projectIds, topicIds, blockedTopicIds };
    });
  }
}
