// Only the isolated load integration test starts this process. No production configuration.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { NativeConnection, Worker } from '@temporalio/worker';
import { Context } from '@temporalio/activity';
import { FakeAdapter } from '@docoo/providers';
import {
  ProviderRuntime,
  createOrchestrationActivities,
  fakeResponder,
  fakeToolResponder,
} from '@docoo/orchestration';

assert.equal(process.env.NODE_ENV, 'test');
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/docoo_ci');
assert.match(process.env.AGENT_LOAD_QUEUE, /^docoo\.agent-test-[a-f0-9]+$/u);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const privilege = (
  await pool.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user')
).rows[0];
assert.equal(privilege.rolsuper, false);
assert.equal(privilege.rolbypassrls, false);
const fake = new FakeAdapter();
fake.responder = fakeResponder;
fake.toolResponder = fakeToolResponder;
const runtime = new ProviderRuntime(
  pool,
  null,
  (kind) => {
    assert.equal(kind, 'fake', 'This CI worker must never call a paid provider.');
    return {
      kind: 'fake',
      listModels: () => fake.listModels(),
      healthCheck: () => fake.healthCheck(),
      invoke: async (request) => {
        process.send({ event: 'invoke.started' });
        try {
          await delay(120);
          return await fake.invoke(request);
        } finally {
          process.send({ event: 'invoke.completed' });
        }
      },
    };
  },
  { cancellationSignal: () => Context.current().cancellationSignal },
);
const activities = createOrchestrationActivities(pool, runtime, { delayScale: 0.002 });
const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
const worker = await Worker.create({
  connection,
  identity: 'isolated-agent-load-' + process.env.AGENT_LOAD_WORKER,
  taskQueue: process.env.AGENT_LOAD_QUEUE,
  maxConcurrentActivityTaskExecutions: 16,
  workflowsPath: fileURLToPath(import.meta.resolve('@docoo/orchestration/workflows')),
  activities: {
    ...activities,
    runAnalysisRound: async (ref) => {
      process.send({ event: 'analysis' });
      return activities.runAnalysisRound(ref);
    },
  },
});
process.on('message', (message) => {
  if (message?.stop) worker.shutdown();
});
const running = worker.run();
process.send({ event: 'ready', pid: process.pid });
try {
  await running;
} finally {
  await connection.close();
  await pool.end();
  process.disconnect();
}
