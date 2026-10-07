import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { writeAudit } from '../common/audit.js';
import { decodeCursor, encodeCursor, isoColumn, listScope } from '../common/pagination.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';

export interface NotificationItem {
  id: string;
  kind: string;
  projectId: string | null;
  project: { code: string; title: string } | null;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
  /** For a task that waited for the administrator: whether it is still waiting. */
  stillWaiting: boolean | null;
}

const columns = `n.id, n.kind, n.project_id as "projectId", n.payload, ${isoColumn('n.created_at', '"createdAt"')},
  ${isoColumn('n.read_at', '"readAt"')}, p.code as "projectCode", p.title as "projectTitle",
  case when t.id is null then null else t.status = 'pending' end as "stillWaiting"`;

const from = `from notifications n
  left join projects p on p.id = n.project_id
  left join human_tasks t on t.id = n.ref_id and n.kind not in ('run_completed', 'writing_succeeded', 'writing_failed')`;

interface Row extends NotificationItem {
  projectCode: string | null;
  projectTitle: string | null;
}

const toItem = (row: Row): NotificationItem => ({
  id: row.id,
  kind: row.kind,
  projectId: row.projectId,
  project:
    row.projectCode !== null ? { code: row.projectCode, title: row.projectTitle ?? '' } : null,
  payload: row.payload,
  createdAt: row.createdAt,
  readAt: row.readAt,
  stillWaiting: row.stillWaiting,
});

/** What needs the administrator's attention, and what finished (ADR-0025). */
@Injectable()
export class NotificationsService {
  constructor(private readonly database: WorkspaceDatabase) {}

  /** The number of unread notifications, for the bell in the header. */
  async summary(context: WorkspaceRequestContext) {
    return this.database.run(context, async (client) => {
      const row = (
        await client.query<{ unread: string }>(
          'select count(*) as unread from notifications where read_at is null',
        )
      ).rows[0]!;
      return { unread: Number(row.unread) };
    });
  }

  async list(
    context: WorkspaceRequestContext,
    input: { status: 'unread' | 'all'; limit: number; cursor?: string | undefined },
  ) {
    return this.database.run(context, async (client) => {
      const scope = listScope(`notifications:${context.workspaceId}`, { status: input.status });
      const after = input.cursor
        ? decodeCursor(input.cursor, scope, 'NOTIFICATION_CURSOR_INVALID')
        : null;
      const rows = (
        await client.query<Row>(
          `select ${columns} ${from}
            where ($1::text = 'all' or n.read_at is null)
              and ($2::timestamptz is null or (n.created_at, n.id) < ($2::timestamptz, $3::uuid))
            order by n.created_at desc, n.id desc limit $4`,
          [input.status, after?.at ?? null, after?.id ?? null, input.limit + 1],
        )
      ).rows;
      const page = rows.slice(0, input.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toItem),
        nextCursor:
          rows.length > input.limit && last ? encodeCursor(scope, last.createdAt, last.id) : null,
      };
    });
  }

  /** Marks one notification read; reading twice changes nothing. */
  async markRead(context: WorkspaceRequestContext, id: string) {
    return this.database.run(context, async (client) => {
      const updated = await client.query(
        `update notifications set read_at = now(), read_by = $2 where id = $1 and read_at is null`,
        [id, context.actorId],
      );
      const exists = updated.rowCount
        ? true
        : Boolean((await client.query('select 1 from notifications where id = $1', [id])).rowCount);
      return { found: exists };
    });
  }

  async markAllRead(context: WorkspaceRequestContext) {
    return this.database.run(context, async (client: PoolClient) => {
      const updated = await client.query(
        `update notifications set read_at = now(), read_by = $1 where read_at is null`,
        [context.actorId],
      );
      const marked = updated.rowCount ?? 0;
      if (marked > 0) {
        await writeAudit(client, context, {
          action: 'notification.read_all',
          targetType: 'workspace',
          targetId: context.workspaceId,
          after: { marked },
        });
      }
      return { marked };
    });
  }
}
