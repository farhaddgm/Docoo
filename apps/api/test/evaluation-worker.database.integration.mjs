import assert from 'node:assert/strict';
import { prepareEvaluationExperiment } from '@docoo/application';
import { evaluationCorpusV1 } from '@docoo/domain/evaluation';
import {
  PostgresEvaluationExecutionStore,
  PostgresEvaluationInvocationJournal,
} from '@docoo/database';
import {
  createPairedEvaluationActivities,
  inWorkspace,
  ProviderRuntime,
} from '@docoo/orchestration';
import { FakeAdapter } from '@docoo/providers';

export async function verifyEvaluationWorkerActivities({
  pool,
  admin,
  context,
  projectId,
  baseline,
  candidate,
  runtime,
  getCalls,
  ownerId,
  viewerId,
  foreignWorkspaceId,
  foreignActorId,
}) {
  const store = new PostgresEvaluationExecutionStore(pool, context, projectId);
  const journal = new PostgresEvaluationInvocationJournal(pool, context, projectId);
  const activity = createPairedEvaluationActivities(pool, runtime, {
    enabled: true,
    environment: 'test',
    liveProviderUseApproved: false,
  });
  const ref = (experimentId) => ({ ...context, projectId, experimentId });
  const manifest = (experimentId) =>
    prepareEvaluationExperiment({
      experimentId,
      repetition: 1,
      timeoutMs: 1000,
      dataset: evaluationCorpusV1,
      baseline,
      candidate,
    });
  const before = getCalls();

  // Recover the exact paid receipt left by the earlier crash test, without another call.
  const gap = ref('stage-receipt-gap');
  const saved = await journal.get(gap.experimentId, baseline.runId, evaluationCorpusV1.cases[0].id);
  assert.equal((await activity.evaluationCase({ ...gap, ordinal: 0 })).reused, true);
  assert.equal(getCalls(), before);
  const recovered = (await store.get(gap.experimentId)).results[0];
  assert.equal(recovered.output, saved.receipt.response.output);
  assert.equal(recovered.latencyMs, saved.latencyMs);
  assert.deepEqual(await activity.evaluationCase({ ...gap, ordinal: 0 }), {
    status: 'completed',
    reused: true,
  });
  assert.equal(getCalls(), before);

  const fresh = manifest('worker-activities-complete');
  await store.create(fresh);
  const full = ref(fresh.experimentId);
  assert.deepEqual(await activity.evaluationPlan(full), { status: 'running', total: 60 });
  for (let ordinal = 0; ordinal < 60; ordinal++)
    assert.equal((await activity.evaluationCase({ ...full, ordinal })).status, 'completed');
  await activity.evaluationFinish({ ...full, status: 'completed' });
  await activity.evaluationFinish({ ...full, status: 'completed' });
  assert.equal((await store.get(fresh.experimentId)).status, 'completed');
  assert.equal((await activity.evaluationPlan(full)).status, 'completed');
  assert.equal(getCalls(), before + 60);
  // A returned but truncated response is a durable failure, not an unknown/retry loop.
  const bad = manifest('worker-invalid-output');
  await store.create(bad);
  let failureCalls = 0;
  const invalidRuntime = new ProviderRuntime(pool, null, (kind) => {
    assert.equal(kind, 'fake');
    const fake = new FakeAdapter();
    const invoke = fake.invoke.bind(fake);
    fake.invoke = async (request) => {
      failureCalls++;
      return { ...(await invoke(request)), finishReason: 'length' };
    };
    return fake;
  });
  const failing = createPairedEvaluationActivities(pool, invalidRuntime, {
    enabled: true,
    environment: 'test',
    liveProviderUseApproved: false,
  });
  assert.equal(
    (await failing.evaluationCase({ ...ref(bad.experimentId), ordinal: 0 })).status,
    'failed',
  );
  await failing.evaluationFinish({ ...ref(bad.experimentId), status: 'failed' });
  assert.equal((await store.get(bad.experimentId)).status, 'failed');
  assert.equal((await store.get(bad.experimentId)).results[0].errorCode, 'invalid_response');
  assert.equal(
    (await failing.evaluationCase({ ...ref(bad.experimentId), ordinal: 0 })).reused,
    true,
  );
  assert.equal(failureCalls, 1);
  await assert.rejects(activity.evaluationCase({ ...full, ordinal: -1 }), /ORDINAL_INVALID/);

  // A pending/unknown call cannot be treated as a retryable lease.
  assert.equal(
    (await activity.evaluationCase({ ...ref('stage-grant-revoked'), ordinal: 0 })).status,
    'interrupted',
  );
  assert.equal((await store.get('stage-grant-revoked')).status, 'interrupted');
  assert.equal(getCalls(), before + 60);

  // A revoked initiator can stop terminal metadata, but cannot regain any project content.
  const stopped = manifest('worker-revoked-after-intent');
  await store.create(stopped);
  const intent = {
    experimentId: stopped.experimentId,
    experimentHash: stopped.contentHash,
    runId: baseline.runId,
    caseId: stopped.dataset.cases[0].id,
    modelSnapshotHash: baseline.configuration.modelSnapshotHash,
    requestHash: 'd'.repeat(64),
  };
  await journal.begin(intent);
  await admin.query('delete from resource_access where user_id=$1 and resource_id=$2', [
    context.actorId,
    projectId,
  ]);
  assert.equal((await activity.evaluationPlan(ref(stopped.experimentId))).status, 'interrupted');
  await assert.rejects(store.get(stopped.experimentId), /NOT_FOUND/);
  assert.equal(
    (
      await admin.query(
        'select status from project_evaluation_experiments where experiment_id=$1',
        [stopped.experimentId],
      )
    ).rows[0].status,
    'interrupted',
  );
  assert.equal(
    (
      await admin.query(
        'select status from project_evaluation_invocation_journal where experiment_id=$1',
        [stopped.experimentId],
      )
    ).rows[0].status,
    'pending',
  );
  await admin.query(
    `insert into resource_access (workspace_id,user_id,kind,resource_id,access,granted_by)
    values ($1,$2,'project',$3,'EDIT',$4)`,
    [context.workspaceId, context.actorId, projectId, ownerId],
  );
  assert.equal(getCalls(), before + 60);

  const disabled = manifest('worker-disabled');
  await store.create(disabled);
  const off = createPairedEvaluationActivities(pool, runtime, {
    enabled: false,
    environment: 'test',
    liveProviderUseApproved: false,
  });
  assert.equal((await off.evaluationPlan(ref(disabled.experimentId))).status, 'interrupted');
  assert.equal(getCalls(), before + 60);

  const protectedRun = manifest('worker-protected-owner');
  await store.create(protectedRun);
  await assert.rejects(
    activity.evaluationPlan({ ...ref(protectedRun.experimentId), actorId: viewerId }),
  );
  assert.equal((await store.get(protectedRun.experimentId)).status, 'running');
  const foreign = await inWorkspace(
    pool,
    { workspaceId: foreignWorkspaceId, actorId: foreignActorId },
    (c) =>
      c.query('select app.interrupt_evaluation_experiment($1,$2,$3) as stopped', [
        context.workspaceId,
        projectId,
        protectedRun.experimentId,
      ]),
  );
  assert.equal(foreign.rows[0].stopped, false);
  assert.equal((await store.get(protectedRun.experimentId)).status, 'running');
  assert.equal(getCalls(), before + 60);
  process.stdout.write(
    'Evaluation worker activities gate passed: 60 additional paired calls, paid-receipt/result recovery without repeat, bounded ordering, disabled switch, owner isolation and metadata-only interruption after revocation.\n',
  );
  return { baseline, candidate, context, projectId };
}
