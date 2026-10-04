import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  assessCitation,
  chunkText,
  detectConflicts,
  effectiveDecision,
  embed,
  EMBEDDING_MODEL,
  extractClaimCandidates,
  normalizeForSearch,
  overrideReasonProblem,
  searchText,
  statusForDecision,
  vectorLiteral,
  type AuditResult,
  type CitationInput,
  type ClaimKind,
  type KnowledgeAuditor,
} from '@docoo/knowledge';
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
import { canonicalJson } from '../config/setting-value.js';
import { SourcesService } from '../sources/sources.service.js';

export const KNOWLEDGE_AUDITOR = Symbol('KNOWLEDGE_AUDITOR');

export type KnowledgeSourceType = 'admin_provided' | 'clue_guided' | 'autonomous_research';
export type Confidentiality = 'internal' | 'confidential' | 'restricted';
export type ScopeType = 'workspace' | 'topic' | 'project';

export interface ScopeInput {
  readonly type: ScopeType;
  readonly id: string;
  readonly role?: string | undefined;
}

export interface ClaimInput {
  readonly text: string;
  readonly kind?: ClaimKind | 'statement' | undefined;
  readonly citations?: readonly CitationInput[] | undefined;
}

export interface CreateKnowledgeInput {
  readonly title: string;
  readonly sourceType: KnowledgeSourceType;
  readonly confidentiality: Confidentiality;
  readonly language: 'fa' | 'en';
  readonly content: string;
  readonly scopes: readonly ScopeInput[];
  readonly provenance: Record<string, unknown>;
  readonly validFrom?: string | undefined;
  readonly validUntil?: string | undefined;
  readonly claims?: readonly ClaimInput[] | undefined;
}

export interface NewVersionInput {
  /** New text; or `sourceVersionId` to take the text from a newer version of the same source. */
  readonly content?: string | undefined;
  readonly sourceVersionId?: string | undefined;
  readonly acceptPartial?: boolean | undefined;
  readonly provenance?: Record<string, unknown> | undefined;
  readonly validFrom?: string | undefined;
  readonly validUntil?: string | undefined;
  readonly claims?: readonly ClaimInput[] | undefined;
  readonly reason: string;
}

export interface FromSourceInput {
  readonly sourceId: string;
  readonly versionId: string;
  readonly title: string;
  readonly confidentiality: Confidentiality;
  readonly scopes: readonly ScopeInput[];
  readonly declaration: string;
  readonly acceptPartial: boolean;
}

export interface RetrieveInput {
  readonly query: string;
  readonly projectId?: string | undefined;
  readonly topicId?: string | undefined;
  readonly role?: string | undefined;
  readonly limit: number;
}

interface ItemRow extends QueryResultRow {
  id: string;
  title: string;
  source_type: KnowledgeSourceType;
  confidentiality: Confidentiality;
  language: 'fa' | 'en';
  current_version_id: string | null;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow extends QueryResultRow {
  id: string;
  item_id: string;
  version_no: number;
  status: string;
  content: string;
  content_sha256: string;
  language: 'fa' | 'en';
  source_version_id: string | null;
  provenance: Record<string, unknown>;
  valid_from: string | null;
  valid_until: string | null;
  stale_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ReviewRow extends QueryResultRow {
  id: string;
  knowledge_version_id: string;
  rubric_version: string;
  auditor: string;
  scores: Record<string, number>;
  overall: number;
  decision: 'approved' | 'needs_revision' | 'rejected';
  reasons: string[];
  claim_results: unknown;
  critical_flags: string[];
  created_at: string;
}

interface OverrideRow extends QueryResultRow {
  id: string;
  review_id: string;
  decision: 'approve' | 'reject';
  reason: string;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
}

const itemColumns = `id, title, source_type, confidentiality, language, current_version_id, version,
  ${isoColumn('deleted_at', 'deleted_at')}, ${isoColumn('created_at', 'created_at')}, ${isoColumn('updated_at', 'updated_at')}`;
const versionColumns = `id, item_id, version_no, status, content, content_sha256, language, source_version_id,
  provenance, ${isoColumn('valid_from', 'valid_from')}, ${isoColumn('valid_until', 'valid_until')}, stale_reason,
  created_by, ${isoColumn('created_at', 'created_at')}, ${isoColumn('updated_at', 'updated_at')}`;
function reviewColumnsOf(alias: string): string {
  return `${alias}.id, ${alias}.knowledge_version_id, ${alias}.rubric_version, ${alias}.auditor, ${alias}.scores,
  ${alias}.overall, ${alias}.decision, ${alias}.reasons, ${alias}.claim_results, ${alias}.critical_flags,
  ${isoColumn(`${alias}.created_at`, 'created_at')}`;
}
const reviewColumns = reviewColumnsOf('audit_reviews');
const overrideColumns = `id, review_id, decision, reason, ${isoColumn('expires_at', 'expires_at')}, created_by,
  ${isoColumn('created_at', 'created_at')}`;

/** Upper bound of existing claims compared during conflict detection. */
const CONFLICT_COMPARE_LIMIT = 5000;
const RRF_K = 60;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly sources: SourcesService,
    @Inject(KNOWLEDGE_AUDITOR) private readonly auditor: KnowledgeAuditor,
  ) {}

  // ---------------------------------------------------------------- items and versions (KNO-001)

  async list(
    context: WorkspaceRequestContext,
    input: {
      limit: number;
      cursor?: string | undefined;
      status?: string | undefined;
      sourceType?: KnowledgeSourceType | undefined;
      scopeType?: ScopeType | undefined;
      scopeId?: string | undefined;
      q?: string | undefined;
    },
  ) {
    const scope = listScope(`${context.workspaceId}:knowledge`, {
      status: input.status,
      sourceType: input.sourceType,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      q: input.q,
    });
    const cursor = input.cursor
      ? decodeCursor(input.cursor, scope, 'KNOWLEDGE_CURSOR_INVALID')
      : null;
    return this.database.run(context, async (client) => {
      const result = await client.query<
        ItemRow & {
          sort_at: string;
          version_no: number | null;
          status: string | null;
          stale_reason: string | null;
          valid_until: string | null;
          source_version_id: string | null;
          overall: number | null;
          review_decision: 'approved' | 'needs_revision' | 'rejected' | null;
          override_decision: 'approve' | 'reject' | null;
          override_expires_at: string | null;
          claim_count: number | null;
          open_conflicts: number | null;
          scopes: { type: ScopeType; id: string; role: string | null }[];
        }
      >(
        `select i.*, v.version_no, ${visibleStatusSql('v')} as status, v.stale_reason,
                ${isoColumn('v.valid_until', 'valid_until')}, v.source_version_id,
                r.overall, r.decision as review_decision,
                o.decision as override_decision, ${isoColumn('o.expires_at', 'override_expires_at')},
                (select count(*)::int from claims c where c.knowledge_version_id = v.id) as claim_count,
                (select count(distinct k.id)::int from knowledge_conflicts k
                   join claims c on c.id in (k.claim_a_id, k.claim_b_id)
                  where k.status = 'open' and c.knowledge_version_id = v.id) as open_conflicts,
                (select coalesce(json_agg(json_build_object('type', s.scope_type, 'id', s.scope_id, 'role', s.role)
                                          order by s.scope_type, s.scope_id, coalesce(s.role, '')), '[]'::json)
                   from knowledge_scopes s where s.item_id = i.id) as scopes
           from (select ${itemColumns}, created_at as sort_at from knowledge_items k
                  where workspace_id = $1 and deleted_at is null
                    and ($6::text is null or source_type::text = $6)
                    and ($7::text is null or exists (
                          select 1 from knowledge_scopes s
                           where s.item_id = k.id and s.scope_type::text = $7 and s.scope_id = $8::uuid))
                    and ($9::text is null or title ilike $9)) i
           left join knowledge_versions v on v.id = i.current_version_id
           left join lateral (select decision, overall from audit_reviews
                               where knowledge_version_id = v.id
                               order by created_at desc, id desc limit 1) r on true
           left join lateral (select decision, expires_at from audit_overrides
                               where knowledge_version_id = v.id and (expires_at is null or expires_at > now())
                               order by created_at desc, id desc limit 1) o on true
          where ($2::text is null or ${visibleStatusSql('v')} = $2)
            and ($3::timestamptz is null or (i.sort_at, i.id) < ($3::timestamptz, $4::uuid))
          order by i.sort_at desc, i.id desc
          limit $5`,
        [
          context.workspaceId,
          input.status ?? null,
          cursor?.at ?? null,
          cursor?.id ?? null,
          input.limit + 1,
          input.sourceType ?? null,
          input.scopeType ?? null,
          input.scopeId ?? null,
          input.q ? containsPattern(input.q) : null,
        ],
      );
      const rows = result.rows.slice(0, input.limit);
      const last = rows.at(-1);
      const titles = await scopeTitles(
        client,
        rows.flatMap((row) => row.scopes),
      );
      const now = new Date();
      return {
        items: rows.map((row) => ({
          ...this.toItem(row),
          versionNo: row.version_no,
          status: row.status,
          staleReason: row.stale_reason,
          validUntil: row.valid_until,
          sourceVersionId: row.source_version_id,
          overall: row.overall,
          decision: row.review_decision,
          effectiveDecision: row.stale_reason
            ? 'stale'
            : effectiveDecision(
                row.review_decision,
                row.override_decision
                  ? { decision: row.override_decision, expiresAt: row.override_expires_at }
                  : null,
                now,
              ),
          claimCount: row.claim_count ?? 0,
          openConflicts: row.open_conflicts ?? 0,
          scopes: row.scopes.map((entry) => ({
            ...entry,
            title: titles.get(scopeKey(entry)) ?? null,
          })),
        })),
        nextCursor:
          result.rows.length > input.limit && last
            ? encodeCursor(scope, last.created_at, last.id)
            : null,
      };
    });
  }

  /**
   * The claim view of the audit queue: the claims of every current version, each with the
   * Brain's verdict on it, its citations and the open conflicts it is part of.
   */
  async listClaims(
    context: WorkspaceRequestContext,
    input: {
      limit: number;
      cursor?: string | undefined;
      status?: string | undefined;
      supported?: 'yes' | 'no' | 'unaudited' | undefined;
      conflicted?: boolean | undefined;
      kind?: string | undefined;
      knowledgeId?: string | undefined;
    },
  ) {
    const scope = listScope(`${context.workspaceId}:claims`, {
      status: input.status,
      supported: input.supported,
      conflicted: input.conflicted ? 'yes' : undefined,
      kind: input.kind,
      knowledgeId: input.knowledgeId,
    });
    const cursor = input.cursor
      ? decodeCursor(input.cursor, scope, 'KNOWLEDGE_CURSOR_INVALID')
      : null;
    return this.database.run(context, async (client) => {
      const result = await client.query<{
        id: string;
        ordinal: number;
        text: string;
        kind: string;
        created_at: string;
        item_id: string;
        title: string;
        version_id: string;
        version_no: number;
        status: string;
        stale_reason: string | null;
        review_decision: 'approved' | 'needs_revision' | 'rejected' | null;
        override_decision: 'approve' | 'reject' | null;
        override_expires_at: string | null;
        supported: boolean | null;
        support_reason: string | null;
        citation_count: number;
        complete_citations: number;
        open_conflicts: number;
      }>(
        `select c.id, c.ordinal, c.text, c.kind, ${isoColumn('c.created_at', 'created_at')},
                i.id as item_id, i.title, v.id as version_id, v.version_no,
                ${visibleStatusSql('v')} as status, v.stale_reason,
                r.decision as review_decision, o.decision as override_decision,
                ${isoColumn('o.expires_at', 'override_expires_at')},
                sup.supported, sup.reason as support_reason,
                (select count(*)::int from citations ct where ct.claim_id = c.id) as citation_count,
                (select count(*)::int from citations ct where ct.claim_id = c.id and ct.complete) as complete_citations,
                (select count(distinct k.id)::int from knowledge_conflicts k
                  where k.status = 'open' and c.id in (k.claim_a_id, k.claim_b_id)) as open_conflicts
           from claims c
           join knowledge_versions v on v.id = c.knowledge_version_id
           join knowledge_items i on i.id = v.item_id and i.current_version_id = v.id
                                 and i.deleted_at is null and i.workspace_id = $1
           left join lateral (select decision, claim_results from audit_reviews
                               where knowledge_version_id = v.id
                               order by created_at desc, id desc limit 1) r on true
           left join lateral (select decision, expires_at from audit_overrides
                               where knowledge_version_id = v.id and (expires_at is null or expires_at > now())
                               order by created_at desc, id desc limit 1) o on true
           left join lateral (select (e->>'supported')::boolean as supported, e->>'reason' as reason
                                from jsonb_array_elements(r.claim_results) e
                               where e->>'claimId' = c.id::text limit 1) sup on true
          where ($2::text is null or ${visibleStatusSql('v')} = $2)
            and ($6::text is null or c.kind = $6)
            and ($7::uuid is null or i.id = $7)
            and ($8::text is null
                 or ($8 = 'yes' and sup.supported is true)
                 or ($8 = 'no' and sup.supported is false)
                 or ($8 = 'unaudited' and sup.supported is null))
            and (not $9::boolean or exists (
                   select 1 from knowledge_conflicts k
                    where k.status = 'open' and c.id in (k.claim_a_id, k.claim_b_id)))
            and ($3::timestamptz is null or (c.created_at, c.id) < ($3::timestamptz, $4::uuid))
          order by c.created_at desc, c.id desc
          limit $5`,
        [
          context.workspaceId,
          input.status ?? null,
          cursor?.at ?? null,
          cursor?.id ?? null,
          input.limit + 1,
          input.kind ?? null,
          input.knowledgeId ?? null,
          input.supported ?? null,
          input.conflicted ?? false,
        ],
      );
      const rows = result.rows.slice(0, input.limit);
      const last = rows.at(-1);
      const now = new Date();
      return {
        items: rows.map((row) => ({
          id: row.id,
          ordinal: row.ordinal,
          text: row.text,
          kind: row.kind,
          knowledgeId: row.item_id,
          title: row.title,
          versionId: row.version_id,
          versionNo: row.version_no,
          status: row.status,
          effectiveDecision: row.stale_reason
            ? 'stale'
            : effectiveDecision(
                row.review_decision,
                row.override_decision
                  ? { decision: row.override_decision, expiresAt: row.override_expires_at }
                  : null,
                now,
              ),
          supported: row.supported,
          supportReason: row.support_reason,
          citations: { total: row.citation_count, complete: row.complete_citations },
          openConflicts: row.open_conflicts,
        })),
        nextCursor:
          result.rows.length > input.limit && last
            ? encodeCursor(scope, last.created_at, last.id)
            : null,
      };
    });
  }

  async create(context: WorkspaceRequestContext, input: CreateKnowledgeInput) {
    return this.database.run(context, async (client) => {
      await this.assertScopes(client, context, input.scopes);
      const item = (
        await client.query<ItemRow>(
          `insert into knowledge_items (workspace_id, title, source_type, confidentiality, language, created_by)
           values ($1, $2, $3, $4, $5, $6) returning ${itemColumns}`,
          [
            context.workspaceId,
            input.title,
            input.sourceType,
            input.confidentiality,
            input.language,
            context.actorId,
          ],
        )
      ).rows[0]!;
      await this.insertScopes(client, context, item.id, input.scopes);
      const provenance = this.provenance(context, input.sourceType, input.provenance);
      const version = await this.insertVersion(client, context, item, 1, 'draft', {
        content: input.content,
        language: input.language,
        provenance,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        sourceVersionId: null,
      });
      await this.insertClaims(client, context, version.id, input.content, input.claims);
      const updated = await this.setCurrent(client, item.id, version.id);
      await writeAudit(client, context, {
        action: 'knowledge.create',
        targetType: 'knowledge',
        targetId: item.id,
        after: {
          versionId: version.id,
          sourceType: input.sourceType,
          confidentiality: input.confidentiality,
          scopes: input.scopes,
          contentSha256: version.content_sha256,
        },
      });
      return this.detail(client, updated);
    });
  }

  /** ING-008: knowledge candidate from an extracted source with located claim candidates. */
  async createFromSource(context: WorkspaceRequestContext, input: FromSourceInput) {
    return this.database.run(context, async (client) => {
      const material = await this.sourceMaterial(
        client,
        input.versionId,
        input.sourceId,
        input.acceptPartial,
      );
      await this.assertScopes(client, context, input.scopes);
      const item = (
        await client.query<ItemRow>(
          `insert into knowledge_items (workspace_id, title, source_type, confidentiality, language, created_by)
           values ($1, $2, 'admin_provided', $3, $4, $5) returning ${itemColumns}`,
          [
            context.workspaceId,
            input.title,
            input.confidentiality,
            material.language,
            context.actorId,
          ],
        )
      ).rows[0]!;
      await this.insertScopes(client, context, item.id, input.scopes);
      const provenance = this.provenance(context, 'admin_provided', {
        declaration: input.declaration,
        sourceId: input.sourceId,
        sourceVersionId: input.versionId,
        sourceSha256: material.sha256,
        partial: material.partial,
      });
      const knowledgeVersion = await this.insertVersion(client, context, item, 1, 'draft', {
        content: material.content,
        language: material.language,
        provenance,
        validFrom: undefined,
        validUntil: undefined,
        sourceVersionId: input.versionId,
      });
      await this.insertSourceClaims(
        client,
        context,
        knowledgeVersion.id,
        input.versionId,
        material,
      );
      const updated = await this.setCurrent(client, item.id, knowledgeVersion.id);
      await writeAudit(client, context, {
        action: 'knowledge.create_from_source',
        targetType: 'knowledge',
        targetId: item.id,
        after: {
          versionId: knowledgeVersion.id,
          sourceVersionId: input.versionId,
          claimCandidates: material.candidates.length,
        },
      });
      return this.detail(client, updated);
    });
  }

  /**
   * The text of an extracted source version and the claim candidates located in it. Only an
   * indexed version qualifies; a partly extracted one needs the caller to accept that.
   */
  private async sourceMaterial(
    client: PoolClient,
    versionId: string,
    sourceId: string,
    acceptPartial: boolean,
  ) {
    const version = await client.query<{ id: string; status: string; sha256: string | null }>(
      `select id, status, sha256 from source_versions where id = $1 and asset_id = $2`,
      [versionId, sourceId],
    );
    const source = version.rows[0];
    if (!source) throw notFound('SOURCE_VERSION_NOT_FOUND', 'The source version was not found.');
    if (source.status !== 'indexed' && !(source.status === 'partial' && acceptPartial)) {
      throw conflict(
        'KNOWLEDGE_SOURCE_NOT_READY',
        source.status === 'partial'
          ? 'The source was only partly extracted; confirm with acceptPartial to use it.'
          : 'Only an indexed source can become knowledge.',
      );
    }
    const segments = await client.query<{
      id: string;
      ordinal: number;
      locator: Record<string, string | number>;
      text: string;
    }>(
      `select id, ordinal, locator, text from source_segments where source_version_id = $1 order by ordinal`,
      [versionId],
    );
    if (segments.rowCount === 0)
      throw conflict('KNOWLEDGE_SOURCE_EMPTY', 'The source has no extracted text.');
    const content = segments.rows.map((segment) => segment.text).join('\n\n');
    const language: 'fa' | 'en' = /[؀-ۿ]/u.test(content) ? 'fa' : 'en';
    return {
      content,
      language,
      sha256: source.sha256,
      partial: source.status === 'partial',
      candidates: extractClaimCandidates(
        segments.rows.map((segment) => ({
          ordinal: segment.ordinal,
          locator: segment.locator,
          text: segment.text,
        })),
      ),
      segmentIds: new Map(segments.rows.map((segment) => [segment.ordinal, segment.id])),
    };
  }

  private async insertSourceClaims(
    client: PoolClient,
    context: WorkspaceRequestContext,
    knowledgeVersionId: string,
    sourceVersionId: string,
    material: Awaited<ReturnType<KnowledgeService['sourceMaterial']>>,
  ): Promise<void> {
    for (const candidate of material.candidates) {
      await client.query(
        `insert into claims (workspace_id, knowledge_version_id, ordinal, text, normalized_text, kind, locator, source_segment_id)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          context.workspaceId,
          knowledgeVersionId,
          candidate.ordinal,
          candidate.text,
          candidate.normalizedText,
          candidate.kind,
          JSON.stringify({ ...candidate.locator, sourceVersionId }),
          material.segmentIds.get(candidate.locator.segment) ?? null,
        ],
      );
    }
  }

  async get(context: WorkspaceRequestContext, itemId: string) {
    return this.database.run(context, async (client) =>
      this.detail(client, await this.loadItem(client, itemId)),
    );
  }

  async versions(context: WorkspaceRequestContext, itemId: string) {
    return this.database.run(context, async (client) => {
      await this.loadItem(client, itemId);
      const result = await client.query<VersionRow>(
        `select ${versionColumns} from knowledge_versions where item_id = $1 order by version_no desc`,
        [itemId],
      );
      return result.rows.map((row) => this.toVersion(row, false));
    });
  }

  async version(context: WorkspaceRequestContext, itemId: string, versionId: string) {
    return this.database.run(context, async (client) => {
      await this.loadItem(client, itemId);
      const version = await this.loadVersion(client, itemId, versionId);
      return {
        ...this.toVersion(version, true),
        claims: await this.claims(client, version.id),
        reviews: (await this.reviews(client, version.id)).map((row) => this.toReview(row)),
      };
    });
  }

  /**
   * KNO-002: new content is a new version awaiting audit (`pending`); the previous version is
   * superseded and its review no longer applies to retrieval.
   */
  async newVersion(
    context: WorkspaceRequestContext,
    itemId: string,
    expectedVersion: number,
    input: NewVersionInput,
  ) {
    return this.database.run(context, async (client) => {
      const item = await this.loadItem(client, itemId, true);
      if (item.version !== expectedVersion) {
        throw preconditionFailed(
          'KNOWLEDGE_VERSION_CONFLICT',
          'The knowledge item changed; reload it and try again.',
        );
      }
      const previous = item.current_version_id
        ? await this.loadVersion(client, itemId, item.current_version_id)
        : null;
      if ((input.content === undefined) === (input.sourceVersionId === undefined)) {
        throw badRequest(
          'KNOWLEDGE_INVALID_REQUEST',
          'Give either new content or a newer source version, not both.',
        );
      }
      const material = input.sourceVersionId
        ? await this.newSourceMaterial(
            client,
            previous,
            input.sourceVersionId,
            !!input.acceptPartial,
          )
        : null;
      const content = material ? material.content : input.content!;
      const next = (
        await client.query<{ next: number }>(
          'select coalesce(max(version_no), 0) + 1 as next from knowledge_versions where item_id = $1',
          [itemId],
        )
      ).rows[0]!.next;
      const provenance = this.provenance(context, item.source_type, {
        ...(previous?.provenance ?? {}),
        ...(input.provenance ?? {}),
        ...(material && input.sourceVersionId
          ? {
              sourceVersionId: input.sourceVersionId,
              sourceSha256: material.sha256,
              partial: material.partial,
            }
          : {}),
        previousVersionId: previous?.id ?? null,
        reason: input.reason,
      });
      const version = await this.insertVersion(client, context, item, next, 'pending', {
        content,
        language: item.language,
        provenance,
        validFrom: input.validFrom ?? previous?.valid_from ?? undefined,
        validUntil: input.validUntil ?? previous?.valid_until ?? undefined,
        sourceVersionId: input.sourceVersionId ?? previous?.source_version_id ?? null,
      });
      if (material && input.sourceVersionId) {
        await this.insertSourceClaims(client, context, version.id, input.sourceVersionId, material);
      } else {
        await this.insertClaims(client, context, version.id, content, input.claims);
      }
      if (previous && previous.status !== 'superseded') {
        await client.query(`update knowledge_versions set status = 'superseded' where id = $1`, [
          previous.id,
        ]);
      }
      const updated = await this.setCurrent(client, itemId, version.id);
      await writeAudit(client, context, {
        action: 'knowledge.version',
        targetType: 'knowledge',
        targetId: itemId,
        reason: input.reason,
        before: previous
          ? {
              versionId: previous.id,
              status: previous.status,
              contentSha256: previous.content_sha256,
            }
          : null,
        after: {
          versionId: version.id,
          status: 'pending',
          contentSha256: version.content_sha256,
          sourceVersionId: input.sourceVersionId ?? null,
          previousReview: 'stale',
        },
      });
      return this.detail(client, updated);
    });
  }

  /** A new version of a knowledge item may only come from a newer version of its own source. */
  private async newSourceMaterial(
    client: PoolClient,
    previous: VersionRow | null,
    sourceVersionId: string,
    acceptPartial: boolean,
  ) {
    const origin = previous?.source_version_id
      ? (
          await client.query<{ asset_id: string }>(
            'select asset_id from source_versions where id = $1',
            [previous.source_version_id],
          )
        ).rows[0]
      : undefined;
    if (!origin) {
      throw conflict(
        'KNOWLEDGE_NO_SOURCE',
        'This knowledge was not built from a source, so it has no newer source version.',
      );
    }
    return this.sourceMaterial(client, sourceVersionId, origin.asset_id, acceptPartial);
  }

  async delete(context: WorkspaceRequestContext, itemId: string, reason: string | undefined) {
    return this.database.run(context, async (client) => {
      const item = await this.loadItem(client, itemId, true);
      const updated = (
        await client.query<ItemRow>(
          `update knowledge_items set deleted_at = now(), version = version + 1 where id = $1 returning ${itemColumns}`,
          [item.id],
        )
      ).rows[0]!;
      await writeAudit(client, context, {
        action: 'knowledge.delete',
        targetType: 'knowledge',
        targetId: itemId,
        reason: reason ?? null,
        severity: 'warning',
      });
      return this.toItem(updated);
    });
  }

  // ---------------------------------------------------------------- Brain audit (KNO-003)

  async submitAudit(context: WorkspaceRequestContext, itemId: string) {
    return this.database.run(context, async (client) => {
      const item = await this.loadItem(client, itemId, true);
      if (!item.current_version_id)
        throw conflict('KNOWLEDGE_NO_VERSION', 'The item has no version to audit.');
      const version = await this.loadVersion(client, itemId, item.current_version_id, true);
      if (version.stale_reason) {
        throw conflict(
          'KNOWLEDGE_STALE',
          'The underlying source changed; create a new version from the new source.',
        );
      }
      if (
        !['draft', 'pending', 'in_review', 'needs_revision', 'rejected'].includes(version.status)
      ) {
        throw conflict(
          'KNOWLEDGE_ALREADY_REVIEWED',
          'This version already has a decision; create a new version to change it.',
        );
      }
      await client.query(`update knowledge_versions set status = 'in_review' where id = $1`, [
        version.id,
      ]);

      const claims = await this.claims(client, version.id);
      const conflicts = await this.detectAndStoreConflicts(client, context, version.id, claims);
      const subject = await this.auditSubject(client, context, item, version, claims, conflicts);
      const result = await this.auditor.audit(subject);
      const review = await this.insertReview(client, context, version.id, result);
      const status = statusForDecision(result.decision);
      await client.query(`update knowledge_versions set status = $2 where id = $1`, [
        version.id,
        status,
      ]);
      if (status === 'approved') await this.index(client, context, version);
      await client.query(`update knowledge_items set version = version + 1 where id = $1`, [
        item.id,
      ]);
      await writeAudit(client, context, {
        action: 'knowledge.audit',
        targetType: 'knowledge',
        targetId: itemId,
        severity: result.decision === 'approved' ? 'info' : 'warning',
        after: {
          versionId: version.id,
          reviewId: review.id,
          auditor: result.auditor,
          rubricVersion: result.rubricVersion,
          overall: result.overall,
          decision: result.decision,
          criticalFlags: result.criticalFlags,
          conflicts: conflicts.length,
        },
      });
      return {
        review: this.toReview(review),
        knowledge: await this.detail(client, await this.loadItem(client, itemId)),
      };
    });
  }

  async listReviews(
    context: WorkspaceRequestContext,
    input: { knowledgeId?: string | undefined; limit: number },
  ) {
    return this.database.run(context, async (client) => {
      const result = await client.query<ReviewRow & { item_id: string }>(
        `select ${reviewColumnsOf('r')}, v.item_id
           from audit_reviews r join knowledge_versions v on v.id = r.knowledge_version_id
          where ($1::uuid is null or v.item_id = $1)
          order by r.created_at desc, r.id desc limit $2`,
        [input.knowledgeId ?? null, input.limit],
      );
      return result.rows.map((row) => ({ ...this.toReview(row), knowledgeId: row.item_id }));
    });
  }

  // ---------------------------------------------------------------- override (KNO-004)

  async override(
    context: WorkspaceRequestContext,
    reviewId: string,
    input: { decision: 'approve' | 'reject'; reason: string; expiresAt?: string | undefined },
  ) {
    const problem = overrideReasonProblem(input.reason);
    if (problem) throw badRequest('KNOWLEDGE_OVERRIDE_REASON_REQUIRED', problem);
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
      throw badRequest('KNOWLEDGE_INVALID_REQUEST', 'An override must expire in the future.');
    }
    return this.database.run(context, async (client) => {
      const review = (
        await client.query<ReviewRow & { item_id: string; current_version_id: string | null }>(
          `select r.id, r.knowledge_version_id, r.decision, r.overall, r.scores, v.item_id, i.current_version_id
             from audit_reviews r
             join knowledge_versions v on v.id = r.knowledge_version_id
             join knowledge_items i on i.id = v.item_id
            where r.id = $1 and i.deleted_at is null
            for update of v`,
          [reviewId],
        )
      ).rows[0];
      if (!review) throw notFound('KNOWLEDGE_REVIEW_NOT_FOUND', 'The audit review was not found.');
      if (review.current_version_id !== review.knowledge_version_id) {
        throw conflict(
          'KNOWLEDGE_REVIEW_STALE',
          'The content changed after this review; audit the new version instead.',
        );
      }
      const latest = (
        await client.query<{ id: string }>(
          `select id from audit_reviews where knowledge_version_id = $1 order by created_at desc, id desc limit 1`,
          [review.knowledge_version_id],
        )
      ).rows[0];
      if (latest?.id !== review.id) {
        throw conflict('KNOWLEDGE_REVIEW_STALE', 'A newer review exists for this version.');
      }
      const inserted = (
        await client.query<OverrideRow>(
          `insert into audit_overrides (workspace_id, review_id, knowledge_version_id, decision, reason, expires_at, created_by)
           values ($1, $2, $3, $4, $5, $6, $7) returning ${overrideColumns}`,
          [
            context.workspaceId,
            review.id,
            review.knowledge_version_id,
            input.decision,
            input.reason.trim(),
            input.expiresAt ?? null,
            context.actorId,
          ],
        )
      ).rows[0]!;
      const effective = effectiveDecision(
        review.decision,
        { decision: input.decision, expiresAt: input.expiresAt ?? null },
        new Date(),
      );
      const status = statusForDecision(effective);
      await client.query(`update knowledge_versions set status = $2 where id = $1`, [
        review.knowledge_version_id,
        status,
      ]);
      if (status === 'approved') {
        const version = await this.loadVersion(client, review.item_id, review.knowledge_version_id);
        await this.index(client, context, version);
      }
      await client.query(`update knowledge_items set version = version + 1 where id = $1`, [
        review.item_id,
      ]);
      await writeAudit(client, context, {
        action: 'knowledge.override',
        targetType: 'knowledge',
        targetId: review.item_id,
        reason: input.reason.trim(),
        severity: 'critical',
        securityRelevant: true,
        before: { reviewId: review.id, brainDecision: review.decision, overall: review.overall },
        after: {
          overrideId: inserted.id,
          decision: input.decision,
          effectiveDecision: effective,
          expiresAt: input.expiresAt ?? null,
        },
      });
      return {
        override: this.toOverride(inserted),
        effectiveDecision: effective,
        knowledge: await this.detail(client, await this.loadItem(client, review.item_id)),
      };
    });
  }

  // ---------------------------------------------------------------- conflicts (KNO-005)

  /**
   * Conflicts between claims that are still in use. A conflict whose claim belongs to a
   * superseded version or a deleted item no longer reaches retrieval, so it is not listed
   * unless `all` is asked for.
   */
  async listConflicts(
    context: WorkspaceRequestContext,
    input: {
      status?: 'open' | 'resolved' | undefined;
      knowledgeId?: string | undefined;
      all?: boolean | undefined;
      limit: number;
    },
  ) {
    return this.database.run(context, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `select c.id, c.conflict_type as "conflictType", c.severity, c.analysis, c.status, c.resolution,
                ${isoColumn('c.created_at', '"createdAt"')}, ${isoColumn('c.resolved_at', '"resolvedAt"')},
                json_build_object('id', a.id, 'text', a.text, 'knowledgeId', va.item_id, 'versionId', va.id,
                                  'title', ia.title) as "claimA",
                json_build_object('id', b.id, 'text', b.text, 'knowledgeId', vb.item_id, 'versionId', vb.id,
                                  'title', ib.title) as "claimB"
           from knowledge_conflicts c
           join claims a on a.id = c.claim_a_id join knowledge_versions va on va.id = a.knowledge_version_id
           join knowledge_items ia on ia.id = va.item_id
           join claims b on b.id = c.claim_b_id join knowledge_versions vb on vb.id = b.knowledge_version_id
           join knowledge_items ib on ib.id = vb.item_id
          where ($1::text is null or c.status::text = $1)
            and ($3::uuid is null or va.item_id = $3 or vb.item_id = $3)
            and ($4::boolean
                 or (ia.deleted_at is null and ia.current_version_id = va.id
                     and ib.deleted_at is null and ib.current_version_id = vb.id))
          order by c.created_at desc, c.id desc limit $2`,
        [input.status ?? null, input.limit, input.knowledgeId ?? null, input.all ?? false],
      );
      return result.rows;
    });
  }

  async resolveConflict(context: WorkspaceRequestContext, conflictId: string, resolution: string) {
    return this.database.run(context, async (client) => {
      const updated = await client.query<{ id: string; status: string }>(
        `update knowledge_conflicts set status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now()
          where id = $1 and status = 'open' returning id, status`,
        [conflictId, resolution, context.actorId],
      );
      if (!updated.rowCount) {
        const exists = await client.query('select 1 from knowledge_conflicts where id = $1', [
          conflictId,
        ]);
        if (!exists.rowCount)
          throw notFound('KNOWLEDGE_CONFLICT_NOT_FOUND', 'The conflict was not found.');
        throw conflict('KNOWLEDGE_CONFLICT_RESOLVED', 'The conflict is already resolved.');
      }
      await writeAudit(client, context, {
        action: 'knowledge.conflict_resolve',
        targetType: 'knowledge_conflict',
        targetId: conflictId,
        reason: resolution,
      });
      return { id: conflictId, status: 'resolved' };
    });
  }

  // ---------------------------------------------------------------- retrieval (KNO-007)

  /**
   * Hybrid retrieval over approved, current, valid, in-scope knowledge only. Scope and
   * approval filters run before any lexical or vector ranking; ranks are fused with
   * reciprocal rank fusion and the exact result is pinned in an append-only snapshot.
   */
  async retrieve(context: WorkspaceRequestContext, input: RetrieveInput) {
    return this.database.run(context, async (client) => {
      const topicIds = new Set<string>();
      if (input.topicId) topicIds.add(input.topicId);
      if (input.projectId) {
        const project = await client.query(
          'select 1 from projects where id = $1 and deleted_at is null',
          [input.projectId],
        );
        if (!project.rowCount)
          throw notFound('KNOWLEDGE_SCOPE_NOT_FOUND', 'The project was not found.');
        const topics = await client.query<{ topic_id: string }>(
          'select topic_id from project_topics where project_id = $1',
          [input.projectId],
        );
        for (const row of topics.rows) topicIds.add(row.topic_id);
      }
      const eligible = `
        select ch.id as chunk_id, ch.text, ch.ordinal, ch.tsv, ch.embedding, v.id as version_id, i.id as item_id, i.title,
               i.confidentiality, v.version_no
          from knowledge_chunks ch
          join knowledge_versions v on v.id = ch.knowledge_version_id
          join knowledge_items i on i.id = v.item_id and i.current_version_id = v.id
         where i.workspace_id = $1 and i.deleted_at is null
           and v.status = 'approved' and v.stale_reason is null
           and (v.valid_from is null or v.valid_from <= now())
           and (v.valid_until is null or v.valid_until > now())
           and coalesce(
                 (select o.decision = 'approve' from audit_overrides o
                   where o.knowledge_version_id = v.id and (o.expires_at is null or o.expires_at > now())
                   order by o.created_at desc, o.id desc limit 1),
                 (select r.decision = 'approved' from audit_reviews r
                   where r.knowledge_version_id = v.id order by r.created_at desc, r.id desc limit 1),
                 false)
           and exists (
                 select 1 from knowledge_scopes s
                  where s.item_id = i.id
                    and (s.role is null or s.role = $2)
                    and (s.scope_type = 'workspace'
                         or (s.scope_type = 'topic' and s.scope_id = any($3::uuid[]))
                         or (s.scope_type = 'project' and s.scope_id = $4)))`;
      const params = [
        context.workspaceId,
        input.role ?? null,
        [...topicIds],
        input.projectId ?? null,
      ];
      const lexical = (() => {
        const words = [
          ...new Set(normalizeForSearch(input.query).match(/[\p{L}\p{M}\p{N}]+/gu) ?? []),
        ]
          .filter((word) => word.length > 1)
          .slice(0, 32);
        return words.length ? words.map((word) => `'${word}'`).join(' | ') : null;
      })();
      const lexicalRows = lexical
        ? (
            await client.query<{ chunk_id: string; rank: number }>(
              `select chunk_id, ts_rank_cd(tsv, to_tsquery('simple', $5)) as rank
                 from (${eligible}) e
                where tsv @@ to_tsquery('simple', $5)
                order by rank desc, chunk_id limit 50`,
              [...params, lexical],
            )
          ).rows
        : [];
      const vector = vectorLiteral(embed(input.query));
      const vectorRows = (
        await client.query<{ chunk_id: string; similarity: number }>(
          `select chunk_id, 1 - (embedding <=> $5::vector) as similarity
             from (${eligible}) e
            order by embedding <=> $5::vector, chunk_id limit 50`,
          [...params, vector],
        )
      ).rows;
      const fused = new Map<
        string,
        {
          score: number;
          lexicalRank: number | null;
          vectorRank: number | null;
          similarity: number | null;
        }
      >();
      lexicalRows.forEach((row, index) => {
        fused.set(row.chunk_id, {
          score: 1 / (RRF_K + index + 1),
          lexicalRank: index + 1,
          vectorRank: null,
          similarity: null,
        });
      });
      vectorRows.forEach((row, index) => {
        const entry = fused.get(row.chunk_id) ?? {
          score: 0,
          lexicalRank: null,
          vectorRank: null,
          similarity: null,
        };
        // Vector-only matches need some real similarity; otherwise every chunk would match.
        if (entry.lexicalRank === null && Number(row.similarity) < 0.2) return;
        fused.set(row.chunk_id, {
          ...entry,
          score: entry.score + 1 / (RRF_K + index + 1),
          vectorRank: index + 1,
          similarity: Math.round(Number(row.similarity) * 10_000) / 10_000,
        });
      });
      const ranked = [...fused.entries()]
        .sort(([idA, a], [idB, b]) => b.score - a.score || (idA < idB ? -1 : 1))
        .slice(0, input.limit);
      const chunkIds = ranked.map(([id]) => id);
      const details = chunkIds.length
        ? (
            await client.query<{
              chunk_id: string;
              text: string;
              ordinal: number;
              version_id: string;
              item_id: string;
              title: string;
              confidentiality: string;
              version_no: number;
            }>(
              `select chunk_id, text, ordinal, version_id, item_id, title, confidentiality, version_no
                 from (${eligible}) e where chunk_id = any($5::uuid[])`,
              [...params, chunkIds],
            )
          ).rows
        : [];
      const byChunk = new Map(details.map((row) => [row.chunk_id, row]));
      const versionIds = [...new Set(details.map((row) => row.version_id))];
      const warnings = await this.conflictWarnings(client, versionIds);
      const reviews = versionIds.length
        ? (
            await client.query<{
              knowledge_version_id: string;
              id: string;
              overall: number;
              decision: string;
            }>(
              `select distinct on (knowledge_version_id) knowledge_version_id, id, overall, decision
                 from audit_reviews where knowledge_version_id = any($1::uuid[])
                order by knowledge_version_id, created_at desc, id desc`,
              [versionIds],
            )
          ).rows
        : [];
      const overrides = versionIds.length
        ? (
            await client.query<{ knowledge_version_id: string; id: string; decision: string }>(
              `select distinct on (knowledge_version_id) knowledge_version_id, id, decision
                 from audit_overrides
                where knowledge_version_id = any($1::uuid[]) and (expires_at is null or expires_at > now())
                order by knowledge_version_id, created_at desc, id desc`,
              [versionIds],
            )
          ).rows
        : [];
      const reviewByVersion = new Map(reviews.map((row) => [row.knowledge_version_id, row]));
      const overrideByVersion = new Map(overrides.map((row) => [row.knowledge_version_id, row]));
      const results = ranked
        .map(([chunkId, rank]) => {
          const row = byChunk.get(chunkId);
          if (!row) return null;
          const override = overrideByVersion.get(row.version_id);
          return {
            chunkId,
            knowledgeId: row.item_id,
            versionId: row.version_id,
            versionNo: row.version_no,
            title: row.title,
            confidentiality: row.confidentiality,
            chunkOrdinal: row.ordinal,
            text: row.text,
            score: Math.round(rank.score * 1_000_000) / 1_000_000,
            lexicalRank: rank.lexicalRank,
            vectorRank: rank.vectorRank,
            similarity: rank.similarity,
            reviewId: reviewByVersion.get(row.version_id)?.id ?? null,
            auditScore: reviewByVersion.get(row.version_id)?.overall ?? null,
            effectiveDecision: override ? 'approved_by_override' : 'approved',
            conflictWarnings: warnings.get(row.version_id) ?? [],
          };
        })
        .filter((result) => result !== null);
      const filters = {
        projectId: input.projectId ?? null,
        topicIds: [...topicIds].sort(),
        role: input.role ?? null,
        limit: input.limit,
      };
      const hash = sha256(
        canonicalJson({ query: input.query, filters, results, model: EMBEDDING_MODEL }),
      );
      const snapshot = (
        await client.query<{ id: string; created_at: string }>(
          `insert into retrieval_snapshots (workspace_id, project_id, topic_id, role, query, filters, results, embedding_model, hash, created_by)
           values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10) returning id, ${isoColumn('created_at', 'created_at')}`,
          [
            context.workspaceId,
            input.projectId ?? null,
            input.topicId ?? null,
            input.role ?? null,
            input.query,
            JSON.stringify(filters),
            JSON.stringify(results),
            EMBEDDING_MODEL,
            hash,
            context.actorId,
          ],
        )
      ).rows[0]!;
      return {
        snapshotId: snapshot.id,
        hash,
        embeddingModel: EMBEDDING_MODEL,
        createdAt: snapshot.created_at,
        results,
      };
    });
  }

  async snapshot(context: WorkspaceRequestContext, snapshotId: string) {
    return this.database.run(context, async (client) => {
      const row = (
        await client.query(
          `select id, project_id as "projectId", topic_id as "topicId", role, query, filters, results,
                  embedding_model as "embeddingModel", hash, created_by as "createdBy",
                  ${isoColumn('created_at', '"createdAt"')}
             from retrieval_snapshots where id = $1`,
          [snapshotId],
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (!row)
        throw notFound('KNOWLEDGE_SNAPSHOT_NOT_FOUND', 'The retrieval snapshot was not found.');
      return row;
    });
  }

  // ---------------------------------------------------------------- internals

  private async conflictWarnings(client: PoolClient, versionIds: readonly string[]) {
    const warnings = new Map<string, unknown[]>();
    if (versionIds.length === 0) return warnings;
    const result = await client.query<{
      id: string;
      version_id: string;
      claim_id: string;
      claim_text: string;
      other_claim_id: string;
      other_text: string;
      other_knowledge_id: string;
      conflict_type: string;
      severity: string;
    }>(
      `select c.id, mine.knowledge_version_id as version_id, mine.id as claim_id, mine.text as claim_text,
              other.id as other_claim_id, other.text as other_text, ov.item_id as other_knowledge_id,
              c.conflict_type, c.severity
         from knowledge_conflicts c
         join claims mine on mine.id in (c.claim_a_id, c.claim_b_id)
         join claims other on other.id in (c.claim_a_id, c.claim_b_id) and other.id <> mine.id
         join knowledge_versions ov on ov.id = other.knowledge_version_id
        where c.status = 'open' and mine.knowledge_version_id = any($1::uuid[])
        order by c.created_at, c.id`,
      [versionIds],
    );
    for (const row of result.rows) {
      const list = warnings.get(row.version_id) ?? [];
      list.push({
        conflictId: row.id,
        conflictType: row.conflict_type,
        severity: row.severity,
        claim: { id: row.claim_id, text: row.claim_text },
        conflictingClaim: {
          id: row.other_claim_id,
          text: row.other_text,
          knowledgeId: row.other_knowledge_id,
        },
      });
      warnings.set(row.version_id, list);
    }
    return warnings;
  }

  private async detectAndStoreConflicts(
    client: PoolClient,
    context: WorkspaceRequestContext,
    versionId: string,
    claims: readonly { id: string; text: string }[],
  ) {
    if (claims.length === 0) return [];
    const existing = await client.query<{ id: string; text: string }>(
      `select c.id, c.text
         from claims c
         join knowledge_versions v on v.id = c.knowledge_version_id
         join knowledge_items i on i.id = v.item_id and i.current_version_id = v.id
        where i.deleted_at is null and v.id <> $1 and v.status in ('approved', 'pending', 'in_review', 'needs_revision')
        order by c.created_at desc limit $2`,
      [versionId, CONFLICT_COMPARE_LIMIT],
    );
    const detected = detectConflicts(claims, existing.rows);
    for (const item of detected) {
      await client.query(
        `insert into knowledge_conflicts (workspace_id, claim_a_id, claim_b_id, conflict_type, severity, analysis)
         values ($1, $2, $3, $4, $5, $6) on conflict (claim_a_id, claim_b_id) do nothing`,
        [
          context.workspaceId,
          item.claimAId,
          item.claimBId,
          item.conflictType,
          item.severity,
          item.analysis,
        ],
      );
    }
    if (detected.length > 0) {
      await writeAudit(client, context, {
        action: 'knowledge.conflict_detected',
        targetType: 'knowledge_version',
        targetId: versionId,
        severity: 'warning',
        after: {
          conflicts: detected.map((item) => ({
            claimAId: item.claimAId,
            claimBId: item.claimBId,
            type: item.conflictType,
          })),
        },
      });
    }
    const open = await client.query<{ id: string }>(
      `select k.id from knowledge_conflicts k
         join claims c on c.id in (k.claim_a_id, k.claim_b_id)
        where k.status = 'open' and c.knowledge_version_id = $1`,
      [versionId],
    );
    return open.rows;
  }

  private async auditSubject(
    client: PoolClient,
    context: WorkspaceRequestContext,
    item: ItemRow,
    version: VersionRow,
    claims: Awaited<ReturnType<KnowledgeService['claims']>>,
    conflicts: readonly unknown[],
  ) {
    const scopes = await client.query<{ scope_type: ScopeType; scope_id: string }>(
      'select scope_type, scope_id from knowledge_scopes where item_id = $1',
      [item.id],
    );
    const scopeTerms: string[] = [];
    for (const scope of scopes.rows) {
      if (scope.scope_type === 'topic') {
        const topic = await client.query<{ title: string; description: string }>(
          'select title, description from topics where id = $1',
          [scope.scope_id],
        );
        if (topic.rows[0]) scopeTerms.push(topic.rows[0].title);
      } else if (scope.scope_type === 'project') {
        const project = await client.query<{ title: string }>(
          'select title from projects where id = $1',
          [scope.scope_id],
        );
        if (project.rows[0]) scopeTerms.push(project.rows[0].title);
      }
    }
    let sourceScan: 'clean' | 'infected' | 'error' | null = null;
    let sourcePartial = false;
    if (version.source_version_id) {
      const source = await client.query<{ scan: { status?: string } | null; status: string }>(
        'select scan, status from source_versions where id = $1',
        [version.source_version_id],
      );
      const status = source.rows[0]?.scan?.status;
      sourceScan = status === 'clean' || status === 'infected' ? status : 'error';
      sourcePartial = source.rows[0]?.status === 'partial';
    }
    return {
      sourceType: item.source_type,
      content: version.content,
      provenance: version.provenance,
      sourceScan,
      sourcePartial,
      claims: claims.map((claim) => ({
        id: claim.id,
        text: claim.text,
        kind: claim.kind,
        citations: claim.citations.map((citation) => ({
          complete: citation.complete,
          publishedAt: citation.publishedAt,
        })),
      })),
      scopeTerms,
      validUntil: version.valid_until,
      openConflicts: conflicts.length,
      now: new Date(),
    };
  }

  private async insertReview(
    client: PoolClient,
    context: WorkspaceRequestContext,
    versionId: string,
    result: AuditResult,
  ) {
    return (
      await client.query<ReviewRow>(
        `insert into audit_reviews (workspace_id, knowledge_version_id, rubric_version, auditor, scores, overall, decision,
                                    reasons, claim_results, critical_flags, created_by)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb, $10, $11) returning ${reviewColumns}`,
        [
          context.workspaceId,
          versionId,
          result.rubricVersion,
          result.auditor,
          JSON.stringify(result.scores),
          result.overall,
          result.decision,
          JSON.stringify(result.reasons),
          JSON.stringify(result.claimResults),
          result.criticalFlags,
          context.actorId,
        ],
      )
    ).rows[0]!;
  }

  /** Approved content becomes searchable: chunks with lexical and vector representations. */
  private async index(
    client: PoolClient,
    context: WorkspaceRequestContext,
    version: VersionRow,
  ): Promise<void> {
    const existing = await client.query(
      'select 1 from knowledge_chunks where knowledge_version_id = $1 limit 1',
      [version.id],
    );
    if (existing.rowCount) return;
    for (const chunk of chunkText(version.content)) {
      await client.query(
        `insert into knowledge_chunks (workspace_id, knowledge_version_id, ordinal, text, search_text, embedding_model, embedding)
         values ($1, $2, $3, $4, $5, $6, $7::vector)`,
        [
          context.workspaceId,
          version.id,
          chunk.ordinal,
          chunk.text,
          searchText(chunk.text),
          EMBEDDING_MODEL,
          vectorLiteral(embed(chunk.text)),
        ],
      );
    }
  }

  private provenance(
    context: WorkspaceRequestContext,
    sourceType: KnowledgeSourceType,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const base: Record<string, unknown> = { ...input, sourceType };
    if (sourceType === 'admin_provided' || sourceType === 'clue_guided') {
      base['actorId'] = context.actorId;
      base['declaredAt'] =
        typeof input['declaredAt'] === 'string' ? input['declaredAt'] : new Date().toISOString();
    }
    return base;
  }

  private async insertVersion(
    client: PoolClient,
    context: WorkspaceRequestContext,
    item: ItemRow,
    versionNo: number,
    status: string,
    input: {
      content: string;
      language: 'fa' | 'en';
      provenance: Record<string, unknown>;
      validFrom: string | undefined;
      validUntil: string | undefined;
      sourceVersionId: string | null;
    },
  ): Promise<VersionRow> {
    if (
      input.validFrom &&
      input.validUntil &&
      Date.parse(input.validUntil) <= Date.parse(input.validFrom)
    ) {
      throw badRequest('KNOWLEDGE_INVALID_REQUEST', 'validUntil must be after validFrom.');
    }
    return (
      await client.query<VersionRow>(
        `insert into knowledge_versions (workspace_id, item_id, version_no, status, content, content_sha256, language,
                                         source_version_id, provenance, valid_from, valid_until, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12) returning ${versionColumns}`,
        [
          context.workspaceId,
          item.id,
          versionNo,
          status,
          input.content,
          sha256(input.content.normalize('NFC')),
          input.language,
          input.sourceVersionId,
          JSON.stringify(input.provenance),
          input.validFrom ?? null,
          input.validUntil ?? null,
          context.actorId,
        ],
      )
    ).rows[0]!;
  }

  /** Claims given by the caller (with citations), or rule-based candidates from the content. */
  private async insertClaims(
    client: PoolClient,
    context: WorkspaceRequestContext,
    versionId: string,
    content: string,
    claims: readonly ClaimInput[] | undefined,
  ): Promise<void> {
    const list =
      claims && claims.length > 0
        ? claims.map((claim, index) => {
            const start = content.indexOf(claim.text);
            return {
              ordinal: index + 1,
              text: claim.text,
              normalizedText: normalizeForSearch(claim.text),
              kind: claim.kind ?? 'statement',
              locator: start >= 0 ? { start, end: start + claim.text.length } : { provided: 1 },
              citations: claim.citations ?? [],
            };
          })
        : extractClaimCandidates([{ ordinal: 1, locator: { content: 1 }, text: content }]).map(
            (candidate) => ({
              ordinal: candidate.ordinal,
              text: candidate.text,
              normalizedText: candidate.normalizedText,
              kind: candidate.kind,
              locator: { start: candidate.locator.start, end: candidate.locator.end },
              citations: [] as CitationInput[],
            }),
          );
    for (const claim of list) {
      const inserted = await client.query<{ id: string }>(
        `insert into claims (workspace_id, knowledge_version_id, ordinal, text, normalized_text, kind, locator)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb) returning id`,
        [
          context.workspaceId,
          versionId,
          claim.ordinal,
          claim.text,
          claim.normalizedText,
          claim.kind,
          JSON.stringify(claim.locator),
        ],
      );
      for (const citation of claim.citations) {
        const assessment = assessCitation(citation);
        await client.query(
          `insert into citations (workspace_id, claim_id, source_ref, title, publisher, author, published_at, accessed_at,
                                  locator, quote_digest, complete, missing_fields)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            context.workspaceId,
            inserted.rows[0]!.id,
            citation.sourceRef ?? null,
            citation.title ?? null,
            citation.publisher ?? null,
            citation.author ?? null,
            citation.publishedAt && !Number.isNaN(Date.parse(citation.publishedAt))
              ? citation.publishedAt
              : null,
            citation.accessedAt && !Number.isNaN(Date.parse(citation.accessedAt))
              ? citation.accessedAt
              : null,
            citation.locator ?? null,
            assessment.quoteDigest,
            assessment.complete,
            assessment.missingFields,
          ],
        );
      }
    }
  }

  private async insertScopes(
    client: PoolClient,
    context: WorkspaceRequestContext,
    itemId: string,
    scopes: readonly ScopeInput[],
  ) {
    for (const scope of scopes) {
      await client.query(
        `insert into knowledge_scopes (workspace_id, item_id, scope_type, scope_id, role) values ($1, $2, $3, $4, $5)
         on conflict do nothing`,
        [context.workspaceId, itemId, scope.type, scope.id, scope.role ?? null],
      );
    }
  }

  private async assertScopes(
    client: PoolClient,
    context: WorkspaceRequestContext,
    scopes: readonly ScopeInput[],
  ) {
    if (scopes.length === 0)
      throw badRequest('KNOWLEDGE_INVALID_REQUEST', 'Knowledge needs at least one scope.');
    for (const scope of scopes) await this.sources.assertScope(client, context, scope);
  }

  private async setCurrent(
    client: PoolClient,
    itemId: string,
    versionId: string,
  ): Promise<ItemRow> {
    return (
      await client.query<ItemRow>(
        `update knowledge_items set current_version_id = $2, version = version + 1 where id = $1 returning ${itemColumns}`,
        [itemId, versionId],
      )
    ).rows[0]!;
  }

  private async loadItem(client: PoolClient, itemId: string, forUpdate = false): Promise<ItemRow> {
    const row = (
      await client.query<ItemRow>(
        `select ${itemColumns} from knowledge_items where id = $1 and deleted_at is null ${forUpdate ? 'for update' : ''}`,
        [itemId],
      )
    ).rows[0];
    if (!row) throw notFound('KNOWLEDGE_NOT_FOUND', 'The knowledge item was not found.');
    return row;
  }

  private async loadVersion(
    client: PoolClient,
    itemId: string,
    versionId: string,
    forUpdate = false,
  ): Promise<VersionRow> {
    const row = (
      await client.query<VersionRow>(
        `select ${versionColumns} from knowledge_versions where id = $1 and item_id = $2 ${forUpdate ? 'for update' : ''}`,
        [versionId, itemId],
      )
    ).rows[0];
    if (!row) throw notFound('KNOWLEDGE_VERSION_NOT_FOUND', 'The knowledge version was not found.');
    return row;
  }

  private async claims(client: PoolClient, versionId: string) {
    const claims = await client.query<{
      id: string;
      ordinal: number;
      text: string;
      kind: string;
      locator: unknown;
      source_segment_id: string | null;
    }>(
      `select id, ordinal, text, kind, locator, source_segment_id from claims where knowledge_version_id = $1 order by ordinal`,
      [versionId],
    );
    const citations = await client.query<{
      claim_id: string;
      id: string;
      source_ref: string | null;
      title: string | null;
      publisher: string | null;
      author: string | null;
      published_at: string | null;
      accessed_at: string | null;
      locator: string | null;
      quote_digest: string | null;
      complete: boolean;
      missing_fields: string[];
      verification_status: string;
    }>(
      `select c.claim_id, c.id, c.source_ref, c.title, c.publisher, c.author,
              ${isoColumn('c.published_at', 'published_at')}, ${isoColumn('c.accessed_at', 'accessed_at')},
              c.locator, c.quote_digest, c.complete, c.missing_fields, c.verification_status
         from citations c join claims cl on cl.id = c.claim_id
        where cl.knowledge_version_id = $1 order by c.created_at, c.id`,
      [versionId],
    );
    return claims.rows.map((claim) => ({
      id: claim.id,
      ordinal: claim.ordinal,
      text: claim.text,
      kind: claim.kind,
      locator: claim.locator,
      sourceSegmentId: claim.source_segment_id,
      citations: citations.rows
        .filter((citation) => citation.claim_id === claim.id)
        .map((citation) => ({
          id: citation.id,
          sourceRef: citation.source_ref,
          title: citation.title,
          publisher: citation.publisher,
          author: citation.author,
          publishedAt: citation.published_at,
          accessedAt: citation.accessed_at,
          locator: citation.locator,
          quoteDigest: citation.quote_digest,
          complete: citation.complete,
          missingFields: citation.missing_fields,
          verificationStatus: citation.verification_status,
        })),
    }));
  }

  private async reviews(client: PoolClient, versionId: string): Promise<ReviewRow[]> {
    return (
      await client.query<ReviewRow>(
        `select ${reviewColumns} from audit_reviews where knowledge_version_id = $1 order by created_at desc, id desc`,
        [versionId],
      )
    ).rows;
  }

  private async detail(client: PoolClient, item: ItemRow) {
    const scopes = await client.query<{
      scope_type: ScopeType;
      scope_id: string;
      role: string | null;
    }>(
      `select scope_type, scope_id, role from knowledge_scopes where item_id = $1
        order by scope_type, scope_id, coalesce(role, '')`,
      [item.id],
    );
    const titles = await scopeTitles(
      client,
      scopes.rows.map((scope) => ({ type: scope.scope_type, id: scope.scope_id })),
    );
    const version = item.current_version_id
      ? await this.loadVersion(client, item.id, item.current_version_id)
      : null;
    const reviews = version ? await this.reviews(client, version.id) : [];
    const overrides = version
      ? (
          await client.query<OverrideRow>(
            `select ${overrideColumns} from audit_overrides where knowledge_version_id = $1 order by created_at desc, id desc`,
            [version.id],
          )
        ).rows
      : [];
    const latestReview = reviews[0] ?? null;
    const activeOverride =
      overrides.find(
        (override) => override.expires_at === null || Date.parse(override.expires_at) > Date.now(),
      ) ?? null;
    return {
      ...this.toItem(item),
      scopes: scopes.rows.map((scope) => ({
        type: scope.scope_type,
        id: scope.scope_id,
        role: scope.role,
        title: titles.get(scopeKey({ type: scope.scope_type, id: scope.scope_id })) ?? null,
      })),
      currentVersion: version
        ? {
            ...this.toVersion(version, true),
            claims: await this.claims(client, version.id),
            latestReview: latestReview ? this.toReview(latestReview) : null,
            overrides: overrides.map((override) => this.toOverride(override)),
            effectiveDecision: version.stale_reason
              ? 'stale'
              : effectiveDecision(
                  latestReview?.decision ?? null,
                  activeOverride
                    ? { decision: activeOverride.decision, expiresAt: activeOverride.expires_at }
                    : null,
                  new Date(),
                ),
          }
        : null,
    };
  }

  private toItem(row: ItemRow) {
    return {
      id: row.id,
      title: row.title,
      sourceType: row.source_type,
      confidentiality: row.confidentiality,
      language: row.language,
      currentVersionId: row.current_version_id,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toVersion(row: VersionRow, withContent: boolean) {
    const expired =
      row.valid_until !== null &&
      Date.parse(row.valid_until) <= Date.now() &&
      row.status === 'approved';
    return {
      id: row.id,
      versionNo: row.version_no,
      status: expired ? 'expired' : row.status,
      contentSha256: row.content_sha256,
      language: row.language,
      sourceVersionId: row.source_version_id,
      provenance: row.provenance,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      staleReason: row.stale_reason,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(withContent ? { content: row.content } : {}),
    };
  }

  private toReview(row: ReviewRow) {
    return {
      id: row.id,
      knowledgeVersionId: row.knowledge_version_id,
      rubricVersion: row.rubric_version,
      auditor: row.auditor,
      scores: row.scores,
      overall: row.overall,
      decision: row.decision,
      reasons: row.reasons,
      claimResults: row.claim_results,
      criticalFlags: row.critical_flags,
      createdAt: row.created_at,
    };
  }

  private toOverride(row: OverrideRow) {
    return {
      id: row.id,
      reviewId: row.review_id,
      decision: row.decision,
      reason: row.reason,
      expiresAt: row.expires_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      humanOverride: true,
    };
  }
}
