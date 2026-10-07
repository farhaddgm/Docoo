import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { encryptSecret, decryptSecret } from '../../providers/dist/secrets.js';

const url = new URL(process.env.DATABASE_TEST_ADMIN_URL ?? '');
if (url.pathname !== '/docoo_ci') throw new Error('Requires disposable database docoo_ci.');
const control = new pg.Client({ connectionString: url.href });
await control.connect();
const testDatabase = 'docoo_security_' + randomBytes(8).toString('hex');
await control.query(`CREATE DATABASE ${testDatabase}`);
url.pathname = '/' + testDatabase;
const migration = new URL('../dist/src/migrate.js', import.meta.url);
execFileSync(process.execPath, [migration.pathname], {
  env: { ...process.env, DATABASE_ADMIN_URL: url.href },
  stdio: 'pipe',
});
const admin = new pg.Client({ connectionString: url.href });
await admin.connect();
const user = randomUUID(),
  workspace = randomUUID(),
  connection = randomUUID(),
  secretId = randomUUID();
const password = randomBytes(32).toString('hex');
const runtimeRole = 'docoo_security_' + randomBytes(8).toString('hex');
const old = { id: 'test-old', key: randomBytes(32) },
  next = { id: 'test-new', key: randomBytes(32) };
const context = `provider-secret:${connection}:1`;
const encrypted = encryptSecret('test-only-provider-credential', old, context);
try {
  await admin.query(`CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${password}' IN ROLE docoo_app`);
  for (const role of ['docoo_worker_agent', 'docoo_worker_ingestion'])
    await admin.query(`ALTER ROLE ${role} PASSWORD '${password}'`);
  await admin.query(
    "insert into users(id,email,display_name,password_hash) values($1,$2,'Test','test-only-hash')",
    [user, `${user}@example.test`],
  );
  await admin.query(
    "insert into sessions(user_id,token_digest,idle_expires_at,absolute_expires_at) values($1,'test-only-session',now()+interval '1 day',now()+interval '1 day')",
    [user],
  );
  await admin.query(
    "insert into password_reset_tokens(user_id,token_digest,expires_at) values($1,'test-only-reset',now()+interval '1 day')",
    [user],
  );
  for (const role of ['docoo_worker_agent', 'docoo_worker_ingestion', runtimeRole]) {
    const login = new URL(url);
    login.username = role;
    login.password = password;
    const client = new pg.Client({ connectionString: login.href });
    await client.connect();
    try {
      for (const setRole of ['', 'set role docoo_app']) {
        if (setRole) await client.query(setRole);
        for (const table of ['users', 'sessions', 'password_reset_tokens']) {
          const idColumn = table === 'users' ? 'id' : 'user_id';
          const count = (
            await client.query(`select count(*)::int as n from ${table} where ${idColumn}=$1`, [
              user,
            ])
          ).rows[0].n;
          assert.equal(count, role === runtimeRole ? 1 : 0, `${role} read ${table}`);
        }
      }
      if (role !== runtimeRole) {
        const result = await client.query(
          "update users set password_hash='changed' where id=$1 returning id",
          [user],
        );
        assert.equal(result.rowCount, 0);
        assert.equal(
          (await admin.query('select password_hash from users where id=$1', [user])).rows[0]
            .password_hash,
          'test-only-hash',
        );
      }
    } finally {
      await client.end();
    }
  }
  await admin.query("insert into workspaces(id,code,name) values($1,$2,'Security test')", [
    workspace,
    workspace,
  ]);
  await admin.query(
    "insert into provider_connections(id,workspace_id,provider,name) values($1,$2,'openai','Security test')",
    [connection, workspace],
  );
  await admin.query(
    'insert into provider_secrets(id,workspace_id,connection_id,secret_version,ciphertext,iv,tag,wrapped_key,wrap_iv,wrap_tag,key_id,fingerprint) values($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11)',
    [
      secretId,
      workspace,
      connection,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
      encrypted.wrappedKey,
      encrypted.wrapIv,
      encrypted.wrapTag,
      encrypted.keyId,
      encrypted.fingerprint,
    ],
  );
  const cli = new URL('../../../apps/api/scripts/rotate-master-key.mjs', import.meta.url);
  const env = {
    ...process.env,
    DATABASE_ADMIN_URL: url.href,
    SECRET_MASTER_KEY: next.key.toString('base64'),
    SECRET_MASTER_KEY_ID: next.id,
    SECRET_PREVIOUS_MASTER_KEYS: JSON.stringify({ [old.id]: old.key.toString('base64') }),
  };
  execFileSync(process.execPath, [cli.pathname], { env, stdio: 'pipe' });
  assert.equal(
    (await admin.query('select key_id from provider_secrets where id=$1', [secretId])).rows[0]
      .key_id,
    old.id,
    'dry run changed stored data',
  );
  execFileSync(process.execPath, [cli.pathname, '--apply'], { env, stdio: 'pipe' });
  const row = (await admin.query('select * from provider_secrets where id=$1', [secretId])).rows[0];
  assert.equal(row.ciphertext, encrypted.ciphertext);
  assert.equal(
    decryptSecret(
      {
        ...encrypted,
        wrappedKey: row.wrapped_key,
        wrapIv: row.wrap_iv,
        wrapTag: row.wrap_tag,
        keyId: row.key_id,
      },
      next,
      context,
    ),
    'test-only-provider-credential',
  );
  await assert.rejects(
    admin.query("update provider_secrets set ciphertext='tampered' where id=$1", [secretId]),
  );
  console.log(
    'Worker isolation passed with real logins and SET ROLE; master-key dry run, rewrap and retirement passed on stored credentials.',
  );
} finally {
  await admin.end();
  await control.query(`DROP DATABASE ${testDatabase}`);
  await control.query(`DROP ROLE ${runtimeRole}`);
  await control.end();
}
