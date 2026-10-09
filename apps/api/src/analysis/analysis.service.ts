import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  ANALYSIS_LIMITS,
  prioritizeAnalysisQuestions,
  analysisProgress,
  checkAnswer,
  coverageGaps,
  coverageReport,
  requiredCategoriesFor,
  isBatchComplete,
  isUnresolved,
  type AnswerStatus,
  type QuestionCategory,
  type QuestionStatus,
} from '@docoo/domain';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import { conflict, notFound, unprocessable } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { CommandRunner } from '../workflow/command-runner.js';

export interface AnswerInput {
  readonly questionId: string;
  readonly status: AnswerStatus;
  readonly text?: string | undefined;
  readonly attachments?: readonly { readonly sourceId: string }[] | undefined;
}

export interface Attachment {
  sourceId: string;
  versionId: string;
  title: string;
}

interface CurrentRow extends QueryResultRow {
  run_id: string;
  run_no: number;
  workflow_id: string;
  stage_run_id: string | null;
  stage_status: string | null;
  latest_output_id: string | null;
  passed_by_decision: boolean | null;
  session_id: string | null;
  minimum_questions: number | null;
  maximum_questions: number | null;
  batch_size: number | null;
  finish_requested_at: string | null;
  finish_reason: string | null;
}

interface QuestionRow extends QueryResultRow {
  id: string;
  batch_id: string;
  batch_no: number;
  number: number;
  category: QuestionCategory;
  text: string;
  rationale: string;
  status: QuestionStatus;
  follow_up_number: number | null;
  answer_id: string | null;
  revision_no: number | null;
  answer_text: string | null;
  attachments: Attachment[] | null;
  answered_at: string | null;
  revisions: string;
}

const questionSelect = `
  select q.id, q.batch_id, b.batch_no, q.ordinal as number, q.category, q.text, q.rationale, q.status,
         f.ordinal as follow_up_number, a.id as answer_id, a.revision_no, a.text as answer_text, a.attachments,
         ${isoColumn('q.answered_at', 'answered_at')},
         (select count(*) from analysis_answers x where x.question_id = q.id) as revisions
    from analysis_questions q
    join question_batches b on b.id = q.batch_id
    left join analysis_questions f on f.id = q.follow_up_of_id
    left join analysis_answers a on a.id = q.current_answer_id`;

const currentSelect = `
  select r.id as run_id, r.run_no, r.temporal_workflow_id as workflow_id, sr.id as stage_run_id,
         sr.status::text as stage_status, sr.latest_output_id, sr.passed_by_decision,
         s.id as session_id, s.minimum_questions, s.maximum_questions, s.batch_size,
         ${isoColumn('s.finish_requested_at', 'finish_requested_at')}, s.finish_reason
    from workflow_runs r
    left join stage_runs sr on sr.run_id = r.id and sr.stage = 'analysis'
    left join analysis_sessions s on s.stage_run_id = sr.id
   where r.project_id = $1 order by r.run_no desc limit 1`;

/** Where the analysis is, in words the backoffice maps to a message. */
export type AnalysisPhase =
  'not_started' | 'answering' | 'analysing' | 'awaiting_approval' | 'approved' | 'cancelled';

const SOURCE_PENDING = new Set(['quarantined', 'scanning', 'accepted', 'extracting']);

function toQuestion(row: QuestionRow) {
  return {
    id: row.id,
    batchId: row.batch_id,
    batchNo: row.batch_no,
    number: row.number,
    category: row.category,
    text: row.text,
    rationale: row.rationale,
    followUpOf: row.follow_up_number,
    status: row.status,
    answer: row.answer_id
      ? {
          id: row.answer_id,
          revisionNo: row.revision_no,
          text: row.answer_text,
          attachments: row.attachments ?? [],
          answeredAt: row.answered_at,
        }
      : null,
    revisions: Number(row.revisions),
  };
}

/** The analyst's questions and the administrator's answers (FR-ANL-001..006). */
@Injectable()
export class AnalysisService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly commands: CommandRunner,
  ) {}

  private async prioritize(
    client: PoolClient,
    projectId: string,
    questions: ReturnType<typeof toQuestion>[],
  ) {
    const criteria = (
      await client.query<{ id: string; criteria: unknown[] }>(
        `select id,criteria from solution_criteria_versions where project_id=$1 order by version_no desc limit 1`,
        [projectId],
      )
    ).rows[0];
    const output = (
      await client.query<{ id: string; content: Record<string, unknown> }>(
        `select o.id,o.content from stage_outputs o join stage_runs s on s.id=o.stage_run_id join workflow_runs r on r.id=s.run_id where r.project_id=$1 and s.stage='analysis' order by o.created_at desc,o.id desc limit 1`,
        [projectId],
      )
    ).rows[0];
    const text = (v: unknown) =>
      typeof v === 'string'
        ? v
        : typeof v === 'object' && v !== null
          ? Object.values(v)
              .filter((x): x is string => typeof x === 'string')
              .join(' ')
          : '';
    const refs = [
      ...(criteria?.criteria ?? []).slice(0, 100).map((c, i) => ({
        id: `criterion:${criteria!.id}:${i}`,
        text: text(c),
        kind: 'criterion' as const,
      })),
      ...(Array.isArray(output?.content['assumptions']) ? output.content['assumptions'] : [])
        .slice(0, 100)
        .map((a: unknown, i: number) => ({
          id: `assumption:${output!.id}:${i}`,
          text: text(a),
          kind: 'assumption' as const,
        })),
    ];
    const aliases: Record<string, string> = {
      goal: 'goals',
      constraint: 'constraints',
      risk: 'risks',
      stakeholder: 'stakeholders',
      time: 'timeline',
    };
    return prioritizeAnalysisQuestions(
      questions.map((q) => ({
        ...q,
        ordinal: q.number,
        coverageArea: aliases[q.category] ?? q.category,
        answer:
          q.status === 'open'
            ? null
            : { ...q.answer, status: q.status, text: q.answer?.text ?? null },
      })),
      refs.filter((r) => r.kind === 'criterion').map((r) => r.text),
      refs,
    )
      .map((q) => ({
        ...questions.find((original) => original.id === q.id)!,
        priority: q.priority,
      }))
      .sort((a, b) => a.number - b.number);
  }

  // ------------------------------------------------------------------ reads

  /** Progress, coverage, the analyst's reading, contradictions, follow-ups and the definition. */
  async overview(context: WorkspaceRequestContext, projectId: string) {
    return this.database.run(
      context,
      async (client) => {
        const current = await this.current(client, projectId);
        const questions = current?.session_id
          ? (
              await client.query<QuestionRow>(
                `${questionSelect} where q.session_id = $1 order by q.ordinal`,
                [current.session_id],
              )
            ).rows.map(toQuestion)
          : [];
        const prioritized = await this.prioritize(client, projectId, questions);
        const progress = analysisProgress(questions);
        // The run's own configuration says whether risk and out-of-scope must also be asked.
        const settings = current?.run_id
          ? ((
              await client.query<{ resolved: Record<string, unknown> | null }>(
                `select c.resolved from workflow_runs r left join config_snapshots c on c.id = r.config_snapshot_id where r.id = $1`,
                [current.run_id],
              )
            ).rows[0]?.resolved ?? {})
          : {};
        const coverage = coverageReport(
          questions,
          requiredCategoriesFor({
            risk: settings['analysis.require_risk_dimension'] === true,
            outOfScope: settings['analysis.require_out_of_scope_dimension'] === true,
          }),
        );

        let openBatchId: string | null = null;
        let understanding: Record<string, unknown> | null = null;
        let contradictions: Record<string, unknown>[] = [];
        if (current?.session_id) {
          openBatchId =
            (
              await client.query<{ id: string }>(
                `select id from question_batches where session_id = $1 and status = 'open'`,
                [current.session_id],
              )
            ).rows[0]?.id ?? null;
          understanding =
            (
              await client.query<Record<string, unknown>>(
                `select round_no as "round", understood, next_ambiguity as "nextAmbiguity", sufficient,
                      sufficiency_reason as "sufficiencyReason", category_notes as "categoryNotes",
                      reason, ${isoColumn('created_at', '"createdAt"')}
                 from analysis_rounds where session_id = $1 and understood is not null
                order by round_no desc limit 1`,
                [current.session_id],
              )
            ).rows[0] ?? null;
          contradictions = (
            await client.query<Record<string, unknown>>(
              `select c.id, qa.ordinal as "first", qb.ordinal as "second", c.description, c.status
               from analysis_contradictions c
               join analysis_questions qa on qa.id = c.question_a_id
               join analysis_questions qb on qb.id = c.question_b_id
              where c.session_id = $1 order by qa.ordinal, qb.ordinal`,
              [current.session_id],
            )
          ).rows;
        }

        const definition = current?.stage_run_id
          ? await this.definitionOf(client, projectId, current, questions)
          : null;
        const phase = this.phase(current, openBatchId, definition?.status ?? null);
        const finishRequested = Boolean(current?.finish_requested_at);
        return {
          analysis: {
            runId: current?.run_id ?? null,
            stageRunId: current?.stage_run_id ?? null,
            phase,
            limits: {
              minimum: current?.minimum_questions ?? ANALYSIS_LIMITS.minimumQuestions,
              maximum: current?.maximum_questions ?? ANALYSIS_LIMITS.maximumQuestions,
              batchSize: current?.batch_size ?? ANALYSIS_LIMITS.batchSize,
            },
            progress,
            coverage,
            coverageGaps: coverageGaps(coverage),
            openBatchId,
            finish: {
              requested: finishRequested,
              requestedAt: current?.finish_requested_at ?? null,
              reason: current?.finish_reason ?? null,
              // Thirty questions asked and none waiting: the administrator may ask for the definition.
              available:
                !finishRequested &&
                progress.minimumReached &&
                progress.open === 0 &&
                (phase === 'analysing' || phase === 'answering'),
            },
            understanding,
            contradictions: contradictions.map((entry) => ({
              id: entry['id'],
              questions: [entry['first'], entry['second']],
              description: entry['description'],
              status: entry['status'],
            })),
            followUps: prioritized.filter((question) => question.status === 'later'),
            definition,
          },
        };
      },
      { snapshot: true },
    );
  }

  /** Every batch of the current analysis with its questions and current answers. */
  async batches(context: WorkspaceRequestContext, projectId: string) {
    return this.database.run(
      context,
      async (client) => {
        const current = await this.current(client, projectId);
        if (!current?.session_id) return { batches: [] };
        const batches = (
          await client.query<Record<string, unknown> & { id: string }>(
            `select b.id, b.batch_no as "batchNo", b.status, ${isoColumn('b.submitted_at', '"submittedAt"')},
                  ${isoColumn('b.created_at', '"createdAt"')}, r.round_no as "round", r.reason,
                  r.understood, r.next_ambiguity as "nextAmbiguity"
             from question_batches b join analysis_rounds r on r.id = b.round_id
            where b.session_id = $1 order by b.batch_no`,
            [current.session_id],
          )
        ).rows;
        const questions = (
          await client.query<QuestionRow>(
            `${questionSelect} where q.session_id = $1 order by q.ordinal`,
            [current.session_id],
          )
        ).rows.map(toQuestion);
        const prioritized = await this.prioritize(client, projectId, questions);
        return {
          batches: batches.map((batch) => ({
            ...batch,
            questions: prioritized.filter((question) => question.batchId === batch.id),
          })),
        };
      },
      { snapshot: true },
    );
  }

  /** FR-ANL-005: the versions of the problem definition across the project's runs. */
  async definitions(context: WorkspaceRequestContext, projectId: string) {
    return this.database.run(
      context,
      async (client) => {
        const project = await client.query<{ approved: string | null }>(
          'select approved_problem_version_id as approved from projects where id = $1',
          [projectId],
        );
        if (!project.rowCount) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');
        const approved = project.rows[0]!.approved;
        const outputs = (
          await client.query<{
            id: string;
            stage_run_id: string;
            run_no: number;
            version_no: number;
            origin: string;
            content: unknown;
            created_at: string;
            latest_output_id: string | null;
            stage_status: string;
          }>(
            `select o.id, o.stage_run_id, r.run_no, o.version_no, o.origin, o.content,
                  ${isoColumn('o.created_at', 'created_at')}, sr.latest_output_id, sr.status::text as stage_status
             from stage_outputs o
             join stage_runs sr on sr.id = o.stage_run_id and sr.stage = 'analysis'
             join workflow_runs r on r.id = sr.run_id
            where sr.project_id = $1 order by r.run_no desc, o.version_no desc`,
            [projectId],
          )
        ).rows;
        const gates = (
          await client.query<{ output_id: string; status: string }>(
            `select distinct on (g.output_id) g.output_id, g.status::text as status
             from gate_decisions g join stage_runs sr on sr.id = g.stage_run_id
            where sr.project_id = $1 and sr.stage = 'analysis'
            order by g.output_id, g.created_at desc, g.id desc`,
            [projectId],
          )
        ).rows;
        const gateOf = new Map(gates.map((gate) => [gate.output_id, gate.status]));
        return {
          definitions: outputs.map((output) => ({
            outputId: output.id,
            stageRunId: output.stage_run_id,
            runNo: output.run_no,
            versionNo: output.version_no,
            origin: output.origin,
            createdAt: output.created_at,
            content: output.content,
            current: output.id === output.latest_output_id,
            approved: output.id === approved,
            status: this.definitionStatus(
              gateOf.get(output.id) ?? null,
              output.stage_status === 'completed' && output.id === output.latest_output_id,
            ),
          })),
          approvedOutputId: approved,
        };
      },
      { snapshot: true },
    );
  }

  // ------------------------------------------------------------------ answers (FR-ANL-003)

  /**
   * Records answers for questions of one batch, all or nothing. A question can be answered, or
   * marked unanswered, irrelevant or later. The batch is complete when none is left open; the
   * workflow is then told so the analyst can read the answers. Questions left for later stay
   * answerable after their batch closed (the follow-up queue).
   */
  async submitAnswers(
    context: WorkspaceRequestContext,
    batchId: string,
    input: { answers: readonly AnswerInput[]; idempotencyKey?: string | undefined },
  ) {
    return this.commands.run(
      context,
      input.idempotencyKey,
      'analysis-answers',
      { batchId, answers: input.answers },
      async (client) => {
        const batch = (
          await client.query<{
            id: string;
            project_id: string;
            session_id: string;
            stage_run_id: string;
            status: string;
            stage_status: string;
            run_id: string;
            workflow_id: string;
            project_status: string;
          }>(
            `select b.id, b.project_id, b.session_id, b.stage_run_id, b.status, sr.status::text as stage_status,
                    sr.run_id, wr.temporal_workflow_id as workflow_id, p.status::text as project_status
               from question_batches b
               join stage_runs sr on sr.id = b.stage_run_id
               join workflow_runs wr on wr.id = sr.run_id
               join projects p on p.id = b.project_id
              where b.id = $1 for update of b`,
            [batchId],
          )
        ).rows[0];
        if (!batch) throw notFound('ANALYSIS_BATCH_NOT_FOUND', 'The question batch was not found.');
        if (!['active', 'paused'].includes(batch.project_status)) {
          throw conflict(
            'ANALYSIS_PROJECT_NOT_ACTIVE',
            'Answers can only be given while the project is active or paused.',
          );
        }
        if (['completed', 'cancelled'].includes(batch.stage_status)) {
          throw conflict('ANALYSIS_CLOSED', 'The analysis of this run is finished.');
        }
        const awaiting = await client.query(
          `select 1 from gate_decisions where stage_run_id = $1 and status = 'pending'`,
          [batch.stage_run_id],
        );
        if (awaiting.rowCount) {
          throw conflict(
            'ANALYSIS_AWAITING_APPROVAL',
            'The problem definition is waiting for a decision; reject it to continue the analysis.',
          );
        }

        const questions = new Map(
          (
            await client.query<{ id: string; status: QuestionStatus; number: number }>(
              `select id, status, ordinal as number from analysis_questions where batch_id = $1 order by ordinal for update`,
              [batchId],
            )
          ).rows.map((row) => [row.id, row]),
        );
        const seen = new Set<string>();
        const sourceIds = new Set<string>();
        for (const answer of input.answers) {
          const question = questions.get(answer.questionId);
          if (!question) {
            throw unprocessable(
              'ANALYSIS_QUESTION_NOT_IN_BATCH',
              'A question does not belong to this batch.',
              { questionId: answer.questionId },
            );
          }
          if (seen.has(answer.questionId)) {
            throw unprocessable('ANALYSIS_DUPLICATE_ANSWER', 'A question was answered twice.', {
              questionId: answer.questionId,
            });
          }
          seen.add(answer.questionId);
          if (batch.status === 'submitted' && question.status !== 'later') {
            throw conflict(
              'ANALYSIS_QUESTION_CLOSED',
              'Only questions left for later can be answered after their batch was submitted.',
              { questionId: answer.questionId, number: question.number },
            );
          }
          const problem = checkAnswer({
            status: answer.status,
            text: answer.text,
            attachmentCount: answer.attachments?.length ?? 0,
          });
          if (problem) {
            throw unprocessable(problem, 'The answer is not valid.', {
              questionId: answer.questionId,
              number: question.number,
            });
          }
          for (const attachment of answer.attachments ?? []) sourceIds.add(attachment.sourceId);
        }

        const attachments = await this.resolveAttachments(client, batch.project_id, [...sourceIds]);
        const submissionId = randomUUID();
        const counts: Record<AnswerStatus, number> = {
          answered: 0,
          unanswered: 0,
          irrelevant: 0,
          later: 0,
        };
        for (const answer of input.answers) {
          const text = answer.text?.trim() ? answer.text.trim() : null;
          const stored = (answer.attachments ?? []).map((item) => attachments.get(item.sourceId)!);
          const inserted = await client.query<{ id: string }>(
            `insert into analysis_answers (workspace_id, project_id, question_id, revision_no, status, text, attachments, submission_id, created_by)
             values ($1, $2, $3,
                     (select coalesce(max(revision_no), 0) + 1 from analysis_answers where question_id = $3),
                     $4, $5, $6::jsonb, $7, $8)
             returning id`,
            [
              context.workspaceId,
              batch.project_id,
              answer.questionId,
              answer.status,
              text,
              JSON.stringify(stored),
              submissionId,
              context.actorId,
            ],
          );
          await client.query(
            `update analysis_questions set status = $2, current_answer_id = $3,
                    answered_at = case when $2 = 'answered' then now() else null end
              where id = $1`,
            [answer.questionId, answer.status, inserted.rows[0]!.id],
          );
          counts[answer.status] += 1;
        }

        const remaining = (
          await client.query<{ status: QuestionStatus }>(
            'select status from analysis_questions where batch_id = $1',
            [batchId],
          )
        ).rows.map((row) => row.status);
        const open = remaining.filter((status) => status === 'open').length;
        const closes = batch.status === 'open' && isBatchComplete(remaining);
        if (closes) {
          await client.query(
            `update question_batches set status = 'submitted', submitted_at = now() where id = $1`,
            [batchId],
          );
          await client.query(
            `update human_tasks set status = 'resolved', resolved_by = $2, resolved_at = now(),
                    resolution = $3::jsonb
              where stage_run_id = $1 and kind = 'analysis_answers' and status = 'pending'`,
            [batch.stage_run_id, context.actorId, JSON.stringify({ batchId })],
          );
        }
        await writeAudit(client, context, {
          action: closes ? 'analysis.batch_submitted' : 'analysis.answers_saved',
          targetType: 'question_batch',
          targetId: batchId,
          projectId: batch.project_id,
          after: { ...counts, remainingOpen: open },
        });
        return {
          signal: closes
            ? {
                workflowId: batch.workflow_id,
                name: 'answers' as const,
                payload: { stageRunId: batch.stage_run_id, batchId },
              }
            : null,
          result: {
            batchId,
            saved: input.answers.length,
            counts,
            remainingOpen: open,
            batchStatus: closes || batch.status === 'submitted' ? 'submitted' : 'open',
          },
        };
      },
    );
  }

  // ------------------------------------------------------------------ finish

  /**
   * The administrator has heard enough: from thirty questions on, with none waiting, the
   * analyst is told to write the problem definition instead of asking more.
   */
  async finish(
    context: WorkspaceRequestContext,
    projectId: string,
    input: { reason: string; idempotencyKey?: string | undefined },
  ) {
    return this.commands.run(
      context,
      input.idempotencyKey,
      'analysis-finish',
      { projectId, reason: input.reason },
      async (client) => {
        const current = await this.current(client, projectId, true);
        if (!current?.session_id || !current.stage_run_id) {
          throw conflict('ANALYSIS_NOT_STARTED', 'The analysis has not started.');
        }
        if (['completed', 'cancelled'].includes(current.stage_status ?? '')) {
          throw conflict('ANALYSIS_CLOSED', 'The analysis of this run is finished.');
        }
        const awaiting = await client.query(
          `select 1 from gate_decisions where stage_run_id = $1 and status = 'pending'`,
          [current.stage_run_id],
        );
        if (awaiting.rowCount) {
          throw conflict(
            'ANALYSIS_AWAITING_APPROVAL',
            'The problem definition is already waiting for a decision.',
          );
        }
        const statuses = (
          await client.query<{ status: QuestionStatus }>(
            'select status from analysis_questions where session_id = $1',
            [current.session_id],
          )
        ).rows;
        const progress = analysisProgress(statuses);
        if (!progress.minimumReached) {
          throw conflict(
            'ANALYSIS_MINIMUM_NOT_REACHED',
            `At least ${ANALYSIS_LIMITS.minimumQuestions} questions are needed before the analysis can finish.`,
            { asked: progress.asked, minimum: progress.minimum },
          );
        }
        if (progress.open > 0) {
          throw conflict(
            'ANALYSIS_ANSWERS_PENDING',
            'Answer the open questions or mark them before finishing.',
            { open: progress.open },
          );
        }
        if (!current.finish_requested_at) {
          await client.query(
            `update analysis_sessions set finish_requested_at = now(), finish_requested_by = $2, finish_reason = $3
              where id = $1`,
            [current.session_id, context.actorId, input.reason],
          );
          await writeAudit(client, context, {
            action: 'analysis.finish_requested',
            targetType: 'stage_run',
            targetId: current.stage_run_id,
            projectId,
            reason: input.reason,
            after: { asked: progress.asked, answered: progress.answered, later: progress.later },
          });
        }
        return { signal: null, result: { finishRequested: true, asked: progress.asked } };
      },
    );
  }

  // ------------------------------------------------------------------ internals

  private async current(
    client: PoolClient,
    projectId: string,
    lock = false,
  ): Promise<CurrentRow | null> {
    const project = await client.query('select 1 from projects where id = $1', [projectId]);
    if (!project.rowCount) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');
    let row = (await client.query<CurrentRow>(currentSelect, [projectId])).rows[0];
    if (lock && row?.session_id) {
      // Serialises with the analyst's round and with other finish requests, then re-reads.
      await client.query('select 1 from analysis_sessions where id = $1 for update', [
        row.session_id,
      ]);
      row = (await client.query<CurrentRow>(currentSelect, [projectId])).rows[0];
    }
    return row ?? null;
  }

  private phase(
    current: CurrentRow | null,
    openBatchId: string | null,
    definitionStatus: string | null,
  ): AnalysisPhase {
    if (!current?.session_id) return 'not_started';
    if (current.stage_status === 'completed') return 'approved';
    if (current.stage_status === 'cancelled') return 'cancelled';
    if (definitionStatus === 'awaiting_approval') return 'awaiting_approval';
    if (openBatchId) return 'answering';
    return 'analysing';
  }

  private definitionStatus(gate: string | null, approved: boolean): string {
    if (approved || gate === 'approved' || gate === 'overridden') return 'approved';
    if (gate === 'pending') return 'awaiting_approval';
    if (gate === 'rejected') return 'rejected';
    if (gate === 'expired') return 'superseded';
    return 'draft';
  }

  /** The current problem definition and what the final report must highlight (FR-ANL-006). */
  private async definitionOf(
    client: PoolClient,
    projectId: string,
    current: CurrentRow,
    questions: ReturnType<typeof toQuestion>[],
  ) {
    if (!current.latest_output_id) return null;
    const output = (
      await client.query<{
        id: string;
        version_no: number;
        origin: string;
        content: unknown;
        created_at: string;
      }>(
        `select id, version_no, origin, content, ${isoColumn('created_at', 'created_at')}
           from stage_outputs where id = $1`,
        [current.latest_output_id],
      )
    ).rows[0];
    if (!output) return null;
    const gate = (
      await client.query<{ status: string; reason: string | null }>(
        `select status::text as status, reason from gate_decisions
          where stage_run_id = $1 and output_id = $2 order by created_at desc, id desc limit 1`,
        [current.stage_run_id, output.id],
      )
    ).rows[0];
    const project = (
      await client.query<{ approved: string | null }>(
        'select approved_problem_version_id as approved from projects where id = $1',
        [projectId],
      )
    ).rows[0];
    const completed = current.stage_status === 'completed';
    return {
      outputId: output.id,
      stageRunId: current.stage_run_id,
      versionNo: output.version_no,
      origin: output.origin,
      createdAt: output.created_at,
      content: output.content,
      status: this.definitionStatus(gate?.status ?? null, completed),
      rejectionReason: gate?.status === 'rejected' ? (gate.reason ?? null) : null,
      approved: completed && project?.approved === output.id,
      passedByDecision: Boolean(current.passed_by_decision),
      // Whatever the model wrote, the questions still open are named from the records.
      unresolvedQuestions: questions
        .filter((question) => isUnresolved(question.status))
        .map((question) => ({
          number: question.number,
          category: question.category,
          text: question.text,
          status: question.status,
          note: question.answer?.text ?? null,
        })),
    };
  }

  /** Files given as answers must be sources of this project that were uploaded and not rejected. */
  private async resolveAttachments(
    client: PoolClient,
    projectId: string,
    sourceIds: readonly string[],
  ): Promise<Map<string, Attachment>> {
    const result = new Map<string, Attachment>();
    if (sourceIds.length === 0) return result;
    const rows = (
      await client.query<{
        id: string;
        title: string;
        current_version_id: string | null;
        status: string | null;
      }>(
        `select a.id, a.title, a.current_version_id, v.status::text as status
           from source_assets a left join source_versions v on v.id = a.current_version_id
          where a.id = any($1::uuid[]) and a.scope_type = 'project' and a.scope_id = $2 and a.deleted_at is null`,
        [sourceIds, projectId],
      )
    ).rows;
    for (const id of sourceIds) {
      const row = rows.find((item) => item.id === id);
      if (!row) {
        throw notFound(
          'ANALYSIS_ATTACHMENT_NOT_FOUND',
          'An attached source was not found in this project.',
        );
      }
      if (!row.current_version_id || row.status === 'uploaded') {
        throw conflict(
          'ANALYSIS_ATTACHMENT_NOT_READY',
          'An attached file has not been uploaded yet.',
        );
      }
      if (
        !SOURCE_PENDING.has(row.status ?? '') &&
        !['indexed', 'partial'].includes(row.status ?? '')
      ) {
        throw conflict(
          'ANALYSIS_ATTACHMENT_UNUSABLE',
          'An attached file was rejected or could not be processed.',
        );
      }
      result.set(id, { sourceId: row.id, versionId: row.current_version_id, title: row.title });
    }
    return result;
  }
}
