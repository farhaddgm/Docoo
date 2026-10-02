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

import { AppModule } from '../../src/app.module.js';
import {
  PASSWORD_RESET_DELIVERY,
  type PasswordResetDelivery,
  type PasswordResetMessage,
} from '../../src/auth/auth.reset-delivery.js';
import { INGESTION_DISPATCHER, OBJECT_STORE } from '../../src/sources/ingestion.providers.js';
import { DATABASE_POOL } from '../../src/tokens.js';

export const adminUrl = process.env['DATABASE_TEST_ADMIN_URL'];
export const webOrigin = 'http://localhost:3000';
export const testPepper = 'docoo-integration-pepper-with-at-least-32-chars';
export const password = 'integration-password-1';

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

export interface Harness {
  readonly app: NestFastifyApplication;
  readonly admin: Client;
  readonly delivery: CapturingResetDelivery;
  readonly objects: MemoryObjectStore;
  readonly ingestion: InlineIngestion;
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
export async function createHarness(name: string): Promise<Harness> {
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

  const delivery = new CapturingResetDelivery();
  const objects = new MemoryObjectStore();
  const ingestion = new InlineIngestion(runtimePool, objects);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_POOL)
    .useValue(runtimePool)
    .overrideProvider(PASSWORD_RESET_DELIVERY)
    .useValue(delivery)
    .overrideProvider(OBJECT_STORE)
    .useValue(objects)
    .overrideProvider(INGESTION_DISPATCHER)
    .useValue(ingestion)
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
    objects,
    ingestion,
    ids,
    emails,
    suffix,
    login,
    request,
    async close() {
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
