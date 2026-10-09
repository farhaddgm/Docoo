import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { IntelligenceClaim } from '@docoo/domain';
import { expandKnowledgeQuery, normalizeKnowledgeText } from '@docoo/domain';

export const evidenceDigest = (value: string) => createHash('sha256').update(value).digest('hex');
export interface ApprovedEvidenceRow {
  id: string;
  text: string;
  knowledge_version_id: string;
  source_version_id: string | null;
  title: string;
  content: string;
  content_sha256: string;
  language: 'fa' | 'en';
  confidentiality: string;
  source_type: string;
  overall: number | null;
  scores: Record<string, number> | null;
  supported: boolean | null;
  published_at: string | null;
  final_url: string | null;
  lexical_score: number;
  country: string | null;
}
/** Authorization, scope, latest audit/override and validity all precede the candidate bound. */
export async function approvedDecisionEvidence(
  client: PoolClient,
  input: {
    workspaceId: string;
    projectId: string;
    languages?: readonly string[];
    ids?: readonly string[];
    query?: string;
    limit?: number;
  },
) {
  const terms = input.query
    ? expandKnowledgeQuery(input.query)
        .map((term) => `'${term.replace(/[^\p{L}\p{N}]/gu, '')}'`)
        .filter((term) => term !== "''")
        .join(' | ')
    : '';
  const result = await client.query<ApprovedEvidenceRow>(
    `
    select c.id,c.text,v.id as knowledge_version_id,v.source_version_id,i.title,v.content,v.content_sha256,
      v.language,i.confidentiality,i.source_type,r.overall,r.scores,v.provenance->>'country' as country,
      (select (x->>'supported')::boolean from jsonb_array_elements(r.claim_results) x where x->>'claimId'=c.id::text limit 1) as supported,
      cite.published_at::date::text,cite.source_ref as final_url,
      ts_rank_cd(to_tsvector('simple',translate(c.text,'يك','یک')),plainto_tsquery('simple',$5)) as lexical_score,
      case when $7<>'' then ts_rank_cd(to_tsvector('simple',translate(c.text,'يك','یک')),to_tsquery('simple',$7)) else 0 end as candidate_score
    from claims c join knowledge_versions v on v.id=c.knowledge_version_id and v.workspace_id=c.workspace_id
    join knowledge_items i on i.id=v.item_id and i.current_version_id=v.id
    left join lateral (select * from audit_reviews where knowledge_version_id=v.id order by created_at desc,id desc limit 1) r on true
    left join lateral (select * from audit_overrides where knowledge_version_id=v.id order by created_at desc,id desc limit 1) o on true
    left join lateral (select published_at,source_ref from citations where claim_id=c.id and complete and verification_status='verified' order by created_at,id limit 1) cite on true
    where i.workspace_id=$1 and i.deleted_at is null and v.status='approved' and v.stale_reason is null
      and (v.valid_from is null or v.valid_from<=now()) and (v.valid_until is null or v.valid_until>now())
      and case when o.id is not null and (o.expires_at is null or o.expires_at>now()) then o.decision='approve' else r.decision='approved' end
      and v.language::text=any($3::text[]) and ($4::uuid[] is null or c.id=any($4::uuid[]))
      and exists(select 1 from projects p where p.id=$2 and p.workspace_id=$1 and p.deleted_at is null)
      and exists(select 1 from knowledge_scopes s where s.item_id=i.id and s.workspace_id=$1 and s.role is null
        and (s.scope_type='workspace' and s.scope_id=$1 or s.scope_type='project' and s.scope_id=$2
          or s.scope_type='topic' and s.scope_id in(select topic_id from project_topics where project_id=$2)))
    order by candidate_score desc,c.created_at desc,c.id limit $6`,
    [
      input.workspaceId,
      input.projectId,
      input.languages ?? ['fa', 'en'],
      input.ids ?? null,
      normalizeKnowledgeText(input.query ?? ''),
      input.limit ?? 1000,
      terms,
    ],
  );
  return result.rows;
}
/** Quotes refer to immutable approved knowledge text; source-less manual knowledge pins itself. */
export function verifiedIntelligenceClaim(row: ApprovedEvidenceRow): IntelligenceClaim | null {
  const start = row.content.indexOf(row.text);
  if (start < 0 || evidenceDigest(row.content) !== row.content_sha256) return null;
  let finalUrl: string | null = null;
  try {
    const url = new URL(row.final_url ?? '');
    if (['https:', 'http:'].includes(url.protocol)) finalUrl = url.href;
  } catch {
    /* absent or non-URL citation */
  }
  return {
    id: row.id,
    text: row.text,
    language: row.language,
    knowledgeVersionId: row.knowledge_version_id,
    sourceVersionId: row.source_version_id ?? row.knowledge_version_id,
    title: row.title,
    quote: row.text,
    quoteHash: evidenceDigest(row.text),
    startOffset: start,
    endOffset: start + row.text.length,
    auditScore: row.overall ?? 0,
    evidenceAdequacy: row.supported === false ? 0 : (row.scores?.['evidence'] ?? 0),
    freshness: row.scores?.['recency'] ?? 0,
    publishedAt: row.published_at,
    finalUrl,
    confidentiality: row.confidentiality === 'internal' ? 'internal' : 'restricted',
  };
}
