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
