import { Injectable } from '@nestjs/common';
import { scoreSolution, type Criterion } from '@docoo/documents';

import { isoColumn } from '../common/pagination.js';
import { notFound } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

interface UsageRow {
  key: string;
  invocations: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
}

/** Document statuses that count as a project's final outputs: approved by a person, then maybe locked. */
const FINAL_STATUSES = ['approved', 'locked'];

/**
 * The summary report of one project: the problem, the tokens its model calls used, the ideas made
 * for it and its final outputs. Read-only; every figure comes from records the project already has.
 */
@Injectable()
export class ProjectReportService {
  constructor(private readonly database: WorkspaceDatabase) {}

  async report(context: WorkspaceRequestContext, projectId: string) {
    // One snapshot, so the four parts of the report cannot disagree with one another.
    return this.database.run(
      context,
      async (client) => {
        const project = (
          await client.query<{
            id: string;
            code: string;
            title: string;
            status: string;
            current_stage: string;
            output_language: 'fa' | 'en';
            kind: string;
            description: string;
            initial_problem: string;
            expected_output: string;
            approved_problem_version_id: string | null;
            created_at: string;
            updated_at: string;
          }>(
            `select id, code, title, status, current_stage, output_language, kind, description,
                    initial_problem, expected_output, approved_problem_version_id,
                    ${isoColumn('created_at', 'created_at')}, ${isoColumn('updated_at', 'updated_at')}
               from projects where workspace_id = $1 and id = $2`,
            [context.workspaceId, projectId],
          )
        ).rows[0];
        if (!project) throw notFound('PROJECT_NOT_FOUND', 'The project was not found.');

        // 1. The problem: what was asked, and the definition a person approved, if there is one.
        const definition = project.approved_problem_version_id
          ? (
              await client.query<{ content: Record<string, unknown> | null }>(
                `select o.content from stage_outputs o join stage_runs s on s.id = o.stage_run_id
                  where o.id = $1 and s.project_id = $2 and s.stage = 'analysis'`,
                [project.approved_problem_version_id, projectId],
              )
            ).rows[0]?.content
          : null;
        const statement = definition?.['problemStatement'];

        // 2. Tokens, in total and by stage and model. Reasoning tokens are part of the total.
        const usageSelect = `count(*)::int as invocations,
                coalesce(sum(i.input_tokens), 0)::bigint::float8 as "inputTokens",
                coalesce(sum(i.output_tokens), 0)::bigint::float8 as "outputTokens",
                coalesce(sum(i.reasoning_tokens), 0)::bigint::float8 as "reasoningTokens",
                coalesce(sum(i.cost_usd), 0)::float8 as "costUsd"`;
        const usageBy = async (key: string) =>
          (
            await client.query<UsageRow>(
              `select ${key} as key, ${usageSelect}
                 from model_invocations i left join stage_runs s on s.id = i.stage_run_id
                where i.project_id = $1 group by 1 order by 1`,
              [projectId],
            )
          ).rows.map((row) => ({ ...row, costUsd: round(row.costUsd) }));
        const totals = (
          await client.query<Omit<UsageRow, 'key'> & { failures: number }>(
            `select ${usageSelect}, count(*) filter (where i.status <> 'succeeded')::int as failures
               from model_invocations i where i.project_id = $1`,
            [projectId],
          )
        ).rows[0]!;

        // 3. Ideas: the newest set, scored by the criteria in force, with the ones chosen first.
        const set = (
          await client.query<{ id: string; created_at: string }>(
            `select id, ${isoColumn('created_at', 'created_at')} from solution_sets
              where project_id = $1 order by created_at desc, id desc limit 1`,
            [projectId],
          )
        ).rows[0];
        const criteria = (
          await client.query<{ criteria: Criterion[] }>(
            `select criteria from solution_criteria_versions
              where project_id = $1 order by version_no desc limit 1`,
            [projectId],
          )
        ).rows[0]?.criteria;
        const solutions = set
          ? (
              await client.query<{
                id: string;
                ordinal: number;
                title: string;
                summary: string;
                score_inputs: Record<string, number>;
              }>(
                'select id, ordinal, title, summary, score_inputs from solutions where set_id = $1 order by ordinal',
                [set.id],
              )
            ).rows
          : [];
        const selection =
          (
            await client.query<{ selected: { solutionId: string; priority: number }[] }>(
              `select selected from solution_selections
                where project_id = $1 order by created_at desc, id desc limit 1`,
              [projectId],
            )
          ).rows[0]?.selected ?? [];
        const ideas = solutions
          .map((row) => ({
            id: row.id,
            ordinal: row.ordinal,
            title: row.title,
            summary: row.summary,
            score: criteria ? scoreSolution(row.score_inputs, criteria).total : null,
            selectedPriority:
              selection.find((item) => item.solutionId === row.id)?.priority ?? null,
          }))
          .sort(
            (a, b) =>
              (a.selectedPriority ?? Number.MAX_SAFE_INTEGER) -
                (b.selectedPriority ?? Number.MAX_SAFE_INTEGER) || a.ordinal - b.ordinal,
          );

        // 4. Final outputs: approved or locked documents with the files exported from them.
        const documents = (
          await client.query<{
            id: string;
            title: string;
            status: string;
            level: number;
            language: 'fa' | 'en';
            approval_kind: string | null;
            version_no: number | null;
            updated_at: string;
          }>(
            `select d.id, d.title, d.status::text as status, d.level, d.language, d.approval_kind,
                    v.version_no, ${isoColumn('d.updated_at', 'updated_at')}
               from documents d left join document_versions v on v.id = d.approved_version_id
              where d.project_id = $1 order by d.priority, d.created_at, d.id`,
            [projectId],
          )
        ).rows;
        const finals = documents.filter((document) => FINAL_STATUSES.includes(document.status));
        const artifacts = finals.length
          ? (
              await client.query<{
                document_id: string;
                id: string;
                format: string;
                size_bytes: number;
                created_at: string;
              }>(
                `select document_id, id, format, size_bytes, ${isoColumn('created_at', 'created_at')}
                   from document_artifacts where document_id = any($1::uuid[])
                  order by created_at desc, id desc`,
                [finals.map((document) => document.id)],
              )
            ).rows
          : [];

        return {
          project: {
            id: project.id,
            code: project.code,
            title: project.title,
            status: project.status,
            currentStage: project.current_stage,
            outputLanguage: project.output_language,
            kind: project.kind,
            createdAt: project.created_at,
            updatedAt: project.updated_at,
          },
          problem: {
            initialProblem: project.initial_problem,
            description: project.description,
            expectedOutput: project.expected_output,
            approvedStatement: typeof statement === 'string' && statement.trim() ? statement : null,
          },
          usage: {
            totals: { ...totals, costUsd: round(totals.costUsd) },
            byStage: await usageBy(`coalesce(s.stage::text, i.purpose)`),
            byModel: await usageBy(`i.provider::text || ':' || i.model`),
          },
          ideas: { createdAt: set?.created_at ?? null, items: ideas },
          outputs: {
            inProgress: documents.length - finals.length,
            items: finals.map((document) => ({
              id: document.id,
              title: document.title,
              status: document.status,
              level: document.level,
              language: document.language,
              approvalKind: document.approval_kind,
              versionNo: document.version_no,
              updatedAt: document.updated_at,
              artifacts: artifacts
                .filter((artifact) => artifact.document_id === document.id)
                .map((artifact) => ({
                  id: artifact.id,
                  format: artifact.format,
                  sizeBytes: artifact.size_bytes,
                  createdAt: artifact.created_at,
                })),
            })),
          },
        };
      },
      { snapshot: true },
    );
  }
}
