import { hash } from '@node-rs/argon2';
import { existsSync } from 'node:fs';
import pg from 'pg';

// Seeds the E2E administrator and workspace in an already migrated database. Idempotent.
const localEnv = new URL('../../../.env', import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const databaseUrl = process.env.DATABASE_ADMIN_URL;
const email = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password-1';
if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL is required to prepare E2E data.');

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query('begin');
  const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const user = await client.query(
    `insert into users (email, password_hash, display_name)
     values ($1, $2, 'E2E Admin')
     on conflict ((lower(email))) do update
       set password_hash = excluded.password_hash, status = 'active',
           failed_login_count = 0, locked_until = null
     returning id`,
    [email, passwordHash],
  );
  const workspace = await client.query(
    `insert into workspaces (code, name) values ('e2e', 'E2E Workspace')
     on conflict ((lower(code))) do update set name = excluded.name
     returning id`,
  );
  await client.query(
    `insert into memberships (workspace_id, user_id) values ($1, $2) on conflict do nothing`,
    [workspace.rows[0].id, user.rows[0].id],
  );
  // Two audit events for the audit explorer test; audit is append-only, so seed them once.
  const seeded = await client.query(
    `select 1 from audit_events where workspace_id = $1 and reason = 'E2E seed' limit 1`,
    [workspace.rows[0].id],
  );
  if (!seeded.rowCount) {
    await client.query(
      `insert into audit_events (workspace_id, actor_id, action, target_type, reason, severity, security_relevant, correlation_id)
       values ($1, $2, 'project.create', 'project', 'E2E seed', 'info', false, gen_random_uuid()),
              ($1, $2, 'knowledge.override', 'audit_review', 'E2E seed', 'critical', true, gen_random_uuid())`,
      [workspace.rows[0].id, user.rows[0].id],
    );
  }
  // The stages of the E2E flows run without waiting for a confirmation of the deliverables plan
  // (ADR-0031) or the research plan (ADR-0038) and without web search (ADR-0026); all are covered
  // by the API integration suites.
  for (const key of [
    'workflow.require_deliverable_confirmation',
    'workflow.require_research_plan_confirmation',
    'research.web_enabled',
  ]) {
    await client.query(
      `insert into config_assignments (workspace_id, setting_key, scope_type, scope_id, sequence, value, reason, created_by)
       select $1, $3, 'workspace', $1, 1, 'false'::jsonb, 'E2E flows run without this extra step', $2
        where not exists (select 1 from config_assignments
                           where workspace_id = $1 and setting_key = $3 and scope_type = 'workspace')`,
      [workspace.rows[0].id, user.rows[0].id, key],
    );
  }
  // A draft knowledge item that has waited ten days for its audit: the Brain page test finds it
  // (ADR-0033) and an administrator audits it from there. A fresh one is added once none is left.
  const waiting = await client.query(
    `select 1 from knowledge_items i join knowledge_versions v on v.id = i.current_version_id
      where i.workspace_id = $1 and i.title like 'E2E Brain waiting draft%' and v.status = 'draft' limit 1`,
    [workspace.rows[0].id],
  );
  if (!waiting.rowCount) {
    const content = 'Seeded note that waits for its audit on the Brain page.';
    const item = await client.query(
      `insert into knowledge_items (workspace_id, title, source_type, created_by)
       values ($1, $2, 'admin_provided', $3) returning id`,
      [workspace.rows[0].id, `E2E Brain waiting draft ${Date.now().toString(36)}`, user.rows[0].id],
    );
    const version = await client.query(
      `insert into knowledge_versions (workspace_id, item_id, version_no, status, content, content_sha256, language,
                                       provenance, created_by, created_at)
       values ($1, $2, 1, 'draft', $3, md5($3), 'en', '{"declaration":"E2E seed"}'::jsonb, $4, now() - interval '10 days')
       returning id`,
      [workspace.rows[0].id, item.rows[0].id, content, user.rows[0].id],
    );
    await client.query('update knowledge_items set current_version_id = $2 where id = $1', [
      item.rows[0].id,
      version.rows[0].id,
    ]);
    await client.query(
      `insert into knowledge_scopes (workspace_id, item_id, scope_type, scope_id) values ($1, $2, 'workspace', $1)`,
      [workspace.rows[0].id, item.rows[0].id],
    );
    await client.query(
      `insert into claims (workspace_id, knowledge_version_id, ordinal, text, normalized_text, kind, locator)
       values ($1, $2, 0, $3, lower($3), 'recommendation', '{}'::jsonb)`,
      [workspace.rows[0].id, version.rows[0].id, content],
    );
  }
  await client.query(
    'update sessions set revoked_at = now() where user_id = $1 and revoked_at is null',
    [user.rows[0].id],
  );
  await client.query('commit');
  console.log(`E2E administrator ready: ${email}`);
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}

// With an object store configured the API can take uploads; make sure its bucket exists.
if (process.env.S3_ENDPOINT) {
  const { S3ObjectStore, s3ConfigFromEnv } = await import(
    new URL('../../../packages/ingestion/dist/index.js', import.meta.url).href
  );
  await new S3ObjectStore(s3ConfigFromEnv(process.env)).ensureBucket();
  console.log(`E2E object store ready: ${process.env.S3_BUCKET}`);
}
