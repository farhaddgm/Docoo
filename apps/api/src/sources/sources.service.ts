import { createHash, randomUUID } from 'node:crypto';

import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  extensionOf,
  objectKeys,
  SUPPORTED_TYPES,
  UrlFetchError,
  validateUrl,
  type IngestionInput,
  type ObjectStore,
  type UrlPolicy,
} from '@docoo/ingestion';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import { visibleStatusSql } from '../common/knowledge-status.js';
import {
  containsPattern,
  decodeCursor,
  encodeCursor,
  isoColumn,
  listScope,
} from '../common/pagination.js';
import { badRequest, conflict, notFound, preconditionFailed } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { scopeKey, scopeTitles } from '../common/scope-titles.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService, type ConfigScope } from '../config/config.service.js';
import {
  INGESTION_DISPATCHER,
  IngestionUnavailableError,
  OBJECT_STORE,
  type IngestionDispatcher,
} from './ingestion.providers.js';

export type SourceKind = 'file' | 'url' | 'text';

export interface SourceScope {
  readonly type: ConfigScope;
  readonly id: string;
  /** Title of the topic or project; a workspace has none. Present on reads only. */
  readonly title?: string | null;
}

/** Knowledge built from a version of a source, so a screen can link to it. */
export interface DerivedKnowledge {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly stale: boolean;
}

export interface SourceVersion {
  readonly id: string;
  readonly versionNo: number;
  readonly status: string;
  readonly filename: string | null;
  readonly declaredMime: string | null;
  readonly sniffedMime: string | null;
  readonly sizeBytes: number | null;
  readonly sha256: string | null;
  readonly originUrl: string | null;
  readonly scan: unknown;
  readonly extraction: unknown;
  readonly failureCode: string | null;
  readonly supersedesVersionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Source {
  readonly id: string;
  readonly kind: SourceKind;
  readonly title: string;
  readonly scope: SourceScope;
  readonly currentVersionId: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentVersion?: SourceVersion | null;
  readonly knowledge?: readonly DerivedKnowledge[];
}

export interface UploadTicket {
  readonly url: string;
  readonly method: 'PUT';
  readonly headers: Record<string, string>;
  readonly expiresAt: string;
}

export interface FileDeclaration {
  readonly filename: string;
  readonly mime: string;
  readonly size: number;
  readonly sha256: string;
}

/** Presigned upload URLs are short-lived (FR-ING-001). */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

interface SourceRow extends QueryResultRow {
  id: string;
  kind: SourceKind;
  title: string;
  scope_type: ConfigScope;
  scope_id: string;
  current_version_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface VersionRow extends QueryResultRow {
  id: string;
  asset_id: string;
  version_no: number;
  status: string;
  filename: string | null;
  declared_mime: string | null;
  sniffed_mime: string | null;
  size_bytes: string | null;
  declared_size: string | null;
  sha256: string | null;
  declared_sha256: string | null;
  origin_url: string | null;
  object_key: string | null;
  scan: unknown;
  extraction: unknown;
  failure_code: string | null;
  supersedes_version_id: string | null;
  created_at: string;
  updated_at: string;
}

const sourceColumns = `id, kind, title, scope_type, scope_id, current_version_id, version,
  ${isoColumn('created_at', 'created_at')}, ${isoColumn('updated_at', 'updated_at')}`;
const versionColumns = `id, asset_id, version_no, status, filename, declared_mime, sniffed_mime,
  size_bytes, declared_size, sha256, declared_sha256, origin_url, object_key, scan, extraction,
  failure_code, supersedes_version_id,
  ${isoColumn('created_at', 'created_at')}, ${isoColumn('updated_at', 'updated_at')}`;

function payloadTooLarge(detail: string): HttpException {
  return new HttpException(
    { status: 413, title: 'Payload Too Large', code: 'SOURCE_TOO_LARGE', detail },
    413,
  );
}

function unsupportedType(): HttpException {
  return new HttpException(
    {
      status: 415,
      title: 'Unsupported Media Type',
      code: 'SOURCE_UNSUPPORTED_TYPE',
      detail: `Supported files: ${Object.keys(SUPPORTED_TYPES).join(', ')}.`,
    },
    415,
  );
}

function unavailable(code: string, detail: string): HttpException {
  return new HttpException({ status: 503, title: 'Service Unavailable', code, detail }, 503);
}

@Injectable()
export class SourcesService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly config: ConfigService,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore | null,
    @Inject(INGESTION_DISPATCHER) private readonly dispatcher: IngestionDispatcher,
  ) {}

  private store(): ObjectStore {
    if (!this.objects) {
      throw unavailable('SOURCE_STORAGE_UNAVAILABLE', 'Object storage is not configured.');
    }
    return this.objects;
  }

  async list(
    context: WorkspaceRequestContext,
    input: {
      limit: number;
      cursor?: string | undefined;
      status?: string | undefined;
      scopeType?: ConfigScope | undefined;
      scopeId?: string | undefined;
      q?: string | undefined;
    },
  ): Promise<{ items: Source[]; nextCursor: string | null }> {
    const scope = listScope(`${context.workspaceId}:sources`, {
      status: input.status,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      q: input.q,
    });
    const cursor = input.cursor ? decodeCursor(input.cursor, scope, 'SOURCE_CURSOR_INVALID') : null;
    return this.database.run(context, async (client) => {
      const result = await client.query<SourceRow & { current: VersionRow | null }>(
        `select a.*,
                (select row_to_json(v) from (select ${versionColumns} from source_versions sv
                   where sv.id = a.current_version_id) v) as current
           from (select ${sourceColumns}, created_at as sort_at from source_assets
                  where workspace_id = $1 and deleted_at is null
                    and ($6::text is null or (scope_type::text = $6 and scope_id = $7::uuid))
                    and ($8::text is null or title ilike $8)) a
           left join source_versions cv on cv.id = a.current_version_id
          where ($2::text is null or cv.status::text = $2)
            and ($3::timestamptz is null or (a.sort_at, a.id) < ($3::timestamptz, $4::uuid))
          order by a.sort_at desc, a.id desc
          limit $5`,
        [
          context.workspaceId,
          input.status ?? null,
          cursor?.at ?? null,
          cursor?.id ?? null,
          input.limit + 1,
          input.scopeType ?? null,
          input.scopeId ?? null,
          input.q ? containsPattern(input.q) : null,
        ],
      );
      const rows = result.rows.slice(0, input.limit);
      const last = rows.at(-1);
      const titles = await scopeTitles(
        client,
        rows.map((row) => ({ type: row.scope_type, id: row.scope_id })),
      );
      const derived = await this.derivedKnowledge(
        client,
        rows.map((row) => row.id),
      );
      return {
        items: rows.map((row) => ({
          ...this.toSource(row, titles),
          currentVersion: row.current ? this.toVersion(row.current) : null,
          knowledge: derived.get(row.id) ?? [],
        })),
        nextCursor:
          result.rows.length > input.limit && last
            ? encodeCursor(scope, last.created_at, last.id)
            : null,
      };
    });
  }

  /** The current version of each knowledge item that was built from one of these sources. */
  private async derivedKnowledge(
    client: PoolClient,
    sourceIds: readonly string[],
  ): Promise<Map<string, DerivedKnowledge[]>> {
    const map = new Map<string, DerivedKnowledge[]>();
    if (sourceIds.length === 0) return map;
    const result = await client.query<{
      asset_id: string;
      id: string;
      title: string;
      status: string;
      stale: boolean;
    }>(
      `select sv.asset_id, i.id, i.title, ${visibleStatusSql('v')} as status,
              v.stale_reason is not null as stale
         from knowledge_items i
         join knowledge_versions v on v.id = i.current_version_id
         join source_versions sv on sv.id = v.source_version_id
        where sv.asset_id = any($1::uuid[]) and i.deleted_at is null
        order by i.created_at, i.id`,
      [sourceIds],
    );
    for (const row of result.rows) {
      const list = map.get(row.asset_id) ?? [];
      list.push({ id: row.id, title: row.title, status: row.status, stale: row.stale });
      map.set(row.asset_id, list);
    }
    return map;
  }

  async get(
    context: WorkspaceRequestContext,
    sourceId: string,
  ): Promise<Source & { versions: SourceVersion[] }> {
    return this.database.run(context, async (client) => {
      const source = await this.loadSource(client, sourceId);
      const versions = await client.query<VersionRow>(
        `select ${versionColumns} from source_versions where asset_id = $1 order by version_no desc`,
        [sourceId],
      );
      const titles = await scopeTitles(client, [{ type: source.scope_type, id: source.scope_id }]);
      return {
        ...this.toSource(source, titles),
        versions: versions.rows.map((row) => this.toVersion(row)),
        knowledge: (await this.derivedKnowledge(client, [sourceId])).get(sourceId) ?? [],
      };
    });
  }

  async segments(
    context: WorkspaceRequestContext,
    sourceId: string,
    versionId: string,
    input: { limit: number; after: number },
  ): Promise<{ items: unknown[]; nextAfter: number | null }> {
    return this.database.run(context, async (client) => {
      await this.loadVersion(client, sourceId, versionId);
      const result = await client.query<{
        ordinal: number;
        locator: unknown;
        text: string;
        confidence: number | null;
      }>(
        `select ordinal, locator, text, confidence from source_segments
          where source_version_id = $1 and ordinal > $2 order by ordinal limit $3`,
        [versionId, input.after, input.limit + 1],
      );
      const rows = result.rows.slice(0, input.limit);
      return {
        items: rows,
        nextAfter: result.rows.length > input.limit ? (rows.at(-1)?.ordinal ?? null) : null,
      };
    });
  }

  /** ING-001: declare a file, get a presigned direct upload URL into quarantine. */
  async createUpload(
    context: WorkspaceRequestContext,
    input: FileDeclaration & { title: string; scope: SourceScope },
  ): Promise<{ source: Source; version: SourceVersion; upload: UploadTicket }> {
    const store = this.store();
    return this.database.run(context, async (client) => {
      await this.assertScope(client, context, input.scope);
      await this.checkDeclaration(client, context, input.scope, input);
      const source = await this.insertSource(client, context, 'file', input.title, input.scope);
      const version = await this.insertVersion(client, context, source.id, 1, {
        filename: input.filename,
        declaredMime: input.mime,
        declaredSize: input.size,
        declaredSha256: input.sha256,
        supersedes: null,
      });
      const upload = await this.ticket(store, context, source.id, version.id, input);
      await client.query(`update source_versions set upload_expires_at = $2 where id = $1`, [
        version.id,
        upload.expiresAt,
      ]);
      await writeAudit(client, context, {
        action: 'source.upload_requested',
        targetType: 'source',
        targetId: source.id,
        after: {
          versionId: version.id,
          filename: input.filename,
          mime: input.mime,
          size: input.size,
          sha256: input.sha256,
          scope: input.scope,
        },
      });
      return { source: this.toSource(source), version: this.toVersion(version), upload };
    });
  }

  /** ING-007: a new version of an existing file source, linked to the previous one. */
  async createVersionUpload(
    context: WorkspaceRequestContext,
    sourceId: string,
    expectedVersion: number,
    input: FileDeclaration & { reason?: string | undefined },
  ): Promise<{ source: Source; version: SourceVersion; upload: UploadTicket }> {
    const store = this.store();
    return this.database.run(context, async (client) => {
      const source = await this.loadSource(client, sourceId, true);
      if (source.kind !== 'file') {
        throw badRequest('SOURCE_INVALID_REQUEST', 'Only file sources take new uploaded versions.');
      }
      if (source.version !== expectedVersion) {
        throw preconditionFailed(
          'SOURCE_VERSION_CONFLICT',
          'The source changed; reload it and try again.',
        );
      }
      const scope = { type: source.scope_type, id: source.scope_id };
      await this.checkDeclaration(client, context, scope, input);
      const next = await client.query<{ next: number }>(
        'select coalesce(max(version_no), 0) + 1 as next from source_versions where asset_id = $1',
        [sourceId],
      );
      const version = await this.insertVersion(client, context, sourceId, next.rows[0]!.next, {
        filename: input.filename,
        declaredMime: input.mime,
        declaredSize: input.size,
        declaredSha256: input.sha256,
        supersedes: source.current_version_id,
      });
      const upload = await this.ticket(store, context, sourceId, version.id, input);
      await client.query(`update source_versions set upload_expires_at = $2 where id = $1`, [
        version.id,
        upload.expiresAt,
      ]);
      const updated = await client.query<SourceRow>(
        `update source_assets set version = version + 1 where id = $1 returning ${sourceColumns}`,
        [sourceId],
      );
      await writeAudit(client, context, {
        action: 'source.version_requested',
        targetType: 'source',
        targetId: sourceId,
        reason: input.reason ?? null,
        after: {
          versionId: version.id,
          versionNo: version.version_no,
          supersedes: source.current_version_id,
          sha256: input.sha256,
        },
      });
      return { source: this.toSource(updated.rows[0]!), version: this.toVersion(version), upload };
    });
  }

  /**
   * Confirms the upload landed in quarantine with the declared size, then starts the
   * ingestion workflow. The new version becomes current and knowledge built from earlier
   * versions is marked stale (ING-007).
   */
  async finalize(
    context: WorkspaceRequestContext,
    sourceId: string,
    versionId: string,
  ): Promise<SourceVersion> {
    const store = this.store();
    const prepared = await this.database.run(context, async (client) => {
      const source = await this.loadSource(client, sourceId, true);
      const version = await this.loadVersion(client, sourceId, versionId, true);
      if (version.status !== 'uploaded') return { source, version, started: false };
      const key = objectKeys.quarantine(context.workspaceId, sourceId, versionId);
      const head = await store.head(key);
      if (!head) {
        throw conflict('SOURCE_UPLOAD_INCOMPLETE', 'The file has not been uploaded yet.');
      }
      if (version.declared_size !== null && head.size !== Number(version.declared_size)) {
        await store.delete(key);
        throw conflict(
          'SOURCE_UPLOAD_SIZE_MISMATCH',
          'The uploaded file size differs from the declared size.',
        );
      }
      const updated = await client.query<VersionRow>(
        `update source_versions set status = 'quarantined', object_key = $2
          where id = $1 returning ${versionColumns}`,
        [versionId, key],
      );
      await this.makeCurrent(client, context, source, versionId);
      await writeAudit(client, context, {
        action: 'source.upload_finalized',
        targetType: 'source',
        targetId: sourceId,
        after: { versionId, size: head.size },
      });
      return { source, version: updated.rows[0]!, started: true };
    });
    if (prepared.version.status === 'quarantined') {
      await this.startIngestion(context, prepared.source, prepared.version);
    }
    return this.reload(context, sourceId, versionId);
  }

  /** ING-006: text pasted by the administrator enters the same pipeline as a file. */
  async createText(
    context: WorkspaceRequestContext,
    input: { title: string; text: string; scope: SourceScope; language: 'fa' | 'en' },
  ): Promise<{ source: Source; version: SourceVersion }> {
    const store = this.store();
    const bytes = new TextEncoder().encode(input.text);
    const prepared = await this.database.run(context, async (client) => {
      await this.assertScope(client, context, input.scope);
      const maxBytes = await this.maxBytes(client, context, input.scope);
      if (bytes.length > maxBytes) throw payloadTooLarge(`The text exceeds ${maxBytes} bytes.`);
      const source = await this.insertSource(client, context, 'text', input.title, input.scope);
      const version = await this.insertVersion(client, context, source.id, 1, {
        filename: 'text.txt',
        declaredMime: 'text/plain',
        declaredSize: bytes.length,
        declaredSha256: createHash('sha256').update(bytes).digest('hex'),
        supersedes: null,
      });
      const key = objectKeys.quarantine(context.workspaceId, source.id, version.id);
      await store.put(key, bytes, 'text/plain; charset=utf-8');
      const updated = await client.query<VersionRow>(
        `update source_versions set status = 'quarantined', object_key = $2 where id = $1 returning ${versionColumns}`,
        [version.id, key],
      );
      await this.makeCurrent(client, context, source, version.id);
      await writeAudit(client, context, {
        action: 'source.text_added',
        targetType: 'source',
        targetId: source.id,
        after: { versionId: version.id, size: bytes.length, scope: input.scope },
      });
      return { source, version: updated.rows[0]! };
    });
    await this.startIngestion(context, prepared.source, prepared.version, input.language);
    return {
      source: this.toSource(prepared.source),
      version: await this.reload(context, prepared.source.id, prepared.version.id),
    };
  }

  /** ING-006: a URL is checked against policy now and fetched by the worker with SSRF guards. */
  async createUrl(
    context: WorkspaceRequestContext,
    input: { title: string; url: string; scope: SourceScope; language: 'fa' | 'en' },
  ): Promise<{ source: Source; version: SourceVersion }> {
    this.store();
    const rejection = await this.database.run(context, async (client) => {
      await this.assertScope(client, context, input.scope);
      try {
        validateUrl(input.url, await this.urlPolicy(client, context, input.scope));
        return null;
      } catch (error) {
        if (!(error instanceof UrlFetchError)) throw error;
        // Recorded in its own committed transaction; the request itself is refused below.
        await writeAudit(client, context, {
          action: 'source.url_rejected',
          targetType: 'source',
          severity: 'warning',
          securityRelevant: true,
          after: { url: input.url, code: error.code },
        });
        return error.code;
      }
    });
    if (rejection)
      throw badRequest('SOURCE_URL_REJECTED', `The URL is not allowed (${rejection}).`);
    const prepared = await this.database.run(context, async (client) => {
      validateUrl(input.url, await this.urlPolicy(client, context, input.scope));
      const source = await this.insertSource(client, context, 'url', input.title, input.scope);
      const version = await this.insertVersion(client, context, source.id, 1, {
        filename: null,
        declaredMime: null,
        declaredSize: null,
        declaredSha256: null,
        supersedes: null,
        originUrl: input.url,
        status: 'quarantined',
      });
      await this.makeCurrent(client, context, source, version.id);
      await writeAudit(client, context, {
        action: 'source.url_added',
        targetType: 'source',
        targetId: source.id,
        after: { versionId: version.id, url: input.url, scope: input.scope },
      });
      return { source, version };
    });
    await this.startIngestion(context, prepared.source, prepared.version, input.language);
    return {
      source: this.toSource(prepared.source),
      version: await this.reload(context, prepared.source.id, prepared.version.id),
    };
  }

  /** Restarts ingestion of a version held in quarantine (scanner down) or failed. */
  async retry(
    context: WorkspaceRequestContext,
    sourceId: string,
    versionId: string,
  ): Promise<SourceVersion> {
    const prepared = await this.database.run(context, async (client) => {
      const source = await this.loadSource(client, sourceId, true);
      const version = await this.loadVersion(client, sourceId, versionId, true);
      if (version.status === 'failed') {
        // A failed extraction restarts from the accepted file.
        await client.query(
          `update source_versions set status = 'accepted', failure_code = null where id = $1`,
          [versionId],
        );
      } else if (version.status !== 'quarantined') {
        throw conflict(
          'SOURCE_NOT_RETRYABLE',
          'Only quarantined or failed versions can be retried.',
        );
      }
      await writeAudit(client, context, {
        action: 'source.retry',
        targetType: 'source',
        targetId: sourceId,
        after: { versionId },
      });
      return { source, version };
    });
    await this.startIngestion(context, prepared.source, prepared.version, null, true);
    return this.reload(context, sourceId, versionId);
  }

  private async startIngestion(
    context: WorkspaceRequestContext,
    source: SourceRow,
    version: VersionRow,
    language: 'fa' | 'en' | null = null,
    retry = false,
  ): Promise<void> {
    const scope = { type: source.scope_type, id: source.scope_id };
    const settings = await this.database.run(context, async (client) => ({
      maxBytes: await this.maxBytes(client, context, scope),
      urlPolicy: await this.urlPolicy(client, context, scope),
      language: language ?? (await this.scopeLanguage(client, scope)),
    }));
    const input: IngestionInput = {
      workspaceId: context.workspaceId,
      versionId: version.id,
      correlationId: retry ? randomUUID() : context.correlationId,
      maxBytes: settings.maxBytes,
      language: settings.language,
      ...(source.kind === 'url' ? { urlPolicy: settings.urlPolicy } : {}),
    };
    try {
      await this.dispatcher.start(input);
    } catch (error) {
      if (error instanceof IngestionUnavailableError) {
        throw unavailable(
          'SOURCE_INGESTION_UNAVAILABLE',
          'The file is safely in quarantine but ingestion could not start; retry later.',
        );
      }
      throw error;
    }
  }

  private async reload(
    context: WorkspaceRequestContext,
    sourceId: string,
    versionId: string,
  ): Promise<SourceVersion> {
    return this.database.run(context, async (client) =>
      this.toVersion(await this.loadVersion(client, sourceId, versionId)),
    );
  }

  private async makeCurrent(
    client: PoolClient,
    context: WorkspaceRequestContext,
    source: SourceRow,
    versionId: string,
  ): Promise<void> {
    const previous = source.current_version_id;
    await client.query(`update source_assets set current_version_id = $2 where id = $1`, [
      source.id,
      versionId,
    ]);
    if (!previous || previous === versionId) return;
    const stale = await client.query<{ id: string; item_id: string }>(
      `update knowledge_versions kv set stale_reason = 'source_version_superseded'
         from source_versions sv
        where kv.source_version_id = sv.id and sv.asset_id = $1 and sv.id <> $2
          and kv.stale_reason is null and kv.status not in ('superseded', 'expired')
        returning kv.id, kv.item_id`,
      [source.id, versionId],
    );
    if (stale.rowCount) {
      await writeAudit(client, context, {
        action: 'knowledge.stale',
        targetType: 'source',
        targetId: source.id,
        severity: 'warning',
        after: {
          reason: 'source_version_superseded',
          newSourceVersionId: versionId,
          knowledgeVersionIds: stale.rows.map((row) => row.id),
        },
      });
    }
  }

  private async ticket(
    store: ObjectStore,
    context: WorkspaceRequestContext,
    sourceId: string,
    versionId: string,
    input: FileDeclaration,
  ): Promise<UploadTicket> {
    const key = objectKeys.quarantine(context.workspaceId, sourceId, versionId);
    const url = await store.presignPut(key, input.mime, input.size, UPLOAD_URL_TTL_SECONDS);
    return {
      url,
      method: 'PUT',
      headers: { 'content-type': input.mime },
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  private async checkDeclaration(
    client: PoolClient,
    context: WorkspaceRequestContext,
    scope: SourceScope,
    input: FileDeclaration,
  ): Promise<void> {
    const extension = extensionOf(input.filename);
    if (
      !extension ||
      !(Object.values(SUPPORTED_TYPES) as string[]).includes(input.mime.toLowerCase())
    ) {
      throw unsupportedType();
    }
    const maxBytes = await this.maxBytes(client, context, scope);
    if (input.size > maxBytes) {
      throw payloadTooLarge(`Files may be at most ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
  }

  private async maxBytes(
    client: PoolClient,
    context: WorkspaceRequestContext,
    scope: SourceScope,
  ): Promise<number> {
    const effective = await this.config.resolve(client, context, scope.type, scope.id);
    const mb = Number(effective.values['ingestion.max_file_mb'] ?? 100);
    return Math.max(1, Math.min(100, mb)) * 1024 * 1024;
  }

  private async urlPolicy(
    client: PoolClient,
    context: WorkspaceRequestContext,
    scope: SourceScope,
  ): Promise<{ policy: UrlPolicy; allowlist: string[] }> {
    const effective = await this.config.resolve(client, context, scope.type, scope.id);
    const policy = effective.values['ingestion.url_policy'];
    const allowlist = effective.values['ingestion.url_allowlist'];
    return {
      policy: policy === 'deny' || policy === 'public' ? policy : 'allowlist',
      allowlist: Array.isArray(allowlist)
        ? allowlist.filter((item): item is string => typeof item === 'string')
        : [],
    };
  }

  private async scopeLanguage(client: PoolClient, scope: SourceScope): Promise<'fa' | 'en'> {
    if (scope.type === 'topic') {
      const topic = await client.query<{ language: 'fa' | 'en' }>(
        'select language from topics where id = $1',
        [scope.id],
      );
      return topic.rows[0]?.language ?? 'fa';
    }
    if (scope.type === 'project') {
      const project = await client.query<{ language: 'fa' | 'en' }>(
        'select output_language as language from projects where id = $1',
        [scope.id],
      );
      return project.rows[0]?.language ?? 'fa';
    }
    const workspace = await client.query<{ language: 'fa' | 'en' }>(
      'select default_locale as language from workspaces where id = $1',
      [scope.id],
    );
    return workspace.rows[0]?.language ?? 'fa';
  }

  async assertScope(
    client: PoolClient,
    context: WorkspaceRequestContext,
    scope: SourceScope,
  ): Promise<void> {
    if (scope.type === 'workspace') {
      if (scope.id !== context.workspaceId)
        throw notFound('SOURCE_SCOPE_NOT_FOUND', 'The scope was not found.');
      return;
    }
    const table = scope.type === 'topic' ? 'topics' : 'projects';
    const found = await client.query(
      `select 1 from ${table} where id = $1 and deleted_at is null`,
      [scope.id],
    );
    if (!found.rowCount) throw notFound('SOURCE_SCOPE_NOT_FOUND', 'The scope was not found.');
  }

  private async insertSource(
    client: PoolClient,
    context: WorkspaceRequestContext,
    kind: SourceKind,
    title: string,
    scope: SourceScope,
  ): Promise<SourceRow> {
    const result = await client.query<SourceRow>(
      `insert into source_assets (workspace_id, kind, title, scope_type, scope_id, created_by)
       values ($1, $2, $3, $4, $5, $6) returning ${sourceColumns}`,
      [context.workspaceId, kind, title, scope.type, scope.id, context.actorId],
    );
    return result.rows[0]!;
  }

  private async insertVersion(
    client: PoolClient,
    context: WorkspaceRequestContext,
    assetId: string,
    versionNo: number,
    input: {
      filename: string | null;
      declaredMime: string | null;
      declaredSize: number | null;
      declaredSha256: string | null;
      supersedes: string | null;
      originUrl?: string;
      status?: string;
    },
  ): Promise<VersionRow> {
    const result = await client.query<VersionRow>(
      `insert into source_versions (
         workspace_id, asset_id, version_no, status, filename, declared_mime, declared_size,
         declared_sha256, origin_url, supersedes_version_id, created_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning ${versionColumns}`,
      [
        context.workspaceId,
        assetId,
        versionNo,
        input.status ?? 'uploaded',
        input.filename,
        input.declaredMime,
        input.declaredSize,
        input.declaredSha256,
        input.originUrl ?? null,
        input.supersedes,
        context.actorId,
      ],
    );
    return result.rows[0]!;
  }

  private async loadSource(
    client: PoolClient,
    sourceId: string,
    forUpdate = false,
  ): Promise<SourceRow> {
    const result = await client.query<SourceRow>(
      `select ${sourceColumns} from source_assets where id = $1 and deleted_at is null ${forUpdate ? 'for update' : ''}`,
      [sourceId],
    );
    const row = result.rows[0];
    if (!row) throw notFound('SOURCE_NOT_FOUND', 'The source was not found.');
    return row;
  }

  private async loadVersion(
    client: PoolClient,
    sourceId: string,
    versionId: string,
    forUpdate = false,
  ): Promise<VersionRow> {
    const result = await client.query<VersionRow>(
      `select ${versionColumns} from source_versions where id = $1 and asset_id = $2 ${forUpdate ? 'for update' : ''}`,
      [versionId, sourceId],
    );
    const row = result.rows[0];
    if (!row) throw notFound('SOURCE_VERSION_NOT_FOUND', 'The source version was not found.');
    return row;
  }

  private toSource(row: SourceRow, titles?: ReadonlyMap<string, string>): Source {
    const title = titles?.get(scopeKey({ type: row.scope_type, id: row.scope_id }));
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      scope: {
        type: row.scope_type,
        id: row.scope_id,
        ...(titles ? { title: title ?? null } : {}),
      },
      currentVersionId: row.current_version_id,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toVersion(row: VersionRow): SourceVersion {
    return {
      id: row.id,
      versionNo: row.version_no,
      status: row.status,
      filename: row.filename,
      declaredMime: row.declared_mime,
      sniffedMime: row.sniffed_mime,
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      sha256: row.sha256,
      originUrl: row.origin_url,
      scan: row.scan,
      extraction: row.extraction,
      failureCode: row.failure_code,
      supersedesVersionId: row.supersedes_version_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
