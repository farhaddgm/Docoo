import pg from 'pg';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_ADMIN_URL,
  connectionTimeoutMillis: 5000,
});
const client = await pool.connect();
try {
  await client.query('begin');
  for (const [role, variable] of [
    ['docoo_worker_agent', 'POSTGRES_AGENT_PASSWORD'],
    ['docoo_worker_ingestion', 'POSTGRES_INGESTION_PASSWORD'],
  ]) {
    const password = process.env[variable];
    if (!password || password.length < 32) throw new Error('Worker credential is missing.');
    const command = (
      await client.query(
        "select format('ALTER ROLE %I PASSWORD %L',$1::text,$2::text) as command",
        [role, password],
      )
    ).rows[0].command;
    await client.query(command);
  }
  await client.query('commit');
  console.log('Dedicated worker database credentials configured.');
} catch {
  await client.query('rollback');
  console.error('Worker credential configuration failed.');
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
