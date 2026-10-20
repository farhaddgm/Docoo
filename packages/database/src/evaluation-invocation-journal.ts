import type { Pool, PoolClient } from 'pg';
import {
  evaluationInvocationIntentSchema,
  evaluationInvocationReceiptSchema,
  type EvaluationInvocationIntent,
  type EvaluationInvocationReceipt,
} from '@docoo/contracts';
import {
  EvaluationInvocationError,
  hashEvaluationSnapshotText,
  readEvaluationExperimentManifest,
  type EvaluationExperimentManifest,
  type EvaluationInvocationJournal,
} from '@docoo/application';
import { setDatabaseRequestContext, type DatabaseRequestContext } from './context.js';

type JournalEntry = {
  intent: EvaluationInvocationIntent;
  status: 'pending' | 'returned' | 'unknown';
  receipt: EvaluationInvocationReceipt | null;
  latencyMs: number | null;
};

/** A unique committed intent, not an expiring lease: losing its acknowledgement cannot permit replay. */
export class PostgresEvaluationInvocationJournal implements EvaluationInvocationJournal {
  constructor(
    private readonly pool: Pool,
    private readonly context: DatabaseRequestContext,
    private readonly projectId: string,
  ) {}

  async begin(value: EvaluationInvocationIntent) {
    const intent = evaluationInvocationIntentSchema.parse(value);
    try {
      await this.transaction(async (client) => {
        const manifest = await this.manifest(client, intent.experimentId, true);
        const ordinal = this.ordinal(manifest, intent);
        const allowed = (
          await client.query<{ allowed: boolean }>(
            `select app.actor_role($1) in ('super_admin','editor')
           and app.resource_access('project',$1,$2)='EDIT' as allowed`,
            [this.context.workspaceId, this.projectId],
          )
        ).rows[0]?.allowed;
        if (!allowed) throw new EvaluationInvocationError('FORBIDDEN');
        const progress = (
          await client.query<{ count: number; complete: boolean | null }>(
            `select count(*)::int as count, bool_and(result_json->>'status'='completed') as complete
           from project_evaluation_case_results where workspace_id=$1 and project_id=$2 and experiment_id=$3`,
            this.scope(intent.experimentId),
          )
        ).rows[0]!;
        if (progress.count !== ordinal || progress.complete === false)
          throw new EvaluationInvocationError('OUT_OF_ORDER');
        await client.query(
          `insert into project_evaluation_invocation_journal
            (workspace_id,project_id,experiment_id,ordinal,intent_json,intent_hash,created_by)
           values ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
          [
            ...this.scope(intent.experimentId),
            ordinal,
            JSON.stringify(intent),
            this.hash(intent),
            this.context.actorId,
          ],
        );
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw new EvaluationInvocationError('ALREADY_STARTED');
      throw error;
    }
  }

  async returned(value: EvaluationInvocationIntent, rawReceipt: EvaluationInvocationReceipt) {
    const intent = evaluationInvocationIntentSchema.parse(value);
    const receipt = evaluationInvocationReceiptSchema.parse(rawReceipt);
    if (
      receipt.response &&
      receipt.outputHash !== hashEvaluationSnapshotText(receipt.response.output)
    )
      throw new EvaluationInvocationError('RECEIPT_CHANGED');
    await this.finish(intent, receipt);
  }

  async unknown(value: EvaluationInvocationIntent) {
    await this.finish(evaluationInvocationIntentSchema.parse(value), null);
  }

  async get(experimentId: string, runId: string, caseId: string): Promise<JournalEntry | null> {
    return this.transaction(async (client) => {
      const manifest = await this.manifest(client, experimentId);
      const ordinal = this.caseOrdinal(manifest, runId, caseId);
      const row = (
        await client.query<{
          intent_json: unknown;
          intent_hash: string;
          status: JournalEntry['status'];
          receipt_json: unknown;
          receipt_hash: string | null;
          latency_ms: number | null;
        }>(
          `select j.intent_json,j.intent_hash,j.status,j.receipt_json,j.receipt_hash,i.latency_ms
        from project_evaluation_invocation_journal j left join model_invocations i on i.id=j.invocation_id
         and i.workspace_id=j.workspace_id and i.project_id=j.project_id
        where j.workspace_id=$1 and j.project_id=$2 and j.experiment_id=$3 and j.ordinal=$4`,
          [...this.scope(experimentId), ordinal],
        )
      ).rows[0];
      if (!row) return null;
      const intent = evaluationInvocationIntentSchema.parse(row.intent_json);
      this.ordinal(manifest, intent);
      const receipt =
        row.receipt_json === null
          ? null
          : evaluationInvocationReceiptSchema.parse(row.receipt_json);
      if (
        this.hash(intent) !== row.intent_hash ||
        (receipt ? this.hash(receipt) : null) !== row.receipt_hash ||
        (row.status === 'returned') !== (receipt !== null) ||
        (receipt?.response &&
          receipt.outputHash !== hashEvaluationSnapshotText(receipt.response.output))
      )
        throw new EvaluationInvocationError('RECEIPT_CHANGED');
      return { intent, status: row.status, receipt, latencyMs: row.latency_ms };
    });
  }

  private async finish(
    intent: EvaluationInvocationIntent,
    receipt: EvaluationInvocationReceipt | null,
  ) {
    await this.transaction(async (client) => {
      const manifest = await this.manifest(client, intent.experimentId);
      const ordinal = this.ordinal(manifest, intent);
      const row = (
        await client.query<{
          intent_hash: string;
          status: JournalEntry['status'];
          receipt_hash: string | null;
        }>(
          `select intent_hash,status,receipt_hash from project_evaluation_invocation_journal
         where workspace_id=$1 and project_id=$2 and experiment_id=$3 and ordinal=$4 for update`,
          [...this.scope(intent.experimentId), ordinal],
        )
      ).rows[0];
      if (!row) throw new EvaluationInvocationError('NOT_FOUND');
      if (row.intent_hash !== this.hash(intent))
        throw new EvaluationInvocationError('RECEIPT_CHANGED');
      const receiptHash = receipt ? this.hash(receipt) : null;
      const status = receipt ? 'returned' : 'unknown';
      if (row.status === status && row.receipt_hash === receiptHash) return;
      if (row.status !== 'pending') throw new EvaluationInvocationError('RECEIPT_CHANGED');
      const updated = await client.query(
        `update project_evaluation_invocation_journal set status=$5,receipt_json=$6::jsonb,
          receipt_hash=$7,invocation_id=$8,finished_at=clock_timestamp()
         where workspace_id=$1 and project_id=$2 and experiment_id=$3 and ordinal=$4`,
        [
          ...this.scope(intent.experimentId),
          ordinal,
          status,
          receipt ? JSON.stringify(receipt) : null,
          receiptHash,
          receipt?.invocationId ?? null,
        ],
      );
      if (updated.rowCount !== 1) throw new EvaluationInvocationError('FORBIDDEN');
    });
  }

  private async manifest(client: PoolClient, experimentId: string, lock = false) {
    const row = (
      await client.query<{ manifest_json: unknown }>(
        `select e.manifest_json from project_evaluation_experiments e join projects p
        on p.workspace_id=e.workspace_id and p.id=e.project_id
       where e.workspace_id=$1 and e.project_id=$2 and e.experiment_id=$3 and p.deleted_at is null
       ${lock ? "and e.status='running' and p.status not in ('archived','deleted') for update of e" : ''}`,
        this.scope(experimentId),
      )
    ).rows[0];
    if (!row) throw new EvaluationInvocationError('NOT_FOUND');
    return readEvaluationExperimentManifest(row.manifest_json as EvaluationExperimentManifest);
  }
  private ordinal(manifest: EvaluationExperimentManifest, intent: EvaluationInvocationIntent) {
    const arm = [manifest.baseline, manifest.candidate].find((arm) => arm.runId === intent.runId);
    if (
      !arm ||
      intent.experimentHash !== manifest.contentHash ||
      intent.modelSnapshotHash !== arm.configuration.modelSnapshotHash
    )
      throw new EvaluationInvocationError('RECEIPT_CHANGED');
    return this.caseOrdinal(manifest, intent.runId, intent.caseId);
  }
  private caseOrdinal(manifest: EvaluationExperimentManifest, runId: string, caseId: string) {
    const index = manifest.dataset.cases.findIndex((item) => item.id === caseId);
    if (index < 0 || ![manifest.baseline.runId, manifest.candidate.runId].includes(runId))
      throw new EvaluationInvocationError('NOT_FOUND');
    const first = index % 2 === 0 ? manifest.baseline.runId : manifest.candidate.runId;
    return index * 2 + (runId === first ? 0 : 1);
  }
  private scope(experimentId: string) {
    return [this.context.workspaceId, this.projectId, experimentId];
  }
  private hash(value: EvaluationInvocationIntent | EvaluationInvocationReceipt) {
    return hashEvaluationSnapshotText(JSON.stringify(value));
  }
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await setDatabaseRequestContext(client, this.context);
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
