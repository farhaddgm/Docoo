import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit, type AuditSeverity } from '../common/audit.js';
import { decodeCursor, encodeCursor, isoColumn } from '../common/pagination.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';

export interface AuditFilters {
  readonly projectId?: string | undefined;
  readonly targetType?: string | undefined;
  readonly targetId?: string | undefined;
  /** Exact action (`project.pause`) or a family (`project.*`). */
  readonly action?: string | undefined;
  readonly actorId?: string | undefined;
  readonly severity?: AuditSeverity | undefined;
  readonly securityRelevant?: boolean | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface AuditEvent {
  readonly id: string;
  readonly action: string;
  readonly actorId: string | null;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly projectId: string | null;
  readonly reason: string | null;
  readonly severity: AuditSeverity;
  readonly securityRelevant: boolean;
  readonly before: unknown;
  readonly after: unknown;
  readonly correlationId: string;
  readonly occurredAt: string;
}

export const AUDIT_EXPORT_LIMIT = 5000;

interface EventRow extends QueryResultRow {
  id: string;
  action: string;
  actor_id: string | null;
  target_type: string;
  target_id: string | null;
  project_id: string | null;
  reason: string | null;
  severity: AuditSeverity;
  security_relevant: boolean;
  before: unknown;
  after: unknown;
  correlation_id: string;
  occurred_at: string;
}

const eventColumns = `
  id, action, actor_id, target_type, target_id, project_id, reason, severity,
  security_relevant, before, after, correlation_id, ${isoColumn('occurred_at', 'occurred_at')}`;

/** Read-only access to the append-only audit log (FR-AUD-001..005). */
@Injectable()
export class AuditService {
  constructor(private readonly database: WorkspaceDatabase) {}

  async list(
    context: WorkspaceRequestContext,
    filters: AuditFilters,
    page: { limit: number; cursor?: string | undefined },
  ): Promise<{ items: readonly AuditEvent[]; nextCursor: string | null }> {
    const scope = `${context.workspaceId}:audit:${JSON.stringify(filters)}`;
    const cursor = page.cursor ? decodeCursor(page.cursor, scope, 'AUDIT_CURSOR_INVALID') : null;
    return this.database.run(context, async (client) => {
      const rows = await this.query(client, context, filters, page.limit + 1, cursor);
      const visible = rows.slice(0, page.limit);
      const last = visible.at(-1);
      return {
        items: visible.map((row) => this.toEvent(row)),
        nextCursor:
          rows.length > page.limit && last ? encodeCursor(scope, last.occurred_at, last.id) : null,
      };
    });
  }

  /** Exports matching events and records the export itself as a security event. */
  async export(
    context: WorkspaceRequestContext,
    filters: AuditFilters,
    format: 'json' | 'csv',
  ): Promise<{ readonly count: number; readonly truncated: boolean; readonly body: string }> {
    return this.database.run(context, async (client) => {
      const rows = await this.query(client, context, filters, AUDIT_EXPORT_LIMIT + 1, null);
      const truncated = rows.length > AUDIT_EXPORT_LIMIT;
      const events = rows.slice(0, AUDIT_EXPORT_LIMIT).map((row) => this.toEvent(row));
      await writeAudit(client, context, {
        action: 'audit.export',
        targetType: 'audit_log',
        severity: 'warning',
        securityRelevant: true,
        after: { format, count: events.length, truncated, filters: { ...filters } },
      });
      const body = format === 'json' ? JSON.stringify({ items: events }) : toCsv(events);
      return { count: events.length, truncated, body };
    });
  }

  private async query(
    client: PoolClient,
    context: WorkspaceRequestContext,
    filters: AuditFilters,
    limit: number,
    cursor: { at: string; id: string } | null,
  ): Promise<EventRow[]> {
    const conditions = ['workspace_id = $1'];
    const params: unknown[] = [context.workspaceId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };
    if (filters.projectId) add('project_id = ?', filters.projectId);
    if (filters.targetType) add('target_type = ?', filters.targetType);
    if (filters.targetId) add('target_id = ?', filters.targetId);
    if (filters.actorId) add('actor_id = ?', filters.actorId);
    if (filters.severity) add('severity = ?', filters.severity);
    if (filters.securityRelevant !== undefined)
      add('security_relevant = ?', filters.securityRelevant);
    if (filters.from) add('occurred_at >= ?::timestamptz', filters.from);
    if (filters.to) add('occurred_at < ?::timestamptz', filters.to);
    if (filters.action?.endsWith('.*')) {
      add("action like ? || '.%'", filters.action.slice(0, -2));
    } else if (filters.action) {
      add('action = ?', filters.action);
    }
    if (cursor) {
      params.push(cursor.at, cursor.id);
      conditions.push(
        `(occurred_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    params.push(limit);
    const result = await client.query<EventRow>(
      `select ${eventColumns}
         from audit_events
        where ${conditions.join(' and ')}
        order by occurred_at desc, id desc
        limit $${params.length}`,
      params,
    );
    return result.rows;
  }

  private toEvent(row: EventRow): AuditEvent {
    return {
      id: row.id,
      action: row.action,
      actorId: row.actor_id,
      targetType: row.target_type,
      targetId: row.target_id,
      projectId: row.project_id,
      reason: row.reason,
      severity: row.severity,
      securityRelevant: row.security_relevant,
      before: row.before,
      after: row.after,
      correlationId: row.correlation_id,
      occurredAt: row.occurred_at,
    };
  }
}

const csvColumns = [
  'occurredAt',
  'action',
  'severity',
  'securityRelevant',
  'actorId',
  'targetType',
  'targetId',
  'projectId',
  'reason',
  'correlationId',
  'before',
  'after',
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(events: readonly AuditEvent[]): string {
  const lines = [csvColumns.join(',')];
  for (const event of events)
    lines.push(csvColumns.map((column) => csvCell(event[column])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
