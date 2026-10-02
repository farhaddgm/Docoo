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
  versionA: randomUUID(),
  versionB: randomUUID(),
  assignmentA: randomUUID(),
  assignmentB: randomUUID(),
  snapshotA: randomUUID(),
  snapshotB: randomUUID(),
  authEvent: randomUUID(),
  itemA: randomUUID(),
  itemB: randomUUID(),
  knowledgeVersionA: randomUUID(),
  knowledgeVersionB: randomUUID(),
  claimA: randomUUID(),
  reviewA: randomUUID(),
};

const knowledgeTables = [
  'source_assets',
  'source_versions',
  'source_segments',
  'knowledge_items',
  'knowledge_scopes',
  'knowledge_versions',
  'claims',
  'citations',
  'audit_reviews',
  'audit_overrides',
  'knowledge_conflicts',
  'knowledge_chunks',
  'retrieval_snapshots',
];

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
    [
      [
        'workspaces',
        'memberships',
        'topics',
        'projects',
        'project_topics',
        'audit_events',
        'topic_versions',
        'config_assignments',
        'config_snapshots',
      ],
    ],
  );
  assert.equal(policies.rowCount, 9, 'Every tenant table must exist after migration.');
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
      `INSERT INTO topic_versions (id, workspace_id, topic_id, version, code, title, description, language)
       VALUES ($1, $2, $3, 1, 'a', 'Topic A', '', 'fa'), ($4, $5, $6, 1, 'b', 'Topic B', '', 'fa')`,
      [ids.versionA, ids.workspaceA, ids.topicA, ids.versionB, ids.workspaceB, ids.topicB],
    );
    await admin.query(
      `INSERT INTO config_assignments (id, workspace_id, setting_key, scope_type, scope_id, sequence, value, reason)
       VALUES ($1, $2, 'research.max_sources', 'workspace', $2, 1, '10', 'test'),
              ($3, $4, 'research.max_sources', 'workspace', $4, 1, '20', 'test')`,
      [ids.assignmentA, ids.workspaceA, ids.assignmentB, ids.workspaceB],
    );
    await admin.query(
      `INSERT INTO config_snapshots (id, workspace_id, subject_type, subject_id, resolved, source_map, hash)
       VALUES ($1, $2, 'project', $3, '{}', '{}', 'a'), ($4, $5, 'project', $6, '{}', '{}', 'b')`,
      [ids.snapshotA, ids.workspaceA, ids.projectA, ids.snapshotB, ids.workspaceB, ids.projectB],
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
    ['topic_versions', 'id', ids.versionA, ids.versionB],
    ['config_assignments', 'id', ids.assignmentA, ids.assignmentB],
    ['config_snapshots', 'id', ids.snapshotA, ids.snapshotB],
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

  // Control-plane history tables: tenant-bound inserts, no in-place changes.
  await expectSqlState(
    '42501',
    ids.workspaceA,
    ids.actorA,
    `INSERT INTO config_assignments (workspace_id, setting_key, scope_type, scope_id, sequence, value, reason)
     VALUES ($1, 'research.max_sources', 'workspace', $1, 2, '5', 'cross tenant')`,
    [ids.workspaceB],
  );
  await expectSqlState(
    '42501',
    ids.workspaceA,
    ids.actorA,
    `INSERT INTO config_assignments (workspace_id, setting_key, scope_type, scope_id, sequence, value, reason, created_by)
     VALUES ($1, 'research.max_sources', 'workspace', $1, 2, '5', 'spoofed actor', $2)`,
    [ids.workspaceA, ids.actorB],
  );
  await expectSqlState(
    '42501',
    ids.workspaceA,
    ids.actorA,
    'UPDATE config_assignments SET value = $1 WHERE id = $2',
    ['99', ids.assignmentA],
  );
  await expectSqlState(
    '42501',
    ids.workspaceA,
    ids.actorA,
    'DELETE FROM topic_versions WHERE id = $1',
    [ids.versionA],
  );
  await expectSqlState(
    '23503',
    ids.workspaceA,
    ids.actorA,
    `INSERT INTO topic_versions (workspace_id, topic_id, version, code, title, description, language)
     VALUES ($1, $2, 2, 'x', 'x', '', 'fa')`,
    [ids.workspaceA, ids.topicB],
  );
  await expectSqlState(
    '42501',
    ids.workspaceA,
    ids.actorA,
    `INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, description_fa, description_en)
     VALUES ('evil.setting', '{"type":"boolean"}', 'true', '{workspace}', 'x', 'x')`,
  );
  await assert.rejects(
    admin.query('UPDATE config_snapshots SET hash = $1 WHERE id = $2', ['x', ids.snapshotA]),
    (error) => {
      assert.equal(error.code, 'P0001');
      return true;
    },
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

  // Knowledge and ingestion tables (ING-*, KNO-*).
  const knowledgePolicies = await admin.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1::text[])`,
    [knowledgeTables],
  );
  assert.equal(
    knowledgePolicies.rowCount,
    knowledgeTables.length,
    'Every knowledge table must exist.',
  );
  for (const policy of knowledgePolicies.rows) {
    assert.equal(policy.relrowsecurity, true, `${policy.relname}: RLS is disabled`);
    assert.equal(policy.relforcerowsecurity, true, `${policy.relname}: FORCE RLS is disabled`);
  }
  await admin.query(
    `INSERT INTO knowledge_items (id, workspace_id, title, source_type) VALUES
       ($1, $2, 'A', 'admin_provided'), ($3, $4, 'B', 'admin_provided')`,
    [ids.itemA, ids.workspaceA, ids.itemB, ids.workspaceB],
  );
  await admin.query(
    `INSERT INTO knowledge_versions (id, workspace_id, item_id, version_no, content, content_sha256, language, provenance)
     VALUES ($1, $2, $3, 1, 'a', 'x', 'fa', '{}'), ($4, $5, $6, 1, 'b', 'y', 'fa', '{}')`,
    [
      ids.knowledgeVersionA,
      ids.workspaceA,
      ids.itemA,
      ids.knowledgeVersionB,
      ids.workspaceB,
      ids.itemB,
    ],
  );
  await admin.query(
    `INSERT INTO claims (id, workspace_id, knowledge_version_id, ordinal, text, normalized_text, kind, locator)
     VALUES ($1, $2, $3, 1, 'a', 'a', 'numeric', '{}')`,
    [ids.claimA, ids.workspaceA, ids.knowledgeVersionA],
  );
  await admin.query(
    `INSERT INTO audit_reviews (id, workspace_id, knowledge_version_id, rubric_version, auditor, scores, overall, decision,
                                reasons, claim_results, critical_flags)
     VALUES ($1, $2, $3, 'v1', 'test', '{}', 80, 'approved', '[]', '[]', '{}')`,
    [ids.reviewA, ids.workspaceA, ids.knowledgeVersionA],
  );
  const visibleItems = await withContext(ids.workspaceA, ids.actorA, () =>
    runtime.query('SELECT id::text AS id FROM knowledge_items ORDER BY id'),
  );
  assert.deepEqual(
    visibleItems.rows.map((row) => row.id),
    [ids.itemA],
  );
  await expectSqlState(
    '42501',
    ids.workspaceA,
    ids.actorA,
    `INSERT INTO knowledge_items (workspace_id, title, source_type) VALUES ($1, 'x', 'admin_provided')`,
    [ids.workspaceB],
  );
  await expectSqlState(
    '42501',
    ids.workspaceA,
    ids.actorA,
    'UPDATE claims SET text = $1 WHERE id = $2',
    ['changed', ids.claimA],
  );
  await expectSqlState(
    '23503',
    ids.workspaceA,
    ids.actorA,
    `INSERT INTO claims (workspace_id, knowledge_version_id, ordinal, text, normalized_text, kind, locator)
     VALUES ($1, $2, 9, 'x', 'x', 'numeric', '{}')`,
    [ids.workspaceA, ids.knowledgeVersionB],
  );
  await expectSqlState(
    '42501',
    ids.workspaceA,
    ids.actorA,
    `INSERT INTO audit_overrides (workspace_id, review_id, knowledge_version_id, decision, reason, created_by)
     VALUES ($1, $2, $3, 'approve', 'A long enough spoofed override reason', $4)`,
    [ids.workspaceA, ids.reviewA, ids.knowledgeVersionA, ids.actorB],
  );
  for (const sql of [
    ['UPDATE claims SET text = $1 WHERE id = $2', ['x', ids.claimA]],
    ['UPDATE audit_reviews SET overall = 1 WHERE id = $1', [ids.reviewA]],
    [
      'UPDATE knowledge_versions SET content = $1 WHERE id = $2',
      ['changed', ids.knowledgeVersionA],
    ],
  ]) {
    await assert.rejects(admin.query(sql[0], sql[1]), (error) => {
      assert.equal(error.code, 'P0001', sql[0]);
      return true;
    });
  }

  console.log(
    'RLS integration passed: PostgreSQL 18 migration, tenant reads/writes, link integrity, audit, config history, knowledge and ingestion tables, and auth workspace lookup.',
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
