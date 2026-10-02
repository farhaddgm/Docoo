import { createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { Pool } from 'pg';

// Operator path for FR-AUTH-002 until a mail adapter exists: issues a single-use reset
// link for an active administrator. The token is printed once to this terminal only and
// stored as a peppered digest, exactly like tokens from POST /auth/password/reset-request.

const localEnv = new URL('../../../.env', import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const databaseUrl = process.env.DATABASE_ADMIN_URL;
const pepper = process.env.SESSION_PEPPER;
const webOrigin = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '');
const ttlSeconds = Number(process.env.PASSWORD_RESET_TTL_SECONDS ?? 1800);
if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL is required.');
if (!pepper || pepper.length < 32) throw new Error('SESSION_PEPPER (32+ characters) is required.');
if (!stdout.isTTY) throw new Error('Run this command in an interactive terminal.');

stdout.write('Admin email: ');
const email = await new Promise((resolve) => {
  stdin.once('data', (chunk) => resolve(chunk.toString('utf8').trim().toLowerCase()));
});
stdin.pause();

const token = randomBytes(32).toString('base64url');
const digest = createHmac('sha256', pepper).update(token).digest('hex');
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
try {
  await client.query('begin');
  const user = await client.query(
    `select id from users where lower(email) = $1 and status = 'active' limit 1`,
    [email],
  );
  if (!user.rowCount) throw new Error('No active administrator has that email.');
  await client.query(
    'update password_reset_tokens set consumed_at = now() where user_id = $1 and consumed_at is null',
    [user.rows[0].id],
  );
  await client.query(
    `insert into password_reset_tokens (user_id, token_digest, expires_at)
     values ($1, $2, now() + ($3::integer * interval '1 second'))`,
    [user.rows[0].id, digest, ttlSeconds],
  );
  await client.query(
    `insert into auth_events (actor_id, action, identifier_digest, correlation_id)
     values ($1, 'password.reset_requested', $2, gen_random_uuid())`,
    [user.rows[0].id, createHmac('sha256', pepper).update(email).digest('hex')],
  );
  await client.query('commit');
  stdout.write(
    `Single-use link (valid ${Math.round(ttlSeconds / 60)} minutes):\n${webOrigin}/fa/reset-password#token=${token}\n`,
  );
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
