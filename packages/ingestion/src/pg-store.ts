import type { Pool, PoolClient } from 'pg';

import type { ExtractedSegment } from './extract.js';
import type {
  IngestionStore,
  PipelineAudit,
  SourceStatus,
  StoredVersion,
  VersionPatch,
} from './pipeline.js';

/**
 * PostgreSQL store for the ingestion pipeline. Every call is one transaction under the
 * workspace RLS context with no actor (system work), exactly like an API request.
 */
export class PgIngestionStore implements IngestionStore {
  constructor(private readonly pool: Pool) {}

  private async inWorkspace<T>(
    workspaceId: string,
    correlationId: string | null,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `select set_config('app.workspace_id', $1, true), set_config('app.actor_id', '', true),
                set_config('app.correlation_id', $2, true)`,
        [workspaceId, correlationId ?? ''],
      );
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  load(workspaceId: string, versionId: string): Promise<StoredVersion | null> {
    return this.inWorkspace(workspaceId, null, async (client) => {
      const result = await client.query<StoredVersion>(
        `select v.id, v.asset_id as "assetId", a.kind, v.status, v.object_key as "objectKey",
                v.filename, v.declared_mime as "declaredMime", v.declared_size as "declaredSize",
                v.declared_sha256 as "declaredSha256", v.origin_url as "originUrl",
                v.sniffed_mime as "sniffedMime"
           from source_versions v
           join source_assets a on a.id = v.asset_id
          where v.id = $1`,
        [versionId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return { ...row, declaredSize: row.declaredSize === null ? null : Number(row.declaredSize) };
    });
  }

  transition(
    workspaceId: string,
    versionId: string,
    from: readonly SourceStatus[],
    patch: VersionPatch,
    audit: PipelineAudit | null,
    correlationId: string,
  ): Promise<boolean> {
    return this.inWorkspace(workspaceId, correlationId, async (client) => {
      const columns: Record<string, unknown> = { status: patch.status };
      const map: Record<string, string> = {
        sniffedMime: 'sniffed_mime',
        sizeBytes: 'size_bytes',
        sha256: 'sha256',
        objectKey: 'object_key',
        failureCode: 'failure_code',
        filename: 'filename',
      };
      for (const [key, column] of Object.entries(map)) {
        if (key in patch) columns[column] = (patch as unknown as Record<string, unknown>)[key];
      }
      if ('scan' in patch) columns['scan'] = JSON.stringify(patch.scan);
      if ('extraction' in patch) columns['extraction'] = JSON.stringify(patch.extraction);
      const names = Object.keys(columns);
      const assignments = names.map((name, index) =>
        ['scan', 'extraction'].includes(name)
          ? `${name} = $${index + 3}::jsonb`
          : `${name} = $${index + 3}`,
      );
      const updated = await client.query<{ asset_id: string }>(
        `update source_versions set ${assignments.join(', ')}
          where id = $1 and status = any($2::source_status[])
          returning asset_id`,
        [versionId, from, ...names.map((name) => columns[name])],
      );
      const row = updated.rows[0];
      if (!row) return false;
      if (audit) {
        await client.query(
          `insert into audit_events (workspace_id, actor_id, action, target_type, target_id, after,
                                     correlation_id, severity, security_relevant)
           values ($1, null, $2, 'source_version', $3, $4::jsonb, $5, $6, $7)`,
          [
            workspaceId,
            audit.action,
            versionId,
            JSON.stringify({ ...audit.after, assetId: row.asset_id }),
            correlationId,
            audit.severity,
            audit.securityRelevant,
          ],
        );
      }
      return true;
    });
  }

  saveSegments(
    workspaceId: string,
    versionId: string,
    segments: readonly ExtractedSegment[],
  ): Promise<void> {
    return this.inWorkspace(workspaceId, null, async (client) => {
      const existing = await client.query(
        'select 1 from source_segments where source_version_id = $1 limit 1',
        [versionId],
      );
      if (existing.rowCount) return;
      const batch = 500;
      for (let start = 0; start < segments.length; start += batch) {
        const slice = segments.slice(start, start + batch);
        await client.query(
          `insert into source_segments (workspace_id, source_version_id, ordinal, locator, text, confidence)
           select $1, $2, item.ordinal, item.locator, item.text, item.confidence
             from jsonb_to_recordset($3::jsonb)
                  as item(ordinal int, locator jsonb, text text, confidence real)`,
          [
            workspaceId,
            versionId,
            JSON.stringify(
              slice.map((segment, index) => ({
                ordinal: start + index + 1,
                locator: segment.locator,
                text: segment.text,
                confidence: segment.confidence ?? null,
              })),
            ),
          ],
        );
      }
    });
  }
}
