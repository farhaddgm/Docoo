import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  executePairedEvaluation,
  prepareEvaluationExperiment,
  hashEvaluationSnapshotText,
} from '@docoo/application';
import { evaluationCorpusV1 } from '@docoo/domain/evaluation';
import {
  PostgresEvaluationExecutionStore,
  PostgresEvaluationInvocationJournal,
} from '@docoo/database';
import {
  activeAgentVersion,
  captureStageEvaluationArm,
  createStageEvaluationAdapter,
  inWorkspace,
  ProviderRuntime,
} from '@docoo/orchestration';
import { FakeAdapter } from '@docoo/providers';

/** Uses the disposable database of the parent gate. No live adapter or credentials are used. */
export async function verifyEvaluationProviderDatabase({
  pool,
  admin,
  workspaceId,
  projectId,
  actorId,
  reviewerId,
  viewerId,
  foreignWorkspaceId,
  foreignActorId,
}) {
  const connectionId = randomUUID();
  const fake = new FakeAdapter();
  const models = await fake.listModels();
  await admin.query(
    `insert into provider_connections (id,workspace_id,provider,name,status) values ($1,$2,'fake','Evaluation fixture','healthy')`,
    [connectionId, workspaceId],
  );
  await admin.query(
    `insert into model_catalog_snapshots (workspace_id,connection_id,models,model_count,hash) values ($1,$2,$3::jsonb,$4,$5)`,
    [
      workspaceId,
      connectionId,
      JSON.stringify(models),
      models.length,
      hashEvaluationSnapshotText(JSON.stringify(models)),
    ],
  );
  const client = await admin.connect();
  let definition;
  try {
    definition = await activeAgentVersion(client, workspaceId, 'researcher');
  } finally {
    client.release();
  }
  const candidate = (
    await admin.query(
      `insert into agent_definition_versions
    (workspace_id,project_id,role,sequence,principles,duties,prompt_template,tools,model_policy,output_schema_id,changed_sections,base_version_id,reason)
    select workspace_id,project_id,role,sequence+1,principles,duties,prompt_template||' Explicitly report missing evidence.',tools,model_policy,
      output_schema_id,'["prompt"]'::jsonb,id,'Synthetic evaluation fixture' from agent_definition_versions where id=$1 returning id`,
      [definition.id],
    )
  ).rows[0].id;
  const context = { workspaceId, actorId: reviewerId, correlationId: randomUUID() };
  const capture = (versionId, runId, overrides = {}) =>
    inWorkspace(pool, context, (c) =>
      captureStageEvaluationArm(c, {
        workspaceId,
        projectId,
        role: 'researcher',
        runId,
        timeoutMs: 1000,
        selection: { definitionVersionId: versionId, connectionId, modelId: 'fake-standard' },
        ...overrides,
      }),
    );
  const baseline = await capture(definition.id, 'baseline-stage');
  const challenger = await capture(candidate, 'candidate-stage');
  const makeInput = (experimentId) => ({
    experimentId,
    repetition: 1,
    timeoutMs: 1000,
    dataset: evaluationCorpusV1,
    baseline,
    candidate: challenger,
  });
  let calls = 0;
  const runtime = new ProviderRuntime(pool, null, (kind) => {
    assert.equal(kind, 'fake', 'This gate must never instantiate a live adapter');
    const adapter = new FakeAdapter();
    const invoke = adapter.invoke.bind(adapter);
    adapter.invoke = (request) => {
      calls++;
      return invoke(request);
    };
    return adapter;
  });
  const store = new PostgresEvaluationExecutionStore(pool, context, projectId);
  const journal = new PostgresEvaluationInvocationJournal(pool, context, projectId);
  const adapterFor = (manifest, selectedJournal = journal) =>
    createStageEvaluationAdapter({
      runtime,
      journal: selectedJournal,
      scope: { ...context, projectId },
      manifest,
      environment: 'test',
      liveProviderUseApproved: false,
    });
  const input = makeInput('production-stage-01');
  const manifest = prepareEvaluationExperiment(input);
  const result = await executePairedEvaluation(input, {
    store,
    adapter: adapterFor(manifest),
    signal: new AbortController().signal,
  });
  assert.equal(result.status, 'completed');
  assert.equal(calls, 60);
  assert.ok(result.results.every((row) => row.costUsd === null));
  const saved = await admin.query(
    `select status,receipt_json from project_evaluation_invocation_journal where experiment_id=$1`,
    [manifest.experimentId],
  );
  assert.equal(saved.rows.length, 60);
  assert.ok(saved.rows.every((row) => row.status === 'returned'));
  const ledger = await admin.query(
    `select count(*)::int as calls,sum(cost_usd) as estimated from model_invocations where purpose='evaluation:paired'`,
  );
  assert.equal(ledger.rows[0].calls, 60);
  assert.ok(Number(ledger.rows[0].estimated) > 0);
  const receipt = await new PostgresEvaluationInvocationJournal(pool, context, projectId).get(
    manifest.experimentId,
    baseline.runId,
    manifest.dataset.cases[0].id,
  );
  assert.equal(receipt.status, 'returned');
  assert.equal(receipt.receipt.response.costUsd, null);
  await journal.returned(receipt.intent, receipt.receipt); // Idempotent exact acknowledgement.
  assert.deepEqual(
    (await journal.get(manifest.experimentId, baseline.runId, manifest.dataset.cases[0].id))
      .receipt,
    receipt.receipt,
  );
  await assert.rejects(
    journal.returned(receipt.intent, { ...receipt.receipt, outputHash: 'f'.repeat(64) }),
    /RECEIPT_CHANGED/,
  );
  await assert.rejects(
    new PostgresEvaluationInvocationJournal(
      pool,
      { ...context, workspaceId: foreignWorkspaceId, actorId: foreignActorId },
      projectId,
    ).get(manifest.experimentId, baseline.runId, manifest.dataset.cases[0].id),
    /NOT_FOUND/,
  );

  // Crash between receipt commit and case-result commit: reload the paid answer, never call again.
  const interruptedInput = makeInput('stage-receipt-gap');
  const interruptedManifest = prepareEvaluationExperiment(interruptedInput);
  const interruptedAdapter = adapterFor(interruptedManifest);
  await assert.rejects(
    executePairedEvaluation(interruptedInput, {
      adapter: interruptedAdapter,
      signal: new AbortController().signal,
      store: {
        create: (m) => store.create(m),
        append: async () => {
          throw new Error('simulated-process-stop');
        },
        finish: (id, status) => store.finish(id, status),
      },
    }),
    /simulated-process-stop/,
  );
  assert.equal(calls, 61);

  assert.equal((await store.get(interruptedManifest.experimentId)).results.length, 0);
  const gapReceipt = await journal.get(
    interruptedManifest.experimentId,
    baseline.runId,
    interruptedManifest.dataset.cases[0].id,
  );
  assert.equal(gapReceipt.status, 'returned');
  assert.ok(gapReceipt.receipt.response.output.length > 0);
  await assert.rejects(
    interruptedAdapter.execute({
      arm: interruptedManifest.baseline,
      testCase: interruptedManifest.dataset.cases[0],
      signal: new AbortController().signal,
    }),
    /ALREADY_STARTED/,
  );
  assert.equal(calls, 61);

  // Separate workers racing on the same case get one committed permit, never two calls.
  const concurrentManifest = prepareEvaluationExperiment(makeInput('stage-concurrent-intent'));
  await store.create(concurrentManifest);
  const concurrentAdapter = adapterFor(concurrentManifest);
  const invocation = {
    arm: concurrentManifest.baseline,
    testCase: concurrentManifest.dataset.cases[0],
    signal: new AbortController().signal,
  };
  const raced = await Promise.allSettled([
    concurrentAdapter.execute(invocation),
    concurrentAdapter.execute(invocation),
  ]);
  assert.equal(raced.filter((item) => item.status === 'fulfilled').length, 1);
  assert.ok(
    raced.some((item) => item.status === 'rejected' && item.reason.code === 'ALREADY_STARTED'),
  );
  assert.equal(calls, 62);

  // SQL cannot bind another kind of invocation to this experiment or reopen a terminal intent.
  const badReceiptManifest = prepareEvaluationExperiment(makeInput('stage-receipt-scope'));
  await store.create(badReceiptManifest);
  const badIntent = {
    ...gapReceipt.intent,
    experimentId: badReceiptManifest.experimentId,
    experimentHash: badReceiptManifest.contentHash,
    requestHash: 'e'.repeat(64),
  };
  await journal.begin(badIntent);
  const wrongInvocationId = randomUUID();
  await admin.query(
    `insert into model_invocations (id,workspace_id,project_id,connection_id,provider,model,purpose,status,retry_no,prompt_sha256)
    values ($1,$2,$3,$4,'fake','fake-standard','selfcheck','succeeded',0,$5)`,
    [wrongInvocationId, workspaceId, projectId, connectionId, badIntent.requestHash],
  );
  await assert.rejects(
    journal.returned(badIntent, { ...gapReceipt.receipt, invocationId: wrongInvocationId }),
    /receipt scope mismatch/,
  );
  assert.equal(
    (await journal.get(badIntent.experimentId, badIntent.runId, badIntent.caseId)).status,
    'pending',
  );
  await journal.unknown(badIntent);
  await assert.rejects(
    inWorkspace(pool, context, (c) =>
      c.query(
        `update project_evaluation_invocation_journal
    set status='pending',finished_at=null where experiment_id=$1`,
        [badIntent.experimentId],
      ),
    ),
    /immutable/,
  );
  // Lose access after an intent commits but before runtime starts: no network/model call.
  const revokedManifest = prepareEvaluationExperiment(makeInput('stage-grant-revoked'));
  await store.create(revokedManifest);
  const revokeAtBegin = {
    begin: async (intent) => {
      await journal.begin(intent);
      await admin.query('delete from resource_access where user_id=$1 and resource_id=$2', [
        reviewerId,
        projectId,
      ]);
    },
    returned: (intent, r) => journal.returned(intent, r),
    unknown: (intent) => journal.unknown(intent),
  };
  await assert.rejects(
    adapterFor(revokedManifest, revokeAtBegin).execute({
      arm: revokedManifest.baseline,
      testCase: revokedManifest.dataset.cases[0],
      signal: new AbortController().signal,
    }),
  );
  assert.equal(calls, 62, 'Revoked initiator must not borrow worker service authority');
  assert.equal(
    (
      await admin.query(
        `select status from project_evaluation_invocation_journal where experiment_id=$1`,
        [revokedManifest.experimentId],
      )
    ).rows[0].status,
    'pending',
  );
  await admin.query(
    `insert into resource_access (workspace_id,user_id,kind,resource_id,access,granted_by) values ($1,$2,'project',$3,'EDIT',$4)`,
    [workspaceId, reviewerId, projectId, actorId],
  );
  await assert.rejects(
    adapterFor(revokedManifest).execute({
      arm: revokedManifest.baseline,
      testCase: revokedManifest.dataset.cases[0],
      signal: new AbortController().signal,
    }),
    /ALREADY_STARTED/,
  );
  await journal.unknown(
    (
      await journal.get(
        revokedManifest.experimentId,
        baseline.runId,
        revokedManifest.dataset.cases[0].id,
      )
    ).intent,
  );
  await assert.rejects(
    adapterFor(revokedManifest).execute({
      arm: revokedManifest.baseline,
      testCase: revokedManifest.dataset.cases[0],
      signal: new AbortController().signal,
    }),
    /ALREADY_STARTED/,
  );
  assert.equal(calls, 62);

  // Scope and model capability are resolved by the server, not accepted from caller snapshots.
  await assert.rejects(
    inWorkspace(pool, { workspaceId, actorId: viewerId }, (c) =>
      captureStageEvaluationArm(c, {
        workspaceId,
        projectId,
        role: 'researcher',
        runId: 'viewer-stage',
        timeoutMs: 1000,
        selection: { definitionVersionId: definition.id, connectionId, modelId: 'fake-standard' },
      }),
    ),
    /EXPERIMENT_INVALID/,
  );
  await assert.rejects(
    capture(definition.id, 'wrong-role', { role: 'evaluator' }),
    /EXPERIMENT_INVALID/,
  );
  await assert.rejects(
    capture(definition.id, 'unknown-model', {
      selection: { definitionVersionId: definition.id, connectionId, modelId: 'not-in-catalog' },
    }),
    /EXPERIMENT_INVALID/,
  );
  await assert.rejects(
    capture(definition.id, 'no-schema', {
      selection: { definitionVersionId: definition.id, connectionId, modelId: 'fake-small' },
    }),
    /EXPERIMENT_INVALID/,
  );
  const latest = await capture(definition.id, 'pin-check');
  await admin.query(
    `insert into model_catalog_snapshots (workspace_id,connection_id,models,model_count,hash) values ($1,$2,'[]'::jsonb,0,$3)`,
    [workspaceId, connectionId, 'a'.repeat(64)],
  );
  assert.notEqual(JSON.parse(latest.snapshots.model).catalogSnapshotHash, 'a'.repeat(64));
  await assert.rejects(capture(definition.id, 'catalog-changed'), /EXPERIMENT_INVALID/);
  const { verifyEvaluationWorkerActivities } =
    await import('./evaluation-worker.database.integration.mjs');
  await verifyEvaluationWorkerActivities({
    pool,
    admin,
    context,
    projectId,
    baseline,
    candidate: challenger,
    runtime,
    getCalls: () => calls,
    ownerId: actorId,
    viewerId,
    foreignWorkspaceId,
    foreignActorId,
  });
  if (process.argv.includes('--with-workflow')) {
    const { verifyEvaluationTemporal } = await import('./evaluation-temporal.integration.mjs');
    await verifyEvaluationTemporal({
      pool,
      context,
      projectId,
      baseline,
      candidate: challenger,
      runtime,
      getCalls: () => calls,
    });
  }
  process.stdout.write(
    'Production stage evaluation gate passed: actual role/catalog capture, 60 paired fake ProviderRuntime calls plus two crash/concurrency probes, durable intents/receipts, real invocation ledger, null measured cost, receipt scope, lost-commit fencing and revocation before model use.\n',
  );
}
