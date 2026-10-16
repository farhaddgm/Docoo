import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  compareReviewedEvaluation,
  evaluationResultOrdinal,
  readEvaluationExecutionResult,
  readEvaluationExperimentManifest,
  type EvaluationExecutionCaseResult,
  type EvaluationExecutionStore,
  type EvaluationExperimentManifest,
  type PairedEvaluationExecution,
} from '@docoo/application';
import { setDatabaseRequestContext, type DatabaseRequestContext } from './context.js';

export interface StoredEvaluationExperiment {
  readonly manifest: EvaluationExperimentManifest;
  readonly status: 'running' | PairedEvaluationExecution['status'];
  readonly results: readonly EvaluationExecutionCaseResult[];
}

export interface EvaluationExperimentListRow extends QueryResultRow {
  id: string;
  status: StoredEvaluationExperiment['status'];
  createdAt: string;
  datasetId: string;
  datasetVersion: number;
  synthetic: boolean;
  caseCount: number;
  resultCount: number;
  reviewCount: number;
  role: string;
}

interface ExperimentRow extends QueryResultRow {
  manifest_json: EvaluationExperimentManifest;
  status: StoredEvaluationExperiment['status'];
}
interface ResultRow extends QueryResultRow {
  result_json: unknown;
}
interface ProgressRow extends QueryResultRow {
  count: number;
  all_completed: boolean | null;
  has_failed: boolean | null;
}

export class EvaluationStoreError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'NOT_RUNNING'
      | 'OUT_OF_ORDER'
      | 'INVALID_TRANSITION'
      | 'REVIEWER_MISMATCH'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REVIEW_FORBIDDEN',
  ) {
    super(`EVALUATION_STORE_${code}`);
    this.name = 'EvaluationStoreError';
  }
}

/** PostgreSQL persistence shared by API and worker; each transaction reapplies current access. */
export class PostgresEvaluationExecutionStore implements EvaluationExecutionStore {
  constructor(
    private readonly pool: Pool,
    private readonly context: DatabaseRequestContext,
    private readonly projectId: string,
  ) {}

  async create(value: EvaluationExperimentManifest): Promise<void> {
    const manifest = readEvaluationExperimentManifest(value);
    await this.transaction(async (client) => {
      await client.query(
        `insert into project_evaluation_experiments
          (workspace_id, project_id, experiment_id, manifest_json, manifest_hash, created_by)
         values ($1,$2,$3,$4::jsonb,$5,$6)`,
        [
          ...this.scope(manifest.experimentId),
          JSON.stringify(manifest),
          manifest.contentHash,
          this.context.actorId,
        ],
      );
      await this.audit(client, 'project.evaluation_experiment.created', {
        experimentId: manifest.experimentId,
        manifestHash: manifest.contentHash,
        caseCount: manifest.dataset.cases.length,
        redacted: true,
      });
    });
  }

  async append(value: EvaluationExecutionCaseResult): Promise<void> {
    await this.transaction(async (client) => {
      const experiment = await this.header(client, value.experimentId, true);
      if (experiment.status !== 'running') throw new EvaluationStoreError('NOT_RUNNING');
      const result = readEvaluationExecutionResult(experiment.manifest, value);
      const ordinal = evaluationResultOrdinal(experiment.manifest, result);
      const progress = await this.progress(client, value.experimentId);
      if (ordinal !== progress.count || progress.all_completed === false) {
        throw new EvaluationStoreError('OUT_OF_ORDER');
      }
      await client.query(
        `insert into project_evaluation_case_results (workspace_id,project_id,experiment_id,ordinal,result_json)
         values ($1,$2,$3,$4,$5::jsonb)`,
        [...this.scope(result.experimentId), ordinal, JSON.stringify(result)],
      );
    });
  }

  async finish(experimentId: string, status: PairedEvaluationExecution['status']): Promise<void> {
    await this.transaction(async (client) => {
      const experiment = await this.header(client, experimentId, true);
      if (experiment.status === status) return;
      const progress = await this.progress(client, experimentId);
      if (
        experiment.status !== 'running' ||
        !['completed', 'failed', 'cancelled'].includes(status) ||
        (status === 'completed' &&
          (progress.count !== experiment.manifest.dataset.cases.length * 2 ||
            progress.all_completed !== true)) ||
        (status === 'failed' && progress.has_failed !== true)
      ) {
        throw new EvaluationStoreError('INVALID_TRANSITION');
      }
      const updated = await client.query(
        `update project_evaluation_experiments set status=$4, finished_at=clock_timestamp()
          where workspace_id=$1 and project_id=$2 and experiment_id=$3`,
        [...this.scope(experimentId), status],
      );
      if (updated.rowCount !== 1) throw new EvaluationStoreError('NOT_FOUND');
      await this.audit(client, 'project.evaluation_experiment.finished', {
        experimentId,
        status,
        resultCount: progress.count,
        redacted: true,
      });
    });
  }

  async get(experimentId: string): Promise<StoredEvaluationExperiment> {
    return this.transaction((client) => this.load(client, experimentId));
  }

  async list(limit: number, after?: { readonly createdAt: string; readonly id: string }) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new EvaluationStoreError('INVALID_TRANSITION');
    return this.transaction(async (client) => {
      await this.assertProject(client);
      const rows = await client.query<EvaluationExperimentListRow>(
        `select e.experiment_id as id, e.status,
          to_char(e.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
          e.manifest_json->'dataset'->>'id' as "datasetId",
          (e.manifest_json->'dataset'->>'version')::int as "datasetVersion", true as synthetic,
          jsonb_array_length(e.manifest_json->'dataset'->'cases') as "caseCount",
          e.manifest_json->'baseline'->'configuration'->>'role' as role,
          (select count(*)::int from project_evaluation_case_results r where r.workspace_id=e.workspace_id
            and r.project_id=e.project_id and r.experiment_id=e.experiment_id) as "resultCount",
          (select count(*)::int from project_evaluation_experiment_reviews r where r.workspace_id=e.workspace_id
            and r.project_id=e.project_id and r.experiment_id=e.experiment_id) as "reviewCount"
         from project_evaluation_experiments e where e.workspace_id=$1 and e.project_id=$2
          and ($3::timestamptz is null or (e.created_at,e.experiment_id)<($3::timestamptz,$4::text))
         order by e.created_at desc,e.experiment_id desc limit $5`,
        [
          this.context.workspaceId,
          this.projectId,
          after?.createdAt ?? null,
          after?.id ?? null,
          limit + 1,
        ],
      );
      return rows.rows;
    });
  }

  async comparisons(experimentId: string) {
    return this.transaction(async (client) => {
      await this.assertProject(client);
      const { manifest } = await this.header(client, experimentId);
      const rows = await client.query<{
        id: string;
        createdAt: string;
        reviewerId: string;
        payload: unknown;
        review_hash: string;
      }>(
        `select id,created_at as "createdAt",created_by as "reviewerId",comparison_json as payload,review_hash
          from project_evaluation_experiment_reviews where workspace_id=$1 and project_id=$2 and experiment_id=$3
          order by created_at desc,id desc limit 20`,
        this.scope(experimentId),
      );
      return rows.rows.map((row) => {
        const payload = row.payload as {
          reviewHash?: unknown;
          review?: { experimentHash?: unknown };
          comparison?: unknown;
        } | null;
        if (
          !payload ||
          payload.reviewHash !== row.review_hash ||
          payload.review?.experimentHash !== manifest.contentHash
        ) {
          throw new EvaluationStoreError('INVALID_TRANSITION');
        }
        return {
          id: row.id,
          createdAt: new Date(row.createdAt).toISOString(),
          reviewerId: row.reviewerId,
          comparison: payload.comparison,
        };
      });
    });
  }

  async review(experimentId: string, input: unknown, commandKey?: string) {
    if (commandKey !== undefined && !/^[A-Za-z0-9._:-]{8,200}$/.test(commandKey))
      throw new EvaluationStoreError('IDEMPOTENCY_CONFLICT');
    return this.transaction(async (client) => {
      const execution = await this.load(client, experimentId);
      const access = await client.query<{ allowed: boolean }>(
        `select app.actor_role($1) in ('super_admin','editor') and app.resource_access('project',$1,$2)='EDIT' as allowed`,
        [this.context.workspaceId, this.projectId],
      );
      if (access.rows[0]?.allowed !== true) throw new EvaluationStoreError('REVIEW_FORBIDDEN');
      if (execution.status !== 'completed') throw new EvaluationStoreError('INVALID_TRANSITION');
      const result = compareReviewedEvaluation({ ...execution, status: execution.status }, input);
      if (result.review.reviewerId !== this.context.actorId)
        throw new EvaluationStoreError('REVIEWER_MISMATCH');
      const serialized = JSON.stringify(input);
      const reviewHash = result.reviewHash;
      if (commandKey !== undefined) {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
          `evaluation-review:${this.context.workspaceId}:${this.projectId}:${experimentId}:${commandKey}`,
        ]);
        const previous = await client.query<{
          review_id: string;
          request_hash: string;
          created_by: string;
        }>(
          `select review_id,request_hash,created_by from project_evaluation_review_commands
            where workspace_id=$1 and project_id=$2 and experiment_id=$3 and command_key=$4`,
          [...this.scope(experimentId), commandKey],
        );
        const command = previous.rows[0];
        if (command) {
          if (command.request_hash !== reviewHash || command.created_by !== this.context.actorId)
            throw new EvaluationStoreError('IDEMPOTENCY_CONFLICT');
          return { id: command.review_id, ...result };
        }
      }
      const inserted = await client.query<{ id: string }>(
        `insert into project_evaluation_experiment_reviews
          (workspace_id,project_id,experiment_id,review_json,comparison_json,review_hash,created_by)
         values ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
         on conflict (workspace_id,project_id,experiment_id,review_hash) do nothing returning id`,
        [
          ...this.scope(experimentId),
          serialized,
          JSON.stringify(result),
          reviewHash,
          this.context.actorId,
        ],
      );
      const saved =
        inserted.rows[0] ??
        (
          await client.query<{ id: string }>(
            `select id from project_evaluation_experiment_reviews
          where workspace_id=$1 and project_id=$2 and experiment_id=$3 and review_hash=$4`,
            [...this.scope(experimentId), reviewHash],
          )
        ).rows[0];
      if (!saved) throw new EvaluationStoreError('NOT_FOUND');
      if (commandKey !== undefined)
        await client.query(
          `insert into project_evaluation_review_commands (workspace_id,project_id,experiment_id,command_key,request_hash,review_id,created_by)
          values ($1,$2,$3,$4,$5,$6,$7)`,
          [...this.scope(experimentId), commandKey, reviewHash, saved.id, this.context.actorId],
        );
      if (inserted.rowCount)
        await this.audit(client, 'project.evaluation_experiment.reviewed', {
          experimentId,
          reviewId: saved.id,
          reviewHash,
          redacted: true,
        });
      return { id: saved.id, ...result };
    });
  }

  private scope(experimentId: string) {
    return [this.context.workspaceId, this.projectId, experimentId];
  }

  private async header(client: PoolClient, experimentId: string, lock = false) {
    const query = await client.query<ExperimentRow>(
      `select manifest_json,status from project_evaluation_experiments
        where workspace_id=$1 and project_id=$2 and experiment_id=$3${lock ? ' for update' : ''}`,
      this.scope(experimentId),
    );
    const row = query.rows[0];
    if (!row) throw new EvaluationStoreError('NOT_FOUND');
    return { manifest: readEvaluationExperimentManifest(row.manifest_json), status: row.status };
  }

  private async progress(client: PoolClient, experimentId: string): Promise<ProgressRow> {
    const rows = await client.query<ProgressRow>(
      `select count(*)::int as count, bool_and(result_json->>'status'='completed') as all_completed,
        bool_or(result_json->>'status'='failed') as has_failed from project_evaluation_case_results
        where workspace_id=$1 and project_id=$2 and experiment_id=$3`,
      this.scope(experimentId),
    );
    return rows.rows[0]!;
  }

  private async load(
    client: PoolClient,
    experimentId: string,
  ): Promise<StoredEvaluationExperiment> {
    await this.assertProject(client);
    const { manifest, status } = await this.header(client, experimentId);
    const saved = await client.query<ResultRow>(
      `select result_json from project_evaluation_case_results
        where workspace_id=$1 and project_id=$2 and experiment_id=$3 order by ordinal`,
      this.scope(experimentId),
    );
    const results = saved.rows.map((entry, index) => {
      const result = readEvaluationExecutionResult(manifest, entry.result_json);
      if (evaluationResultOrdinal(manifest, result) !== index)
        throw new EvaluationStoreError('OUT_OF_ORDER');
      return result;
    });
    return { manifest, status, results };
  }

  private async assertProject(client: PoolClient) {
    const project = await client.query(
      "select id from projects where workspace_id=$1 and id=$2 and status<>'deleted'",
      [this.context.workspaceId, this.projectId],
    );
    if (!project.rows[0]) throw new EvaluationStoreError('NOT_FOUND');
  }

  private async audit(client: PoolClient, action: string, after: Record<string, unknown>) {
    await client.query(
      `insert into audit_events (workspace_id,actor_id,action,target_type,target_id,"after",correlation_id,security_relevant)
       values ($1,$2,$3,'project',$4,$5::jsonb,$6,false)`,
      [
        this.context.workspaceId,
        this.context.actorId,
        action,
        this.projectId,
        JSON.stringify(after),
        /^[0-9a-f-]{36}$/i.test(this.context.correlationId)
          ? this.context.correlationId
          : randomUUID(),
      ],
    );
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await setDatabaseRequestContext(client, this.context);
      const value = await operation(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
