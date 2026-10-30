import { setTimeout as delay } from 'node:timers/promises';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../src/tokens.js';
import { afterAll, expect, it } from 'vitest';

import { AnalysisDriver } from './support/analysis.js';
import {
  adminUrl,
  createHarness,
  temporalAddress,
  type Harness,
  type TemporalTestRuntime,
} from './support/harness.js';

let h: Harness | undefined;
const children: ChildProcess[] = [];
afterAll(async () => {
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once('exit', () => resolve());
          child.send({ stop: true });
          const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
          timer.unref();
          child.once('exit', () => clearTimeout(timer));
        }),
    ),
  );
  await h?.close();
});
const p95 = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;

it.skipIf(!adminUrl || !temporalAddress)(
  '25 actual agent workflows share provider capacity across two workers with 1000 projects',
  async () => {
    h = await createHarness('agentload', { workflow: true });
    const harness = h;
    const temporal = harness.engine as TemporalTestRuntime;
    // The installed SDK permits one worker per queue/build in a process. Use two real OS
    // processes, matching horizontal replicas and giving each its own restricted PG pool.
    await temporal.stopWorker();
    const invocations: { started: bigint; completed: bigint }[] = [];
    const roundsByWorker = [0, 0];
    const workerPids = new Set<number>();
    await Promise.all(
      [0, 1].map(async (index) => {
        const child = fork(
          fileURLToPath(new URL('../scripts/agent-load-worker.mjs', import.meta.url)),
          [],
          {
            env: {
              ...process.env,
              DATABASE_URL: harness.app.get<Pool>(DATABASE_POOL).options.connectionString!,
              AGENT_LOAD_QUEUE: temporal.taskQueue,
              AGENT_LOAD_WORKER: String(index),
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          },
        );
        children.push(child);
        let diagnostic = '';
        const collect = (chunk: Buffer) => {
          diagnostic = (diagnostic + String(chunk)).slice(-4000);
        };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Agent load worker readiness timed out: ' + diagnostic)),
            30_000,
          );
          child.once('error', reject);
          child.once('exit', (code) => {
            clearTimeout(timer);
            if (code !== 0) reject(new Error('Agent load worker failed: ' + diagnostic));
          });
          child.on(
            'message',
            (message: { event?: string; pid?: number; started?: string; completed?: string }) => {
              if (message.event === 'ready') {
                clearTimeout(timer);
                workerPids.add(message.pid!);
                resolve();
              }
              if (message.event === 'analysis') roundsByWorker[index] = roundsByWorker[index]! + 1;
              if (message.event === 'invoke.interval') {
                invocations.push({
                  started: BigInt(message.started!),
                  completed: BigInt(message.completed!),
                });
              }
            },
          );
        });
      }),
    );
    expect(workerPids.size).toBe(2);
    const cookie = await harness.login(harness.emails.a);
    const api = (suffix: string) => `/v1/workspaces/${harness.ids.workspaceA}${suffix}`;
    const topic = await harness.request('POST', api('/topics'), {
      cookie,
      payload: { code: 'agent-load', title: 'Synthetic agent load' },
    });
    expect(topic.statusCode, topic.body).toBe(201);
    const topicId = topic.json<{ topic: { id: string } }>().topic.id;
    const configuredLimit = 2;
    const connection = await harness.request('POST', api('/provider-connections'), {
      cookie,
      payload: { provider: 'fake', name: 'Agent load', maxConcurrentInvocations: configuredLimit },
    });
    expect(connection.statusCode, connection.body).toBe(201);
    const connectionId = connection.json<{ connection: { id: string } }>().connection.id;
    for (const [key, value] of [
      ['ai.connection_id', connectionId],
      ['ai.model', 'fake-standard'],
    ] as const) {
      const response = await harness.request('PUT', api('/settings/assignments'), {
        cookie,
        payload: {
          key,
          value,
          scopeType: 'workspace',
          scopeId: harness.ids.workspaceA,
          reason: 'Synthetic agent load',
        },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    // Seed only the volume background; the25 measured workflows are created/activated via API.
    await harness.admin.query(
      `insert into projects(workspace_id,code,title,initial_problem,created_by)
       select $1,'volume-'||n,'Synthetic volume '||n,'Synthetic background only',$2
       from generate_series(1,975) n`,
      [harness.ids.workspaceA, harness.ids.userA],
    );
    const projects: { id: string; version: number }[] = [];
    for (let index = 0; index < 25; index++) {
      const response = await harness.request('POST', api('/projects'), {
        cookie,
        payload: {
          code: 'agent-' + index,
          title: 'Synthetic measured agent ' + index,
          initialProblem:
            'Understand repeat-customer churn using aggregate receipts and voluntary surveys.',
          topics: [{ topicId }],
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      projects.push(response.json<{ project: { id: string; version: number } }>().project);
    }
    const projectIds = projects.map((project) => project.id);
    const count = await harness.admin.query<{ count: number }>(
      'select count(*)::int as count from projects where workspace_id=$1',
      [harness.ids.workspaceA],
    );
    expect(count.rows[0]!.count).toBe(1000);
    const started = performance.now();
    const activationMs = await Promise.all(
      projects.map(async (project) => {
        const before = performance.now();
        const response = await harness.request('POST', api(`/projects/${project.id}/activate`), {
          cookie,
          payload: { expectedVersion: project.version },
        });
        expect(response.statusCode, response.body).toBe(200);
        return performance.now() - before;
      }),
    );
    expect(temporal.started).toHaveLength(25);
    const executions = await Promise.all(
      temporal.started.map((id) => temporal.client.workflow.getHandle(id).describe()),
    );
    expect(new Set(executions.map((execution) => execution.runId)).size).toBe(25);
    expect(executions.every((execution) => execution.status.name === 'RUNNING')).toBe(true);
    const readMs: number[] = [];
    const deadline = performance.now() + 60_000;
    let batches: { project_id: string; ready_ms: number }[] = [];
    while (performance.now() < deadline) {
      const before = performance.now();
      const response = await harness.request('GET', api('/projects'), { cookie });
      readMs.push(performance.now() - before);
      expect(response.statusCode, response.body).toBe(200);
      batches = (
        await harness.admin.query<{ project_id: string; ready_ms: number }>(
          `select b.project_id,extract(epoch from (b.created_at-r.created_at))*1000 as ready_ms
         from question_batches b join stage_runs s on s.id=b.stage_run_id join workflow_runs r on r.id=s.run_id
         where b.project_id=any($1::uuid[]) and b.status='open'`,
          [projectIds],
        )
      ).rows;
      if (batches.length === 25) break;
      await delay(100);
    }
    expect(batches).toHaveLength(25);
    const analysis = new AnalysisDriver(harness, cookie, harness.ids.workspaceA);
    for (const project of projects) {
      const view = await analysis.overview(project.id);
      expect(view.phase).toBe('answering');
      expect(view.progress.open).toBeGreaterThan(0);
      expect(view.progress.answered).toBe(0);
    }
    const ledger = (
      await harness.admin.query<{ project_id: string; stage_run_id: string; status: string }>(
        'select project_id,stage_run_id,status from model_invocations where connection_id=$1 order by created_at',
        [connectionId],
      )
    ).rows;
    expect(ledger).toHaveLength(25);
    expect(new Set(ledger.map((row) => row.project_id)).size).toBe(25);
    expect(new Set(ledger.map((row) => row.stage_run_id)).size).toBe(25);
    expect(ledger.every((row) => row.status === 'succeeded')).toBe(true);
    // IPC preserves order within one worker, not between workers. Count overlaps on the
    // shared monotonic clock so a delayed completion message cannot invent concurrency.
    await expect.poll(() => invocations.length).toBe(25);
    const events = invocations
      .flatMap(({ started, completed }) => [
        { time: started, delta: 1 },
        { time: completed, delta: -1 },
      ])
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.delta - b.delta));
    let active = 0;
    let peak = 0;
    for (const event of events) {
      active += event.delta;
      peak = Math.max(peak, active);
    }
    expect(active).toBe(0);
    expect(peak).toBe(configuredLimit);
    expect(roundsByWorker).toHaveLength(2);
    expect(roundsByWorker.every((calls) => calls > 0)).toBe(true);
    expect(roundsByWorker.reduce((sum, calls) => sum + calls, 0)).toBe(25);
    expect(
      (
        await harness.admin.query(
          'select id from provider_invocation_leases where connection_id=$1',
          [connectionId],
        )
      ).rowCount,
    ).toBe(0);
    expect(p95(readMs)).toBeLessThan(500);
    const readyMs = batches.map((batch) => Number(batch.ready_ms));
    expect(p95(readyMs)).toBeLessThan(60_000);
    process.stdout.write(
      JSON.stringify({
        test: 'actual-agent-load',
        provider: 'fake',
        projects: 1000,
        concurrentTemporalWorkflows: 25,
        actualAgentRounds: ledger.length,
        workers: 2,
        independentWorkerPools: 2,
        workerProcesses: workerPids.size,
        roundsByWorker: roundsByWorker,
        configuredProviderLimit: configuredLimit,
        maximumProviderCalls: peak,
        activationP95Ms: p95(activationMs),
        apiReadHandlerP95Ms: p95(readMs),
        apiReadSamples: readMs.length,
        firstQuestionBatchP95Ms: p95(readyMs),
        elapsedMs: performance.now() - started,
        slo: { readHandlerP95Ms: 500, firstQuestionBatchP95Ms: 60_000 },
        browserPageMeasurement: false,
        humanAnswersOrApprovals: 0,
      }) + '\n',
    );
  },
  120_000,
);
