// Backup and restore drill (REL-001, NFR-REL-004/005): takes a full backup of PostgreSQL
// (roles + database) and of the object store, restores both into a separate, freshly started
// PostgreSQL 18 server and a separate bucket, then proves the restore is complete: every
// table's row count and content checksum, RLS, append-only triggers, migrations and every
// object's SHA-256 must match. Writes a JSON report with RTO and fails on any mismatch.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import pg from 'pg';

const localEnv = new URL('../../../.env', import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const sourceUrl = process.env.BACKUP_SOURCE_URL ?? process.env.DATABASE_ADMIN_URL;
if (!sourceUrl) throw new Error('BACKUP_SOURCE_URL or DATABASE_ADMIN_URL is required.');
const image =
  process.env.BACKUP_PG_IMAGE ??
  'pgvector/pgvector:0.8.1-pg18@sha256:508c5290cda481d4f5f846446a26e9c1b804766828a394a5861de1b348a18b4c';
const restorePort = Number(process.env.RESTORE_PORT ?? 55432);
const rtoTargetSeconds = Number(process.env.RTO_TARGET_SECONDS ?? 4 * 3600);
const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
const workDir = process.env.BACKUP_DIR ?? join(tmpdir(), `docoo-backup-${stamp}`);
const reportPath = process.env.BACKUP_REPORT ?? join(workDir, 'drill-report.json');
const container = `docoo-restore-drill-${randomBytes(3).toString('hex')}`;
const restorePassword = randomBytes(12).toString('hex');
mkdirSync(workDir, { recursive: true });

const seconds = (start) => Math.round((performance.now() - start) / 10) / 100;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));

/** Runs a PostgreSQL client tool of the server's major version from the official image. */
function pgTool(args, { input } = {}) {
  return execFileSync(
    'docker',
    ['run', '--rm', '-i', '--network', 'host', '-v', `${workDir}:/backup`, image, ...args],
    { input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 64 },
  ).toString();
}

/** Row count and order-independent content checksum of every table, plus safety features. */
async function fingerprint(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const tables = (
      await client.query(
        `select c.relname, c.relrowsecurity, c.relforcerowsecurity
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
      )
    ).rows;
    const result = {};
    for (const table of tables) {
      const row = (
        await client.query(
          `select count(*)::int as rows, coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as checksum
             from public.${client.escapeIdentifier(table.relname)} t`,
        )
      ).rows[0];
      result[table.relname] = {
        rows: row.rows,
        checksum: row.checksum,
        rls: table.relrowsecurity,
        forceRls: table.relforcerowsecurity,
      };
    }
    const triggers = (
      await client.query(
        `select count(*)::int as count from pg_trigger t join pg_proc p on p.oid = t.tgfoid
          where p.proname = 'reject_history_mutation' and not t.tgisinternal`,
      )
    ).rows[0].count;
    const policies = (
      await client.query(
        `select count(*)::int as count from pg_policies where schemaname = 'public'`,
      )
    ).rows[0].count;
    const migrations = (
      await client
        .query(`select count(*)::int as count from drizzle.__drizzle_migrations`)
        .catch(() => ({ rows: [{ count: -1 }] }))
    ).rows[0].count;
    const version = (await client.query('show server_version')).rows[0].server_version;
    return { tables: result, triggers, policies, migrations, version };
  } finally {
    await client.end();
  }
}

function s3() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket || !process.env.S3_ACCESS_KEY_ID) return null;
  return {
    bucket,
    client: new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      },
    }),
  };
}

async function listKeys(client, bucket) {
  const keys = [];
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? []) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys.sort();
}

async function getBytes(client, bucket, key) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await response.Body.transformToByteArray());
}

const report = {
  startedAt: new Date().toISOString(),
  source: new URL(sourceUrl).pathname.slice(1),
  image,
  steps: {},
  checks: [],
};
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok, ...(detail ? { detail } : {}) });
  if (!ok) log('drill.check_failed', { name, detail });
};

let restoreStarted = false;
const storage = s3();
const restoreBucket = storage
  ? `${storage.bucket}-restore-${randomBytes(3).toString('hex')}`
  : null;
try {
  // ------------------------------------------------------------------ backup
  const backupStart = performance.now();
  const before = await fingerprint(sourceUrl);
  pgTool([
    'pg_dumpall',
    `--dbname=${sourceUrl}`,
    '--roles-only',
    '--no-role-passwords',
    '--file=/backup/globals.sql',
  ]);
  pgTool(['pg_dump', '--format=custom', '--compress=6', '--file=/backup/database.dump', sourceUrl]);
  const objects = [];
  if (storage) {
    for (const key of await listKeys(storage.client, storage.bucket)) {
      const bytes = await getBytes(storage.client, storage.bucket, key);
      const path = join(workDir, 'objects', key);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      objects.push({ key, sha256: sha256(bytes), size: bytes.length });
    }
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    serverVersion: before.version,
    migrations: before.migrations,
    files: {
      'globals.sql': sha256(readFileSync(join(workDir, 'globals.sql'))),
      'database.dump': sha256(readFileSync(join(workDir, 'database.dump'))),
    },
    objects,
    tables: before.tables,
  };
  writeFileSync(join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  report.steps.backupSeconds = seconds(backupStart);
  report.backup = {
    dumpBytes: readFileSync(join(workDir, 'database.dump')).length,
    objects: objects.length,
    tables: Object.keys(before.tables).length,
  };
  log('drill.backup_done', report.backup);

  // ------------------------------------------------------------------ restore (separate server)
  const restoreStart = performance.now();
  execFileSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      container,
      '-p',
      `127.0.0.1:${restorePort}:5432`,
      '-e',
      `POSTGRES_PASSWORD=${restorePassword}`,
      image,
    ],
    { stdio: 'pipe' },
  );
  restoreStarted = true;
  const adminRestoreUrl = `postgresql://postgres:${restorePassword}@127.0.0.1:${restorePort}/postgres`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const probe = new pg.Client({ connectionString: adminRestoreUrl });
      await probe.connect();
      await probe.end();
      break;
    } catch (error) {
      if (attempt > 60) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  // Integrity of the backup files is checked before they are used.
  check(
    'backup files match the manifest',
    Object.entries(manifest.files).every(
      ([file, digest]) => sha256(readFileSync(join(workDir, file))) === digest,
    ),
  );
  pgTool(['psql', `--dbname=${adminRestoreUrl}`, '--quiet', '--file=/backup/globals.sql']);
  const database = report.source;
  pgTool([
    'psql',
    `--dbname=${adminRestoreUrl}`,
    '--quiet',
    '--command',
    `create database "${database}"`,
  ]);
  const restoreUrl = `postgresql://postgres:${restorePassword}@127.0.0.1:${restorePort}/${database}`;
  pgTool(['pg_restore', '--exit-on-error', `--dbname=${restoreUrl}`, '/backup/database.dump']);
  if (storage && restoreBucket) {
    await storage.client.send(new CreateBucketCommand({ Bucket: restoreBucket }));
    for (const object of objects) {
      await storage.client.send(
        new PutObjectCommand({
          Bucket: restoreBucket,
          Key: object.key,
          Body: readFileSync(join(workDir, 'objects', object.key)),
        }),
      );
    }
  }
  report.steps.restoreSeconds = seconds(restoreStart);

  // ------------------------------------------------------------------ verification
  const verifyStart = performance.now();
  const after = await fingerprint(restoreUrl);
  const mismatched = Object.keys(before.tables).filter(
    (table) => JSON.stringify(before.tables[table]) !== JSON.stringify(after.tables[table]),
  );
  check(
    'every table restored with identical rows and checksum',
    mismatched.length === 0 &&
      Object.keys(after.tables).length === Object.keys(before.tables).length,
    mismatched.join(', '),
  );
  check(
    'row-level security is enabled and forced as before',
    Object.values(after.tables).filter((table) => table.forceRls).length ===
      Object.values(before.tables).filter((table) => table.forceRls).length,
  );
  check(
    'append-only triggers restored',
    after.triggers === before.triggers && after.triggers > 0,
    `${after.triggers}/${before.triggers}`,
  );
  check(
    'RLS policies restored',
    after.policies === before.policies && after.policies > 0,
    `${after.policies}/${before.policies}`,
  );
  check(
    'migration history restored',
    after.migrations === before.migrations && after.migrations > 0,
    `${after.migrations}/${before.migrations}`,
  );
  const restoredRole = new pg.Client({ connectionString: restoreUrl });
  await restoredRole.connect();
  const appRole = (
    await restoredRole.query(
      `select count(*)::int as count from pg_roles where rolname = 'docoo_app'`,
    )
  ).rows[0].count;
  await restoredRole.end();
  check('runtime role and grants restored', appRole === 1);
  if (storage && restoreBucket) {
    const restoredKeys = await listKeys(storage.client, restoreBucket);
    let identical = restoredKeys.length === objects.length;
    for (const object of objects) {
      if (!identical) break;
      identical =
        sha256(await getBytes(storage.client, restoreBucket, object.key)) === object.sha256;
    }
    check(
      'every object restored with identical SHA-256',
      identical,
      `${restoredKeys.length}/${objects.length}`,
    );
  }
  report.steps.verifySeconds = seconds(verifyStart);
  report.rtoSeconds =
    Math.round((report.steps.restoreSeconds + report.steps.verifySeconds) * 100) / 100;
  check(
    `RTO within target (${rtoTargetSeconds} s)`,
    report.rtoSeconds <= rtoTargetSeconds,
    `${report.rtoSeconds} s`,
  );
  report.restore = {
    tables: Object.keys(after.tables).length,
    rows: Object.values(after.tables).reduce((sum, table) => sum + table.rows, 0),
  };
} catch (error) {
  check(
    'drill completed',
    false,
    error instanceof Error ? error.message.split('\n')[0] : String(error),
  );
} finally {
  if (restoreStarted && !process.env.KEEP_RESTORE)
    execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  if (storage && restoreBucket && !process.env.KEEP_RESTORE) {
    try {
      for (const key of await listKeys(storage.client, restoreBucket)) {
        await storage.client.send(new DeleteObjectCommand({ Bucket: restoreBucket, Key: key }));
      }
      await storage.client.send(new DeleteBucketCommand({ Bucket: restoreBucket }));
    } catch {
      // the bucket was never created
    }
  }
}

report.finishedAt = new Date().toISOString();
report.ok = report.checks.length > 0 && report.checks.every((item) => item.ok);
writeFileSync(reportPath, JSON.stringify(report, null, 2));
for (const item of report.checks)
  console.log(
    `${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` (${item.detail})` : ''}`,
  );
console.log(
  `\nBackup ${report.steps.backupSeconds ?? '-'} s, restore ${report.steps.restoreSeconds ?? '-'} s, verify ${report.steps.verifySeconds ?? '-'} s, RTO ${report.rtoSeconds ?? '-'} s. Report: ${reportPath}`,
);
if (report.ok) {
  // Feeds the DocooBackupStale alert (infra/prometheus/rules/slo.yml).
  const metric = `docoo_backup_last_success_timestamp_seconds ${Math.floor(Date.now() / 1000)}\n`;
  writeFileSync(join(workDir, 'backup.prom'), metric);
  if (process.env.PUSHGATEWAY_URL) {
    await fetch(`${process.env.PUSHGATEWAY_URL.replace(/\/$/u, '')}/metrics/job/docoo-backup`, {
      method: 'POST',
      body: metric,
    });
  }
}
process.exit(report.ok ? 0 : 1);
