import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { Client, Connection } from '@temporalio/client';
import { Worker, NativeConnection, bundleWorkflowCode } from '@temporalio/worker';
import { createPairedEvaluationActivities } from '@docoo/orchestration';
import { prepareEvaluationExperiment } from '@docoo/application';
import { evaluationCorpusV1 } from '@docoo/domain/evaluation';
import { PostgresEvaluationExecutionStore } from '@docoo/database';
import { parseEnvironment } from '@docoo/config';
import { TemporalWorkflowEngine } from '../dist/workflow/workflow.engine.js';

export async function verifyEvaluationTemporal({
  pool,
  context,
  projectId,
  baseline,
  candidate,
  runtime,
  getCalls,
}) {
  const address = process.env.TEMPORAL_EVAL_ADDRESS;
  if (!/^127\.0\.0\.1:\d{1,5}$/.test(address ?? ''))
    throw new Error(
      'TEMPORAL_EVAL_ADDRESS must name the loopback-only disposable Temporal server.',
    );
  const connection = await Connection.connect({ address, connectTimeout: '30 seconds' });
  let native;
  let firstWorker, firstRun;
  const taskQueue = `docoo-evaluation-gate-${randomBytes(8).toString('hex')}`;
  class FixtureEngine extends TemporalWorkflowEngine {
    evaluationTaskQueue() {
      return taskQueue;
    }
  }
  const engine = new FixtureEngine(
    parseEnvironment({
      SESSION_PEPPER: 'evaluation-temporal-fixture-pepper-32-chars',
      TEMPORAL_ADDRESS: address,
    }),
  );
  try {
    native = await NativeConnection.connect({ address });
    const client = new Client({ connection });
    const store = new PostgresEvaluationExecutionStore(pool, context, projectId);
    const input = {
      experimentId: 'temporal-paired-01',
      repetition: 1,
      timeoutMs: 1000,
      dataset: evaluationCorpusV1,
      baseline,
      candidate,
    };
    const manifest = prepareEvaluationExperiment(input);
    await store.create(manifest);
    const ref = { ...context, projectId, experimentId: manifest.experimentId };
    const activities = createPairedEvaluationActivities(pool, runtime, {
      enabled: true,
      environment: 'test',
      liveProviderUseApproved: false,
    });
    const bundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(import.meta.resolve('@docoo/orchestration/workflows')),
    });
    const before = getCalls();
    // The first result commits, then its activity acknowledgement is lost. Temporal retries it.
    let lost = false;
    const lostAcknowledgement = Promise.withResolvers();
    firstWorker = await Worker.create({
      connection: native,
      taskQueue,
      workflowBundle: bundle,
      activities: {
        ...activities,
        evaluationCase: async (ref) => {
          const result = await activities.evaluationCase(ref);
          if (ref.ordinal === 0 && !lost) {
            lost = true;
            lostAcknowledgement.resolve();
            throw new Error('simulated-lost-activity-acknowledgement');
          }
          return result;
        },
      },
    });
    const workflowId = `eval-${taskQueue}`;
    firstRun = firstWorker.run();
    firstRun.catch(() => undefined);
    // Only queue routing is overridden; the engine makes real Temporal RPCs with its real start policy.
    await engine.startPairedEvaluation(workflowId, ref);
    await engine.startPairedEvaluation(workflowId, ref);
    const handle = client.workflow.getHandle(workflowId);
    await Promise.race([
      lostAcknowledgement.promise,
      pause(30000, undefined, { ref: false }).then(() => {
        throw new Error('Worker fault injection did not run.');
      }),
    ]);
    firstWorker.shutdown();
    await firstRun;
    firstRun = undefined;
    const freshActivities = createPairedEvaluationActivities(pool, runtime, {
      enabled: true,
      environment: 'test',
      liveProviderUseApproved: false,
    });
    let recoveredFirst = false;
    const replacement = await Worker.create({
      connection: native,
      taskQueue,
      workflowBundle: bundle,
      activities: {
        ...freshActivities,
        evaluationCase: async (ref) => {
          const result = await freshActivities.evaluationCase(ref);
          if (ref.ordinal === 0) {
            assert.equal(result.reused, true);
            recoveredFirst = true;
          }
          return result;
        },
      },
    });
    const result = await replacement.runUntil(() =>
      Promise.race([
        handle.result(),
        pause(180000, undefined, { ref: false }).then(() => {
          throw new Error('Evaluation workflow did not complete.');
        }),
      ]),
    );
    assert.deepEqual(result, { status: 'completed' });
    assert.equal(lost, true);
    assert.equal(
      recoveredFirst,
      true,
      'The replacement worker must recover the unacknowledged first case.',
    );
    assert.equal(getCalls(), before + 60, 'Activity retry must reuse the committed case result.');
    const saved = await store.get(manifest.experimentId);
    assert.equal(saved.status, 'completed');
    assert.equal(saved.results.length, 60);
    const runId = (await handle.describe()).runId;
    assert.equal(typeof runId, 'string');
    assert.ok(runId.length > 0);
    await engine.startPairedEvaluation(workflowId, ref);
    assert.equal(
      (await handle.describe()).runId,
      runId,
      'Dispatch retry after completion must not start another execution.',
    );
    assert.equal(getCalls(), before + 60);
    const history = await client.workflow.getHandle(workflowId).fetchHistory();
    assert.ok(
      history.events.some((event) => (event.activityTaskStartedEventAttributes?.attempt ?? 0) > 1),
    );
    await Worker.runReplayHistory({ workflowBundle: bundle }, history);
    process.stdout.write(
      'Temporal evaluation gate passed: actual workflow, replacement worker after lost acknowledgement, 60 calls without repeat, exact DB completion and deterministic history replay.\n',
    );
  } finally {
    if (firstRun) {
      if (firstWorker.getState() === 'RUNNING') firstWorker.shutdown();
      await firstRun.catch(() => undefined);
    }
    await engine.onModuleDestroy();
    await native?.close();
    await connection.close();
  }
}
import 'reflect-metadata';
