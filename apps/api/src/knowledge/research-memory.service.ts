import { createHash } from 'node:crypto';

import {
  composeMemory,
  maxConfidentiality,
  memoryEligibility,
  memoryFingerprintText,
  memoryProvenance,
  type MemoryBlock,
  type MemoryConfidentiality,
} from '@docoo/contracts';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import { conflict, notFound, unprocessable } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { KnowledgeService } from './knowledge.service.js';

export type MemoryState =
  | { readonly index: number; readonly state: 'saveable' }
  | { readonly index: number; readonly state: 'saved'; readonly knowledgeId: string }
  | { readonly index: number; readonly state: 'blocked'; readonly reason: MemoryBlock };

interface LoadedOutput {
  readonly stageRunId: string;
  readonly findings: Record<string, unknown>[];
  readonly queries: string[];
  readonly createdAt: string;
  readonly projectTitle: string;
  readonly language: 'fa' | 'en';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const objects = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object' && !Array.isArray(item),
      )
    : [];

/**
 * Research memory (ADR-0053): keeps a verified research finding as a draft of the organization's
 * knowledge. The draft is created and recorded in one transaction; it still has to pass the
 * knowledge audit before any research can rely on it.
 */
@Injectable()
export class ResearchMemoryService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly knowledge: KnowledgeService,
  ) {}

  /** Which findings of an output may be kept, which already are, and why the rest cannot. */
  async list(
    context: WorkspaceRequestContext,
    projectId: string,
    outputId: string,
  ): Promise<{ outputId: string; items: MemoryState[] }> {
    return this.database.run(context, async (client) => {
      const output = await this.loadOutput(client, projectId, outputId);
      const nowYear = new Date().getUTCFullYear();
      const prints = output.findings.map((finding) => sha256(memoryFingerprintText(finding)));
      const kept =
        prints.length > 0 ? await this.keptItems(client, prints) : new Map<string, string>();
      const items = output.findings.map((finding, index): MemoryState => {
        const knowledgeId = kept.get(prints[index]!);
        if (knowledgeId) return { index, state: 'saved', knowledgeId };
        const eligibility = memoryEligibility(finding, nowYear);
        return eligibility.ok
          ? { index, state: 'saveable' }
          : { index, state: 'blocked', reason: eligibility.reason };
      });
      return { outputId, items };
    });
  }

  async save(
    context: WorkspaceRequestContext,
    projectId: string,
    input: {
      readonly outputId: string;
      readonly findingIndex: number;
      readonly title?: string | undefined;
      readonly confidentiality: MemoryConfidentiality;
    },
  ): Promise<{ knowledgeId: string }> {
    return this.database.run(context, async (client) => {
      const output = await this.loadOutput(client, projectId, input.outputId);
      const finding = output.findings[input.findingIndex];
      if (!finding)
        throw notFound('RESEARCH_FINDING_NOT_FOUND', 'That finding is not in the output.');
      const eligibility = memoryEligibility(finding, new Date().getUTCFullYear());
      if (!eligibility.ok) {
        throw unprocessable(
          'RESEARCH_MEMORY_NOT_ALLOWED',
          'This finding cannot be kept in the knowledge.',
          { reason: eligibility.reason },
        );
      }
      const fingerprint = sha256(memoryFingerprintText(finding));
      // Two people keeping the same finding at once must not make two items.
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `research-memory:${context.workspaceId}:${fingerprint}`,
      ]);
      const existing = await this.keptItems(client, [fingerprint]);
      if (existing.has(fingerprint)) {
        throw conflict(
          'RESEARCH_MEMORY_ALREADY_SAVED',
          'This finding is already kept in the knowledge.',
          {
            knowledgeId: existing.get(fingerprint),
          },
        );
      }

      // A kept finding is never less confidential than the approved knowledge it was built on.
      const knowledgeIds = eligibility.knowledgeIds.filter((id) => UUID.test(id));
      let confidentiality = input.confidentiality;
      if (knowledgeIds.length > 0) {
        const floors = await client.query<{ confidentiality: MemoryConfidentiality }>(
          `select confidentiality from knowledge_items where id = any($1::uuid[])`,
          [knowledgeIds],
        );
        for (const row of floors.rows)
          confidentiality = maxConfidentiality(confidentiality, row.confidentiality);
      }

      // The project's topics, so later projects of the same topics find it; the project alone without any.
      const topics = await client.query<{ topicId: string }>(
        `select topic_id as "topicId" from project_topics where project_id = $1 order by priority`,
        [projectId],
      );
      const scopes =
        topics.rows.length > 0
          ? topics.rows.map((row) => ({ type: 'topic' as const, id: row.topicId }))
          : [{ type: 'project' as const, id: projectId }];

      const draft = composeMemory(finding, eligibility.pages, output.language, {
        accessedAt: output.createdAt,
        ...(input.title ? { title: input.title } : {}),
      });
      const created = (await this.knowledge.createWithin(client, context, {
        title: draft.title,
        sourceType: 'autonomous_research',
        confidentiality,
        language: output.language,
        content: draft.content,
        scopes,
        provenance: memoryProvenance({
          queries: output.queries,
          claim: draft.claim.text,
          accessedAt: output.createdAt,
          projectId,
          stageRunId: output.stageRunId,
          outputId: input.outputId,
          fingerprint,
          publishedAtIsAsOfYear: draft.publishedAtIsAsOfYear,
        }),
        ...(eligibility.validUntil ? { validUntil: eligibility.validUntil } : {}),
        claims: [draft.claim],
      })) as { id: string };

      await client.query(
        `insert into research_memory_items
           (workspace_id, project_id, stage_run_id, output_id, fingerprint, knowledge_id, created_by)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          context.workspaceId,
          projectId,
          output.stageRunId,
          input.outputId,
          fingerprint,
          created.id,
          context.actorId,
        ],
      );
      await writeAudit(client, context, {
        action: 'research_memory.saved',
        targetType: 'knowledge',
        targetId: created.id,
        projectId,
        after: { outputId: input.outputId, findingIndex: input.findingIndex, fingerprint },
      });
      return { knowledgeId: created.id };
    });
  }

  private async loadOutput(
    client: PoolClient,
    projectId: string,
    outputId: string,
  ): Promise<LoadedOutput> {
    const row = (
      await client.query<{
        stageRunId: string;
        content: unknown;
        createdAt: string;
        title: string;
        language: 'fa' | 'en';
      }>(
        `select o.stage_run_id as "stageRunId", o.content, ${isoColumn('o.created_at', '"createdAt"')},
                p.title, p.output_language as language
           from stage_outputs o
           join stage_runs s on s.id = o.stage_run_id
           join projects p on p.id = s.project_id
          where o.id = $1 and s.project_id = $2 and s.stage = 'research' and p.deleted_at is null`,
        [outputId, projectId],
      )
    ).rows[0];
    if (!row) throw notFound('RESEARCH_OUTPUT_NOT_FOUND', 'That research output was not found.');
    const content =
      row.content !== null && typeof row.content === 'object'
        ? (row.content as Record<string, unknown>)
        : {};
    const web =
      content['web'] !== null && typeof content['web'] === 'object'
        ? (content['web'] as Record<string, unknown>)
        : {};
    return {
      stageRunId: row.stageRunId,
      findings: objects(content['findings']),
      queries: Array.isArray(web['queries'])
        ? web['queries'].filter((item): item is string => typeof item === 'string')
        : [],
      createdAt: row.createdAt,
      projectTitle: row.title,
      language: row.language,
    };
  }

  /** Fingerprint → the knowledge item that keeps it, for items that still exist. */
  private async keptItems(
    client: PoolClient,
    fingerprints: string[],
  ): Promise<Map<string, string>> {
    const rows = await client.query<{ fingerprint: string; knowledgeId: string }>(
      `select m.fingerprint, m.knowledge_id as "knowledgeId"
         from research_memory_items m
         join knowledge_items k on k.id = m.knowledge_id and k.workspace_id = m.workspace_id
        where m.fingerprint = any($1::text[]) and k.deleted_at is null`,
      [fingerprints],
    );
    return new Map(rows.rows.map((row) => [row.fingerprint, row.knowledgeId]));
  }
}
