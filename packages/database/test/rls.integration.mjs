import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import pg from 'pg';

// Run only on a disposable PostgreSQL 18 database named docoo_ci:
// DATABASE_ADMIN_URL=postgresql://.../docoo_ci pnpm db:migrate
// DATABASE_TEST_ADMIN_URL=postgresql://.../docoo_ci pnpm db:test:rls
const adminUrl = process.env['DATABASE_TEST_ADMIN_URL'];
if (!adminUrl) {
  throw new Error('DATABASE_TEST_ADMIN_URL is required for the RLS integration gate.');
}

const parsedUrl = new URL(adminUrl);
if (
  !['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
  parsedUrl.pathname !== '/docoo_ci'
) {
  throw new Error('The RLS integration gate requires a disposable database named docoo_ci.');
}

const { Client } = pg;
const admin = new Client({ connectionString: adminUrl });
let runtime;
let roleCreated = false;
let adminConnected = false;
const roleName = `docoo_rls_${randomBytes(8).toString('hex')}`;
const rolePassword = randomBytes(24).toString('hex');

const ids = {
  workspaceA: randomUUID(),
  workspaceB: randomUUID(),
  actorA: randomUUID(),
  actorB: randomUUID(),
  topicA: randomUUID(),
  topicB: randomUUID(),
  projectA: randomUUID(),
  projectB: randomUUID(),
  auditA: randomUUID(),
  auditB: randomUUID(),
  authEvent: randomUUID(),
};

async function withContext(workspaceId, actorId, action) {
  await runtime.query('BEGIN');
  try {
    if (workspaceId !== null) {
      await runtime.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    }
    if (actorId !== null) {
      await runtime.query("SELECT set_config('app.actor_id', $1, true)", [actorId]);
    }
    const result = await action();
    await runtime.query('COMMIT');
    return result;
  } catch (error) {
    await runtime.query('ROLLBACK');
    throw error;
  }
}

async function expectSqlState(code, workspaceId, actorId, sql, params = []) {
  await assert.rejects(
    withContext(workspaceId, actorId, () => runtime.query(sql, params)),
    (error) => {
      assert.equal(error.code, code, `${sql}: unexpected SQLSTATE`);
      return true;
    },
  );
}

try {
  await admin.connect();
  adminConnected = true;

  const environment = await admin.query(`
    SELECT current_database() AS database_name,
           current_setting('server_version_num')::int AS server_version,
           r.rolsuper AS is_superuser
      FROM pg_roles r
     WHERE r.rolname = current_user
  `);
  assert.equal(environment.rows[0].database_name, 'docoo_ci');
  assert.ok(
    environment.rows[0].server_version >= 180000 && environment.rows[0].server_version < 190000,
    'The RLS integration gate requires PostgreSQL 18.',
  );
  assert.equal(environment.rows[0].is_superuser, true, 'Fixture setup needs a test superuser.');

  const policies = await admin.query(
    `
    SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
     WHERE relnamespace = 'public'::regnamespace
       AND relname = ANY($1::text[])
  `,
    [['workspaces', 'memberships', 'topics', 'projects', 'project_topics', 'audit_events']],
  );
  assert.equal(policies.rowCount, 6, 'Every tenant table must exist after migration.');
  for (const policy of policies.rows) {
    assert.equal(policy.relrowsecurity, true, `${policy.relname}: RLS is disabled`);
    assert.equal(policy.relforcerowsecurity, true, `${policy.relname}: FORCE RLS is disabled`);
  }

  const roleSql = await admin.query(
    "SELECT format('CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text, $2::text) AS sql",
    [roleName, rolePassword],
  );
  await admin.query(roleSql.rows[0].sql);
  roleCreated = true;
  await admin.query(`GRANT docoo_app TO ${roleName}`);

  const runtimeUrl = new URL(adminUrl);
  runtimeUrl.username = roleName;
  runtimeUrl.password = rolePassword;
  runtime = new Client({ connectionString: runtimeUrl.toString() });
  await runtime.connect();

  const runtimeRole = await runtime.query(`
    SELECT current_user AS role_name, r.rolsuper, r.rolbypassrls,
           row_security_active('public.topics'::regclass) AS rls_active
      FROM pg_roles r
     WHERE r.rolname = current_user
  `);
  assert.equal(runtimeRole.rows[0].role_name, roleName);
  assert.equal(runtimeRole.rows[0].rolsuper, false);
  assert.equal(runtimeRole.rows[0].rolbypassrls, false);
  assert.equal(runtimeRole.rows[0].rls_active, true);

  await admin.query('BEGIN');
  try {
    const suffix = randomBytes(5).toString('hex');
    await admin.query(
      'INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
      [
        ids.actorA,
        `a-${suffix}@example.test`,
        'test-only',
        'A',
        ids.actorB,
        `b-${suffix}@example.test`,
        'test-only',
        'B',
      ],
    );
    await admin.query('INSERT INTO workspaces (id, code, name) VALUES ($1, $2, $3), ($4, $5, $6)', [
      ids.workspaceA,
      `a-${suffix}`,
      'Workspace A',
      ids.workspaceB,
      `b-${suffix}`,
      'Workspace B',
    ]);
    await admin.query('INSERT INTO memberships (workspace_id, user_id) VALUES ($1, $2), ($3, $4)', [
      ids.workspaceA,
      ids.actorA,
      ids.workspaceB,
      ids.actorB,
    ]);
    await admin.query(
      'INSERT INTO topics (id, workspace_id, code, title) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
      [
        ids.topicA,
        ids.workspaceA,
        `a-${suffix}`,
        'Topic A',
        ids.topicB,
        ids.workspaceB,
        `b-${suffix}`,
        'Topic B',
      ],
    );
    await admin.query(
      'INSERT INTO projects (id, workspace_id, code, title, initial_problem) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [
        ids.projectA,
        ids.workspaceA,
        `a-${suffix}`,
        'Project A',
        'Problem A',
        ids.projectB,
        ids.workspaceB,
        `b-${suffix}`,
        'Project B',
        'Problem B',
      ],
    );
    await admin.query(
      'INSERT INTO project_topics (workspace_id, project_id, topic_id, priority) VALUES ($1, $2, $3, 1), ($4, $5, $6, 1)',
      [ids.workspaceA, ids.projectA, ids.topicA, ids.workspaceB, ids.projectB, ids.topicB],
    );
    await admin.query(
      'INSERT INTO audit_events (id, workspace_id, actor_id, action, target_type, correlation_id) VALUES ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)',
      [
        ids.auditA,
        ids.workspaceA,
        ids.actorA,
        'test.created',
        'topic',
        randomUUID(),
        ids.auditB,
        ids.workspaceB,
        ids.actorB,
        'test.created',
        'topic',
        randomUUID(),
      ],
    );
    await admin.query(
      'INSERT INTO auth_events (id, actor_id, action, identifier_digest, correlation_id) VALUES ($1, $2, $3, $4, $5)',
      [ids.authEvent, ids.actorA, 'login.succeeded', 'test-only', randomUUID()],
    );
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }

  const tenantTables = [
    ['workspaces', 'id', ids.workspaceA, ids.workspaceB],
    ['memberships', 'workspace_id', ids.workspaceA, ids.workspaceB],
    ['topics', 'id', ids.topicA, ids.topicB],
    ['projects', 'id', ids.projectA, ids.projectB],
    ['project_topics', 'project_id', ids.projectA, ids.projectB],
    ['audit_events', 'id', ids.auditA, ids.auditB],
  ];
  for (const [table, idColumn, expectedA, expectedB] of tenantTables) {
    const withoutContext = await withContext(null, null, () =>
      runtime.query(`SELECT ${idColumn}::text AS id FROM ${table}`),
    );
    assert.deepEqual(withoutContext.rows, [], `${table}: missing context exposed data`);

    const rowsA = await withContext(ids.workspaceA, ids.actorA, () =>
      runtime.query(`SELECT ${idColumn}::text AS id FROM ${table}`),
    );
    assert.deepEqual(
      rowsA.rows.map((row) => row.id),
      [expectedA],
      `${table}: tenant A saw another tenant`,
    );

    const rowsB = await withContext(ids.workspaceB, ids.actorB, () =>
      runtime.query(`SELECT ${idColumn}::text AS id FROM ${table}`),
    );
    assert.deepEqual(
      rowsB.rows.map((row) => row.id),
      [expectedB],
      `${table}: tenant B saw another tenant`,
    );
  }

  const hiddenUpdate = await withContext(ids.workspaceA, ids.actorA, () =>
    runtime.query('UPDATE topics SET title = $1 WHERE id = $2 RETURNING id', [
      'Intrusion',
      ids.topicB,
    ]),
  );
  assert.equal(hiddenUpdate.rowCount, 0, 'A cross-tenant update must affect no rows.');

  const hiddenDelete = await withContext(ids.workspaceA, ids.actorA, () =>
    runtime.query('DELETE FROM topics WHERE id = $1 RETURNING id', [ids.topicB]),
  );
  assert.equal(hiddenDelete.rowCount, 0, 'A cross-tenant delete must affect no rows.');

  await expectSqlState(
    '42501',
    null,
    null,
    'INSERT INTO topics (workspace_id, code, title) VALUES ($1, $2, $3)',
    [ids.workspaceA, `no-context-${randomUUID()}`, 'No context'],
  );
  await expectSqlState(
    '42501',
    ids.workspaceA,
    ids.actorA,
    'INSERT INTO topics (workspace_id, code, title) VALUES ($1, $2, $3)',
    [ids.workspaceB, `cross-tenant-${randomUUID()}`, 'Cross tenant'],
  );
  await expectSqlState(
    '42501',
    ids.workspaceA,
    ids.actorA,
    'UPDATE topics SET workspace_id = $1 WHERE id = $2',
    [ids.workspaceB, ids.topicA],
  );
  await expectSqlState(
    '23503',
    ids.workspaceA,
    ids.actorA,
    'INSERT INTO project_topics (workspace_id, project_id, topic_id, priority) VALUES ($1, $2, $3, 2)',
    [ids.workspaceA, ids.projectA, ids.topicB],
  );
  await expectSqlState(
    '42501',
    ids.workspaceA,
    ids.actorA,
    'INSERT INTO audit_events (workspace_id, actor_id, action, target_type, correlation_id) VALUES ($1, $2, $3, $4, $5)',
    [ids.workspaceA, ids.actorB, 'test.invalid', 'topic', randomUUID()],
  );

  const actorAWorkspaces = await withContext(null, ids.actorA, () =>
    runtime.query('SELECT id::text AS id FROM app.auth_user_workspaces()'),
  );
  assert.deepEqual(
    actorAWorkspaces.rows.map((row) => row.id),
    [ids.workspaceA],
  );
  const actorBWorkspaces = await withContext(null, ids.actorB, () =>
    runtime.query('SELECT id::text AS id FROM app.auth_user_workspaces()'),
  );
  assert.deepEqual(
    actorBWorkspaces.rows.map((row) => row.id),
    [ids.workspaceB],
  );
  const anonymousWorkspaces = await withContext(null, null, () =>
    runtime.query('SELECT id::text AS id FROM app.auth_user_workspaces()'),
  );
  assert.deepEqual(anonymousWorkspaces.rows, []);

  await expectSqlState('42501', null, null, 'SELECT id FROM auth_events');
  await expectSqlState(
    '42501',
    ids.workspaceA,
    ids.actorA,
    'UPDATE audit_events SET action = $1 WHERE id = $2',
    ['test.invalid', ids.auditA],
  );
  await assert.rejects(
    admin.query('DELETE FROM audit_events WHERE id = $1', [ids.auditA]),
    (error) => {
      assert.equal(error.code, 'P0001');
      return true;
    },
  );
  await assert.rejects(
    admin.query('DELETE FROM auth_events WHERE id = $1', [ids.authEvent]),
    (error) => {
      assert.equal(error.code, 'P0001');
      return true;
    },
  );

  console.log(
    'RLS integration passed: PostgreSQL 18 migration, tenant reads/writes, link integrity, audit, and auth workspace lookup.',
  );
} finally {
  if (runtime) {
    await runtime.end();
  }
  if (adminConnected) {
    if (roleCreated) {
      await admin.query(`DROP ROLE ${roleName}`);
    }
    await admin.end();
  }
}
