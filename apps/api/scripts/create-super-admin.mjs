import { hash } from '@node-rs/argon2';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { stdin, stdout } from 'node:process';

const localEnv = new URL('../../../.env', import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

function readLine(prompt) {
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    let value = '';
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      const delimiter = text.search(/[\r\n]/);
      if (delimiter === -1) {
        value += text;
        return;
      }
      value += text.slice(0, delimiter);
      stdin.off('data', onData);
      stdout.write('\n');
      resolve(value);
    };
    stdin.on('data', onData);
    stdin.once('error', reject);
  });
}

function readHidden(prompt) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(
      'Admin bootstrap requires an interactive terminal so the password stays hidden.',
    );
  }

  return new Promise((resolve, reject) => {
    const bytes = [];
    const finish = (error) => {
      stdin.setRawMode(false);
      stdin.off('data', onData);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(Buffer.from(bytes).toString('utf8'));
    };
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 3 || byte === 4) {
          finish(new Error('Admin bootstrap was cancelled.'));
          return;
        }
        if (byte === 10 || byte === 13) {
          finish();
          return;
        }
        if (byte === 127 || byte === 8) {
          if (bytes.length > 0) {
            bytes.pop();
            while (bytes.length > 0 && (bytes.at(-1) & 0xc0) === 0x80) bytes.pop();
            stdout.write('\b \b');
          }
          continue;
        }
        if (byte >= 32) {
          bytes.push(byte);
          if ((byte & 0xc0) !== 0x80) stdout.write('*');
        }
      }
    };
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stdin.once('error', finish);
  });
}

const databaseUrl = process.env.DATABASE_ADMIN_URL;
if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL is required.');

// Unattended mode (installer): ADMIN_EMAIL is set, the password is random and never shown, and
// a single-use link lets the owner choose their own password in the browser.
const unattended = Boolean(process.env.ADMIN_EMAIL);
const email = (unattended ? process.env.ADMIN_EMAIL : await readLine('Admin email: '))
  .trim()
  .toLowerCase();
const displayName = (
  unattended ? (process.env.ADMIN_DISPLAY_NAME ?? 'Admin') : await readLine('Display name: ')
).trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
if (!displayName) throw new Error('Display name cannot be empty.');

let password;
if (unattended) {
  password = randomBytes(32).toString('base64url');
} else {
  password = await readHidden('Password (minimum 12 characters): ');
  const passwordConfirmation = await readHidden('Confirm password: ');
  if (password.length < 12) throw new Error('Password must contain at least 12 characters.');
  if (password !== passwordConfirmation) throw new Error('Passwords do not match.');
}
const pepper = process.env.SESSION_PEPPER;
if (unattended && (!pepper || pepper.length < 32)) {
  throw new Error('SESSION_PEPPER (32+ characters) is required for the set-password link.');
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const passwordHash = await hash(password, {
  memoryCost: Number(process.env.PASSWORD_ARGON2_MEMORY_KIB ?? 19_456),
  timeCost: Number(process.env.PASSWORD_ARGON2_ITERATIONS ?? 2),
  parallelism: Number(process.env.PASSWORD_ARGON2_PARALLELISM ?? 1),
});
const client = await pool.connect();

try {
  await client.query('begin');
  await client.query("select pg_advisory_xact_lock(hashtext('docoo.bootstrap.super_admin'))");

  const existingUsers = await client.query('select id from users limit 1');
  if (existingUsers.rowCount) {
    throw new Error('An administrator already exists; refusing to change account state.');
  }

  const existingEmail = await client.query('select id from users where lower(email) = $1 limit 1', [
    email,
  ]);
  if (existingEmail.rowCount) throw new Error('That email is already registered.');

  let workspace = await client.query('select id from workspaces order by created_at, id limit 1');
  if (!workspace.rowCount) {
    const workspaceId = randomUUID();
    await client.query("select set_config('app.workspace_id', $1, true)", [workspaceId]);
    workspace = await client.query(
      `insert into workspaces (id, code, name, default_locale)
       values ($1, 'main', 'Docoo', 'fa')
       returning id`,
      [workspaceId],
    );
  } else {
    await client.query("select set_config('app.workspace_id', $1, true)", [workspace.rows[0].id]);
  }

  const user = await client.query(
    `insert into users (email, password_hash, display_name)
     values ($1, $2, $3)
     returning id`,
    [email, passwordHash, displayName],
  );
  await client.query(
    `insert into memberships (workspace_id, user_id, role)
     values ($1, $2, 'super_admin')`,
    [workspace.rows[0].id, user.rows[0].id],
  );
  let link = null;
  if (unattended) {
    const token = randomBytes(32).toString('base64url');
    await client.query(
      `insert into password_reset_tokens (user_id, token_digest, expires_at)
       values ($1, $2, now() + interval '24 hours')`,
      [user.rows[0].id, createHmac('sha256', pepper).update(token).digest('hex')],
    );
    const origin = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '');
    link = `${origin}/fa/reset-password#token=${token}`;
  }
  await client.query('commit');
  stdout.write(`Super Admin created for ${email}. Keep your recovery path secure.\n`);
  if (link)
    stdout.write(`Choose your password with this single-use link (valid 24 hours):\n${link}\n`);
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
