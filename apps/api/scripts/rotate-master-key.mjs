import pg from 'pg';
import { masterKeyFromEnv, rewrapSecret, decryptSecret } from '@docoo/providers';
const master = masterKeyFromEnv();
if (!master || !process.env.DATABASE_ADMIN_URL)
  throw new Error('Current/previous master keys and DATABASE_ADMIN_URL are required.');
const apply = process.argv.includes('--apply');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_ADMIN_URL,
  connectionTimeoutMillis: 5000,
});
const client = await pool.connect();
const counts = { provider_secrets: 0, contenter_connections: 0 };
try {
  await client.query('begin');
  await client.query("select pg_advisory_xact_lock(hashtext('docoo.master_key_rotation'))");
  for (const table of Object.keys(counts)) {
    const rows = (await client.query(`select * from ${table} where key_id is not null for update`))
      .rows;
    for (const row of rows) {
      const encrypted = {
        ciphertext: row.ciphertext,
        iv: row.iv,
        tag: row.tag,
        wrappedKey: row.wrapped_key,
        wrapIv: row.wrap_iv,
        wrapTag: row.wrap_tag,
        keyId: row.key_id,
        fingerprint: row.fingerprint,
      };
      const context =
        table === 'provider_secrets'
          ? `provider-secret:${row.connection_id}:${row.secret_version}`
          : `contenter-token:${row.id}:${row.secret_version}`;
      // Authenticate every existing record before touching any wrapping keys.
      decryptSecret(encrypted, master, context);
      if (row.key_id === master.id) continue;
      const next = rewrapSecret(encrypted, master, context);
      decryptSecret(next, master, context);
      if (apply)
        await client.query(
          `update ${table} set wrapped_key=$1,wrap_iv=$2,wrap_tag=$3,key_id=$4 where id=$5`,
          [next.wrappedKey, next.wrapIv, next.wrapTag, next.keyId, row.id],
        );
      counts[table]++;
    }
  }
  if (apply)
    await client.query(
      "insert into account_events(action,details) values('security.master_key_rotated',$1::jsonb)",
      [JSON.stringify({ records: counts })],
    );
  await client.query(apply ? 'commit' : 'rollback');
  console.log(JSON.stringify({ applied: apply, records: counts }));
} catch (error) {
  await client.query('rollback');
  throw new Error('Master-key rotation failed; transaction rolled back.', { cause: error });
} finally {
  client.release();
  await pool.end();
}
