import { createHash } from 'node:crypto';

import { recordAuditWrite } from '@docoo/observability';
import type { PoolClient } from 'pg';

import type { WorkspaceRequestContext } from './request-context.js';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface AuditEntry {
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly projectId?: string | null;
  readonly reason?: string | null;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly severity?: AuditSeverity;
  readonly securityRelevant?: boolean;
}

const secretKeys = /password|secret|token|api[_-]?key|credential|cookie|authorization/i;
/** Free-text fields that may hold confidential problem content (FR-AUD-004). */
const contentKeys = new Set([
  'title',
  'description',
  'initialProblem',
  'initial_problem',
  'conflictInstruction',
]);

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Redacts audit snapshots: secrets are dropped, free-text content is replaced by a
 * digest and length so changes stay provable without storing the content.
 */
export function redactForAudit(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (secretKeys.test(key)) {
      result[key] = '[REDACTED]';
    } else if (contentKeys.has(key) && typeof field === 'string') {
      result[key] = { redacted: true, length: field.length, sha256: digest(field) };
    } else if (field !== null && typeof field === 'object' && !Array.isArray(field)) {
      result[key] = redactForAudit(field as Record<string, unknown>);
    } else {
      result[key] = field;
    }
  }
  return result;
}

export async function writeAudit(
  client: PoolClient,
  context: WorkspaceRequestContext,
  entry: AuditEntry,
): Promise<void> {
  const started = performance.now();
  try {
    await insertAudit(client, context, entry);
    recordAuditWrite('succeeded', (performance.now() - started) / 1000);
  } catch (error) {
    recordAuditWrite('failed', (performance.now() - started) / 1000);
    throw error;
  }
}

async function insertAudit(
  client: PoolClient,
  context: WorkspaceRequestContext,
  entry: AuditEntry,
): Promise<void> {
  await client.query(
    `insert into audit_events (
       workspace_id, actor_id, action, target_type, target_id, project_id, reason,
       before, after, correlation_id, severity, security_relevant
     ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)`,
    [
      context.workspaceId,
      context.actorId,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      entry.projectId ?? null,
      entry.reason ?? null,
      JSON.stringify(redactForAudit(entry.before)),
      JSON.stringify(redactForAudit(entry.after)),
      context.correlationId,
      entry.severity ?? 'info',
      entry.securityRelevant ?? false,
    ],
  );
}
