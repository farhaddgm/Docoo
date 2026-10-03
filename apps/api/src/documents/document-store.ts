import { createHash } from 'node:crypto';

import {
  checkCompliance,
  DEFAULT_LEVEL_BOUNDS,
  type Level,
  type LevelBounds,
  type StructuredDocument,
} from '@docoo/documents';
import type { PoolClient } from 'pg';

import type { WorkspaceRequestContext } from '../common/request-context.js';
import { canonicalJson } from '../config/setting-value.js';

/** A text setting such as `ai.model`; anything else counts as unset. */
export function settingText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `document.level_bounds` holds ten numbers: min/max of levels 1–5. Malformed falls back. */
export function levelBoundsFrom(value: unknown): Record<Level, LevelBounds> {
  if (
    !Array.isArray(value) ||
    value.length !== 10 ||
    !value.every((item) => Number.isInteger(item))
  ) {
    return { ...DEFAULT_LEVEL_BOUNDS };
  }
  const numbers = value as number[];
  const bounds = {} as Record<Level, LevelBounds>;
  for (let level = 1; level <= 5; level += 1) {
    const min = numbers[(level - 1) * 2]!;
    const max = numbers[(level - 1) * 2 + 1]!;
    if (min > max) return { ...DEFAULT_LEVEL_BOUNDS };
    bounds[level as Level] = { min, max };
  }
  return bounds;
}

/** Stores an immutable version with its official count and bounds (DOC-101/102). */
export async function insertDocumentVersion(
  client: PoolClient,
  context: WorkspaceRequestContext,
  documentId: string,
  content: StructuredDocument,
  level: Level,
  bounds: Record<Level, LevelBounds>,
  origin: 'model' | 'edit' | 'restore' | 'supersede',
  restoredFromId: string | null,
  reason: string | null,
): Promise<{ id: string; versionNo: number; withinBounds: boolean; count: number }> {
  const compliance = checkCompliance(content, level, bounds);
  const json = canonicalJson(content);
  const row = (
    await client.query<{ id: string; version_no: number }>(
      `insert into document_versions (workspace_id, document_id, version_no, content, content_sha256, char_count, count_algorithm,
                                      level, bounds, within_bounds, origin, restored_from_id, reason, created_by)
       values ($1, $2, (select coalesce(max(version_no), 0) + 1 from document_versions where document_id = $2), $3::jsonb, $4,
               $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
       returning id, version_no`,
      [
        context.workspaceId,
        documentId,
        JSON.stringify(content),
        createHash('sha256').update(json).digest('hex'),
        compliance.count,
        compliance.algorithm,
        level,
        JSON.stringify(compliance.bounds),
        compliance.withinBounds,
        origin,
        restoredFromId,
        reason,
        context.actorId,
      ],
    )
  ).rows[0]!;
  await client.query(
    `update documents set current_version_id = $2, status = $3, approved_version_id = null, approval_kind = null,
            version = version + 1 where id = $1`,
    [documentId, row.id, 'draft'],
  );
  return {
    id: row.id,
    versionNo: row.version_no,
    withinBounds: compliance.withinBounds,
    count: compliance.count,
  };
}
