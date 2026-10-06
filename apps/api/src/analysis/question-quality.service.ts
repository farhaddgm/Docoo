import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  composeInstructions,
  normalizeQuestionQuality,
  QUESTION_QUALITY_RULES,
  QUESTION_QUALITY_SCHEMA,
  QUESTION_QUALITY_SCHEMA_NAME,
  questionQualityPromptData,
  resolveQualityCriteria,
  type QualityCriterion,
  type QualityFinding,
  type QualityQuestion,
  type QualityReviewReason,
} from '@docoo/domain';
import { activeAgentVersion, ProviderRuntime } from '@docoo/orchestration';
import { ProviderError } from '@docoo/providers';
import type { PoolClient } from 'pg';

import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import { conflict, notFound, unprocessable } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';
import { settingText } from '../documents/document-store.js';
import { PROVIDER_RUNTIME } from '../providers/providers.service.js';

export interface ReviewRow {
  id: string;
  criteria: QualityCriterion[];
  questionCount: number;
  judgeVersionId: string | null;
  model: string;
  status: 'completed' | 'failed';
  reason: QualityReviewReason | null;
  score: number | null;
  summary: string | null;
  findings: QualityFinding[];
  discarded: number;
  invocationId: string | null;
  errorCode: string | null;
  createdAt: string;
}

const reviewColumns = `id, criteria, question_count as "questionCount", judge_version_id as "judgeVersionId", model,
  status, reason, score, summary, findings, discarded, invocation_id as "invocationId", error_code as "errorCode",
  ${isoColumn('created_at', '"createdAt"')}`;

const digest = (prompt: { instructions: string; message: string }) =>
  createHash('sha256')
    .update(prompt.instructions)
    .update('\n')
    .update(prompt.message)
    .digest('hex');

/**
 * The Brain judges the analyst's questions of a project (ADR-0024). It reads the questions as they
 * stand, never the answers, and changes nothing: the result is a new, append-only review. Only
 * findings that name real questions survive (`normalizeQuestionQuality`).
 */
@Injectable()
export class QuestionQualityService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly config: ConfigService,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
  ) {}

  /** The newest reviews of the project, newest first, and how many questions there are now. */
  async list(context: WorkspaceRequestContext, projectId: string) {
    return this.database.run(context, async (client) => {
      await this.requireProject(client, projectId);
      const session = await this.session(client, projectId);
      const questionCount = session
        ? Number(
            (
              await client.query<{ count: string }>(
                'select count(*) as count from analysis_questions where session_id = $1',
                [session.id],
              )
            ).rows[0]!.count,
          )
        : 0;
      const reviews = (
        await client.query<ReviewRow>(
          `select ${reviewColumns} from question_quality_reviews where project_id = $1
            order by created_at desc, id desc limit 10`,
          [projectId],
        )
      ).rows;
      return { reviews, questionCount };
    });
  }

  async run(context: WorkspaceRequestContext, projectId: string) {
    const plan = await this.database.run(context, async (client) => {
      await this.requireProject(client, projectId);
      const session = await this.session(client, projectId);
      if (!session)
        throw unprocessable('ANALYSIS_NO_QUESTIONS', 'The analyst has not asked any question yet.');
      const rows = (
        await client.query<{
          id: string;
          number: number;
          category: string;
          text: string;
          status: string;
        }>(
          `select id, ordinal as number, category, text, status from analysis_questions
            where session_id = $1 order by ordinal`,
          [session.id],
        )
      ).rows;
      if (rows.length === 0)
        throw unprocessable('ANALYSIS_NO_QUESTIONS', 'The analyst has not asked any question yet.');
      const effective = await this.config.resolve(client, context, 'project', projectId);
      const judge = await activeAgentVersion(client, context.workspaceId, 'brain');
      const connectionId =
        judge.modelPolicy?.connectionId ?? settingText(effective.values['ai.connection_id']);
      const model = judge.modelPolicy?.model ?? settingText(effective.values['ai.model']);
      if (!connectionId || !model)
        throw conflict('AI_NOT_CONFIGURED', 'Set ai.connection_id and ai.model first.');
      const language = (
        await client.query<{ language: 'fa' | 'en' }>(
          'select output_language as language from projects where id = $1',
          [projectId],
        )
      ).rows[0]!.language;
      const questions: QualityQuestion[] = rows.map((row) => ({
        ref: `Q${row.number}`,
        id: row.id,
        number: row.number,
        category: row.category,
        text: row.text,
        status: row.status,
      }));
      return {
        sessionId: session.id,
        questions,
        criteria: resolveQualityCriteria(effective.values['analysis.quality_criteria']),
        judge,
        connectionId,
        model,
        language,
      };
    });

    const prompt = {
      instructions: composeInstructions({
        role: 'brain',
        content: plan.judge,
        language: plan.language,
        task: plan.judge.promptTemplate,
        rules: QUESTION_QUALITY_RULES,
      }),
      message: `<data>${JSON.stringify(
        questionQualityPromptData({ criteria: plan.criteria, questions: plan.questions }),
      )}</data>`,
    };
    type Outcome =
      | {
          status: 'completed';
          score: number;
          summary: string;
          findings: readonly QualityFinding[];
          discarded: number;
        }
      | { status: 'failed'; reason: QualityReviewReason; errorCode: string | null };
    let invocationId: string | null = null;
    let outcome: Outcome;
    try {
      // The call runs outside any transaction: no connection is held while the model thinks.
      const invoked = await this.runtime.invoke(
        {
          workspaceId: context.workspaceId,
          projectId,
          stageRunId: null,
          attemptId: null,
          purpose: 'brain:question_quality',
          retryNo: 0,
          agentDefinitionVersionId: plan.judge.id,
          promptSha256: digest(prompt),
        },
        plan.connectionId,
        {
          model: plan.model,
          instructions: prompt.instructions,
          messages: [{ role: 'user', content: prompt.message }],
          responseSchema: {
            name: QUESTION_QUALITY_SCHEMA_NAME,
            schema: QUESTION_QUALITY_SCHEMA,
          },
        },
      );
      invocationId = invoked.invocationId;
      if (invoked.response.finishReason !== 'stop' || invoked.response.json === null) {
        outcome = {
          status: 'failed',
          reason: 'invalid_output',
          errorCode: `output_${invoked.response.finishReason}`,
        };
      } else {
        const result = normalizeQuestionQuality(invoked.response.json, {
          criteria: plan.criteria,
          questions: plan.questions,
        });
        outcome = result.ok
          ? { status: 'completed', ...result.quality }
          : { status: 'failed', reason: result.reason, errorCode: null };
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      outcome = { status: 'failed', reason: 'provider_failure', errorCode: error.code };
    }

    return this.database.run(context, async (client) => {
      const saved = (
        await client.query<ReviewRow>(
          `insert into question_quality_reviews
             (workspace_id, project_id, session_id, criteria, question_count, judge_version_id, model, status, reason,
              score, summary, findings, discarded, invocation_id, error_code, created_by)
           values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16)
           returning ${reviewColumns}`,
          [
            context.workspaceId,
            projectId,
            plan.sessionId,
            JSON.stringify(plan.criteria),
            plan.questions.length,
            plan.judge.id,
            plan.model,
            outcome.status,
            outcome.status === 'failed' ? outcome.reason : null,
            outcome.status === 'completed' ? outcome.score : null,
            outcome.status === 'completed' ? outcome.summary : null,
            JSON.stringify(outcome.status === 'completed' ? outcome.findings : []),
            outcome.status === 'completed' ? outcome.discarded : 0,
            invocationId,
            outcome.status === 'failed' ? outcome.errorCode : null,
            context.actorId,
          ],
        )
      ).rows[0]!;
      // The review is the project's own content: the audit log keeps what was judged and how it
      // came out, not the questions or the findings.
      await writeAudit(client, context, {
        action: 'analysis.question_quality_reviewed',
        targetType: 'project',
        targetId: projectId,
        projectId,
        after: {
          reviewId: saved.id,
          status: saved.status,
          score: saved.score,
          questions: saved.questionCount,
          findings: saved.findings.length,
          discarded: saved.discarded,
        },
      });
      return { review: saved };
    });
  }

  private async requireProject(client: PoolClient, projectId: string): Promise<void> {
    const project = await client.query('select 1 from projects where id = $1', [projectId]);
    if (!project.rowCount) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');
  }

  /** The analysis session of the project's latest run, if the analyst has started one. */
  private async session(client: PoolClient, projectId: string): Promise<{ id: string } | null> {
    return (
      (
        await client.query<{ id: string }>(
          `select s.id from workflow_runs r
             join stage_runs sr on sr.run_id = r.id and sr.stage = 'analysis'
             join analysis_sessions s on s.stage_run_id = sr.id
            where r.project_id = $1 order by r.run_no desc limit 1`,
          [projectId],
        )
      ).rows[0] ?? null
    );
  }
}
