import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import { decodeCursor, encodeCursor, isoColumn } from '../common/pagination.js';
import { notFound } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import {
  categorize,
  fingerprint,
  sanitize,
  scrubMessage,
  scrubStack,
  type ClientErrorKind,
  type ErrorCategory,
  type ErrorSource,
} from './error-classifier.js';

export type ErrorStatus = 'new' | 'seen' | 'fixed' | 'ignored';

export interface RecordErrorInput {
  readonly source: ErrorSource;
  readonly message: string;
  readonly status?: number | null | undefined;
  readonly kind?: ClientErrorKind | undefined;
  readonly method?: string | null | undefined;
  /** Route pattern on the server, request path on the client. */
  readonly route?: string | null | undefined;
  readonly page?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
  readonly stack?: string | null | undefined;
  readonly context?: unknown;
}

export interface ErrorFilters {
  readonly status?: ErrorStatus | undefined;
  readonly source?: ErrorSource | undefined;
  readonly category?: ErrorCategory | undefined;
  readonly search?: string | undefined;
}

interface ErrorRow extends QueryResultRow {
  id: string;
  source: ErrorSource;
  category: ErrorCategory;
  status: ErrorStatus;
  message: string;
  occurrences: number;
  http_method: string | null;
  route: string | null;
  http_status: number | null;
  page: string | null;
  project_id: string | null;
  correlation_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  stack?: string | null;
  context?: unknown;
}

const summaryColumns = `
  id, source, category, status, message, occurrences, http_method, route, http_status, page,
  project_id, correlation_id, ${isoColumn('first_seen_at', 'first_seen_at')},
  ${isoColumn('last_seen_at', 'last_seen_at')}`;

function toError(row: ErrorRow) {
  return {
    id: row.id,
    source: row.source,
    category: row.category,
    status: row.status,
    message: row.message,
    occurrences: row.occurrences,
    method: row.http_method,
    route: row.route,
    httpStatus: row.http_status,
    page: row.page,
    projectId: row.project_id,
    correlationId: row.correlation_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    ...(row.stack !== undefined ? { stack: row.stack } : {}),
    ...(row.context !== undefined ? { context: row.context } : {}),
  };
}

export type SmartError = ReturnType<typeof toError>;

/** Records, groups and triages errors of the workspace (SMT-001). Never stores request bodies. */
@Injectable()
export class SmartErrorsService {
  constructor(private readonly database: WorkspaceDatabase) {}

  /**
   * Stores one occurrence. Equal fingerprints share a row whose counter grows; a recurrence of
   * a `fixed` error re-opens it, an `ignored` one stays ignored.
   */
  async record(
    context: WorkspaceRequestContext,
    input: RecordErrorInput,
  ): Promise<{ id: string; category: ErrorCategory }> {
    const message = scrubMessage(input.message) || 'Unknown error';
    const category = categorize({
      source: input.source,
      message,
      status: input.status,
      kind: input.kind,
    });
    const route = input.route ?? null;
    const key = fingerprint({
      source: input.source,
      category,
      method: input.method,
      route,
      message,
    });
    return this.database.run(context, async (client) => {
      const row = (
        await client.query<{ id: string; category: ErrorCategory }>(
          `insert into app_errors (workspace_id, source, category, fingerprint, message, http_method, route,
                                   http_status, page, project_id, correlation_id, stack, context)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, (select id from projects where id = $10::uuid), $11, $12, $13::jsonb)
           on conflict (workspace_id, fingerprint) do update
             set occurrences = app_errors.occurrences + 1,
                 last_seen_at = now(),
                 status = case when app_errors.status = 'fixed' then 'new'::app_error_status else app_errors.status end,
                 http_status = excluded.http_status,
                 page = excluded.page,
                 project_id = excluded.project_id,
                 correlation_id = excluded.correlation_id,
                 stack = coalesce(excluded.stack, app_errors.stack),
                 context = excluded.context
           returning id, category`,
          [
            context.workspaceId,
            input.source,
            category,
            key,
            message,
            input.method ? input.method.toUpperCase().slice(0, 10) : null,
            route ? route.slice(0, 300) : null,
            input.status ?? null,
            input.page ? input.page.slice(0, 300) : null,
            input.projectId ?? null,
            input.correlationId ?? null,
            scrubStack(input.stack),
            JSON.stringify(sanitize(input.context ?? {})),
          ],
        )
      ).rows[0]!;
      return row;
    });
  }

  async list(
    context: WorkspaceRequestContext,
    filters: ErrorFilters,
    page: { limit: number; cursor?: string | undefined },
  ) {
    const scope = `${context.workspaceId}:smart-errors:${JSON.stringify(filters)}`;
    const cursor = page.cursor ? decodeCursor(page.cursor, scope, 'SMART_CURSOR_INVALID') : null;
    return this.database.run(context, async (client) => {
      const params: unknown[] = [];
      const conditions: string[] = [];
      const add = (sql: string, value: unknown) => {
        params.push(value);
        conditions.push(sql.replaceAll('?', `$${params.length}`));
      };
      if (filters.status) add('status = ?', filters.status);
      if (filters.source) add('source = ?', filters.source);
      if (filters.category) add('category = ?', filters.category);
      if (filters.search) {
        add(
          "(message ilike ? escape '\\' or route ilike ? escape '\\')",
          `%${filters.search.replace(/[\\%_]/g, '\\$&')}%`,
        );
      }
      if (cursor) {
        params.push(cursor.at, cursor.id);
        conditions.push(
          `(last_seen_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      params.push(page.limit + 1);
      const rows = (
        await client.query<ErrorRow>(
          `select ${summaryColumns} from app_errors
            ${conditions.length ? `where ${conditions.join(' and ')}` : ''}
            order by last_seen_at desc, id desc limit $${params.length}`,
          params,
        )
      ).rows;
      const visible = rows.slice(0, page.limit);
      const last = visible.at(-1);
      return {
        items: visible.map(toError),
        nextCursor:
          rows.length > page.limit && last ? encodeCursor(scope, last.last_seen_at, last.id) : null,
      };
    });
  }

  /** Errors seen after `since`, oldest first, for the toast poller of other sessions. */
  async feed(context: WorkspaceRequestContext, since: string | undefined) {
    return this.database.run(context, async (client) => {
      const rows = (
        await client.query<ErrorRow>(
          `select ${summaryColumns} from app_errors
            where status in ('new', 'seen') and last_seen_at > coalesce($1::timestamptz, now() - interval '1 minute')
            order by last_seen_at, id limit 20`,
          [since ?? null],
        )
      ).rows;
      return { items: rows.map(toError), now: new Date().toISOString() };
    });
  }

  async get(context: WorkspaceRequestContext, id: string) {
    return this.database.run(context, async (client) => ({
      error: toError(await this.load(client, id)),
    }));
  }

  async setStatus(context: WorkspaceRequestContext, id: string, status: ErrorStatus) {
    return this.database.run(context, async (client) => {
      const before = await this.load(client, id);
      await client.query('update app_errors set status = $2 where id = $1', [id, status]);
      await writeAudit(client, context, {
        action: 'smart.error_status_changed',
        targetType: 'app_error',
        targetId: id,
        before: { status: before.status },
        after: { status, category: before.category, occurrences: before.occurrences },
      });
      return { error: toError(await this.load(client, id)) };
    });
  }

  /** Counters for the Smart button badge. */
  async summary(context: WorkspaceRequestContext) {
    return this.database.run(context, async (client) => {
      const row = (
        await client.query<{ errors: number; issues: number }>(
          `select (select count(*)::int from app_errors where status in ('new', 'seen')) as errors,
                  (select count(*)::int from walker_issues where status in ('open', 'in_progress')) as issues`,
        )
      ).rows[0]!;
      return { openErrors: row.errors, openIssues: row.issues };
    });
  }

  private async load(client: PoolClient, id: string): Promise<ErrorRow> {
    const row = (
      await client.query<ErrorRow>(
        `select ${summaryColumns}, stack, context from app_errors where id = $1`,
        [id],
      )
    ).rows[0];
    if (!row) throw notFound('SMART_ERROR_NOT_FOUND', 'The error was not found.');
    return row;
  }
}
