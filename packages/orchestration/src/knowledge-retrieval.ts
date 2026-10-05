import { createHash } from 'node:crypto';

import { embed, EMBEDDING_MODEL, normalizeForSearch, vectorLiteral } from '@docoo/knowledge';
import type { PoolClient } from 'pg';

/** Reciprocal rank fusion constant. */
const RRF_K = 60;

export interface RetrievalRequest {
  readonly workspaceId: string;
  /** The signed-in administrator; a worker acts without one. */
  readonly actorId: string | null;
  readonly query: string;
  readonly projectId?: string | null | undefined;
  readonly topicId?: string | null | undefined;
  readonly role?: string | null | undefined;
  readonly limit: number;
  /** Confidentiality levels left out before ranking (the research stage drops `restricted`). */
  readonly excludeConfidentiality?: readonly string[] | undefined;
  /**
   * `knowledge.min_audit_score` (0 to 1): a version approved by the Brain counts only when its
   * overall audit score (0 to 100) reaches this share. An administrator's override stands as the
   * human decision and is not held to it. `undefined` or 0 leaves every approved version in.
   */
  readonly minAuditScore?: number | undefined;
}

export interface ConflictWarning {
  readonly conflictId: string;
  readonly conflictType: string;
  readonly severity: string;
  readonly claim: { readonly id: string; readonly text: string };
  readonly conflictingClaim: {
    readonly id: string;
    readonly text: string;
    readonly knowledgeId: string;
  };
}

export interface RetrievedPassage {
  readonly chunkId: string;
  readonly knowledgeId: string;
  readonly versionId: string;
  readonly versionNo: number;
  readonly title: string;
  readonly confidentiality: string;
  readonly chunkOrdinal: number;
  readonly text: string;
  readonly score: number;
  readonly lexicalRank: number | null;
  readonly vectorRank: number | null;
  readonly similarity: number | null;
  readonly reviewId: string | null;
  readonly auditScore: number | null;
  readonly effectiveDecision: 'approved' | 'approved_by_override';
  readonly conflictWarnings: readonly ConflictWarning[];
}

export interface Retrieval {
  readonly snapshotId: string;
  readonly hash: string;
  readonly embeddingModel: string;
  readonly createdAt: string;
  readonly results: RetrievedPassage[];
}

/** The project the retrieval was scoped to does not exist (or is not visible). */
export class RetrievalScopeError extends Error {
  constructor() {
    super('The project was not found.');
    this.name = 'RetrievalScopeError';
  }
}

/** Stable JSON with sorted object keys, used for snapshot hashes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function conflictWarnings(client: PoolClient, versionIds: readonly string[]) {
  const warnings = new Map<string, ConflictWarning[]>();
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

/**
 * Hybrid retrieval over approved, current, valid, in-scope knowledge only (KNO-007). Scope and
 * approval filters run before any lexical or vector ranking; ranks are fused with reciprocal
 * rank fusion and the exact result is pinned in an append-only snapshot. The API (the screens
 * and the retrieval test) and the research stage of the workflow both call this, so an agent
 * is given exactly what the test shows.
 */
export async function retrieveKnowledge(
  client: PoolClient,
  input: RetrievalRequest,
): Promise<Retrieval> {
  const topicIds = new Set<string>();
  if (input.topicId) topicIds.add(input.topicId);
  if (input.projectId) {
    const project = await client.query(
      'select 1 from projects where id = $1 and deleted_at is null',
      [input.projectId],
    );
    if (!project.rowCount) throw new RetrievalScopeError();
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
       and not (i.confidentiality::text = any($5::text[]))
       and coalesce(
             (select o.decision = 'approve' from audit_overrides o
               where o.knowledge_version_id = v.id and (o.expires_at is null or o.expires_at > now())
               order by o.created_at desc, o.id desc limit 1),
             (select r.decision = 'approved' and r.overall >= $6::real from audit_reviews r
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
    input.workspaceId,
    input.role ?? null,
    [...topicIds],
    input.projectId ?? null,
    [...(input.excludeConfidentiality ?? [])],
    Math.max(0, Math.min(1, input.minAuditScore ?? 0)) * 100,
  ];
  const words = [...new Set(normalizeForSearch(input.query).match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])]
    .filter((word) => word.length > 1)
    .slice(0, 32);
  const lexical = words.length ? words.map((word) => `'${word}'`).join(' | ') : null;
  const lexicalRows = lexical
    ? (
        await client.query<{ chunk_id: string; rank: number }>(
          `select chunk_id, ts_rank_cd(tsv, to_tsquery('simple', $7)) as rank
             from (${eligible}) e
            where tsv @@ to_tsquery('simple', $7)
            order by rank desc, chunk_id limit 50`,
          [...params, lexical],
        )
      ).rows
    : [];
  const vector = vectorLiteral(embed(input.query));
  const vectorRows = (
    await client.query<{ chunk_id: string; similarity: number }>(
      `select chunk_id, 1 - (embedding <=> $7::vector) as similarity
         from (${eligible}) e
        order by embedding <=> $7::vector, chunk_id limit 50`,
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
             from (${eligible}) e where chunk_id = any($7::uuid[])`,
          [...params, chunkIds],
        )
      ).rows
    : [];
  const byChunk = new Map(details.map((row) => [row.chunk_id, row]));
  const versionIds = [...new Set(details.map((row) => row.version_id))];
  const warnings = await conflictWarnings(client, versionIds);
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
  const results: RetrievedPassage[] = [];
  for (const [chunkId, rank] of ranked) {
    const row = byChunk.get(chunkId);
    if (!row) continue;
    const override = overrideByVersion.get(row.version_id);
    results.push({
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
    });
  }
  const filters = {
    projectId: input.projectId ?? null,
    topicIds: [...topicIds].sort(),
    role: input.role ?? null,
    limit: input.limit,
    ...(input.minAuditScore ? { minAuditScore: input.minAuditScore } : {}),
  };
  const hash = sha256(
    canonicalJson({ query: input.query, filters, results, model: EMBEDDING_MODEL }),
  );
  const snapshot = (
    await client.query<{ id: string; created_at: string }>(
      `insert into retrieval_snapshots (workspace_id, project_id, topic_id, role, query, filters, results, embedding_model, hash, created_by)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
       returning id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at`,
      [
        input.workspaceId,
        input.projectId ?? null,
        input.topicId ?? null,
        input.role ?? null,
        input.query,
        JSON.stringify(filters),
        JSON.stringify(results),
        EMBEDDING_MODEL,
        hash,
        input.actorId,
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
}
