import { Inject, Injectable } from '@nestjs/common';
import {
  checkCompliance,
  DocumentValidationError,
  isTemplateKey,
  templateFor,
  validateDocument,
  visibleText,
  walkBlocks,
  type Level,
} from '@docoo/documents';
import { checkTerms } from '@docoo/domain';
import {
  documentWritingWorkflowId,
  resolveAgentProfile,
  resolveWritingSettings,
} from '@docoo/orchestration';
import type { PoolClient, QueryResultRow } from 'pg';

import { BusinessService } from '../business/business.service.js';
import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import { badRequest, conflict, isUniqueViolation, notFound } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';
import { engineUnavailable } from '../workflow/command-runner.js';
import {
  WORKFLOW_ENGINE,
  WorkflowEngineUnavailableError,
  type WorkflowEngine,
} from '../workflow/workflow.engine.js';
import { levelBoundsFrom } from './document-store.js';

interface WritingRow extends QueryResultRow {
  id: string;
  document_id: string;
  project_id: string;
  status: string;
  phase: string;
  level: number;
  template_version: string;
  language: 'fa' | 'en';
  notes: string | null;
  base_version_id: string | null;
  result_version_id: string | null;
  agent_definition_version_id: string | null;
  plan: {
    sections?: {
      key: string;
      label: string;
      source: string;
      subsections: { id: string; heading: string | null; budget: { target: number } }[];
    }[];
    targetTotal?: number;
    notes?: string[];
  } | null;
  parts: Record<string, { letters: number; fitRound: number; tries: number }>;
  report: Record<string, unknown> | null;
  block_code: string | null;
  error_code: string | null;
  requested_by: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  cost_usd: number | null;
  calls: number;
}

const columns = `w.id, w.document_id, w.project_id, w.status, w.phase, w.level, w.template_version,
  w.language::text as language, w.notes, w.base_version_id, w.result_version_id, w.agent_definition_version_id,
  w.plan, w.parts, w.report, w.block_code, w.error_code, w.requested_by,
  ${isoColumn('w.started_at', 'started_at')}, ${isoColumn('w.ended_at', 'ended_at')},
  ${isoColumn('w.created_at', 'created_at')},
  (select sum(i.cost_usd)::real from model_invocations i where i.writing_id = w.id) as cost_usd,
  (select count(*)::int from model_invocations i where i.writing_id = w.id and i.status = 'succeeded') as calls`;

const LIVE = ['queued', 'running', 'paused'];

export interface StartWritingInput {
  readonly level?: number | undefined;
  readonly template?: string | undefined;
  readonly notes?: string | undefined;
}

/** The documenter writes a document (ADR-0019): start it, follow it, pause, resume or cancel. */
@Injectable()
export class WritingsService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly config: ConfigService,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEngine,
    private readonly business: BusinessService,
  ) {}

  async list(context: WorkspaceRequestContext, documentId: string) {
    return this.database.run(context, async (client) => {
      await this.requireDocument(client, documentId);
      const rows = await client.query<WritingRow>(
        `select ${columns} from document_writings w where w.document_id = $1 order by w.created_at desc, w.id desc limit 20`,
        [documentId],
      );
      return rows.rows.map((row) => this.summary(row));
    });
  }

  async get(context: WorkspaceRequestContext, documentId: string, writingId: string) {
    return this.database.run(context, async (client) => {
      const row = await this.load(client, documentId, writingId);
      return this.detail(row);
    });
  }

  async start(context: WorkspaceRequestContext, documentId: string, input: StartWritingInput) {
    // The documenter reads the project's business as it is when the writing starts: Contenter is
    // asked first (when the project asks for it) and the snapshot is pinned to the writing.
    const owner = await this.database.run(
      context,
      async (client) =>
        (
          await client.query<{ project_id: string }>(
            'select project_id from documents where id = $1',
            [documentId],
          )
        ).rows[0],
    );
    if (!owner) throw notFound('DOCUMENT_NOT_FOUND', 'The document was not found.');
    const business = await this.business.resolveForUse(context, owner.project_id);
    const created = await this.database.run(context, async (client) => {
      const document = (
        await client.query<{
          id: string;
          project_id: string;
          solution_id: string | null;
          status: string;
          level: number;
          language: 'fa' | 'en';
          current_version_id: string | null;
          version: number;
        }>(
          `select id, project_id, solution_id, status::text as status, level, language::text as language,
                  current_version_id, version
             from documents where id = $1 for update`,
          [documentId],
        )
      ).rows[0];
      if (!document) throw notFound('DOCUMENT_NOT_FOUND', 'The document was not found.');
      if (['locked', 'superseded'].includes(document.status)) {
        throw conflict('DOCUMENT_LOCKED', 'A locked document can only change through supersede.');
      }
      if (!document.solution_id) {
        throw conflict(
          'DOCUMENT_HAS_NO_SOLUTION',
          'The documenter writes the document of a solution; this document has none.',
        );
      }
      const live = await client.query(
        `select 1 from document_writings where document_id = $1 and status in ('queued', 'running', 'paused')`,
        [documentId],
      );
      if (live.rowCount)
        throw conflict(
          'DOCUMENT_WRITING_ACTIVE',
          'The documenter is already writing this document.',
        );

      const effective = await this.config.resolve(client, context, 'project', document.project_id);
      const settings = resolveWritingSettings(effective.values);
      // The documenter's own model (Agents page) wins over the project's default.
      const definition = (
        await resolveAgentProfile(client, {
          workspaceId: context.workspaceId,
          projectId: document.project_id,
          role: 'documenter',
        })
      ).definition;
      const connectionId = definition.modelPolicy?.connectionId ?? settings.connectionId;
      const model = definition.modelPolicy?.model ?? settings.model;
      if (!connectionId || !model)
        throw conflict('AI_NOT_CONFIGURED', 'Set ai.connection_id and ai.model first.');

      const level = input.level ?? document.level;
      const template =
        input.template === undefined
          ? templateFor(effective.values['document.default_template'])
          : isTemplateKey(input.template)
            ? templateFor(input.template)
            : null;
      if (!template)
        throw badRequest('DOCUMENT_TEMPLATE_UNKNOWN', 'Choose brief, standard or detailed.');

      const row = await client
        .query<{ id: string }>(
          `insert into document_writings (workspace_id, project_id, document_id, level, template_version, language, notes,
                                        base_version_id, temporal_workflow_id, settings, requested_by, business_snapshot_id)
         values ($1, $2, $3, $4, $5, $6::locale, $7, $8, 'pending', $9::jsonb, $10, $11)
         returning id`,
          [
            context.workspaceId,
            document.project_id,
            documentId,
            level,
            template.version,
            document.language,
            input.notes?.trim() ? input.notes.trim() : null,
            document.current_version_id,
            JSON.stringify({ ...settings, levelBounds: effective.values['document.level_bounds'] }),
            context.actorId,
            business.snapshotId,
          ],
        )
        .catch((error: unknown) => {
          if (isUniqueViolation(error))
            throw conflict(
              'DOCUMENT_WRITING_ACTIVE',
              'The documenter is already writing this document.',
            );
          throw error;
        });
      const writingId = row.rows[0]!.id;
      const workflowId = documentWritingWorkflowId(writingId);
      await client.query('update document_writings set temporal_workflow_id = $2 where id = $1', [
        writingId,
        workflowId,
      ]);
      // The document keeps the level the writing was asked for, so versions and the document agree.
      if (level !== document.level) {
        await client.query('update documents set level = $2, version = version + 1 where id = $1', [
          documentId,
          level,
        ]);
      }
      await writeAudit(client, context, {
        action: 'document.writing_requested',
        targetType: 'document',
        targetId: documentId,
        projectId: document.project_id,
        after: {
          writingId,
          level,
          template: template.version,
          knowledgeLimit: settings.knowledgeLimit,
          fitRounds: settings.fitRounds,
        },
      });
      return { writingId, workflowId, projectId: document.project_id };
    });

    try {
      await this.engine.startWriting(created.workflowId, {
        workspaceId: context.workspaceId,
        projectId: created.projectId,
        documentId,
        writingId: created.writingId,
      });
    } catch (error) {
      if (!(error instanceof WorkflowEngineUnavailableError)) throw error;
      // Nothing is running: free the document for another try instead of leaving a stuck row.
      await this.database.run(context, (client) =>
        client.query(
          `update document_writings set status = 'failed', phase = 'done', error_code = 'engine_unavailable', ended_at = now()
            where id = $1 and status = 'queued'`,
          [created.writingId],
        ),
      );
      throw engineUnavailable();
    }
    return this.get(context, documentId, created.writingId);
  }

  /** Pause, resume or cancel; the workflow does it at its next safe point. */
  async signal(
    context: WorkspaceRequestContext,
    documentId: string,
    writingId: string,
    action: 'pause' | 'resume' | 'cancel',
    reason: string | undefined,
  ) {
    const row = await this.database.run(context, async (client) => {
      const writing = await this.load(client, documentId, writingId);
      if (!LIVE.includes(writing.status))
        throw conflict('DOCUMENT_WRITING_FINISHED', 'This writing is already finished.');
      if (action === 'resume' && writing.status !== 'paused')
        throw conflict('DOCUMENT_WRITING_NOT_PAUSED', 'Only a paused writing can be resumed.');
      if (action === 'pause' && writing.status === 'paused')
        throw conflict('DOCUMENT_WRITING_PAUSED', 'The writing is already paused.');
      await writeAudit(client, context, {
        action: `document.writing_${action}_requested`,
        targetType: 'document',
        targetId: documentId,
        projectId: writing.project_id,
        reason: reason ?? null,
        after: { writingId },
      });
      return writing;
    });
    try {
      await this.engine.signal(
        documentWritingWorkflowId(row.id),
        action,
        action === 'cancel' ? { reason: reason ?? null } : undefined,
      );
    } catch (error) {
      if (error instanceof WorkflowEngineUnavailableError) throw engineUnavailable();
      throw error;
    }
    return this.get(context, documentId, writingId);
  }

  /**
   * Checks an edited document without saving it: the structure, the official count against the
   * bounds of its level, the outline and which references are cited. The editor uses it while
   * the administrator works; saving still validates again (DOC-101).
   */
  async check(
    context: WorkspaceRequestContext,
    documentId: string,
    input: { content: unknown; level?: number | undefined },
  ) {
    return this.database.run(context, async (client) => {
      const document = await this.requireDocument(client, documentId);
      const level = (input.level ?? document.level) as Level;
      try {
        const content = validateDocument(input.content);
        const bounds = levelBoundsFrom(
          (await this.config.resolve(client, context, 'project', document.project_id)).values[
            'document.level_bounds'
          ],
        );
        const compliance = checkCompliance(content, level, bounds);
        const used = new Set<string>();
        const entries: { id: string; text: string }[] = [];
        const outline: { id: string; level: number; text: string }[] = [];
        for (const block of walkBlocks(content.blocks)) {
          if (block.type === 'heading')
            outline.push({ id: block.id, level: block.level, text: block.text });
          if (block.type === 'paragraph')
            for (const run of block.runs) for (const id of run.citations ?? []) used.add(id);
          if (block.type === 'bibliography')
            for (const entry of block.entries) entries.push({ id: entry.id, text: entry.text });
        }
        // Brand terminology is checked by code against the project's business, never by the model.
        const termIssues = checkTerms(
          visibleText(content),
          await this.business.termRules(client, document.project_id),
        );
        return {
          valid: true as const,
          problems: [] as string[],
          termIssues,
          compliance: {
            level: compliance.level,
            count: compliance.count,
            algorithm: compliance.algorithm,
            bounds: compliance.bounds,
            withinBounds: compliance.withinBounds,
            deviation: compliance.deviation,
          },
          outline,
          references: entries.map((entry) => ({ ...entry, cited: used.has(entry.id) })),
        };
      } catch (error) {
        if (error instanceof DocumentValidationError)
          return { valid: false as const, problems: error.problems };
        throw error;
      }
    });
  }

  // ------------------------------------------------------------------ helpers

  private async requireDocument(client: PoolClient, documentId: string) {
    const row = (
      await client.query<{ id: string; project_id: string; level: number }>(
        'select id, project_id, level from documents where id = $1',
        [documentId],
      )
    ).rows[0];
    if (!row) throw notFound('DOCUMENT_NOT_FOUND', 'The document was not found.');
    return row;
  }

  private async load(client: PoolClient, documentId: string, writingId: string) {
    const row = (
      await client.query<WritingRow>(
        `select ${columns} from document_writings w where w.id = $1 and w.document_id = $2`,
        [writingId, documentId],
      )
    ).rows[0];
    if (!row) throw notFound('DOCUMENT_WRITING_NOT_FOUND', 'The writing was not found.');
    return row;
  }

  private summary(row: WritingRow) {
    return {
      id: row.id,
      status: row.status,
      phase: row.phase,
      level: row.level,
      templateVersion: row.template_version,
      blockCode: row.block_code,
      errorCode: row.error_code,
      resultVersionId: row.result_version_id,
      withinBounds:
        row.report && typeof row.report['withinBounds'] === 'boolean'
          ? row.report['withinBounds']
          : null,
      createdAt: row.created_at,
      endedAt: row.ended_at,
    };
  }

  private detail(row: WritingRow) {
    const subsections = (row.plan?.sections ?? []).flatMap((section) =>
      section.subsections.map((sub) => {
        const part = row.parts[sub.id];
        return {
          id: sub.id,
          section: section.label,
          source: section.source,
          heading: sub.heading,
          target: sub.budget.target,
          letters: part?.letters ?? null,
          state: part ? (part.fitRound > 0 ? 'adjusted' : 'written') : 'pending',
        };
      }),
    );
    return {
      ...this.summary(row),
      documentId: row.document_id,
      language: row.language,
      notes: row.notes,
      baseVersionId: row.base_version_id,
      agentDefinitionVersionId: row.agent_definition_version_id,
      requestedBy: row.requested_by,
      startedAt: row.started_at,
      progress: {
        total: subsections.length,
        written: subsections.filter((item) => item.state !== 'pending').length,
        targetTotal: row.plan?.targetTotal ?? null,
        subsections,
      },
      flags: row.plan?.notes ?? [],
      report: row.report,
      cost: { usd: row.cost_usd, modelCalls: row.calls },
    };
  }
}
