import {
  analysisProgress,
  batchCapacity,
  contradictionKey,
  coverageGaps,
  coverageReport,
  dedupeQuestions,
  decideRound,
  reconcileContradictions,
  type QuestionCategory,
  type QuestionStatus,
} from '@docoo/domain';
import { checkCostLimit, ProviderError, retryDelaySeconds } from '@docoo/providers';
import type { Pool, PoolClient } from 'pg';

import {
  ANALYSIS_ROUND_SCHEMA,
  ANALYSIS_ROUND_SCHEMA_NAME,
  fitTranscript,
  parseRoundOutput,
  roundPrompt,
  type AnalysisContext,
  type TranscriptAttachment,
  type TranscriptQuestion,
} from './analysis.js';
import { audit, inWorkspace } from './db.js';
import type { StageRef } from './refs.js';
import type { ProviderRuntime } from './runtime.js';
import { promptDigest, resolveAgentProfile } from './agents.js';
import { loadSettings } from './settings.js';

export interface AnalysisRoundRef extends StageRef {
  /** 1-based; every round is stored once, so a repeated call returns the stored outcome. */
  readonly roundNo: number;
  readonly retryNo: number;
  /** The wait for answer attachments to be processed ran out; go on without them. */
  readonly attachmentWaitExhausted: boolean;
}

export type AnalysisRoundResult =
  | {
      readonly status: 'batch';
      readonly batchId: string;
      readonly batchNo: number;
      readonly questionCount: number;
    }
  | { readonly status: 'definition'; readonly reason: string }
  | { readonly status: 'waiting_answers'; readonly batchId: string }
  | { readonly status: 'waiting_attachments' }
  | { readonly status: 'retry'; readonly code: string; readonly delaySeconds: number }
  | {
      readonly status: 'blocked';
      readonly code: string;
      readonly reason: 'provider_failure' | 'configuration' | 'cost_limit';
    };

export interface AnalysisActivities {
  runAnalysisRound(ref: AnalysisRoundRef): Promise<AnalysisRoundResult>;
}

interface SessionRow {
  id: string;
  finish_requested_at: Date | null;
}

interface QuestionRow {
  id: string;
  ordinal: number;
  batch_no: number;
  category: QuestionCategory;
  text: string;
  status: QuestionStatus;
  follow_up_ordinal: number | null;
  note: string | null;
  attachments: { sourceId: string; versionId: string; title: string }[] | null;
}

interface VersionRow {
  id: string;
  status: string;
  excerpt: string | null;
}

const PENDING_SOURCE_STATUSES = new Set([
  'uploaded',
  'quarantined',
  'scanning',
  'accepted',
  'extracting',
]);

async function ensureSession(client: PoolClient, ref: StageRef): Promise<SessionRow> {
  await client.query(
    `insert into analysis_sessions (workspace_id, project_id, stage_run_id) values ($1, $2, $3)
     on conflict (stage_run_id) do nothing`,
    [ref.workspaceId, ref.projectId, ref.stageRunId],
  );
  return (
    await client.query<SessionRow>(
      'select id, finish_requested_at from analysis_sessions where stage_run_id = $1 for update',
      [ref.stageRunId],
    )
  ).rows[0]!;
}

async function storedRound(
  client: PoolClient,
  sessionId: string,
  roundNo: number,
): Promise<AnalysisRoundResult | null> {
  const round = (
    await client.query<{ id: string; outcome: string; reason: string }>(
      'select id, outcome, reason from analysis_rounds where session_id = $1 and round_no = $2',
      [sessionId, roundNo],
    )
  ).rows[0];
  if (!round) return null;
  if (round.outcome === 'definition') return { status: 'definition', reason: round.reason };
  const batch = (
    await client.query<{ id: string; batch_no: number; count: string }>(
      `select b.id, b.batch_no, (select count(*) from analysis_questions q where q.batch_id = b.id) as count
         from question_batches b where b.round_id = $1`,
      [round.id],
    )
  ).rows[0]!;
  return {
    status: 'batch',
    batchId: batch.id,
    batchNo: batch.batch_no,
    questionCount: Number(batch.count),
  };
}

/** Questions of the session with their current answers and what the attached files contain. */
async function loadQuestions(
  client: PoolClient,
  sessionId: string,
): Promise<{ questions: TranscriptQuestion[]; pendingAttachments: number }> {
  const rows = (
    await client.query<QuestionRow>(
      `select q.id, q.ordinal, b.batch_no, q.category, q.text, q.status, f.ordinal as follow_up_ordinal,
              a.text as note, a.attachments
         from analysis_questions q
         join question_batches b on b.id = q.batch_id
         left join analysis_questions f on f.id = q.follow_up_of_id
         left join analysis_answers a on a.id = q.current_answer_id
        where q.session_id = $1 order by q.ordinal`,
      [sessionId],
    )
  ).rows;
  const versionIds = [
    ...new Set(rows.flatMap((row) => (row.attachments ?? []).map((item) => item.versionId))),
  ];
  const versions = new Map<string, VersionRow>();
  if (versionIds.length > 0) {
    const found = await client.query<VersionRow>(
      `select v.id, v.status::text as status,
              (select left(string_agg(s.text, E'\\n' order by s.ordinal), 3200)
                 from (select text, ordinal from source_segments where source_version_id = v.id order by ordinal limit 60) s) as excerpt
         from source_versions v where v.id = any($1::uuid[])`,
      [versionIds],
    );
    for (const row of found.rows) versions.set(row.id, row);
  }
  let pendingAttachments = 0;
  const questions = rows.map((row): TranscriptQuestion => {
    const attachments = (row.attachments ?? []).map((item): TranscriptAttachment => {
      const version = versions.get(item.versionId);
      if (!version) return { title: item.title, state: 'unusable', excerpt: null };
      if (PENDING_SOURCE_STATUSES.has(version.status)) {
        pendingAttachments += 1;
        return { title: item.title, state: 'pending', excerpt: null };
      }
      if (version.status === 'indexed' || version.status === 'partial') {
        return { title: item.title, state: 'processed', excerpt: version.excerpt };
      }
      return { title: item.title, state: 'unusable', excerpt: null };
    });
    return {
      number: row.ordinal,
      batch: row.batch_no,
      category: row.category,
      text: row.text,
      status: row.status,
      note: row.note,
      attachments,
      followUpOf: row.follow_up_ordinal,
    };
  });
  return { questions, pendingAttachments };
}

/** Everything the analyst or the definition writer is shown about the analysis so far. */
export async function loadAnalysisContext(
  client: PoolClient,
  input: { sessionId: string; projectId: string; round: number; capacity: number },
  preloaded?: TranscriptQuestion[],
): Promise<AnalysisContext> {
  const questions = preloaded ?? (await loadQuestions(client, input.sessionId)).questions;
  const report = coverageReport(questions);
  const contradictions = await client.query<{ a: number; b: number; description: string }>(
    `select qa.ordinal as a, qb.ordinal as b, c.description
       from analysis_contradictions c
       join analysis_questions qa on qa.id = c.question_a_id
       join analysis_questions qb on qb.id = c.question_b_id
      where c.session_id = $1 and c.status = 'open' order by qa.ordinal, qb.ordinal`,
    [input.sessionId],
  );
  const summaries = await client.query<{ round: number; understood: string; next: string }>(
    `select round_no as round, coalesce(understood, '') as understood, coalesce(next_ambiguity, '') as next
       from analysis_rounds where session_id = $1 and understood is not null
      order by round_no desc limit 6`,
    [input.sessionId],
  );
  const prior = await client.query<{ content: unknown }>(
    `select o.content from projects p join stage_outputs o on o.id = p.approved_problem_version_id where p.id = $1`,
    [input.projectId],
  );
  return {
    round: input.round,
    asked: questions.length,
    capacity: input.capacity,
    transcript: fitTranscript(questions),
    coverage: report,
    coverageGaps: coverageGaps(report),
    openContradictions: contradictions.rows.map((row) => ({
      questions: [row.a, row.b] as const,
      description: row.description,
    })),
    summaries: summaries.rows
      .reverse()
      .map((row) => ({ round: row.round, understood: row.understood, nextAmbiguity: row.next })),
    priorDefinition: prior.rows[0]?.content ?? null,
  };
}

/** Loads the analysis transcript of a stage run for the definition attempt. */
export async function loadDefinitionContext(
  client: PoolClient,
  stageRunId: string,
  projectId: string,
): Promise<AnalysisContext | null> {
  const session = (
    await client.query<{ id: string }>('select id from analysis_sessions where stage_run_id = $1', [
      stageRunId,
    ])
  ).rows[0];
  if (!session) return null;
  return loadAnalysisContext(client, { sessionId: session.id, projectId, round: 0, capacity: 0 });
}

export function createAnalysisActivities(
  pool: Pool,
  runtime: ProviderRuntime,
  options: { delayScale?: number } = {},
): AnalysisActivities {
  const delayScale = options.delayScale ?? 1;
  const run = <T>(workspaceId: string, work: (client: PoolClient) => Promise<T>) =>
    inWorkspace(pool, { workspaceId }, work);

  return {
    async runAnalysisRound(ref) {
      const prepared = await run(ref.workspaceId, async (client) => {
        const session = await ensureSession(client, ref);
        const stored = await storedRound(client, session.id, ref.roundNo);
        if (stored) return { done: stored } as const;

        const last = (
          await client.query<{ id: string; batch_no: number; status: string }>(
            'select id, batch_no, status from question_batches where session_id = $1 order by batch_no desc limit 1',
            [session.id],
          )
        ).rows[0];
        if (last?.status === 'open') {
          return { done: { status: 'waiting_answers', batchId: last.id } as const } as const;
        }

        const loaded = await loadQuestions(client, session.id);
        if (loaded.pendingAttachments > 0 && !ref.attachmentWaitExhausted) {
          return { done: { status: 'waiting_attachments' } as const } as const;
        }
        const asked = loaded.questions.length;
        const limits = await client.query<{ minimum_questions: number; maximum_questions: number }>(
          'select minimum_questions, maximum_questions from analysis_sessions where id = $1',
          [session.id],
        );
        const { minimum_questions: minimum, maximum_questions: maximum } = limits.rows[0]!;

        // The administrator asked to finish, or the ceiling is reached: hand over without a call.
        const forced =
          asked >= minimum && session.finish_requested_at !== null
            ? 'finish_requested'
            : asked >= maximum
              ? 'maximum_reached'
              : null;
        if (forced) {
          await client.query(
            `insert into analysis_rounds (workspace_id, project_id, session_id, round_no, based_on_batch_id, outcome, reason)
             values ($1, $2, $3, $4, $5, 'definition', $6)`,
            [ref.workspaceId, ref.projectId, session.id, ref.roundNo, last?.id ?? null, forced],
          );
          await audit(client, ref.workspaceId, {
            action: 'analysis.ready_to_define',
            targetType: 'stage_run',
            targetId: ref.stageRunId,
            projectId: ref.projectId,
            after: { reason: forced, asked, round: ref.roundNo },
          });
          return { done: { status: 'definition', reason: forced } as const } as const;
        }

        const config = await loadSettings(client, ref.runId);
        const spent =
          (
            await client.query<{ total: number | null }>(
              `select sum(i.cost_usd)::real as total from model_invocations i
                 join stage_runs s on s.id = i.stage_run_id where s.run_id = $1`,
              [ref.runId],
            )
          ).rows[0]?.total ?? 0;
        const cost = checkCostLimit(spent, config.costLimitUsd);
        if (cost.status === 'exceeded') {
          return {
            done: { status: 'blocked', code: 'cost_limit_exceeded', reason: 'cost_limit' } as const,
          } as const;
        }
        // The analyst's pinned definition may name its own model (FR-AGT-001).
        const profile = await resolveAgentProfile(client, {
          workspaceId: ref.workspaceId,
          projectId: ref.projectId,
          role: 'analyst',
        });
        const connectionId = profile.definition.modelPolicy?.connectionId ?? config.connectionId;
        const model = profile.definition.modelPolicy?.model ?? config.model;
        if (!connectionId || !model) {
          return {
            done: {
              status: 'blocked',
              code: 'ai_not_configured',
              reason: 'configuration',
            } as const,
          } as const;
        }

        const project = (
          await client.query<{ title: string; problem: string; language: 'fa' | 'en' }>(
            `select title, initial_problem as problem, output_language as language from projects where id = $1`,
            [ref.projectId],
          )
        ).rows[0]!;
        const topics = await client.query<{ title: string }>(
          `select t.title from project_topics pt join topics t on t.id = pt.topic_id where pt.project_id = $1 order by pt.priority`,
          [ref.projectId],
        );
        const feedback = await client.query<{ comment: string }>(
          `select comment from stage_reviews where stage_run_id = $1 and action = 'reject' and comment is not null order by created_at`,
          [ref.stageRunId],
        );
        const context = await loadAnalysisContext(
          client,
          {
            sessionId: session.id,
            projectId: ref.projectId,
            round: ref.roundNo,
            capacity: batchCapacity(asked),
          },
          loaded.questions,
        );
        await client.query(
          `update stage_runs set status = 'running'
            where id = $1 and status in ('ready', 'waiting_for_human', 'retrying', 'rejected')`,
          [ref.stageRunId],
        );
        await client.query(
          `update workflow_runs set status = 'running' where id = $1 and status = 'waiting_for_human'`,
          [ref.runId],
        );
        if (last) {
          await client.query(
            `update human_tasks set status = 'resolved', resolved_at = coalesce(resolved_at, now())
              where stage_run_id = $1 and kind = 'analysis_answers' and status = 'pending'`,
            [ref.stageRunId],
          );
        }
        if (cost.status === 'warning' && ref.retryNo === 0) {
          await audit(client, ref.workspaceId, {
            action: 'workflow.cost_warning',
            targetType: 'workflow_run',
            targetId: ref.runId,
            projectId: ref.projectId,
            severity: 'warning',
            after: { ...cost },
          });
        }
        const prompt = roundPrompt({
          language: project.language,
          projectTitle: project.title,
          problem: project.problem,
          topics: topics.rows.map((row) => row.title),
          feedback: feedback.rows.map((row) => row.comment),
          analysis: context,
          definition: profile.definition,
        });
        return {
          sessionId: session.id,
          lastBatchId: last?.id ?? null,
          lastBatchNo: last?.batch_no ?? 0,
          config: { ...config, connectionId, model },
          agentDefinitionVersionId: profile.definition.id,
          promptSha256: promptDigest(prompt),
          numbers: new Set(loaded.questions.map((question) => question.number)),
          prompt,
        } as const;
      });
      if ('done' in prepared) return prepared.done;

      let output;
      let invocationId: string;
      try {
        const invoked = await runtime.invoke(
          {
            workspaceId: ref.workspaceId,
            projectId: ref.projectId,
            stageRunId: ref.stageRunId,
            attemptId: null,
            purpose: 'analysis:round',
            retryNo: ref.retryNo,
            agentDefinitionVersionId: prepared.agentDefinitionVersionId,
            promptSha256: prepared.promptSha256,
          },
          prepared.config.connectionId,
          {
            model: prepared.config.model,
            instructions: prepared.prompt.instructions,
            messages: [{ role: 'user', content: prepared.prompt.message }],
            responseSchema: { name: ANALYSIS_ROUND_SCHEMA_NAME, schema: ANALYSIS_ROUND_SCHEMA },
            idempotencyKey: `${ref.stageRunId}:round:${ref.roundNo}:${ref.retryNo}`,
          },
        );
        invocationId = invoked.invocationId;
        if (invoked.response.finishReason !== 'stop' || invoked.response.json === null) {
          throw new ProviderError('invalid_output', `output_${invoked.response.finishReason}`);
        }
        output = parseRoundOutput(invoked.response.json, prepared.numbers);
      } catch (error) {
        const providerError =
          error instanceof ProviderError
            ? error
            : new ProviderError('transient', 'analysis_round_failed');
        const delay = retryDelaySeconds(ref.retryNo + 1, providerError);
        if (delay !== null) {
          return { status: 'retry', code: providerError.code, delaySeconds: delay * delayScale };
        }
        return { status: 'blocked', code: providerError.code, reason: 'provider_failure' };
      }

      return run(ref.workspaceId, async (client): Promise<AnalysisRoundResult> => {
        const session = await ensureSession(client, ref);
        const stored = await storedRound(client, session.id, ref.roundNo);
        if (stored) return stored;

        const loaded = await loadQuestions(client, session.id);
        const asked = loaded.questions.length;
        const kept = dedupeQuestions(
          output.questions,
          loaded.questions.map((question) => question.text),
        ).kept.slice(0, batchCapacity(asked));
        const projected = [
          ...loaded.questions,
          ...kept.map((question) => ({ category: question.category, status: 'open' as const })),
        ];
        const decision = decideRound({
          asked,
          finishRequested: session.finish_requested_at !== null,
          modelSufficient: output.sufficient,
          newQuestionCount: kept.length,
          coverageGaps: coverageGaps(coverageReport(projected)),
        });
        if (decision.action === 'stalled') {
          return {
            status: 'blocked',
            code: 'analysis_no_new_questions',
            reason: 'provider_failure',
          };
        }

        const round = (
          await client.query<{ id: string }>(
            `insert into analysis_rounds (workspace_id, project_id, session_id, round_no, based_on_batch_id, outcome, reason,
                                          understood, next_ambiguity, sufficient, sufficiency_reason, category_notes, invocation_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13) returning id`,
            [
              ref.workspaceId,
              ref.projectId,
              session.id,
              ref.roundNo,
              prepared.lastBatchId,
              decision.action === 'ask' ? 'batch' : 'definition',
              decision.reason,
              output.understood,
              output.nextAmbiguity,
              output.sufficient,
              output.sufficiencyReason,
              JSON.stringify(output.categoryNotes),
              invocationId,
            ],
          )
        ).rows[0]!;

        // Contradiction log: new ones are logged, vanished ones resolved, returning ones reopened.
        const byNumber = new Map(
          (
            await client.query<{ id: string; ordinal: number }>(
              'select id, ordinal from analysis_questions where session_id = $1',
              [session.id],
            )
          ).rows.map((row) => [row.ordinal, row.id]),
        );
        const existing = (
          await client.query<{ key: string; status: 'open' | 'resolved' }>(
            'select key, status from analysis_contradictions where session_id = $1',
            [session.id],
          )
        ).rows;
        const changes = reconcileContradictions(
          existing,
          output.contradictions.map((entry) => entry.key),
        );
        for (const entry of output.contradictions) {
          if (!changes.toOpen.includes(entry.key)) continue;
          const [first, second] = entry.key.split('-').map(Number) as [number, number];
          await client.query(
            `insert into analysis_contradictions (workspace_id, project_id, session_id, question_a_id, question_b_id, key, description, detected_round_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              ref.workspaceId,
              ref.projectId,
              session.id,
              byNumber.get(first),
              byNumber.get(second),
              contradictionKey(first, second),
              entry.description,
              round.id,
            ],
          );
        }
        if (changes.toReopen.length > 0) {
          await client.query(
            `update analysis_contradictions set status = 'open', resolved_round_id = null
              where session_id = $1 and key = any($2::text[])`,
            [session.id, changes.toReopen],
          );
        }
        if (changes.toResolve.length > 0) {
          await client.query(
            `update analysis_contradictions set status = 'resolved', resolved_round_id = $3
              where session_id = $1 and key = any($2::text[])`,
            [session.id, changes.toResolve, round.id],
          );
        }

        if (decision.action === 'define') {
          await audit(client, ref.workspaceId, {
            action: 'analysis.ready_to_define',
            targetType: 'stage_run',
            targetId: ref.stageRunId,
            projectId: ref.projectId,
            after: { reason: decision.reason, asked, round: ref.roundNo },
          });
          return { status: 'definition', reason: decision.reason };
        }

        const batchNo = prepared.lastBatchNo + 1;
        const batch = (
          await client.query<{ id: string }>(
            `insert into question_batches (workspace_id, project_id, session_id, stage_run_id, round_id, batch_no)
             values ($1, $2, $3, $4, $5, $6) returning id`,
            [ref.workspaceId, ref.projectId, session.id, ref.stageRunId, round.id, batchNo],
          )
        ).rows[0]!;
        const ordinals = new Map<number, string>();
        for (const [index, question] of kept.entries()) {
          const ordinal = asked + index + 1;
          const inserted = await client.query<{ id: string }>(
            `insert into analysis_questions (workspace_id, project_id, session_id, batch_id, ordinal, category, text, rationale, follow_up_of_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
            [
              ref.workspaceId,
              ref.projectId,
              session.id,
              batch.id,
              ordinal,
              question.category,
              question.text,
              question.rationale,
              question.followUpOf === null ? null : (byNumber.get(question.followUpOf) ?? null),
            ],
          );
          ordinals.set(ordinal, inserted.rows[0]!.id);
        }
        await client.query(`update stage_runs set status = 'waiting_for_human' where id = $1`, [
          ref.stageRunId,
        ]);
        await client.query(`update workflow_runs set status = 'waiting_for_human' where id = $1`, [
          ref.runId,
        ]);
        await client.query(
          `insert into human_tasks (workspace_id, project_id, stage_run_id, kind, title, payload)
           values ($1, $2, $3, 'analysis_answers', $4, $5::jsonb)`,
          [
            ref.workspaceId,
            ref.projectId,
            ref.stageRunId,
            `Answer the analyst's questions (batch ${batchNo})`,
            JSON.stringify({ batchId: batch.id, batchNo, questionCount: kept.length }),
          ],
        );
        const progress = analysisProgress([
          ...loaded.questions,
          ...kept.map(() => ({ status: 'open' as const })),
        ]);
        await audit(client, ref.workspaceId, {
          action: 'analysis.batch_opened',
          targetType: 'question_batch',
          targetId: batch.id,
          projectId: ref.projectId,
          after: {
            batchNo,
            questions: kept.length,
            asked: progress.asked,
            reason: decision.reason,
            round: ref.roundNo,
          },
        });
        return { status: 'batch', batchId: batch.id, batchNo, questionCount: kept.length };
      });
    },
  };
}
