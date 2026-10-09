import 'reflect-metadata';

import { hash } from '@node-rs/argon2';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomBytes, randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { Client, Pool } from 'pg';

import {
  ClamdScanner,
  extractInSandbox,
  MemoryObjectStore,
  PgIngestionStore,
  runPipeline,
  TesseractOcr,
  UnconfiguredTranscriber,
  type IngestionInput,
  type MalwareScanner,
  type StepResult,
} from '@docoo/ingestion';

import {
  AGENT_TASK_QUEUE,
  createOrchestrationActivities,
  createDecisionResearchActivities,
  type DecisionResearchRef,
  fakeResponder,
  fakeToolResponder,
  ProviderRuntime,
  type RunRef,
  type WritingRef,
} from '@docoo/orchestration';
import {
  createAdapter,
  FakeAdapter,
  masterKeyFromEnv,
  parsePriceCatalog,
  PriceCatalogError,
  type FakeScript,
} from '@docoo/providers';
import {
  Client as TemporalClient,
  Connection as TemporalConnection,
  WorkflowExecutionAlreadyStartedError,
} from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';

import { AppModule } from '../../src/app.module.js';
import {
  NOTIFICATION_MAIL_TRANSPORT,
  NotificationMailer,
} from '../../src/notifications/notification-mailer.js';
import {
  WORKFLOW_ENGINE,
  type WorkflowEngine,
  type WorkflowSignal,
} from '../../src/workflow/workflow.engine.js';
import {
  PASSWORD_RESET_DELIVERY,
  type PasswordResetDelivery,
  type PasswordResetMessage,
} from '../../src/auth/auth.reset-delivery.js';
import {
  PRICE_CATALOG,
  type LoadedPriceCatalog,
  type PriceCatalogSource,
} from '../../src/providers/price-catalog.source.js';
import { PROVIDER_RUNTIME } from '../../src/providers/providers.service.js';
import { INGESTION_DISPATCHER, OBJECT_STORE } from '../../src/sources/ingestion.providers.js';
import { DATABASE_POOL } from '../../src/tokens.js';

export const adminUrl = process.env['DATABASE_TEST_ADMIN_URL'];
export const webOrigin = 'http://localhost:3000';
export const testPepper = 'docoo-integration-pepper-with-at-least-32-chars';
export const password = 'integration-password-1';

/** A mail server stand-in: keeps what was sent and can be made to fail. */
export class CapturingMailTransport {
  readonly sent: { from: string; to: string; subject: string; text: string }[] = [];
  /** Number of the next calls that throw, as an unreachable server would. */
  failures = 0;

  sendMail(message: { from?: string; to?: string; subject?: string; text?: string }) {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new Error('mail server unreachable'));
    }
    this.sent.push({
      from: String(message.from),
      to: String(message.to),
      subject: String(message.subject),
      text: String(message.text),
    });
    return Promise.resolve({});
  }
}

export class CapturingResetDelivery implements PasswordResetDelivery {
  readonly messages: PasswordResetMessage[] = [];

  deliver(message: PasswordResetMessage): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }

  lastToken(): string {
    const url = this.messages.at(-1)?.resetUrl ?? '';
    return decodeURIComponent(url.split('#token=')[1] ?? '');
  }
}

/** Detects the EICAR test string; the real clamd adapter is used when CLAMD_HOST is set. */
export const eicarScanner: MalwareScanner = {
  scan: (bytes) =>
    Promise.resolve(
      Buffer.from(bytes).includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
        ? { status: 'infected', engine: 'test', signature: 'Eicar-Test-Signature', detail: null }
        : { status: 'clean', engine: 'test', signature: null, detail: null },
    ),
};

/** Runs the ingestion workflow steps in-process, in the same order the Temporal worker does. */
export class InlineIngestion {
  readonly runs: { input: IngestionInput; result: StepResult }[] = [];
  scanner: MalwareScanner = process.env['CLAMD_HOST']
    ? new ClamdScanner(process.env['CLAMD_HOST'], Number(process.env['CLAMD_PORT'] ?? 3310))
    : eicarScanner;
  available = true;

  constructor(
    private readonly pool: Pool,
    readonly objects: MemoryObjectStore,
  ) {}

  async start(input: IngestionInput): Promise<void> {
    if (!this.available) {
      const { IngestionUnavailableError } =
        await import('../../src/sources/ingestion.providers.js');
      throw new IngestionUnavailableError('temporal_unreachable');
    }
    const result = await runPipeline(input, {
      store: new PgIngestionStore(this.pool),
      objects: this.objects,
      scanner: this.scanner,
      extract: (bytes, mime) => extractInSandbox(bytes, mime),
      ocr: new TesseractOcr(),
      transcriber: new UnconfiguredTranscriber(),
    });
    this.runs.push({ input, result });
  }
}

/** Records engine calls when a test does not run real workflows. */
export class RecordingEngine implements WorkflowEngine {
  readonly calls: {
    kind: 'start' | 'signal';
    workflowId: string;
    signal?: WorkflowSignal;
    payload?: unknown;
  }[] = [];
  start(workflowId: string): Promise<void> {
    this.calls.push({ kind: 'start', workflowId });
    return Promise.resolve();
  }
  startWriting(workflowId: string): Promise<void> {
    this.calls.push({ kind: 'start', workflowId });
    return Promise.resolve();
  }
  signal(workflowId: string, signal: WorkflowSignal, payload?: unknown): Promise<void> {
    this.calls.push({ kind: 'signal', workflowId, signal, payload });
    return Promise.resolve();
  }
}

export const temporalAddress = process.env['TEMPORAL_ADDRESS'];

/**
 * Real Temporal for workflow tests: an in-process worker on a private task queue with the
 * production workflow and activities, and a provider runtime whose fake adapter tests can script.
 */
export class TemporalTestRuntime implements WorkflowEngine {
  readonly taskQueue = `${AGENT_TASK_QUEUE}-test-${randomBytes(4).toString('hex')}`;
  fakeScript: FakeScript = () => null;
  readonly fake = new FakeAdapter((request, call) => this.fakeScript(request, call));

  constructor(private readonly pool: Pool) {
    // The same analyst, researcher and judge the stack uses for provider kind `fake`; tests may script their own.
    this.fake.responder = fakeResponder;
    this.fake.toolResponder = fakeToolResponder;
  }
  private worker: Worker | null = null;
  private running: Promise<void> | null = null;
  private native: NativeConnection | null = null;
  private connection: TemporalConnection | null = null;
  client!: TemporalClient;

  async connect(): Promise<void> {
    this.connection = await TemporalConnection.connect({ address: temporalAddress! });
    this.client = new TemporalClient({ connection: this.connection });
    await this.startWorker();
  }

  async startWorker(): Promise<void> {
    this.native = await NativeConnection.connect({ address: temporalAddress! });
    const runtime = new ProviderRuntime(this.pool, null, (kind, options) =>
      kind === 'fake' ? this.fake : createAdapter(kind, options),
    );
    this.worker = await Worker.create({
      connection: this.native,
      taskQueue: this.taskQueue,
      workflowsPath: fileURLToPath(import.meta.resolve('@docoo/orchestration/workflows')),
      activities: {
        ...createOrchestrationActivities(this.pool, runtime, { delayScale: 0.002 }),
        ...createDecisionResearchActivities(this.pool),
      },
    });
    this.running = this.worker.run();
  }

  /** Simulates a worker crash/restart: workflow state must survive (WF-004). */
  async stopWorker(): Promise<void> {
    this.worker?.shutdown();
    await this.running?.catch(() => undefined);
    await this.native?.close();
    this.worker = null;
  }

  readonly started: string[] = [];

  async start(workflowId: string, ref: RunRef): Promise<void> {
    this.started.push(workflowId);
    try {
      await this.client.workflow.start('projectWorkflow', {
        taskQueue: this.taskQueue,
        workflowId,
        args: [ref],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }

  async startWriting(workflowId: string, ref: WritingRef): Promise<void> {
    this.started.push(workflowId);
    try {
      await this.client.workflow.start('documentWritingWorkflow', {
        taskQueue: this.taskQueue,
        workflowId,
        args: [ref],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }

  async startDecisionResearch(workflowId: string, ref: DecisionResearchRef): Promise<void> {
    this.started.push(workflowId);
    try {
      await this.client.workflow.start('decisionResearchWorkflow', {
        taskQueue: this.taskQueue,
        workflowId,
        args: [ref],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }

  async signal(workflowId: string, signal: WorkflowSignal, payload?: unknown): Promise<void> {
    await this.client.workflow
      .getHandle(workflowId)
      .signal(signal, ...(payload === undefined ? [] : [payload]));
  }

  async close(): Promise<void> {
    for (const workflowId of this.started) {
      await this.client.workflow
        .getHandle(workflowId)
        .terminate('test finished')
        .catch(() => undefined);
    }
    await this.stopWorker();
    await this.connection?.close();
  }
}

/** The public price catalog replaced by a file the test controls (nothing leaves the machine). */
export class StubPriceCatalog implements PriceCatalogSource {
  /** Set to make the catalog unreachable, as a blocked network would. */
  failing = false;
  loads = 0;
  private loaded: LoadedPriceCatalog;

  constructor(file: Record<string, unknown>) {
    this.loaded = { catalog: parsePriceCatalog(file), fetchedAt: new Date().toISOString() };
  }

  /** Publishes a new version of the catalog file. */
  publish(file: Record<string, unknown>): void {
    this.loaded = { catalog: parsePriceCatalog(file), fetchedAt: new Date().toISOString() };
  }

  load(): Promise<LoadedPriceCatalog> {
    this.loads += 1;
    return this.failing
      ? Promise.reject(new PriceCatalogError('unreachable', 'ENOTFOUND'))
      : Promise.resolve(this.loaded);
  }
}

export interface Harness {
  readonly app: NestFastifyApplication;
  readonly admin: Client;
  readonly delivery: CapturingResetDelivery;
  /** The mail server the notification mailer sends to, and the mailer itself (ticks are driven by tests). */
  readonly mailbox: CapturingMailTransport;
  readonly mailer: NotificationMailer;
  readonly objects: MemoryObjectStore;
  readonly ingestion: InlineIngestion;
  readonly engine: RecordingEngine | TemporalTestRuntime;
  /** Fake model provider shared by the API and the test worker; tests may set `responder`/`script`. */
  readonly fake: FakeAdapter;
  /** Stand-in for the public model price catalog; tests publish files into it. */
  readonly priceCatalog: StubPriceCatalog;
  readonly ids: {
    readonly userA: string;
    readonly userB: string;
    readonly workspaceA: string;
    readonly workspaceB: string;
  };
  readonly emails: { readonly a: string; readonly b: string };
  readonly suffix: string;
  login(email: string, secret?: string): Promise<string>;
  request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    options?: {
      cookie?: string;
      payload?: unknown;
      headers?: Record<string, string>;
      origin?: string;
    },
  ): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

/**
 * Boots the API against the disposable `docoo_ci` database with a fresh non-superuser
 * runtime role (RLS enforced) and two isolated workspaces A and B.
 */
export async function createHarness(
  name: string,
  options: { workflow?: boolean } = {},
): Promise<Harness> {
  const parsed = new URL(adminUrl!);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.pathname !== '/docoo_ci') {
    throw new Error('Integration tests require a disposable PostgreSQL database named docoo_ci.');
  }
  const suffix = randomBytes(6).toString('hex');
  const roleName = `docoo_${name}_${suffix}`;
  const rolePassword = randomBytes(24).toString('hex');
  const ids = {
    userA: randomUUID(),
    userB: randomUUID(),
    workspaceA: randomUUID(),
    workspaceB: randomUUID(),
  };
  const emails = { a: `${name}-a-${suffix}@example.test`, b: `${name}-b-${suffix}@example.test` };

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const server = (
    await admin.query<{ server_version: number; is_superuser: boolean }>(
      `select current_setting('server_version_num')::int as server_version, rolsuper as is_superuser
         from pg_roles where rolname = current_user`,
    )
  ).rows[0];
  if (
    !server ||
    server.server_version < 180000 ||
    server.server_version >= 190000 ||
    !server.is_superuser
  ) {
    throw new Error('Integration tests require a PostgreSQL 18 test superuser.');
  }

  const roleSql = await admin.query<{ sql: string }>(
    "select format('CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text, $2::text) as sql",
    [roleName, rolePassword],
  );
  await admin.query(roleSql.rows[0]!.sql);
  await admin.query(`grant docoo_app to ${roleName}`);

  const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  await admin.query(
    `insert into users (id, email, password_hash, display_name)
     values ($1, $2, $3, 'Admin A'), ($4, $5, $3, 'Admin B')`,
    [ids.userA, emails.a, passwordHash, ids.userB, emails.b],
  );
  await admin.query(`insert into workspaces (id, code, name) values ($1, $2, $3), ($4, $5, $6)`, [
    ids.workspaceA,
    `${name}-a-${suffix}`,
    'Workspace A',
    ids.workspaceB,
    `${name}-b-${suffix}`,
    'Workspace B',
  ]);
  await admin.query(`insert into memberships (workspace_id, user_id) values ($1, $2), ($3, $4)`, [
    ids.workspaceA,
    ids.userA,
    ids.workspaceB,
    ids.userB,
  ]);

  const runtimeUrl = new URL(adminUrl!);
  runtimeUrl.username = roleName;
  runtimeUrl.password = rolePassword;
  const runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 4 });
  process.env['NODE_ENV'] = 'test';
  process.env['SESSION_PEPPER'] = testPepper;
  process.env['WEB_ORIGIN'] = webOrigin;
  process.env['SECRET_MASTER_KEY'] ??= randomBytes(32).toString('base64');

  const delivery = new CapturingResetDelivery();
  const objects = new MemoryObjectStore();
  const ingestion = new InlineIngestion(runtimePool, objects);
  let engine: RecordingEngine | TemporalTestRuntime;
  if (options.workflow) {
    const temporal = new TemporalTestRuntime(runtimePool);
    await temporal.connect();
    engine = temporal;
  } else {
    engine = new RecordingEngine();
  }
  const fake = engine instanceof TemporalTestRuntime ? engine.fake : new FakeAdapter();
  if (!(engine instanceof TemporalTestRuntime)) {
    fake.responder = fakeResponder;
    fake.toolResponder = fakeToolResponder;
  }
  const providerRuntime = new ProviderRuntime(runtimePool, masterKeyFromEnv(), (kind, options) =>
    kind === 'fake' ? fake : createAdapter(kind, options),
  );
  const priceCatalog = new StubPriceCatalog({});
  const mailbox = new CapturingMailTransport();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_POOL)
    .useValue(runtimePool)
    .overrideProvider(PASSWORD_RESET_DELIVERY)
    .useValue(delivery)
    .overrideProvider(OBJECT_STORE)
    .useValue(objects)
    .overrideProvider(INGESTION_DISPATCHER)
    .useValue(ingestion)
    .overrideProvider(WORKFLOW_ENGINE)
    .useValue(engine)
    .overrideProvider(PROVIDER_RUNTIME)
    .useValue(providerRuntime)
    .overrideProvider(PRICE_CATALOG)
    .useValue(priceCatalog)
    .overrideProvider(NOTIFICATION_MAIL_TRANSPORT)
    .useValue(mailbox)
    .compile();
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  await app.register(cookie, { secret: testPepper });
  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) =>
      new HttpException(
        {
          status: context.statusCode,
          title: 'Too Many Requests',
          code: 'AUTH_RATE_LIMITED',
          detail: 'Please wait before trying again.',
        },
        context.statusCode,
      ),
  });
  app.setGlobalPrefix('v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const request: Harness['request'] = (method, url, options = {}) => {
    const headers: Record<string, string> = {
      origin: options.origin ?? webOrigin,
      'sec-fetch-site': 'same-origin',
      ...options.headers,
    };
    if (options.cookie) headers['cookie'] = options.cookie;
    const injection: InjectOptions = { method, url, headers };
    if (options.payload !== undefined) {
      injection.payload = options.payload as NonNullable<InjectOptions['payload']>;
    }
    return app.inject(injection);
  };

  const login: Harness['login'] = async (email, secret = password) => {
    const response = await request('POST', '/v1/auth/login', {
      payload: { identifier: email, password: secret },
    });
    if (response.statusCode !== 200) {
      throw new Error(`Login failed for ${email}: ${response.statusCode} ${response.body}`);
    }
    const setCookie = response.headers['set-cookie'];
    return String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] ?? '';
  };

  return {
    app,
    admin,
    delivery,
    mailbox,
    mailer: module.get(NotificationMailer),
    objects,
    ingestion,
    engine,
    fake,
    priceCatalog,
    ids,
    emails,
    suffix,
    login,
    request,
    async close() {
      if (engine instanceof TemporalTestRuntime) await engine.close();
      await app.close();
      await runtimePool.end().catch(() => undefined);
      await admin.query(`drop owned by ${roleName}`).catch(() => undefined);
      await admin.query(`drop role ${roleName}`);
      await admin.end();
    },
  };
}

export function setCookieOf(response: LightMyRequestResponse): string {
  const value = response.headers['set-cookie'];
  return String(Array.isArray(value) ? value[0] : value).split(';')[0] ?? '';
}
