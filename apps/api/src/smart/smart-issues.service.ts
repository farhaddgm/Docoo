import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import { decodeCursor, encodeCursor, isoColumn } from '../common/pagination.js';
import { conflict, notFound } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { issueTitle } from './smart-prompts.js';

export type IssueStatus = 'open' | 'in_progress' | 'fixed' | 'wont_fix';

export interface IssueFilters {
  readonly status?: IssueStatus | undefined;
  readonly search?: string | undefined;
}

export interface IssuePatch {
  readonly status?: IssueStatus | undefined;
  readonly title?: string | undefined;
  readonly note?: string | undefined;
}

interface IssueRow extends QueryResultRow {
  id: string;
  title: string;
  body?: string;
  status: IssueStatus;
  note: string;
  context?: unknown;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

const listColumns = `id, title, status, note, source_message_id,
  ${isoColumn('created_at', 'created_at')}, ${isoColumn('updated_at', 'updated_at')}`;

function toIssue(row: IssueRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    note: row.note,
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.body !== undefined ? { body: row.body } : {}),
    ...(row.context !== undefined ? { context: row.context } : {}),
  };
}

/** The admin's bug ledger: Smart answers saved verbatim, one record per message (SMT-002). */
@Injectable()
export class SmartIssuesService {
  constructor(private readonly database: WorkspaceDatabase) {}

  /** Saves the exact text of an assistant message; saving it again returns the same record. */
  async saveFromMessage(context: WorkspaceRequestContext, messageId: string) {
    return this.database.run(context, async (client) => {
      const message = (
        await client.query<{
          content: string;
          role: string;
          status: string;
          context: Record<string, unknown>;
          kind: string;
          error_id: string | null;
        }>(
          `select m.content, m.role, m.status, m.context, c.kind, c.error_id
             from smart_messages m join smart_conversations c on c.id = m.conversation_id
            where m.id = $1`,
          [messageId],
        )
      ).rows[0];
      if (!message) throw notFound('SMART_MESSAGE_NOT_FOUND', 'The message was not found.');
      if (message.role !== 'assistant' || message.status !== 'done') {
        throw conflict('SMART_MESSAGE_NOT_SAVABLE', 'Only a finished Smart answer can be saved.');
      }
      const inserted = await client.query<IssueRow>(
        `insert into walker_issues (workspace_id, title, body, context, source_message_id, created_by)
         values ($1, $2, $3, $4::jsonb, $5, $6)
         on conflict (workspace_id, source_message_id) do nothing
         returning id, title, body, status, note, context, source_message_id,
                   ${isoColumn('created_at', 'created_at')}, ${isoColumn('updated_at', 'updated_at')}`,
        [
          context.workspaceId,
          issueTitle(message.content),
          message.content,
          JSON.stringify({
            ...message.context,
            conversationKind: message.kind,
            errorId: message.error_id,
          }),
          messageId,
          context.actorId,
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        const existing = await this.load(client, undefined, messageId);
        return { issue: toIssue(existing), created: false };
      }
      await writeAudit(client, context, {
        action: 'smart.issue_saved',
        targetType: 'walker_issue',
        targetId: row.id,
        after: { status: row.status, sourceMessageId: messageId },
      });
      return { issue: toIssue(row), created: true };
    });
  }

  async list(
    context: WorkspaceRequestContext,
    filters: IssueFilters,
    page: { limit: number; cursor?: string | undefined },
  ) {
    const scope = `${context.workspaceId}:smart-issues:${JSON.stringify(filters)}`;
    const cursor = page.cursor ? decodeCursor(page.cursor, scope, 'SMART_CURSOR_INVALID') : null;
    return this.database.run(context, async (client) => {
      const params: unknown[] = [];
      const conditions: string[] = [];
      if (filters.status) {
        params.push(filters.status);
        conditions.push(`status = $${params.length}`);
      }
      if (filters.search) {
        params.push(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`);
        conditions.push(
          `(title ilike $${params.length} escape '\\' or body ilike $${params.length} escape '\\')`,
        );
      }
      if (cursor) {
        params.push(cursor.at, cursor.id);
        conditions.push(
          `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      params.push(page.limit + 1);
      const rows = (
        await client.query<IssueRow>(
          `select ${listColumns} from walker_issues
            ${conditions.length ? `where ${conditions.join(' and ')}` : ''}
            order by created_at desc, id desc limit $${params.length}`,
          params,
        )
      ).rows;
      const visible = rows.slice(0, page.limit);
      const last = visible.at(-1);
      return {
        items: visible.map(toIssue),
        nextCursor:
          rows.length > page.limit && last ? encodeCursor(scope, last.created_at, last.id) : null,
      };
    });
  }

  async get(context: WorkspaceRequestContext, id: string) {
    return this.database.run(context, async (client) => ({
      issue: toIssue(await this.load(client, id)),
    }));
  }

  async update(context: WorkspaceRequestContext, id: string, patch: IssuePatch) {
    return this.database.run(context, async (client) => {
      const before = await this.load(client, id);
      await client.query(
        `update walker_issues
            set status = coalesce($2::walker_issue_status, status),
                title = coalesce($3, title),
                note = coalesce($4, note)
          where id = $1`,
        [id, patch.status ?? null, patch.title ?? null, patch.note ?? null],
      );
      await writeAudit(client, context, {
        action: 'smart.issue_updated',
        targetType: 'walker_issue',
        targetId: id,
        before: { status: before.status },
        after: {
          status: patch.status ?? before.status,
          changed: Object.entries(patch)
            .filter(([, value]) => value !== undefined)
            .map(([key]) => key),
        },
      });
      return { issue: toIssue(await this.load(client, id)) };
    });
  }

  async remove(context: WorkspaceRequestContext, id: string) {
    return this.database.run(context, async (client) => {
      const before = await this.load(client, id);
      await client.query('delete from walker_issues where id = $1', [id]);
      await writeAudit(client, context, {
        action: 'smart.issue_deleted',
        targetType: 'walker_issue',
        targetId: id,
        before: { status: before.status },
      });
    });
  }

  private async load(
    client: PoolClient,
    id: string | undefined,
    messageId?: string,
  ): Promise<IssueRow> {
    const row = (
      await client.query<IssueRow>(
        `select ${listColumns}, body, context from walker_issues
          where ${messageId ? 'source_message_id' : 'id'} = $1`,
        [messageId ?? id],
      )
    ).rows[0];
    if (!row) throw notFound('SMART_ISSUE_NOT_FOUND', 'The issue was not found.');
    return row;
  }
}
