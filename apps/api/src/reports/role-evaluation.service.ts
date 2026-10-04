import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  charterItems,
  composeInstructions,
  evaluationPromptData,
  EVALUATION_LIMITS,
  normalizeEvaluation,
  ROLE_EVALUATION_RULES,
  ROLE_EVALUATION_SCHEMA,
  ROLE_EVALUATION_SCHEMA_NAME,
  ROLE_STAGE,
  sampleContent,
  type AgentRole,
  type CharterItem,
  type EvaluationReason,
  type EvaluationSample,
  type KnownDeviation,
  type RoleEvaluation,
  type WorkflowStage,
} from '@docoo/domain';
import {
  activeAgentVersion,
  loadAgentVersion,
  ProviderRuntime,
  type AgentDefinitionRecord,
} from '@docoo/orchestration';
import { ProviderError } from '@docoo/providers';
import type { PoolClient } from 'pg';

import { settingText } from '../documents/document-store.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { ConfigService } from '../config/config.service.js';
import { PROVIDER_RUNTIME } from '../providers/providers.service.js';
import { STAGE_ROLE, type Deviation } from './brain.js';

/** The five roles that run a stage; Brain judges them and is not judged itself. */
const EVALUATED: readonly { role: AgentRole; stage: WorkflowStage }[] = Object.entries(
  STAGE_ROLE,
).map(([stage, role]) => ({ role, stage: stage as WorkflowStage }));

interface RolePlan {
  readonly role: AgentRole;
  readonly stage: WorkflowStage;
  /** The charter the samples ran with. */
  readonly definition: AgentDefinitionRecord;
  readonly samples: readonly EvaluationSample[];
  readonly knownDeviations: readonly KnownDeviation[];
}

/** Everything read for the evaluation, collected in the report's read transaction. */
export interface EvaluationPlan {
  readonly judge: AgentDefinitionRecord;
  readonly connectionId: string;
  readonly model: string;
  readonly language: 'fa' | 'en';
  readonly roles: readonly RolePlan[];
  /** Roles with no sample in the period; they get a `skipped` entry without any call. */
  readonly withoutSamples: readonly { role: AgentRole; stage: WorkflowStage }[];
}

export interface EvaluationOutcome {
  readonly evaluations: RoleEvaluation[];
  readonly summary: {
    readonly requested: true;
    readonly judgeVersionId: string;
    readonly judgeSequence: number;
    readonly completed: number;
    readonly skipped: number;
    readonly failed: number;
    readonly discardedFindings: number;
  };
}

const digest = (prompt: { instructions: string; message: string }) =>
  createHash('sha256')
    .update(prompt.instructions)
    .update('\n')
    .update(prompt.message)
    .digest('hex');

/**
 * Model-based evaluation of the roles in a Brain report (ADR-0011, ADR-0017). The Brain, with
 * its own active definition, reads a few outputs of each stage role next to the charter the
 * role ran with and judges how well the work follows it. Only findings that name charter items
 * and samples survive; the evaluation reads and calls the model, and changes nothing else
 * (FR-BRN-004).
 */
@Injectable()
export class RoleEvaluationService {
  constructor(
    private readonly config: ConfigService,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
  ) {}

  /** Reads samples, charters and the model to use. Runs inside the report's read transaction. */
  async plan(
    client: PoolClient,
    context: WorkspaceRequestContext,
    input: {
      projectId: string | null;
      from: string | null;
      to: string;
    },
    deviations: readonly Deviation[],
  ): Promise<EvaluationPlan> {
    const judge = await activeAgentVersion(client, context.workspaceId, 'brain');
    const effective = await this.config.resolve(
      client,
      context,
      input.projectId ? 'project' : 'workspace',
      input.projectId ?? context.workspaceId,
    );
    const connectionId =
      judge.modelPolicy?.connectionId ?? settingText(effective.values['ai.connection_id']);
    const model = judge.modelPolicy?.model ?? settingText(effective.values['ai.model']);
    const language = input.projectId
      ? (
          await client.query<{ language: 'fa' | 'en' }>(
            'select output_language as language from projects where id = $1',
            [input.projectId],
          )
        ).rows[0]!.language
      : (
          await client.query<{ language: 'fa' | 'en' }>(
            'select default_locale::text as language from workspaces where id = $1',
            [context.workspaceId],
          )
        ).rows[0]!.language;

    const roles: RolePlan[] = [];
    const withoutSamples: { role: AgentRole; stage: WorkflowStage }[] = [];
    for (const { role, stage } of EVALUATED) {
      const rows = (
        await client.query<{
          id: string;
          project_id: string;
          content: unknown;
          created_at: string;
          version_id: string | null;
        }>(
          `select o.id, s.project_id, o.content, to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
                  a.agent_definition_version_id as version_id
             from stage_outputs o
             join stage_runs s on s.id = o.stage_run_id
             left join stage_attempts a on a.id = o.attempt_id
            where s.stage = $1::stage_kind and o.origin = 'model'
              and ($2::uuid is null or s.project_id = $2)
              and ($3::timestamptz is null or o.created_at >= $3) and o.created_at < $4
            order by o.created_at desc, o.id desc limit 50`,
          [stage, input.projectId, input.from, input.to],
        )
      ).rows;
      // The newest output decides which charter is judged; outputs of another version of the
      // role are left out so no output is measured against rules it did not run with.
      const versionId = rows.find((row) => row.version_id !== null)?.version_id ?? null;
      const chosen = (versionId ? rows.filter((row) => row.version_id === versionId) : rows).slice(
        0,
        EVALUATION_LIMITS.samplesPerRole,
      );
      if (chosen.length === 0) {
        withoutSamples.push({ role, stage });
        continue;
      }
      const definition =
        (versionId ? await loadAgentVersion(client, context.workspaceId, versionId) : null) ??
        (await activeAgentVersion(client, context.workspaceId, role));
      const reviews = (
        await client.query<{ output_id: string; action: string; comment: string | null }>(
          `select output_id, action::text as action, comment from stage_reviews
            where output_id = any($1::uuid[]) and action in ('approve', 'reject')
            order by created_at, id`,
          [chosen.map((row) => row.id)],
        )
      ).rows;
      roles.push({
        role,
        stage,
        definition,
        samples: chosen.map((row, index) => ({
          ref: `S${index + 1}`,
          outputId: row.id,
          projectId: row.project_id,
          createdAt: row.created_at,
          content: sampleContent(row.content),
          reviews: reviews
            .filter((review) => review.output_id === row.id)
            .map((review) => ({ action: review.action, comment: review.comment })),
        })),
        knownDeviations: deviations
          .filter((deviation) => deviation.role === role)
          .map((deviation) => ({
            rule: deviation.rule,
            severity: deviation.severity,
            count: deviation.count,
            detail: deviation.detail,
          })),
      });
    }
    return { judge, connectionId, model, language, roles, withoutSamples };
  }

  /**
   * One model call per role, in parallel, outside any database transaction. A role that fails
   * is reported as failed with its reason; the report itself is never lost to one provider error.
   */
  async evaluate(
    context: WorkspaceRequestContext,
    input: { projectId: string | null },
    plan: EvaluationPlan,
  ): Promise<EvaluationOutcome> {
    const skipped = (
      role: AgentRole,
      stage: WorkflowStage,
      reason: EvaluationReason,
    ): RoleEvaluation => ({
      role,
      stage,
      status: 'skipped',
      reason,
      charterVersionId: null,
      charterSequence: null,
      samples: [],
      score: null,
      summary: null,
      findings: [],
      discarded: 0,
      invocationId: null,
      errorCode: null,
    });
    const configured = plan.connectionId !== '' && plan.model !== '';
    const judged = await Promise.all(
      plan.roles.map((entry) => this.judge(context, input, plan, entry, configured)),
    );
    // Keep the stable stage order of the report whatever order the calls finished in.
    const byRole = new Map<string, RoleEvaluation>([
      ...plan.withoutSamples.map(
        ({ role, stage }) => [role, skipped(role, stage, 'no_samples')] as const,
      ),
      ...judged.map((evaluation) => [evaluation.role, evaluation] as const),
    ]);
    const evaluations = EVALUATED.map(({ role }) => byRole.get(role)!);
    return {
      evaluations,
      summary: {
        requested: true,
        judgeVersionId: plan.judge.id,
        judgeSequence: plan.judge.sequence,
        completed: evaluations.filter((item) => item.status === 'completed').length,
        skipped: evaluations.filter((item) => item.status === 'skipped').length,
        failed: evaluations.filter((item) => item.status === 'failed').length,
        discardedFindings: evaluations.reduce((sum, item) => sum + item.discarded, 0),
      },
    };
  }

  private async judge(
    context: WorkspaceRequestContext,
    input: { projectId: string | null },
    plan: EvaluationPlan,
    entry: RolePlan,
    configured: boolean,
  ): Promise<RoleEvaluation> {
    const charter: CharterItem[] = charterItems(entry.definition);
    const base = {
      role: entry.role,
      stage: ROLE_STAGE[entry.role],
      charterVersionId: entry.definition.id,
      charterSequence: entry.definition.sequence,
      samples: entry.samples.map((sample) => ({
        ref: sample.ref,
        outputId: sample.outputId,
        projectId: sample.projectId,
        createdAt: sample.createdAt,
        rejected: sample.reviews.some((review) => review.action === 'reject'),
      })),
      score: null,
      summary: null,
      findings: [],
      discarded: 0,
      invocationId: null,
      errorCode: null,
    } satisfies Omit<RoleEvaluation, 'status' | 'reason'>;
    if (!configured) return { ...base, status: 'skipped', reason: 'ai_not_configured' };

    const prompt = {
      instructions: composeInstructions({
        role: 'brain',
        content: plan.judge,
        language: plan.language,
        task: plan.judge.promptTemplate,
        rules: ROLE_EVALUATION_RULES,
      }),
      message: `<data>${JSON.stringify(
        evaluationPromptData({
          role: entry.role,
          stage: entry.stage,
          charter,
          samples: entry.samples,
          knownDeviations: entry.knownDeviations,
        }),
      )}</data>`,
    };
    try {
      const { response, invocationId } = await this.runtime.invoke(
        {
          workspaceId: context.workspaceId,
          projectId: input.projectId,
          stageRunId: null,
          attemptId: null,
          purpose: `brain:evaluate:${entry.role}`,
          retryNo: 0,
          agentDefinitionVersionId: plan.judge.id,
          promptSha256: digest(prompt),
        },
        plan.connectionId,
        {
          model: plan.model,
          instructions: prompt.instructions,
          messages: [{ role: 'user', content: prompt.message }],
          responseSchema: { name: ROLE_EVALUATION_SCHEMA_NAME, schema: ROLE_EVALUATION_SCHEMA },
        },
      );
      if (response.finishReason !== 'stop' || response.json === null) {
        return {
          ...base,
          status: 'failed',
          reason: 'invalid_output',
          invocationId,
          errorCode: `output_${response.finishReason}`,
        };
      }
      const result = normalizeEvaluation(response.json, { charter, samples: entry.samples });
      if (!result.ok) {
        return { ...base, status: 'failed', reason: result.reason, invocationId };
      }
      return {
        ...base,
        status: 'completed',
        reason: null,
        invocationId,
        score: result.evaluation.score,
        summary: result.evaluation.summary,
        findings: result.evaluation.findings,
        discarded: result.evaluation.discarded,
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        return { ...base, status: 'failed', reason: 'provider_failure', errorCode: error.code };
      }
      throw error;
    }
  }
}
