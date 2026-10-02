import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  ClamdScanner,
  extractInSandbox,
  objectKeys,
  PgIngestionStore,
  S3ObjectStore,
  s3ConfigFromEnv,
  TesseractOcr,
  UnconfiguredTranscriber,
  type StepResult,
} from '@docoo/ingestion';
import { Client as TemporalClient, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createActivities } from './activities.js';

const adminUrl = process.env['DATABASE_TEST_ADMIN_URL'];
const s3 = s3ConfigFromEnv();
const clamdHost = process.env['CLAMD_HOST'];
const temporalAddress = process.env['TEMPORAL_ADDRESS'];
const ready = Boolean(adminUrl && s3 && clamdHost && temporalAddress);
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/**
 * End-to-end ingestion with the real services: presigned upload to S3 (SeaweedFS in CI),
 * clamd INSTREAM, the Temporal workflow and worker, and PostgreSQL under RLS with a
 * non-superuser runtime role.
 */
describe.skipIf(!ready)('ingestion worker with real services (ING-001..003)', () => {
  const taskQueue = `docoo-ingestion-test-${randomBytes(4).toString('hex')}`;
  const roleName = `docoo_worker_${randomBytes(4).toString('hex')}`;
  const rolePassword = randomBytes(16).toString('hex');
  const workspaceId = randomUUID();
  let admin: Client;
  let pool: Pool;
  let objects: S3ObjectStore;
  let worker: Worker;
  let running: Promise<void>;
  let nativeConnection: NativeConnection;
  let connection: Connection;
  let client: TemporalClient;

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin
      .query(
        `select format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', $1::text, $2::text)`,
        [roleName, rolePassword],
      )
      .then((result) => admin.query(result.rows[0].format as string));
    await admin.query(`grant docoo_app to ${roleName}`);
    await admin.query(`insert into workspaces (id, code, name) values ($1, $2, 'Worker test')`, [
      workspaceId,
      `worker-${roleName}`,
    ]);
    const runtime = new URL(adminUrl!);
    runtime.username = roleName;
    runtime.password = rolePassword;
    pool = new Pool({ connectionString: runtime.toString(), max: 4 });
    objects = new S3ObjectStore(s3!);
    await objects.ensureBucket();

    nativeConnection = await NativeConnection.connect({ address: temporalAddress! });
    worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      // Under vitest this file is TypeScript; the Temporal bundler compiles workflows.ts itself.
      workflowsPath: fileURLToPath(
        new URL(
          import.meta.url.endsWith('.ts') ? './workflows.ts' : './workflows.js',
          import.meta.url,
        ),
      ),
      activities: createActivities({
        store: new PgIngestionStore(pool),
        objects,
        scanner: new ClamdScanner(clamdHost!, Number(process.env['CLAMD_PORT'] ?? 3310)),
        extract: (bytes, mime) => extractInSandbox(bytes, mime),
        ocr: new TesseractOcr(),
        transcriber: new UnconfiguredTranscriber(),
      }),
    });
    running = worker.run();
    connection = await Connection.connect({ address: temporalAddress! });
    client = new TemporalClient({ connection });
  }, 120_000);

  afterAll(async () => {
    worker?.shutdown();
    await running?.catch(() => undefined);
    await nativeConnection?.close();
    await connection?.close();
    await pool?.end();
    if (admin) {
      await admin.query(`drop owned by ${roleName}`).catch(() => undefined);
      await admin.query(`drop role if exists ${roleName}`).catch(() => undefined);
      await admin.end();
    }
  });

  async function ingest(
    bytes: Uint8Array,
    filename: string,
    mime: string,
  ): Promise<{ versionId: string; result: StepResult }> {
    const assetId = randomUUID();
    const versionId = randomUUID();
    await admin.query(
      `insert into source_assets (id, workspace_id, kind, title, scope_type, scope_id) values ($1, $2, 'file', $3, 'workspace', $2)`,
      [assetId, workspaceId, filename],
    );
    const key = objectKeys.quarantine(workspaceId, assetId, versionId);
    await admin.query(
      `insert into source_versions (id, workspace_id, asset_id, version_no, status, object_key, filename, declared_mime, declared_size, declared_sha256)
       values ($1, $2, $3, 1, 'quarantined', $4, $5, $6, $7, $8)`,
      [
        versionId,
        workspaceId,
        assetId,
        key,
        filename,
        mime,
        bytes.length,
        createHash('sha256').update(bytes).digest('hex'),
      ],
    );
    // The browser path: a presigned PUT straight into quarantine.
    const url = await objects.presignPut(key, mime, bytes.length, 300);
    const upload = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': mime },
      body: Buffer.from(bytes),
    });
    expect(upload.status, await upload.text()).toBe(200);
    const result = await client.workflow.execute('ingestSourceVersion', {
      taskQueue,
      workflowId: `ingest-${versionId}`,
      args: [
        {
          workspaceId,
          versionId,
          correlationId: randomUUID(),
          maxBytes: 10 * 1024 * 1024,
          language: 'en',
        },
      ],
    });
    return { versionId, result: result as StepResult };
  }

  it('indexes a clean file through the workflow with lineage and audit', async () => {
    const { versionId, result } = await ingest(
      new TextEncoder().encode('Line one of a clean file.\n\nSales grew 20% because of demand.'),
      'clean.txt',
      'text/plain',
    );
    expect(result).toEqual({ status: 'indexed', failureCode: null });
    const segments = await admin.query(
      'select locator, text from source_segments where source_version_id = $1 order by ordinal',
      [versionId],
    );
    expect(segments.rows).toEqual([
      { locator: { line: 1 }, text: 'Line one of a clean file.' },
      { locator: { line: 3 }, text: 'Sales grew 20% because of demand.' },
    ]);
    const version = await admin.query<{
      scan: { status: string; engine: string };
      object_key: string;
    }>('select scan, object_key from source_versions where id = $1', [versionId]);
    expect(version.rows[0]!.scan).toMatchObject({ status: 'clean', engine: 'clamd' });
    expect(version.rows[0]!.object_key).toMatch(/^sources\//u);
    const actions = await admin.query<{ action: string }>(
      'select action from audit_events where target_id = $1 order by occurred_at',
      [versionId],
    );
    expect(actions.rows.map((row) => row.action)).toEqual(['source.accepted', 'source.extracted']);
  }, 120_000);

  it('keeps an EICAR file in quarantine using clamd', async () => {
    const { versionId, result } = await ingest(
      new TextEncoder().encode(EICAR),
      'eicar.txt',
      'text/plain',
    );
    expect(result).toEqual({ status: 'rejected', failureCode: 'malware_detected' });
    const version = await admin.query<{ scan: { status: string; signature: string } }>(
      'select scan from source_versions where id = $1',
      [versionId],
    );
    expect(version.rows[0]!.scan.status).toBe('infected');
    const segments = await admin.query(
      'select 1 from source_segments where source_version_id = $1',
      [versionId],
    );
    expect(segments.rowCount).toBe(0);
  }, 120_000);
});
