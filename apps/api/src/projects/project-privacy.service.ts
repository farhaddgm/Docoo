import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { parsePrivacyPolicy, type PrivacyPolicy } from '@docoo/providers';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { writeAudit } from '../common/audit.js';

/** The privacy policy of a project: what happens to private values before a model call (ADR-0059). */
@Injectable()
export class ProjectPrivacyService {
  constructor(@Inject(WorkspaceDatabase) private readonly database: WorkspaceDatabase) {}

  get(context: WorkspaceRequestContext, projectId: string): Promise<PrivacyPolicy> {
    return this.database.run(context, async (client) => {
      const row = (
        await client.query<{ privacy_mode: string; privacy_blocked_words: string[] }>(
          `select privacy_mode, privacy_blocked_words from projects
            where workspace_id = $1 and id = $2 and deleted_at is null`,
          [context.workspaceId, projectId],
        )
      ).rows[0];
      if (!row) throw new NotFoundException('The project was not found.');
      return parsePrivacyPolicy(row.privacy_mode, row.privacy_blocked_words);
    });
  }

  set(
    context: WorkspaceRequestContext,
    projectId: string,
    policy: PrivacyPolicy,
  ): Promise<PrivacyPolicy> {
    return this.database.run(context, async (client) => {
      const before = (
        await client.query<{ privacy_mode: string; privacy_blocked_words: string[] }>(
          `select privacy_mode, privacy_blocked_words from projects
            where workspace_id = $1 and id = $2 and deleted_at is null for update`,
          [context.workspaceId, projectId],
        )
      ).rows[0];
      if (!before) throw new NotFoundException('The project was not found.');
      await client.query(
        `update projects set privacy_mode = $3, privacy_blocked_words = $4
          where workspace_id = $1 and id = $2`,
        [context.workspaceId, projectId, policy.mode, policy.blockedWords],
      );
      // The audit trail keeps the mode and how many words, never the words (they can name a client).
      await writeAudit(client, context, {
        action: 'project.privacy.update',
        targetType: 'project',
        targetId: projectId,
        projectId,
        severity: policy.mode === 'off' ? 'warning' : 'info',
        securityRelevant: true,
        before: {
          privacyMode: before.privacy_mode,
          blockedWordCount: before.privacy_blocked_words.length,
        },
        after: { privacyMode: policy.mode, blockedWordCount: policy.blockedWords.length },
      });
      return policy;
    });
  }
}
