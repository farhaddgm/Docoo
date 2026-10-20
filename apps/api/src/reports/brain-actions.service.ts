import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { roleHasPermission, type WorkspacePermission } from '../auth/auth.authorization.js';
import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import {
  badRequest,
  forbidden,
  isUniqueViolation,
  notFound,
  conflict,
} from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import {
  isExecutableAction,
  type ExecutableActionKind,
  type Finding,
  type FindingAction,
} from './brain-analysis.js';

/** What a person needs besides `knowledge.audit` to approve each kind of action. */
const ACTION_PERMISSION: Record<ExecutableActionKind, WorkspacePermission> = {
  audit_knowledge: 'knowledge.audit',
  request_revision: 'workflow.reject',
  pause_project: 'project.pause',
};

export interface ActionDecisionInput {
  readonly findingKey: string;
  readonly actionKey: string;
  readonly decision: 'approve' | 'dismiss';
  readonly note?: string | undefined;
}

const text = (language: string, fa: string, en: string) => (language === 'fa' ? fa : en);

/**
 * Runs the actions a Brain report proposed, one at a time, only after an administrator
 * approves them (ADR-0032, FR-BRN-004). The action is read from the stored report, never from
 * the request; it runs through the same service and permission as the matching screen, and the
 * decision, its result and an audit event are recorded.
 */
@Injectable()
export class BrainActionsService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly knowledge: KnowledgeService,
    private readonly workflow: WorkflowService,
    private readonly projects: ProjectsService,
  ) {}

  async decide(
    context: WorkspaceRequestContext,
    role: string,
    reportId: string,
    input: ActionDecisionInput,
  ) {
    const found = await this.database.run(context, async (client) => {
      const report = (
        await client.query<{ findings: Finding[]; project_id: string | null }>(
          'select findings, project_id from brain_reports where id = $1',
          [reportId],
        )
      ).rows[0];
      if (!report) throw notFound('BRAIN_REPORT_NOT_FOUND', 'The Brain report was not found.');
      const finding = report.findings.find((item) => item.key === input.findingKey);
      const action = finding?.actions.find((item) => item.key === input.actionKey);
      if (!finding || !action) {
        throw notFound('BRAIN_ACTION_NOT_FOUND', 'The report has no such proposed action.');
      }
      return { finding, action };
    });
    const { finding, action } = found;
    if (!isExecutableAction(action.kind)) {
      throw badRequest(
        'BRAIN_ACTION_NOT_EXECUTABLE',
        'This action only opens a page; there is nothing to approve.',
      );
    }
    const kind = action.kind;
    if (input.decision === 'approve' && !roleHasPermission(role, ACTION_PERMISSION[kind])) {
      throw forbidden('BRAIN_ACTION_FORBIDDEN', 'You may not approve this kind of action.');
    }
    const projectId = this.projectOf(finding, action);
    const decisionId = await this.record(
      context,
      reportId,
      input,
      finding,
      action,
      kind,
      projectId,
    );
    if (input.decision === 'dismiss') return this.load(context, decisionId);

    let result: Record<string, unknown>;
    try {
      result = await this.run(context, kind, action, projectId, decisionId, input.note);
    } catch (error) {
      await this.complete(
        context,
        reportId,
        decisionId,
        'failed',
        {
          error: errorCode(error),
        },
        finding,
        action,
        projectId,
      );
      throw error;
    }
    await this.complete(context, reportId, decisionId, 'done', result, finding, action, projectId);
    return this.load(context, decisionId);
  }

  async list(client: PoolClient, reportId: string) {
    return (
      await client.query<Record<string, unknown>>(
        `select id, finding_key as "findingKey", action_key as "actionKey", action_kind as "actionKind",
                target_type as "targetType", target_id as "targetId", status, note, result,
                decided_by as "decidedBy", ${isoColumn('created_at', '"createdAt"')},
                ${isoColumn('completed_at', '"completedAt"')}
           from brain_action_decisions where report_id = $1 order by created_at, id`,
        [reportId],
      )
    ).rows;
  }

  private projectOf(finding: Finding, action: FindingAction): string | null {
    const fromAction = action.params['projectId'];
    if (typeof fromAction === 'string') return fromAction;
    return finding.projectId;
  }

  private async record(
    context: WorkspaceRequestContext,
    reportId: string,
    input: ActionDecisionInput,
    finding: Finding,
    action: FindingAction,
    kind: ExecutableActionKind,
    projectId: string | null,
  ): Promise<string> {
    const dismiss = input.decision === 'dismiss';
    try {
      return await this.database.run(context, async (client) => {
        const row = (
          await client.query<{ id: string }>(
            `insert into brain_action_decisions (workspace_id, report_id, finding_key, action_key, action_kind, project_id,
                                                 target_type, target_id, status, note, action, decided_by, completed_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, case when $9 = 'dismissed' then now() end)
             returning id`,
            [
              context.workspaceId,
              reportId,
              finding.key,
              action.key,
              kind,
              projectId,
              action.target?.type ?? 'none',
              action.target?.id,
              dismiss ? 'dismissed' : 'running',
              input.note ?? '',
              JSON.stringify(action),
              context.actorId,
            ],
          )
        ).rows[0]!;
        if (dismiss) {
          await writeAudit(client, context, {
            action: 'brain.action_dismissed',
            targetType: 'brain_report',
            targetId: reportId,
            projectId,
            reason: input.note || null,
            after: this.auditAfter(row.id, finding, action),
          });
        }
        return row.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('BRAIN_ACTION_DECIDED', 'This action was already decided for this report.');
      }
      throw error;
    }
  }

  private auditAfter(decisionId: string, finding: Finding, action: FindingAction) {
    return {
      decisionId,
      findingKey: finding.key,
      actionKey: action.key,
      kind: action.kind,
      targetType: action.target?.type ?? null,
      targetId: action.target?.id ?? null,
    };
  }

  private async complete(
    context: WorkspaceRequestContext,
    reportId: string,
    decisionId: string,
    status: 'done' | 'failed',
    result: Record<string, unknown>,
    finding: Finding,
    action: FindingAction,
    projectId: string | null,
  ) {
    await this.database.run(context, async (client) => {
      await client.query(
        `update brain_action_decisions set status = $2, result = $3::jsonb, completed_at = now() where id = $1`,
        [decisionId, status, JSON.stringify(result)],
      );
      await writeAudit(client, context, {
        action: status === 'done' ? 'brain.action_approved' : 'brain.action_failed',
        targetType: 'brain_report',
        targetId: reportId,
        projectId,
        severity: status === 'done' ? 'info' : 'warning',
        after: this.auditAfter(decisionId, finding, action),
      });
    });
  }

  private async load(context: WorkspaceRequestContext, decisionId: string) {
    return this.database.run(context, async (client) => {
      const reportId = (
        await client.query<{ report_id: string }>(
          'select report_id from brain_action_decisions where id = $1',
          [decisionId],
        )
      ).rows[0]!.report_id;
      return (await this.list(client, reportId)).find((row) => row['id'] === decisionId)!;
    });
  }

  private async run(
    context: WorkspaceRequestContext,
    kind: ExecutableActionKind,
    action: FindingAction,
    projectId: string | null,
    decisionId: string,
    note: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (kind === 'audit_knowledge') {
      const done = await this.knowledge.submitAudit(context, action.target!.id);
      return { decision: done.review.decision, overall: done.review.overall };
    }
    const language = await this.database.run(
      context,
      async (client) =>
        (
          await client.query<{ language: string }>(
            'select output_language as language from projects where id = $1',
            [projectId],
          )
        ).rows[0]?.language ?? 'en',
    );
    if (kind === 'request_revision') {
      const percent = Number(action.params['recentPercent'] ?? 0);
      const review = await this.workflow.review(
        context,
        String(action.params['projectId']),
        String(action.params['stageRunId']),
        String(action.params['outputId']),
        {
          action: 'reject',
          comment: text(
            language,
            `درخواست بازبینی از Brain: در این مرحله اخیراً ${percent}٪ موارد مشکل داشته‌اند. این خروجی را دقیق‌تر با اصول و وظایف نقش و الزام‌های مرحله بسنجید و نسخهٔ بهتری بنویسید.`,
            `Revision requested by Brain: recently ${percent}% of this stage's work had problems. Check this output again against the role's principles and the stage requirements, and write a better version.`,
          ),
          idempotencyKey: `brain-action:${decisionId}`,
        },
      );
      return { action: review.action, gate: review.gate };
    }
    const project = await this.projects.command(
      context,
      String(action.params['projectId']),
      'pause',
      {
        expectedVersion: Number(action.params['expectedVersion']),
        reason:
          note ||
          text(
            language,
            'توقف با تأیید ادمین بر پایهٔ پیشنهاد Brain (افزایش هزینه).',
            'Paused by the administrator on a Brain proposal (cost increase).',
          ),
      },
    );
    return { status: project.status };
  }
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'getResponse' in error) {
    const response = (error as { getResponse(): unknown }).getResponse();
    if (typeof response === 'object' && response !== null && 'code' in response) {
      return String(response.code).slice(0, 80);
    }
  }
  return 'ERROR';
}
