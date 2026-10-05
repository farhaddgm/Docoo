import { createHash, randomUUID } from 'node:crypto';

import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  AGENT_ROLES,
  BUSINESS_PROMPT_DEFAULT_CHARS,
  businessPrompt,
  canonicalBusinessJson,
  clampBusinessBudget,
  diffBusinessContent,
  normalizeBusinessExport,
  type AgentRole,
  type BusinessContent,
  type BusinessTerm,
} from '@docoo/domain';
import { businessForRole, loadSnapshot, type RoleBusiness } from '@docoo/orchestration';
import { decryptSecret, encryptSecret, type MasterKey } from '@docoo/providers';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import { badRequest, conflict, notFound } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';
import { SECRET_MASTER_KEY } from '../providers/providers.service.js';
import { ContenterClient, ContenterError } from './contenter-client.js';

/** The sealed token is bound to its connection row and version, like a provider key. */
const tokenContext = (connectionId: string, version: number) =>
  `contenter-token:${connectionId}:${version}`;

interface ConnectionRow extends QueryResultRow {
  id: string;
  api_url: string;
  web_url: string | null;
  status: string;
  secret_version: number;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
  wrapped_key: string | null;
  wrap_iv: string | null;
  wrap_tag: string | null;
  key_id: string | null;
  fingerprint: string | null;
  last_checked_at: string | null;
  last_latency_ms: number | null;
  last_error: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

const connectionColumns = `id, api_url, web_url, status, secret_version, ciphertext, iv, tag, wrapped_key, wrap_iv,
  wrap_tag, key_id, fingerprint, ${isoColumn('last_checked_at', 'last_checked_at')}, last_latency_ms, last_error,
  version, ${isoColumn('created_at', 'created_at')}, ${isoColumn('updated_at', 'updated_at')}`;

interface LinkRow extends QueryResultRow {
  project_id: string;
  external_business_id: string;
  name: string;
  snapshot_id: string;
  linked_at: string;
  synced_at: string | null;
  sync_error: string | null;
}

const linkColumns = `l.project_id, l.external_business_id, l.name, l.snapshot_id, ${isoColumn('l.linked_at', 'linked_at')},
  ${isoColumn('l.synced_at', 'synced_at')}, l.sync_error`;

interface SnapshotRow extends QueryResultRow {
  id: string;
  external_business_id: string;
  version_no: number;
  name: string;
  content_sha256: string;
  content: BusinessContent;
  changes: Record<string, unknown>;
  exported_at: string | null;
  fetched_at: string;
}

const snapshotColumns = `s.id, s.external_business_id, s.version_no, s.name, s.content_sha256, s.content, s.changes,
  ${isoColumn('s.exported_at', 'exported_at')}, ${isoColumn('s.fetched_at', 'fetched_at')}`;

/** What one fetch from Contenter gave: the normalized content and its hash. */
export interface FetchedBusiness {
  readonly content: BusinessContent;
  readonly sha256: string;
  readonly exportedAt: string | null;
}

export interface StoredSnapshot {
  readonly id: string;
  readonly versionNo: number;
  /** False when the latest snapshot already had exactly this content. */
  readonly created: boolean;
}

export interface SyncOutcome {
  readonly changed: boolean;
  readonly snapshotId: string;
  readonly versionNo: number;
}

/** What a run or a writing needs to know about the business of its project. */
export interface BusinessForUse {
  readonly snapshotId: string | null;
  /** The reason the latest check of Contenter failed, when it did (the saved snapshot was used). */
  readonly syncError: string | null;
}

/** Asking Contenter before a run or a writing must not hold the start up for long. */
const START_SYNC_TIMEOUT_MS = 8_000;

function badGateway(code: string, detail: string): HttpException {
  return new HttpException({ status: 502, title: 'Bad Gateway', code, detail }, 502);
}

function unavailable(code: string, detail: string): HttpException {
  return new HttpException({ status: 503, title: 'Service Unavailable', code, detail }, 503);
}

/** Contenter's failure as an API problem the page can explain. */
export function contenterProblem(error: unknown): HttpException {
  if (!(error instanceof ContenterError)) throw error;
  switch (error.kind) {
    case 'unreachable':
      return badGateway('CONTENTER_UNREACHABLE', error.message);
    case 'unauthorized':
      return badGateway('CONTENTER_TOKEN_REFUSED', 'Contenter refused the service token.');
    case 'not_available':
      return badGateway(
        'CONTENTER_NOT_AVAILABLE',
        'The address does not serve the Docoo service API (is INTEGRATION_TOKEN set in Contenter?).',
      );
    case 'business_not_found':
      return notFound('BUSINESS_NOT_FOUND', 'Contenter has no business with this id.');
    case 'server_error':
      return badGateway('CONTENTER_ERROR', 'Contenter answered with a server error.');
    case 'bad_response':
      return badGateway(
        'CONTENTER_BAD_RESPONSE',
        `Contenter's answer could not be used (${error.message}).`,
      );
  }
}

/** The short, code-like reason stored on a link when a refresh failed. */
const syncErrorOf = (error: unknown): string =>
  error instanceof ContenterError ? error.kind : 'unexpected_error';

const hashOf = (content: BusinessContent): string =>
  createHash('sha256').update(canonicalBusinessJson(content)).digest('hex');

/** The page of Contenter businesses a project can be linked to (light rows only). */
export interface ContenterBusinessPage {
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    readonly tagline: string;
    readonly industry: string;
    readonly website: string;
    readonly location: string;
    readonly language: string;
    readonly status: string;
    readonly filledSections: number;
    readonly totalSections: number;
    readonly topics: number;
    readonly updatedAt: string | null;
  }[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : '';
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

/**
 * The business a project belongs to (ADR-0021): the connection to Contenter, the pinned snapshots
 * of what it exports, the link of a project and what each agent will be given. Contenter is only
 * ever read; nothing is written there.
 */
@Injectable()
export class BusinessService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly configService: ConfigService,
    @Inject(SECRET_MASTER_KEY) private readonly masterKey: MasterKey | null,
  ) {}

  // ---- the connection ---------------------------------------------------------------------

  async connection(context: WorkspaceRequestContext) {
    return this.database.run(context, async (client) => {
      const row = await this.loadConnection(client);
      return row ? this.toConnection(row) : null;
    });
  }

  async saveConnection(
    context: WorkspaceRequestContext,
    input: { apiUrl: string; webUrl: string | null; token?: string | undefined },
  ) {
    const master = this.requireMasterKey();
    await this.database.run(context, async (client) => {
      const existing = await this.loadConnection(client, true);
      if (!existing && !input.token) {
        throw badRequest('CONTENTER_TOKEN_REQUIRED', 'Enter the service token of Contenter.');
      }
      const id = existing?.id ?? randomUUID();
      const version = (existing?.secret_version ?? 0) + (input.token ? 1 : 0);
      const sealed = input.token
        ? encryptSecret(input.token, master, tokenContext(id, version))
        : null;
      if (!existing) {
        await client.query(
          `insert into contenter_connections (id, workspace_id, api_url, web_url, status, secret_version, ciphertext, iv, tag,
                                              wrapped_key, wrap_iv, wrap_tag, key_id, fingerprint, created_by)
           values ($1, $2, $3, $4, 'unconfigured', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            id,
            context.workspaceId,
            input.apiUrl,
            input.webUrl,
            version,
            sealed?.ciphertext,
            sealed?.iv,
            sealed?.tag,
            sealed?.wrappedKey,
            sealed?.wrapIv,
            sealed?.wrapTag,
            sealed?.keyId,
            sealed?.fingerprint,
            context.actorId,
          ],
        );
      } else {
        await client.query(
          `update contenter_connections
              set api_url = $2, web_url = $3, status = 'unconfigured', last_error = null, version = version + 1,
                  secret_version = $4,
                  ciphertext = coalesce($5, ciphertext), iv = coalesce($6, iv), tag = coalesce($7, tag),
                  wrapped_key = coalesce($8, wrapped_key), wrap_iv = coalesce($9, wrap_iv),
                  wrap_tag = coalesce($10, wrap_tag), key_id = coalesce($11, key_id),
                  fingerprint = coalesce($12, fingerprint)
            where id = $1`,
          [
            id,
            input.apiUrl,
            input.webUrl,
            version,
            sealed?.ciphertext,
            sealed?.iv,
            sealed?.tag,
            sealed?.wrappedKey,
            sealed?.wrapIv,
            sealed?.wrapTag,
            sealed?.keyId,
            sealed?.fingerprint,
          ],
        );
      }
      await writeAudit(client, context, {
        action: 'integration.contenter_configured',
        targetType: 'integration',
        targetId: id,
        securityRelevant: true,
        before: existing ? { apiUrl: existing.api_url, webUrl: existing.web_url } : null,
        after: {
          apiUrl: input.apiUrl,
          webUrl: input.webUrl,
          tokenChanged: Boolean(input.token),
          fingerprint: sealed?.fingerprint ?? existing?.fingerprint ?? null,
        },
      });
    });
    // The new settings are tried at once, so the page shows whether they work.
    return this.testConnection(context);
  }

  async testConnection(context: WorkspaceRequestContext) {
    const { client: contenter, id } = await this.contenterClient(context);
    const started = performance.now();
    let status = 'healthy';
    let error: string | null = null;
    try {
      const answer = (await contenter.ping()) as { ok?: unknown; service?: unknown };
      if (answer?.ok !== true || answer.service !== 'contenter') {
        status = 'invalid';
        error = 'bad_response';
      }
    } catch (failure) {
      if (!(failure instanceof ContenterError)) throw failure;
      status = failure.kind === 'unauthorized' ? 'invalid' : 'unreachable';
      error = failure.kind;
    }
    const latency = Math.round(performance.now() - started);
    return this.database.run(context, async (client) => {
      await client.query(
        `update contenter_connections set status = $2, last_checked_at = now(), last_latency_ms = $3, last_error = $4
          where id = $1`,
        [id, status, status === 'healthy' ? latency : null, error],
      );
      const row = await this.loadConnection(client);
      return this.toConnection(row!);
    });
  }

  async removeConnection(context: WorkspaceRequestContext): Promise<void> {
    await this.database.run(context, async (client) => {
      const row = await this.loadConnection(client, true);
      if (!row) throw notFound('CONTENTER_NOT_CONFIGURED', 'Contenter is not connected.');
      await client.query('delete from contenter_connections where id = $1', [row.id]);
      await writeAudit(client, context, {
        action: 'integration.contenter_removed',
        targetType: 'integration',
        targetId: row.id,
        securityRelevant: true,
        before: { apiUrl: row.api_url, fingerprint: row.fingerprint },
      });
    });
  }

  // ---- reading Contenter ----------------------------------------------------------------------

  /** The businesses of Contenter a project can be linked to. */
  async browse(
    context: WorkspaceRequestContext,
    query: { q?: string | undefined; page: number; pageSize: number },
  ): Promise<ContenterBusinessPage> {
    const { client } = await this.contenterClient(context);
    let answer: unknown;
    try {
      answer = await client.listBusinesses({
        ...(query.q ? { q: query.q } : {}),
        page: query.page,
        pageSize: query.pageSize,
      });
    } catch (error) {
      throw contenterProblem(error);
    }
    const body = (typeof answer === 'object' && answer !== null ? answer : {}) as Record<
      string,
      unknown
    >;
    const rows = Array.isArray(body['items']) ? body['items'] : [];
    return {
      items: rows.flatMap((item): ContenterBusinessPage['items'][number][] => {
        if (typeof item !== 'object' || item === null) return [];
        const row = item as Record<string, unknown>;
        if (typeof row['id'] !== 'string' || !row['id']) return [];
        return [
          {
            id: row['id'].slice(0, 100),
            name: text(row['name'], 300),
            tagline: text(row['tagline'], 600),
            industry: text(row['industry'], 300),
            website: text(row['website'], 500),
            location: text(row['location'], 300),
            language: text(row['language'], 10),
            status: text(row['status'], 30),
            filledSections: count(row['filledSections']),
            totalSections: count(row['totalSections']),
            topics: count(row['topics']),
            updatedAt: typeof row['updatedAt'] === 'string' ? row['updatedAt'] : null,
          },
        ];
      }),
      total: count(body['total']),
      page: count(body['page']) || query.page,
      pageSize: count(body['pageSize']) || query.pageSize,
      totalPages: count(body['totalPages']) || 1,
    };
  }

  /** Reads one business from Contenter (no database transaction is held while waiting). */
  async fetchBusiness(
    context: WorkspaceRequestContext,
    externalId: string,
    timeoutMs?: number,
  ): Promise<FetchedBusiness> {
    const { client } = await this.contenterClient(context, timeoutMs);
    let answer: unknown;
    try {
      answer = await client.exportBusiness(externalId);
    } catch (error) {
      throw contenterProblem(error);
    }
    const normalized = normalizeBusinessExport(answer);
    if (!normalized.ok) {
      throw badGateway(
        'CONTENTER_BAD_RESPONSE',
        `Contenter's export of this business could not be used (${normalized.problem}).`,
      );
    }
    const exportedAt =
      typeof answer === 'object' && answer !== null && 'exportedAt' in answer
        ? String(answer.exportedAt).slice(0, 40)
        : null;
    return { content: normalized.content, sha256: hashOf(normalized.content), exportedAt };
  }

  // ---- snapshots and the project link ---------------------------------------------------------

  /** Keeps a fetched business as the next version, unless the latest one already says the same. */
  async storeSnapshot(
    client: PoolClient,
    context: WorkspaceRequestContext,
    fetched: FetchedBusiness,
  ): Promise<StoredSnapshot> {
    const externalId = fetched.content.business.externalId;
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `business:${context.workspaceId}:${externalId}`,
    ]);
    const latest = (
      await client.query<{
        id: string;
        version_no: number;
        content_sha256: string;
        content: BusinessContent;
      }>(
        `select id, version_no, content_sha256, content from business_snapshots
          where workspace_id = $1 and external_business_id = $2 order by version_no desc limit 1`,
        [context.workspaceId, externalId],
      )
    ).rows[0];
    if (latest && latest.content_sha256 === fetched.sha256) {
      return { id: latest.id, versionNo: latest.version_no, created: false };
    }
    const versionNo = (latest?.version_no ?? 0) + 1;
    const changes = diffBusinessContent(latest?.content ?? null, fetched.content);
    const inserted = (
      await client.query<{ id: string }>(
        `insert into business_snapshots (workspace_id, external_business_id, version_no, name, content_sha256, content,
                                         changes, exported_at, fetched_by)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9) returning id`,
        [
          context.workspaceId,
          externalId,
          versionNo,
          fetched.content.business.name.slice(0, 300),
          fetched.sha256,
          JSON.stringify(fetched.content),
          JSON.stringify(changes),
          fetched.exportedAt && !Number.isNaN(Date.parse(fetched.exportedAt))
            ? fetched.exportedAt
            : null,
          context.actorId,
        ],
      )
    ).rows[0]!;
    return { id: inserted.id, versionNo, created: true };
  }

  /**
   * Links a project to the fetched business inside the caller's transaction (the project is
   * being created, or the link is being changed). Replaces an earlier link.
   */
  async attach(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string,
    fetched: FetchedBusiness,
    reason: string | null,
  ): Promise<StoredSnapshot> {
    const before = (await this.loadLink(client, projectId)) ?? null;
    const stored = await this.storeSnapshot(client, context, fetched);
    const business = fetched.content.business;
    await client.query(
      `insert into project_businesses (project_id, workspace_id, external_business_id, name, snapshot_id, linked_by, synced_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (project_id) do update
         set external_business_id = excluded.external_business_id, name = excluded.name, snapshot_id = excluded.snapshot_id,
             linked_by = excluded.linked_by, linked_at = now(), synced_at = now(), sync_error = null`,
      [
        projectId,
        context.workspaceId,
        business.externalId,
        business.name.slice(0, 300),
        stored.id,
        context.actorId,
      ],
    );
    await writeAudit(client, context, {
      action: 'business.link_set',
      targetType: 'project',
      targetId: projectId,
      projectId,
      reason,
      before: before ? { businessId: before.external_business_id, name: before.name } : null,
      after: {
        businessId: business.externalId,
        name: business.name,
        snapshotId: stored.id,
        versionNo: stored.versionNo,
      },
    });
    return stored;
  }

  /** Links a project to a business of Contenter (or changes the link). */
  async link(
    context: WorkspaceRequestContext,
    projectId: string,
    input: { externalBusinessId: string; reason?: string | undefined },
  ) {
    await this.database.run(context, (client) => this.assertEditable(client, projectId));
    const fetched = await this.fetchBusiness(context, input.externalBusinessId);
    await this.database.run(context, async (client) => {
      await this.assertEditable(client, projectId);
      await this.attach(client, context, projectId, fetched, input.reason ?? null);
    });
    return this.get(context, projectId);
  }

  async unlink(context: WorkspaceRequestContext, projectId: string, reason: string | null) {
    await this.database.run(context, async (client) => {
      await this.assertEditable(client, projectId);
      const link = await this.loadLink(client, projectId);
      if (!link)
        throw notFound('BUSINESS_LINK_NOT_FOUND', 'The project is not linked to a business.');
      await client.query('delete from project_businesses where project_id = $1', [projectId]);
      await writeAudit(client, context, {
        action: 'business.unlinked',
        targetType: 'project',
        targetId: projectId,
        projectId,
        reason,
        before: {
          businessId: link.external_business_id,
          name: link.name,
          snapshotId: link.snapshot_id,
        },
      });
    });
    return this.get(context, projectId);
  }

  /** Asks Contenter again; a change becomes a new snapshot and the project reads it from now on. */
  async sync(
    context: WorkspaceRequestContext,
    projectId: string,
    timeoutMs?: number,
  ): Promise<SyncOutcome> {
    const link = await this.database.run(context, async (client) => {
      const row = await this.loadLink(client, projectId);
      if (!row)
        throw notFound('BUSINESS_LINK_NOT_FOUND', 'The project is not linked to a business.');
      return row;
    });
    let fetched: FetchedBusiness;
    try {
      fetched = await this.fetchBusiness(context, link.external_business_id, timeoutMs);
    } catch (error) {
      const reason = error instanceof HttpException ? this.codeOf(error) : 'unexpected_error';
      await this.database.run(context, (client) =>
        client.query('update project_businesses set sync_error = $2 where project_id = $1', [
          projectId,
          reason.slice(0, 300),
        ]),
      );
      throw error;
    }
    return this.database.run(context, async (client) => {
      const stored = await this.storeSnapshot(client, context, fetched);
      await client.query(
        `update project_businesses set snapshot_id = $2, name = $3, synced_at = now(), sync_error = null where project_id = $1`,
        [projectId, stored.id, fetched.content.business.name.slice(0, 300)],
      );
      if (stored.created) {
        await writeAudit(client, context, {
          action: 'business.snapshot_created',
          targetType: 'project',
          targetId: projectId,
          projectId,
          before: { snapshotId: link.snapshot_id },
          after: {
            snapshotId: stored.id,
            versionNo: stored.versionNo,
            businessId: link.external_business_id,
          },
        });
      }
      return { changed: stored.created, snapshotId: stored.id, versionNo: stored.versionNo };
    });
  }

  /**
   * The snapshot a run or a writing will read. When the project asks for it (`business.sync_on_start`),
   * Contenter is asked first; if it cannot answer, the saved snapshot is used and the reason is returned.
   */
  async resolveForUse(
    context: WorkspaceRequestContext,
    projectId: string,
  ): Promise<BusinessForUse> {
    const link = await this.database.run(context, (client) => this.loadLink(client, projectId));
    if (!link) return { snapshotId: null, syncError: null };
    const config = await this.configService.effective(context, 'project', projectId);
    if (config.values['business.sync_on_start'] === false) {
      return { snapshotId: link.snapshot_id, syncError: link.sync_error };
    }
    try {
      const outcome = await this.sync(context, projectId, START_SYNC_TIMEOUT_MS);
      return { snapshotId: outcome.snapshotId, syncError: null };
    } catch (error) {
      return {
        snapshotId: link.snapshot_id,
        syncError: error instanceof HttpException ? this.codeOf(error) : syncErrorOf(error),
      };
    }
  }

  /**
   * What one role reads of the project's business now (the snapshot its link points at), for the
   * calls that run outside a workflow: solutions and document evaluation. Null without a link.
   */
  async roleBusiness(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string,
    role: AgentRole,
  ): Promise<RoleBusiness | null> {
    const link = await this.loadLink(client, projectId);
    if (!link) return null;
    const config = await this.configService.resolve(client, context, 'project', projectId);
    return businessForRole(
      await loadSnapshot(client, link.snapshot_id),
      role,
      config.values['business.prompt_budget_chars'],
    );
  }

  /** The brand terminology of the project's business (what the documenter must keep to). */
  async termRules(client: PoolClient, projectId: string): Promise<readonly BusinessTerm[]> {
    const link = await this.loadLink(client, projectId);
    if (!link) return [];
    return (await loadSnapshot(client, link.snapshot_id))?.content.terms ?? [];
  }

  async hasLink(client: PoolClient, projectId: string): Promise<boolean> {
    return (await this.loadLink(client, projectId)) !== undefined;
  }

  /** A cloned project reads the same business, at the snapshot the original reads now. */
  async copyLink(
    client: PoolClient,
    context: WorkspaceRequestContext,
    fromProjectId: string,
    toProjectId: string,
  ): Promise<void> {
    await client.query(
      `insert into project_businesses (project_id, workspace_id, external_business_id, name, snapshot_id, linked_by, synced_at)
       select $2, workspace_id, external_business_id, name, snapshot_id, $3, synced_at
         from project_businesses where project_id = $1`,
      [fromProjectId, toProjectId, context.actorId],
    );
  }

  // ---- reading what is stored -----------------------------------------------------------------

  /** The link of a project with the full content of the snapshot its agents read. */
  async get(context: WorkspaceRequestContext, projectId: string) {
    return this.database.run(context, async (client) => {
      await this.assertProject(client, projectId);
      const connection = await this.loadConnection(client);
      const link = await this.loadLink(client, projectId);
      if (!link)
        return { connection: this.connectionSummary(connection), link: null, snapshot: null };
      const snapshot = (
        await client.query<SnapshotRow>(
          `select ${snapshotColumns} from business_snapshots s where s.id = $1`,
          [link.snapshot_id],
        )
      ).rows[0]!;
      const latest = (
        await client.query<{ version_no: number }>(
          `select max(version_no)::int as version_no from business_snapshots
            where workspace_id = $1 and external_business_id = $2`,
          [context.workspaceId, link.external_business_id],
        )
      ).rows[0]!;
      return {
        connection: this.connectionSummary(connection),
        link: {
          externalBusinessId: link.external_business_id,
          name: link.name,
          snapshotId: link.snapshot_id,
          linkedAt: link.linked_at,
          syncedAt: link.synced_at,
          syncError: link.sync_error,
          contenterUrl: this.contenterUrl(connection, link.external_business_id),
        },
        snapshot: this.toSnapshot(snapshot, true),
        latestVersionNo: latest.version_no,
      };
    });
  }

  /** The versions of the project's business Docoo has kept, with how many runs read each. */
  async snapshots(context: WorkspaceRequestContext, projectId: string) {
    return this.database.run(context, async (client) => {
      await this.assertProject(client, projectId);
      const link = await this.loadLink(client, projectId);
      if (!link) return { items: [] };
      const rows = (
        await client.query<SnapshotRow & { runs: number; writings: number }>(
          `select ${snapshotColumns},
                  (select count(*)::int from workflow_runs r where r.business_snapshot_id = s.id) as runs,
                  (select count(*)::int from document_writings w where w.business_snapshot_id = s.id) as writings
             from business_snapshots s
            where s.workspace_id = $1 and s.external_business_id = $2
            order by s.version_no desc limit 50`,
          [context.workspaceId, link.external_business_id],
        )
      ).rows;
      return {
        items: rows.map((row) => ({
          ...this.toSnapshot(row, false),
          current: row.id === link.snapshot_id,
          runs: row.runs,
          writings: row.writings,
        })),
      };
    });
  }

  async snapshot(context: WorkspaceRequestContext, projectId: string, snapshotId: string) {
    return this.database.run(context, async (client) => {
      await this.assertProject(client, projectId);
      const link = await this.loadLink(client, projectId);
      const row = link
        ? (
            await client.query<SnapshotRow>(
              `select ${snapshotColumns} from business_snapshots s
                where s.id = $1 and s.workspace_id = $2 and s.external_business_id = $3`,
              [snapshotId, context.workspaceId, link.external_business_id],
            )
          ).rows[0]
        : undefined;
      if (!row) throw notFound('BUSINESS_SNAPSHOT_NOT_FOUND', 'The snapshot was not found.');
      return { snapshot: this.toSnapshot(row, true) };
    });
  }

  /**
   * What each agent role will be given from the project's business: which sections, how many
   * characters, what did not fit. `role` adds the exact data of that role.
   */
  async contextPreview(
    context: WorkspaceRequestContext,
    projectId: string,
    role: AgentRole | null,
  ) {
    const config = await this.configService.effective(context, 'project', projectId);
    const budgetChars = clampBusinessBudget(
      config.values['business.prompt_budget_chars'] ?? BUSINESS_PROMPT_DEFAULT_CHARS,
    );
    return this.database.run(context, async (client) => {
      await this.assertProject(client, projectId);
      const link = await this.loadLink(client, projectId);
      if (!link) return { linked: false, budgetChars, roles: [] };
      const snapshot = (
        await client.query<SnapshotRow>(
          `select ${snapshotColumns} from business_snapshots s where s.id = $1`,
          [link.snapshot_id],
        )
      ).rows[0]!;
      const now = new Date();
      return {
        linked: true,
        snapshotId: snapshot.id,
        versionNo: snapshot.version_no,
        budgetChars,
        roles: AGENT_ROLES.map((agentRole) => {
          const prompt = businessPrompt(snapshot.content, { role: agentRole, budgetChars, now });
          return {
            role: agentRole,
            summary: prompt?.summary ?? null,
            ...(role === agentRole && prompt ? { data: prompt.data, rules: prompt.rules } : {}),
          };
        }),
      };
    });
  }

  // ---- helpers -------------------------------------------------------------------------------

  private requireMasterKey(): MasterKey {
    if (!this.masterKey) {
      throw unavailable('SECRET_STORE_UNAVAILABLE', 'SECRET_MASTER_KEY is not configured.');
    }
    return this.masterKey;
  }

  private codeOf(error: HttpException): string {
    const body = error.getResponse();
    return typeof body === 'object' && body !== null && 'code' in body
      ? String(body.code)
      : 'error';
  }

  /** A ready client: the stored token is opened only here, for the length of one request. */
  private async contenterClient(
    context: WorkspaceRequestContext,
    timeoutMs?: number,
  ): Promise<{ client: ContenterClient; id: string }> {
    const row = await this.database.run(context, (client) => this.loadConnection(client));
    if (!row || row.secret_version === 0 || !row.ciphertext) {
      throw conflict(
        'CONTENTER_NOT_CONFIGURED',
        'Connect Contenter first (address and service token).',
      );
    }
    const master = this.requireMasterKey();
    const token = decryptSecret(
      {
        ciphertext: row.ciphertext,
        iv: row.iv!,
        tag: row.tag!,
        wrappedKey: row.wrapped_key!,
        wrapIv: row.wrap_iv!,
        wrapTag: row.wrap_tag!,
        keyId: row.key_id!,
        fingerprint: row.fingerprint!,
      },
      master,
      tokenContext(row.id, row.secret_version),
    );
    return {
      client: new ContenterClient({
        apiUrl: row.api_url,
        token,
        ...(timeoutMs ? { timeoutMs } : {}),
      }),
      id: row.id,
    };
  }

  private async loadConnection(
    client: PoolClient,
    forUpdate = false,
  ): Promise<ConnectionRow | undefined> {
    return (
      await client.query<ConnectionRow>(
        `select ${connectionColumns} from contenter_connections ${forUpdate ? 'for update' : ''}`,
      )
    ).rows[0];
  }

  private async loadLink(client: PoolClient, projectId: string): Promise<LinkRow | undefined> {
    return (
      await client.query<LinkRow>(
        `select ${linkColumns} from project_businesses l where l.project_id = $1`,
        [projectId],
      )
    ).rows[0];
  }

  private async assertProject(client: PoolClient, projectId: string): Promise<string> {
    const row = (
      await client.query<{ status: string }>('select status from projects where id = $1', [
        projectId,
      ])
    ).rows[0];
    if (!row) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');
    return row.status;
  }

  private async assertEditable(client: PoolClient, projectId: string): Promise<void> {
    const status = await this.assertProject(client, projectId);
    if (status === 'archived' || status === 'deleted') {
      throw conflict('PROJECT_READ_ONLY', `A ${status} project cannot change its business.`);
    }
  }

  private contenterUrl(connection: ConnectionRow | undefined, externalId: string): string | null {
    if (!connection?.web_url) return null;
    return `${connection.web_url.replace(/\/+$/u, '')}/app/businesses/${encodeURIComponent(externalId)}`;
  }

  private connectionSummary(row: ConnectionRow | undefined) {
    return row
      ? { configured: row.secret_version > 0, status: row.status }
      : { configured: false, status: 'unconfigured' };
  }

  private toSnapshot(row: SnapshotRow, withContent: boolean) {
    return {
      id: row.id,
      versionNo: row.version_no,
      name: row.name,
      contentSha256: row.content_sha256,
      changes: row.changes,
      exportedAt: row.exported_at,
      fetchedAt: row.fetched_at,
      ...(withContent ? { content: row.content } : {}),
    };
  }

  private toConnection(row: ConnectionRow) {
    return {
      apiUrl: row.api_url,
      webUrl: row.web_url,
      status: row.status,
      secret: {
        configured: row.secret_version > 0,
        version: row.secret_version,
        fingerprint: row.fingerprint,
      },
      lastCheckedAt: row.last_checked_at,
      lastLatencyMs: row.last_latency_ms,
      lastError: row.last_error,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
