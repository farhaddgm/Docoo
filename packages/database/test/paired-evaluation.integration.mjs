import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import {
  executePairedEvaluation,
  hashEvaluationSnapshotText,
  prepareEvaluationExperiment,
} from '@docoo/application';
import { evaluationCorpusV1 } from '../../domain/dist/paired-evaluation-entry.js';
import { PostgresEvaluationExecutionStore, setDatabaseRequestContext } from '../dist/src/index.js';

// This gate always creates its own database and login role; it never migrates a deployed database.
const envPath = new URL('../../../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);
if (!process.env.DATABASE_ADMIN_URL)
  throw new Error('DATABASE_ADMIN_URL is required for the local evaluation gate.');
const bootstrapUrl = new URL(process.env.DATABASE_ADMIN_URL);
if (
  !['postgres:', 'postgresql:'].includes(bootstrapUrl.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(bootstrapUrl.hostname) ||
  Number(bootstrapUrl.port || 5432) !== Number(process.env.POSTGRES_PORT || 5432) ||
  decodeURIComponent(bootstrapUrl.username) !== (process.env.POSTGRES_USER || 'docoo_admin')
) {
  throw new Error(
    'The evaluation gate requires this project’s loopback PostgreSQL admin connection.',
  );
}
bootstrapUrl.pathname = '/postgres';
const suffix = randomBytes(8).toString('hex');
const databaseName = `docoo_eval_${suffix}`;
const roleName = `docoo_eval_${suffix}`;
const rolePassword = randomBytes(24).toString('hex');
const poolClients = new WeakMap();
function createTrackedPool(options) {
  const pool = new Pool(options);
  const clients = new Set();
  poolClients.set(pool, clients);
  pool.on('connect', (client) => clients.add(client));
  pool.on('remove', (client) => clients.delete(client));
  return pool;
}
async function closePool(pool) {
  if (!pool) return;
  // pg-pool can resolve end() before Client's socket has actually closed.
  // Do not force-drop a database while those connections are still shutting down.
  const disconnected = [...poolClients.get(pool)].map(
    (client) => new Promise((resolve) => client.once('end', resolve)),
  );
  await pool.end();
  await Promise.all(disconnected);
}
const admin = createTrackedPool({
  connectionString: bootstrapUrl.toString(),
  max: 1,
  connectionTimeoutMillis: 5000,
});
let seededAdmin;
let runtime;
let databaseCreated = false;
let roleCreated = false;

function makeArm(runId, prompt) {
  const snapshots = {
    model: JSON.stringify({
      provider: 'deterministic',
      modelId: 'integration-fixture-v1',
      seed: 17,
    }),
    prompt,
    retrieval: '{"scope":"synthetic-only"}',
    rubric: '{"scale":[0,100]}',
    pricing: null,
  };
  return {
    runId,
    snapshots,
    configuration: {
      role: 'researcher',
      provider: 'deterministic',
      modelId: 'integration-fixture-v1',
      modelSnapshotHash: hashEvaluationSnapshotText(snapshots.model),
      promptHash: hashEvaluationSnapshotText(snapshots.prompt),
      retrievalHash: hashEvaluationSnapshotText(snapshots.retrieval),
      rubricHash: hashEvaluationSnapshotText(snapshots.rubric),
      pricingSnapshotHash: null,
    },
  };
}
function request(experimentId) {
  return {
    experimentId,
    repetition: 1,
    timeoutMs: 1000,
    dataset: evaluationCorpusV1,
    baseline: makeArm('baseline-01', 'Baseline production snapshot fixture.'),
    candidate: makeArm('candidate-01', 'Candidate production snapshot fixture.'),
  };
}

async function migrate(connectionString) {
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['--filter', '@docoo/database', 'db:migrate'], {
      cwd: new URL('../../../', import.meta.url),
      env: { ...process.env, DATABASE_ADMIN_URL: connectionString },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Disposable evaluation migration failed.')),
    );
  });
}

try {
  const info = (
    await admin.query(`select current_setting('server_version_num')::int as version, rolsuper
    from pg_roles where rolname=current_user`)
  ).rows[0];
  assert.ok(
    info.rolsuper && info.version >= 180000 && info.version < 190000,
    'PostgreSQL 18 superuser required',
  );
  await admin.query(`create database ${databaseName}`);
  databaseCreated = true;
  const adminUrl = new URL(bootstrapUrl);
  adminUrl.pathname = `/${databaseName}`;
  await migrate(adminUrl.toString());
  await admin.query(`create role ${roleName} login password '${rolePassword}' in role docoo_app`);
  roleCreated = true;
  seededAdmin = createTrackedPool({ connectionString: adminUrl.toString(), max: 1 });
  const runtimeUrl = new URL(adminUrl);
  runtimeUrl.username = roleName;
  runtimeUrl.password = rolePassword;
  runtime = createTrackedPool({ connectionString: runtimeUrl.toString(), max: 4 });
  const [wid, foreignWid, actor, foreignActor, reviewer, viewer, pid, foreignPid] = Array.from(
    { length: 8 },
    () => randomUUID(),
  );
  await seededAdmin.query(
    `insert into users (id,email,display_name,account_role) values
    ($1,'owner@example.test','Owner','super_admin'),($2,'foreign@example.test','Foreign','super_admin'),
    ($3,'reviewer@example.test','Reviewer','editor'),($4,'viewer@example.test','Viewer','viewer')`,
    [actor, foreignActor, reviewer, viewer],
  );
  await seededAdmin.query(
    `insert into workspaces (id,code,name) values ($1,'eval-a','Evaluation A'),($2,'eval-b','Evaluation B')`,
    [wid, foreignWid],
  );
  await seededAdmin.query(
    `insert into memberships (workspace_id,user_id,role) values
    ($1,$2,'super_admin'),($3,$4,'super_admin'),($1,$5,'editor'),($1,$6,'viewer')`,
    [wid, actor, foreignWid, foreignActor, reviewer, viewer],
  );
  await seededAdmin.query(
    `insert into projects (id,workspace_id,code,title,initial_problem,created_by)
    values ($1,$2,'EVAL-A','Evaluation A','Synthetic fixture',$3),($4,$5,'EVAL-B','Evaluation B','Foreign fixture',$6)`,
    [pid, wid, actor, foreignPid, foreignWid, foreignActor],
  );
  await seededAdmin.query(
    `insert into resource_access (workspace_id,user_id,kind,resource_id,access,granted_by)
    values ($1,$2,'project',$3,'EDIT',$4),($1,$5,'project',$3,'VIEW',$4)`,
    [wid, reviewer, pid, actor, viewer],
  );
  const context = (workspaceId, actorId) => ({ workspaceId, actorId, correlationId: randomUUID() });
  const store = new PostgresEvaluationExecutionStore(runtime, context(wid, actor), pid);
  let calls = 0;
  const adapter = {
    execute: async ({ arm, testCase }) => {
      calls++;
      return {
        provider: arm.configuration.provider,
        modelId: arm.configuration.modelId,
        output: `Synthetic integration output ${arm.runId} / ${testCase.id}`,
        inputTokens: 14,
        outputTokens: 9,
        costUsd: null,
      };
    },
  };
  const run = await executePairedEvaluation(request('persisted-01'), {
    store,
    adapter,
    signal: new AbortController().signal,
  });
  assert.equal(calls, 60);
  assert.equal(run.status, 'completed');
  // New store and connection read all results back after the execution process could have exited.
  const reloaded = await new PostgresEvaluationExecutionStore(
    runtime,
    context(wid, actor),
    pid,
  ).get('persisted-01');
  assert.deepEqual(reloaded, run);
  await assert.rejects(
    executePairedEvaluation(request('persisted-01'), {
      store,
      adapter,
      signal: new AbortController().signal,
    }),
    { code: '23505' },
  );
  assert.equal(calls, 60, 'duplicate manifest must fail before invoking a model');
  const viewStore = new PostgresEvaluationExecutionStore(runtime, context(wid, viewer), pid);
  assert.equal((await viewStore.get('persisted-01')).results.length, 60);
  await assert.rejects(viewStore.create(prepareEvaluationExperiment(request('viewer-forbidden'))), {
    code: '42501',
  });
  await seededAdmin.query("update resource_access set access='EDIT' where user_id=$1", [viewer]);
  await assert.rejects(
    viewStore.create(prepareEvaluationExperiment(request('viewer-edit-forbidden'))),
    { code: '42501' },
  );
  await assert.rejects(
    new PostgresEvaluationExecutionStore(runtime, context(foreignWid, foreignActor), pid).get(
      'persisted-01',
    ),
    /NOT_FOUND/,
  );
  await assert.rejects(
    new PostgresEvaluationExecutionStore(runtime, context(wid, foreignActor), pid).get(
      'persisted-01',
    ),
    /NOT_FOUND/,
  );
  await assert.rejects(
    new PostgresEvaluationExecutionStore(runtime, context(wid, actor), foreignPid).get(
      'persisted-01',
    ),
    /NOT_FOUND/,
  );
  const humanReview = {
    experimentHash: run.manifest.contentHash,
    rubricHash: run.manifest.baseline.configuration.rubricHash,
    reviewerId: reviewer,
    reviewedAt: '2026-10-16T12:00:00.000Z',
    ratings: run.results.map((result) => ({
      runId: result.runId,
      caseId: result.caseId,
      outputHash: result.outputHash,
      humanScore: 80,
      humanAccepted: true,
      judgeAccepted: null,
      citationErrors: 0,
    })),
  };
  const reviewStore = new PostgresEvaluationExecutionStore(runtime, context(wid, reviewer), pid);
  const comparison = await reviewStore.review('persisted-01', humanReview);
  assert.equal(comparison.comparison.metrics.fa.caseCount, 15);
  assert.equal(comparison.comparison.metrics.en.caseCount, 15);
  assert.equal(comparison.comparison.metrics.all.cost.candidateMinusBaselineUsd, null);
  assert.equal(comparison.id, (await reviewStore.review('persisted-01', humanReview)).id);
  assert.equal(
    comparison.id,
    (
      await reviewStore.review('persisted-01', {
        ...humanReview,
        ratings: [...humanReview.ratings].reverse(),
      })
    ).id,
    'review ordering must not create another review',
  );
  await assert.rejects(store.review('persisted-01', humanReview), /REVIEWER_MISMATCH/);
  await assert.rejects(viewStore.review('persisted-01', { ...humanReview, reviewerId: viewer }), {
    code: 'REVIEW_FORBIDDEN',
  });
  await assert.rejects(store.append(run.results[0]), /NOT_RUNNING/);
  await assert.rejects(store.finish('persisted-01', 'cancelled'), /INVALID_TRANSITION/);
  const unfinished = prepareEvaluationExperiment(request('unfinished-01'));
  await store.create(unfinished);
  await assert.rejects(store.finish('unfinished-01', 'completed'), /INVALID_TRANSITION/);
  const startRequestHash = createHash('sha256').update('fixed-start-body').digest('hex');
  const startStore = new PostgresEvaluationExecutionStore(runtime, context(wid, actor), pid);
  const enqueued = await startStore.enqueue(
    prepareEvaluationExperiment(request('outbox-01')),
    'start-command-0001',
    startRequestHash,
  );
  assert.deepEqual(enqueued, {
    experimentId: 'outbox-01',
    state: 'pending',
    replayed: false,
  });
  assert.deepEqual(await startStore.findStartCommand('start-command-0001', startRequestHash), {
    experimentId: 'outbox-01',
    state: 'pending',
    replayed: true,
  });
  await assert.rejects(
    startStore.findStartCommand('start-command-0001', 'f'.repeat(64)),
    /IDEMPOTENCY_CONFLICT/,
  );
  const claim = await runtime.query('select * from app.claim_evaluation_start()');
  assert.deepEqual(claim.rows[0], {
    workspace_id: wid,
    project_id: pid,
    experiment_id: 'outbox-01',
    actor_id: actor,
  });
  assert.equal((await runtime.query('select * from app.claim_evaluation_start()')).rowCount, 0);
  await startStore.completeStartDelivery('outbox-01');
  assert.deepEqual(await startStore.findStartCommand('start-command-0001', startRequestHash), {
    experimentId: 'outbox-01',
    state: 'started',
    replayed: true,
  });
  assert.equal((await runtime.query('select * from app.claim_evaluation_start()')).rowCount, 0);
  // A provider failure is durable and cannot become a successful quality report.
  const failed = await executePairedEvaluation(request('failed-01'), {
    store,
    adapter: {
      execute: async () => {
        throw new Error('private-api-key-detail');
      },
    },
    signal: new AbortController().signal,
  });
  assert.equal(failed.status, 'failed');
  assert.equal((await store.get('failed-01')).results[0].errorCode, 'provider_failure');
  await assert.rejects(store.review('failed-01', humanReview), /INVALID_TRANSITION/);
  const queryAs = async (workspaceId, actorId, query, params) => {
    const client = await runtime.connect();
    try {
      await client.query('begin');
      await setDatabaseRequestContext(client, context(workspaceId, actorId));
      const result = await client.query(query, params);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  };
  const callsBeforeInterruption = calls;
  await assert.rejects(
    executePairedEvaluation(request('interrupted-01'), {
      adapter,
      signal: new AbortController().signal,
      store: {
        create: (manifest) => store.create(manifest),
        append: async (result) => {
          await store.append(result);
          throw new Error('simulated-process-stop');
        },
        finish: (id, status) => store.finish(id, status),
      },
    }),
    /simulated-process-stop/,
  );
  assert.equal(
    calls,
    callsBeforeInterruption + 1,
    'no call may follow an unacknowledged storage result',
  );
  const interrupted = await new PostgresEvaluationExecutionStore(
    runtime,
    context(wid, actor),
    pid,
  ).get('interrupted-01');
  assert.equal(interrupted.status, 'running');
  assert.equal(interrupted.results.length, 1, 'a committed prefix survives interruption');
  await assert.rejects(store.append(interrupted.results[0]), /OUT_OF_ORDER/);
  await assert.rejects(
    queryAs(
      wid,
      actor,
      `insert into project_evaluation_case_results (workspace_id,project_id,experiment_id,ordinal,result_json)
      values ($1,$2,'interrupted-01',2,$3::jsonb)`,
      [wid, pid, JSON.stringify(interrupted.results[0])],
    ),
    /out of order/,
  );
  await assert.rejects(
    queryAs(
      wid,
      actor,
      `insert into project_evaluation_case_results (workspace_id,project_id,experiment_id,ordinal,result_json)
      values ($1,$2,'interrupted-01',1,$3::jsonb)`,
      [wid, pid, JSON.stringify(interrupted.results[0])],
    ),
    /scope mismatch/,
  );
  await assert.rejects(
    executePairedEvaluation(request('interrupted-01'), {
      store,
      adapter,
      signal: new AbortController().signal,
    }),
    { code: '23505' },
  );
  assert.equal(
    calls,
    callsBeforeInterruption + 1,
    'an interrupted experiment must not be blindly replayed',
  );
  await store.finish('interrupted-01', 'cancelled');
  await assert.rejects(
    queryAs(
      wid,
      actor,
      `update project_evaluation_case_results set result_json='{}' where workspace_id=$1`,
      [wid],
    ),
    { code: '42501' },
  );
  await assert.rejects(
    queryAs(wid, actor, `delete from project_evaluation_experiments where workspace_id=$1`, [wid]),
    { code: '42501' },
  );
  await assert.rejects(
    queryAs(
      wid,
      actor,
      `update project_evaluation_experiments set status='cancelled' where workspace_id=$1 and experiment_id='persisted-01'`,
      [wid],
    ),
    /immutable/,
  );
  const audit = await seededAdmin.query(
    `select "after" from audit_events where action like 'project.evaluation_experiment.%'`,
  );
  assert.ok(audit.rows.length >= 5);
  assert.ok(!JSON.stringify(audit.rows).includes('Synthetic integration output'));
  assert.ok(!JSON.stringify(audit.rows).includes('private-api-key-detail'));
  if (process.argv.includes('--with-api')) {
    const { verifyEvaluationLabHttp } =
      await import('../../../apps/api/test/evaluation-lab.http.integration.mjs');
    await verifyEvaluationLabHttp({
      pool: runtime,
      admin: seededAdmin,
      workspaceId: wid,
      projectId: pid,
      actorId: actor,
      reviewerId: reviewer,
      viewerId: viewer,
      foreignWorkspaceId: foreignWid,
      foreignActorId: foreignActor,
    });
    const { verifyEvaluationProviderDatabase } =
      await import('../../../apps/api/test/evaluation-provider.database.integration.mjs');
    await verifyEvaluationProviderDatabase({
      pool: runtime,
      admin: seededAdmin,
      workspaceId: wid,
      projectId: pid,
      actorId: actor,
      reviewerId: reviewer,
      viewerId: viewer,
      foreignWorkspaceId: foreignWid,
      foreignActorId: foreignActor,
    });
  }
  // Revoking the project grant also revokes stored outputs and comparisons immediately.
  await seededAdmin.query('delete from resource_access where user_id=$1', [reviewer]);
  await assert.rejects(reviewStore.get('persisted-01'), /NOT_FOUND/);
  process.stdout.write(
    'Paired evaluation PostgreSQL gate passed: 60 persisted calls, exact reload, human review, idempotency, isolation, VIEW/EDIT, revocation and immutable history. Synthetic labels only; no live provider called.\n',
  );
} finally {
  await closePool(runtime);
  await closePool(seededAdmin);
  if (databaseCreated) await admin.query(`drop database ${databaseName}`);
  if (roleCreated) await admin.query(`drop role ${roleName}`);
  await closePool(admin);
}
