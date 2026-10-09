import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  ConflictSuggestionReviewInput,
  EvidenceLinkInput,
  IntelligenceSearchInput,
  ProjectResearchPlan,
  ProjectResearchManifestItem,
} from '@docoo/contracts';
import {
  assessEvidence,
  detectKnowledgeConflicts,
  localEmbeddingModel,
  rankKnowledgeClaims,
  type IntelligenceClaim,
} from '@docoo/domain';
import {
  approvedDecisionEvidence,
  verifiedIntelligenceClaim,
  evidenceDigest,
  captureAdaptiveEvidence,
} from '@docoo/orchestration';
import { createOpenAiEmbeddings } from '@docoo/providers';
import { visibleText, type StructuredDocument } from '@docoo/documents';
import type { Environment } from '@docoo/config';
import { API_CONFIG } from '../tokens.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { writeAudit } from '../common/audit.js';
import { WORKFLOW_ENGINE, type WorkflowEngine } from '../workflow/workflow.engine.js';

const digest = (value: unknown) => evidenceDigest(JSON.stringify(value));
type Link = {
  id: string;
  target_type: string;
  target_version_id: string;
  block_index: number | null;
  assertion: string;
  claim_id: string;
  relation: string;
  applicability_reviewed: boolean;
  citation: IntelligenceClaim;
};
type Review = {
  claim_a_id: string;
  claim_b_id: string;
  fingerprint: string;
  decision: string;
  reason: string;
  applicability_condition: string | null;
};
const claimList = (rows: Awaited<ReturnType<typeof approvedDecisionEvidence>>) =>
  rows.flatMap((row) => {
    const claim = verifiedIntelligenceClaim(row);
    return claim ? [claim] : [];
  });

@Injectable()
export class DecisionIntelligenceService {
  constructor(
    private readonly database: WorkspaceDatabase,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEngine,
    @Inject(API_CONFIG) private readonly config: Environment,
  ) {}
  private async project(client: PoolClient, id: string, write = false) {
    const row = (
      await client.query<{ status: string }>(
        `select status from projects where id=$1 and deleted_at is null${write ? ' for update' : ''}`,
        [id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    if (write && ['archived', 'deleted'].includes(row.status))
      throw new ConflictException('Project is read only');
  }
  private async once(
    client: PoolClient,
    table: 'project_evidence_links' | 'project_conflict_suggestion_reviews',
    context: WorkspaceRequestContext,
    projectId: string,
    key: string,
    hash: string,
  ) {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${context.workspaceId}:${projectId}:${key}`,
    ]);
    const row = (
      await client.query<{ id: string; request_hash: string; actor_id: string }>(
        `select id,request_hash,actor_id from ${table} where workspace_id=$1 and project_id=$2 and idempotency_key=$3`,
        [context.workspaceId, projectId, key],
      )
    ).rows[0];
    if (row && (row.request_hash !== hash || row.actor_id !== context.actorId))
      throw new ConflictException('Idempotency key reused');
    return row ? { id: row.id, replayed: true } : null;
  }
  async search(
    context: WorkspaceRequestContext,
    projectId: string,
    input: IntelligenceSearchInput,
  ) {
    return this.database.run(context, async (client) => {
      await this.project(client, projectId);
      const rows = await approvedDecisionEvidence(client, {
        ...context,
        projectId,
        languages: input.languages,
        query: input.query,
      });
      const claims = claimList(rows);
      let model: string = localEmbeddingModel,
        embeddingStatus: 'local' | 'provider' | 'not_permitted' = 'local';
      let vectors: readonly (readonly number[])[] | undefined;
      let fallbackReason: 'provider_unavailable' | undefined;
      let candidates = claims;
      if (input.mode === 'hybrid' && this.config.KNOWLEDGE_EMBEDDING_ENABLED) {
        const allowed =
          this.config.KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL &&
          claims.every((c) => c.confidentiality === 'internal');
        if (!allowed) embeddingStatus = 'not_permitted';
        else
          try {
            candidates = rankKnowledgeClaims({ query: input.query, claims, limit: 64 }).map(
              (r) => r.claim,
            );
            vectors = await createOpenAiEmbeddings({
              apiKey: this.config.KNOWLEDGE_EMBEDDING_API_KEY,
              model: this.config.KNOWLEDGE_EMBEDDING_MODEL,
              texts: [input.query, ...candidates.map((c) => c.text)],
            });
            model = this.config.KNOWLEDGE_EMBEDDING_MODEL;
            embeddingStatus = 'provider';
          } catch {
            candidates = claims;
            fallbackReason = 'provider_unavailable';
          }
      }
      const items = rankKnowledgeClaims({
        query: input.query,
        claims: candidates,
        mode: input.mode,
        limit: input.limit,
        ...(vectors
          ? {
              vectors: {
                query: vectors[0]!,
                claims: new Map(candidates.map((c, i) => [c.id, vectors[i + 1]!])),
              },
            }
          : {}),
        fullTextScores: new Map(rows.map((r) => [r.id, Number(r.lexical_score)])),
      });
      return {
        model,
        embeddingStatus,
        ...(fallbackReason ? { fallbackReason } : {}),
        candidateCount: claims.length,
        truncated: rows.length === 1000,
        items,
      };
    });
  }
  private async suggestions(
    client: PoolClient,
    context: WorkspaceRequestContext,
    projectId: string,
  ) {
    const claims = claimList(await approvedDecisionEvidence(client, { ...context, projectId }));
    const byId = new Map(claims.map((c) => [c.id, c]));
    const reviews = (
      await client.query<Review>(
        `select distinct on(claim_a_id,claim_b_id) claim_a_id,claim_b_id,fingerprint,decision,reason,applicability_condition from project_conflict_suggestion_reviews where project_id=$1 order by claim_a_id,claim_b_id,created_at desc,id desc`,
        [projectId],
      )
    ).rows;
    return detectKnowledgeConflicts(claims.slice(0, 300)).map((s) => {
      const claimA = byId.get(s.claimAId)!,
        claimB = byId.get(s.claimBId)!;
      const fingerprint = digest({ suggestion: s, a: claimA, b: claimB });
      return {
        ...s,
        claimA,
        claimB,
        fingerprint,
        review:
          reviews.find(
            (r) =>
              r.claim_a_id === s.claimAId &&
              r.claim_b_id === s.claimBId &&
              r.fingerprint === fingerprint,
          ) ?? null,
      };
    });
  }
  async conflicts(context: WorkspaceRequestContext, projectId: string) {
    return this.database.run(
      context,
      async (client) => {
        await this.project(client, projectId);
        return { items: await this.suggestions(client, context, projectId), candidateLimit: 300 };
      },
      { snapshot: true },
    );
  }
  async reviewConflict(
    context: WorkspaceRequestContext,
    projectId: string,
    input: ConflictSuggestionReviewInput,
  ) {
    return this.database.run(context, async (client) => {
      await this.project(client, projectId, true);
      const replay = await this.once(
        client,
        'project_conflict_suggestion_reviews',
        context,
        projectId,
        input.idempotencyKey,
        digest(input),
      );
      if (replay) return replay;
      const suggestion = (await this.suggestions(client, context, projectId)).find(
        (s) => s.claimAId === input.claimAId && s.claimBId === input.claimBId,
      );
      if (!suggestion || suggestion.fingerprint !== input.expectedFingerprint)
        throw new ConflictException('Conflict changed; refresh');
      const id = (
        await client.query<{ id: string }>(
          `insert into project_conflict_suggestion_reviews(workspace_id,project_id,claim_a_id,claim_b_id,fingerprint,decision,applicability_condition,reason,actor_id,idempotency_key,request_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
          [
            context.workspaceId,
            projectId,
            input.claimAId,
            input.claimBId,
            input.expectedFingerprint,
            input.decision,
            input.applicabilityCondition,
            input.reason,
            context.actorId,
            input.idempotencyKey,
            digest(input),
          ],
        )
      ).rows[0]!.id;
      await writeAudit(client, context, {
        action: 'intelligence.conflict.reviewed',
        targetType: 'conflict_review',
        targetId: id,
        projectId,
        after: { decision: input.decision, reasonHash: digest(input.reason) },
      });
      return { id, replayed: false };
    });
  }
  private async targets(client: PoolClient, projectId: string) {
    const solutions = (
      await client.query<{ id: string; title: string; summary: string }>(
        `select id,title,summary from solutions where project_id=$1 order by created_at desc,id limit 100`,
        [projectId],
      )
    ).rows;
    const documents = (
      await client.query<{ id: string; title: string; content: StructuredDocument }>(
        `select v.id,d.title,v.content from document_versions v join documents d on d.id=v.document_id where d.project_id=$1 order by v.created_at desc,v.id limit 100`,
        [projectId],
      )
    ).rows;
    return [
      ...solutions.map((s) => ({
        id: `solution:${s.id}`,
        type: 'solution' as const,
        versionId: s.id,
        blockIndex: null,
        title: s.title,
        text: s.summary,
      })),
      ...documents.flatMap((d) =>
        (d.content.blocks ?? []).slice(0, 10001).map((b, i) => ({
          id: `document:${d.id}:${i}`,
          type: 'document' as const,
          versionId: d.id,
          blockIndex: i,
          title: d.title,
          text: visibleText({ ...d.content, title: '', blocks: [b] }),
        })),
      ),
    ];
  }
  async linkEvidence(
    context: WorkspaceRequestContext,
    projectId: string,
    input: EvidenceLinkInput,
  ) {
    return this.database.run(context, async (client) => {
      await this.project(client, projectId, true);
      const replay = await this.once(
        client,
        'project_evidence_links',
        context,
        projectId,
        input.idempotencyKey,
        digest(input),
      );
      if (replay) return replay;
      const target = (await this.targets(client, projectId)).find(
        (t) =>
          t.type === input.targetType &&
          t.versionId === input.targetVersionId &&
          t.blockIndex === input.blockIndex,
      );
      if (!target || !target.text.includes(input.assertion))
        throw new BadRequestException('Assertion must occur verbatim in target');
      const claim = claimList(
        await approvedDecisionEvidence(client, { ...context, projectId, ids: [input.claimId] }),
      )[0];
      if (!claim) throw new ConflictException('Evidence unavailable');
      const id = (
        await client.query<{ id: string }>(
          `insert into project_evidence_links(workspace_id,project_id,target_type,target_version_id,block_index,assertion,claim_id,citation,relation,applicability_reviewed,reason,actor_id,idempotency_key,request_hash) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14) returning id`,
          [
            context.workspaceId,
            projectId,
            input.targetType,
            input.targetVersionId,
            input.blockIndex,
            input.assertion,
            input.claimId,
            JSON.stringify(claim),
            input.relation,
            input.applicabilityReviewed,
            input.reason,
            context.actorId,
            input.idempotencyKey,
            digest(input),
          ],
        )
      ).rows[0]!.id;
      await writeAudit(client, context, {
        action: 'intelligence.evidence.linked',
        targetType: 'evidence_link',
        targetId: id,
        projectId,
        after: { relation: input.relation, reasonHash: digest(input.reason) },
      });
      return { id, replayed: false };
    });
  }
  async graph(context: WorkspaceRequestContext, projectId: string) {
    return this.database.run(
      context,
      async (client) => {
        await this.project(client, projectId);
        const targets = await this.targets(client, projectId);
        const links = (
          await client.query<Link>(
            `select id,target_type,target_version_id,block_index,assertion,claim_id,relation,applicability_reviewed,citation from project_evidence_links where project_id=$1 order by created_at,id limit 5000`,
            [projectId],
          )
        ).rows;
        const ids = [...new Set(links.map((l) => l.claim_id))];
        const claims = claimList(
          await approvedDecisionEvidence(client, { ...context, projectId, ids, limit: 5000 }),
        );
        const byId = new Map(claims.map((c) => [c.id, c]));
        const usable = links.filter((l) => {
          const c = byId.get(l.claim_id);
          return (
            c &&
            c.knowledgeVersionId === l.citation.knowledgeVersionId &&
            c.quoteHash === l.citation.quoteHash &&
            c.sourceVersionId === l.citation.sourceVersionId &&
            c.startOffset === l.citation.startOffset &&
            c.endOffset === l.citation.endOffset
          );
        });
        const reviews = (
          await client.query<Review>(
            `select distinct on(claim_a_id,claim_b_id) claim_a_id,claim_b_id,fingerprint,decision,reason,applicability_condition from project_conflict_suggestion_reviews where project_id=$1 order by claim_a_id,claim_b_id,created_at desc,id desc`,
            [projectId],
          )
        ).rows;
        const reviewedIds = [...new Set(reviews.flatMap((r) => [r.claim_a_id, r.claim_b_id]))];
        const conflictClaims = claimList(
          await approvedDecisionEvidence(client, {
            ...context,
            projectId,
            ids: reviewedIds,
            limit: 5000,
          }),
        );
        const conflictsById = new Map(conflictClaims.map((c) => [c.id, c]));
        const opposing = (supportIds: Set<string>) =>
          reviews.flatMap((r) => {
            if (r.decision === 'dismissed') return [];
            const a = conflictsById.get(r.claim_a_id),
              b = conflictsById.get(r.claim_b_id);
            if (!a || !b) return [];
            const suggestion = detectKnowledgeConflicts([a, b])[0];
            if (!suggestion || digest({ suggestion, a, b }) !== r.fingerprint) return [];
            return supportIds.has(a.id) ? [b] : supportIds.has(b.id) ? [a] : [];
          });
        const evaluated = targets.map((target) => {
          const match = (l: Link) =>
            l.target_type === target.type &&
            l.target_version_id === target.versionId &&
            l.block_index === target.blockIndex;
          const active = usable.filter(match);
          const assertions = [...new Set(active.map((l) => l.assertion))].map((assertion) => {
            const own = active.filter((l) => l.assertion === assertion);
            const supports = own
              .filter((l) => l.relation === 'supports')
              .map((l) => byId.get(l.claim_id)!);
            return {
              assertion,
              assessment: assessEvidence({
                assertion,
                supports,
                opposes: [
                  ...own.filter((l) => l.relation === 'opposes').map((l) => byId.get(l.claim_id)!),
                  ...opposing(new Set(supports.map((c) => c.id))),
                ],
                applicabilityReviewed:
                  own.some((l) => l.relation === 'supports') &&
                  own
                    .filter((l) => l.relation === 'supports')
                    .every((l) => l.applicability_reviewed),
              }),
            };
          });
          return {
            ...target,
            assertions,
            assessment:
              assertions.length === 1 && assertions[0]!.assertion.trim() === target.text.trim()
                ? assertions[0]!.assessment
                : assessEvidence({ assertion: target.text, supports: [] }),
            unavailableLinkCount: links.filter(match).length - active.length,
          };
        });
        const visibleClaims = claims.filter((c) => usable.some((l) => l.claim_id === c.id));
        const edges = usable.flatMap((l) => {
          const target = targets.find(
            (t) =>
              t.type === l.target_type &&
              t.versionId === l.target_version_id &&
              t.blockIndex === l.block_index,
          );
          return target
            ? [
                {
                  from: `claim:${l.claim_id}`,
                  to: target.id,
                  relation: l.relation,
                  assertion: l.assertion,
                },
              ]
            : [];
        });
        const decisions = (
          await client.query<{ id: string; selected: unknown }>(
            `select id,selected from solution_selections where project_id=$1 order by created_at desc,id desc limit 1`,
            [projectId],
          )
        ).rows;
        for (const claim of visibleClaims)
          edges.push({
            from: `source:${claim.sourceVersionId}`,
            to: `claim:${claim.id}`,
            relation: 'exact_quote',
            assertion: claim.quote,
          });
        for (const decision of decisions)
          if (Array.isArray(decision.selected))
            for (const selected of decision.selected as unknown[]) {
              const sid =
                typeof selected === 'string'
                  ? selected
                  : typeof selected === 'object' && selected !== null && 'solutionId' in selected
                    ? String(selected.solutionId)
                    : '';
              if (targets.some((t) => t.id === `solution:${sid}`))
                edges.push({
                  from: `solution:${sid}`,
                  to: `decision:${decision.id}`,
                  relation: 'selected',
                  assertion: '',
                });
            }
        return {
          targets: evaluated,
          claims: visibleClaims,
          edges,
          decisions: decisions.map((d) => ({ id: d.id, version: 1 })),
          truncated: links.length === 5000 || targets.length >= 100,
        };
      },
      { snapshot: true },
    );
  }
  async previewResearch(
    context: WorkspaceRequestContext,
    projectId: string,
    plan: ProjectResearchPlan,
  ) {
    return this.database.run(
      context,
      async (client) => {
        await this.project(client, projectId);
        const rows = await approvedDecisionEvidence(client, {
          ...context,
          projectId,
          languages: plan.sourceLanguages ?? [plan.language],
        });
        return { ...captureAdaptiveEvidence(rows, plan).report, truncated: rows.length === 1000 };
      },
      { snapshot: true },
    );
  }
  async launchResearch(
    context: WorkspaceRequestContext,
    projectId: string,
    plan: ProjectResearchPlan,
    key: string,
  ) {
    const ref = await this.database.run(context, async (client) => {
      await this.project(client, projectId, true);
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${context.workspaceId}:${projectId}:${key}`,
      ]);
      const prior = (
        await client.query<{ id: string; plan_hash: string; actor_id: string }>(
          `select id,plan_hash,actor_id from project_research_intelligence_reports where project_id=$1 and idempotency_key=$2`,
          [projectId, key],
        )
      ).rows[0];
      if (prior && (prior.plan_hash !== digest(plan) || prior.actor_id !== context.actorId))
        throw new ConflictException('Idempotency key reused');
      if (prior) return { ...context, projectId, reportId: prior.id };
      const id = (
        await client.query<{ id: string }>(
          `insert into project_research_intelligence_reports(workspace_id,project_id,actor_id,plan,plan_hash,idempotency_key) values($1,$2,$3,$4::jsonb,$5,$6) returning id`,
          [
            context.workspaceId,
            projectId,
            context.actorId,
            JSON.stringify(plan),
            digest(plan),
            key,
          ],
        )
      ).rows[0]!.id;
      await writeAudit(client, context, {
        action: 'intelligence.research.queued',
        targetType: 'research_report',
        targetId: id,
        projectId,
      });
      return { ...context, projectId, reportId: id };
    });
    if (!this.engine.startDecisionResearch)
      throw new ServiceUnavailableException('Research worker unavailable');
    try {
      await this.engine.startDecisionResearch(`decision-research-${ref.reportId}`, ref);
    } catch {
      throw new ServiceUnavailableException('Research queued; retry with the same idempotency key');
    }
    return { workflowRunId: ref.reportId, status: 'queued' };
  }
  async researchReports(context: WorkspaceRequestContext, projectId: string) {
    return this.database.run(
      context,
      async (client) => {
        await this.project(client, projectId);
        const rows = (
          await client.query<{
            id: string;
            report: Record<string, unknown> | null;
            manifest: ProjectResearchManifestItem[] | null;
            status: string;
          }>(
            `select id,report,manifest,status from project_research_intelligence_reports where project_id=$1 order by created_at desc,id desc limit 20`,
            [projectId],
          )
        ).rows;
        const ids = [
          ...new Set(
            rows.flatMap((r) =>
              (r.manifest ?? []).flatMap((m) => (m.citations ?? [m]).map((c) => c.claimId)),
            ),
          ),
        ];
        const claims = new Map(
          claimList(
            await approvedDecisionEvidence(client, { ...context, projectId, ids, limit: 5000 }),
          ).map((c) => [c.id, c]),
        );
        const items = rows.map((row) => {
          const current = (row.manifest ?? []).every((m) =>
            (m.citations ?? [m]).every((pin) => {
              const c = claims.get(pin.claimId);
              return (
                c &&
                c.knowledgeVersionId === pin.knowledgeVersionId &&
                c.sourceVersionId === pin.sourceVersionId &&
                c.quoteHash === pin.sourceQuoteHash &&
                c.startOffset === pin.startOffset &&
                c.endOffset === pin.endOffset &&
                evidenceDigest(c.text) === m.claimHash
              );
            }),
          );
          return {
            workflowRunId: row.id,
            report: current ? row.report : null,
            current,
            status: row.status,
          };
        });
        return { items };
      },
      { snapshot: true },
    );
  }
}
