// Seeds the E2E workspace with the NFR-PERF-003 baseline volume for the load test (SRE-002):
// 1,000 projects, audit history and model invocations. Idempotent: it tops up to the target.
import { existsSync } from 'node:fs';
import pg from 'pg';

const localEnv = new URL('../../../.env', import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);
const databaseUrl = process.env.DATABASE_ADMIN_URL;
if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL is required to seed load data.');
const projects = Number(process.env.LOAD_PROJECTS ?? 1000);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const workspace = (await client.query(`select id from workspaces where lower(code) = 'e2e'`))
    .rows[0];
  const user = (
    await client.query(`select id from users where lower(email) = 'e2e-admin@example.test'`)
  ).rows[0];
  if (!workspace || !user) throw new Error('Run apps/web/e2e/prepare.mjs first.');
  await client.query('begin');
  await client.query(
    `insert into projects (workspace_id, code, title, initial_problem, status, created_by)
     select $1, 'load-' || n, 'Load project ' || n, 'Baseline volume project ' || n,
            (array['draft','active','paused','completed']::project_status[])[1 + n % 4], $2
       from generate_series(1, $3) as n
     on conflict do nothing`,
    [workspace.id, user.id, projects],
  );
  await client.query(
    `insert into audit_events (workspace_id, actor_id, action, target_type, target_id, project_id, reason, severity, correlation_id, occurred_at)
     select $1, $2, (array['project.create','project.update','document.edit','knowledge.audit'])[1 + n % 4], 'project', p.id, p.id,
            'Load seed', (array['info','info','warning','critical']::audit_severity[])[1 + n % 4], gen_random_uuid(),
            now() - (n || ' minutes')::interval
       from generate_series(1, $3 * 5) as n
       join lateral (select id from projects where workspace_id = $1 and code = 'load-' || (1 + n % $3)) p on true
      where not exists (select 1 from audit_events where workspace_id = $1 and reason = 'Load seed')`,
    [workspace.id, user.id, projects],
  );
  const connection = (
    await client.query(
      `insert into provider_connections (workspace_id, provider, name, status, created_by)
       select $1, 'fake', 'Load fake', 'configured', $2
        where not exists (select 1 from provider_connections where workspace_id = $1 and name = 'Load fake')
       returning id`,
      [workspace.id, user.id],
    )
  ).rows[0];
  if (connection) {
    await client.query(
      `insert into model_invocations (workspace_id, connection_id, project_id, provider, model, purpose, status, input_tokens,
                                      output_tokens, latency_ms, cost_usd, created_at)
       select $1, $2, p.id, 'fake', 'fake-standard', (array['analysis','research','solutions','evaluation'])[1 + n % 4],
              (array['succeeded','succeeded','succeeded','transient_failed']::invocation_status[])[1 + n % 4],
              500 + n % 700, 200 + n % 300, 100 + n % 900, 0.001 * (n % 7), now() - (n || ' minutes')::interval
         from generate_series(1, 2000) as n
         join lateral (select id from projects where workspace_id = $1 and code = 'load-' || (1 + n % $3)) p on true`,
      [workspace.id, connection.id, projects],
    );
  }
  await client.query('commit');
  const counts = await client.query(
    `select (select count(*) from projects where workspace_id = $1)::int as projects,
            (select count(*) from audit_events where workspace_id = $1)::int as audit_events,
            (select count(*) from model_invocations where workspace_id = $1)::int as invocations`,
    [workspace.id],
  );
  console.log(`Load data ready: ${JSON.stringify(counts.rows[0])}`);
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
