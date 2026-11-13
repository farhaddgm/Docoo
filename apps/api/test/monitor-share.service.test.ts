import { hash } from '@node-rs/argon2';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MonitorShareService } from '../src/monitor/monitor-share.service.js';
import type { WorkspaceRequestContext } from '../src/common/request-context.js';

vi.mock('../src/common/audit.js', () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

const context = {
  workspaceId: '810b1170-629e-4718-b880-5cb0b81d6f32',
  actorId: '405c9eaa-d469-493c-94b3-6ec7744df8e7',
  correlationId: 'c',
} as unknown as WorkspaceRequestContext;

const config = {
  SESSION_PEPPER: 'pepper-pepper-pepper-pepper-pepper',
  NODE_ENV: 'test',
  PASSWORD_ARGON2_MEMORY_KIB: 8,
  PASSWORD_ARGON2_ITERATIONS: 1,
  PASSWORD_ARGON2_PARALLELISM: 1,
};
const token = 'A'.repeat(43);

type Handler = (sql: string, values?: unknown[]) => { rows: unknown[]; rowCount?: number };

function setup(handler: Handler) {
  const queries: { sql: string; values?: unknown[] | undefined }[] = [];
  const client = {
    query: vi.fn((sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (/^(begin|commit|rollback)/u.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve(handler(sql, values));
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn().mockResolvedValue(client), query: client.query };
  const database = {
    run: vi.fn((_c: unknown, work: (c: unknown) => unknown) => work(client)),
  };
  const monitor = {
    clientConfig: vi.fn().mockResolvedValue({ settings: {} }),
    viewerView: vi.fn().mockResolvedValue({ project: null }),
    voiceView: vi.fn().mockResolvedValue({}),
  };
  const service = new MonitorShareService(
    pool as never,
    config as never,
    database as never,
    monitor as never,
  );
  return { service, queries, monitor };
}

const link = async (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  workspace_id: context.workspaceId,
  kind: 'viewer',
  password_hash: await hash('correct horse', { memoryCost: 8, timeCost: 1, parallelism: 1 }),
  max_sessions: 2,
  created_by: context.actorId,
  expires_at: null,
  ended: false,
  ...over,
});

describe('MonitorShareService', () => {
  let row: Record<string, unknown>;
  beforeEach(async () => {
    row = await link();
  });

  it('stores only digests and a hash, and shows the address once', async () => {
    const { service, queries } = setup((sql) =>
      /insert into monitor_share_links/u.test(sql)
        ? { rows: [{ id: 'l1', created_at: new Date('2026-11-11T00:00:00Z') }] }
        : { rows: [] },
    );
    const made = await service.create(context, {
      kind: 'viewer',
      password: 'correct horse',
      expiresAt: null,
      maxSessions: 3,
      label: '',
    });
    const insert = queries.find((q) => /insert into monitor_share_links/u.test(q.sql))!;
    const values = insert.values as string[];
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(values).not.toContain(made.token);
    expect(values).not.toContain('correct horse');
    expect(values[4]).toMatch(/^\$argon2/u);
  });

  it('refuses a wrong password and hides nothing but the kind before it', async () => {
    const { service } = setup(() => ({ rows: [row] }));
    expect(await service.info(token)).toEqual({ kind: 'viewer' });
    await expect(service.unlock(token, 'wrong', '1.1.1.1')).rejects.toMatchObject({
      response: { code: 'MONITOR_SHARE_WRONG_PASSWORD' },
    });
  });

  it('slows down repeated wrong passwords', async () => {
    const { service } = setup(() => ({ rows: [row] }));
    for (let i = 0; i < 8; i += 1) await service.unlock(token, 'x', '2.2.2.2').catch(() => 0);
    await expect(service.unlock(token, 'x', '2.2.2.2')).rejects.toMatchObject({ status: 429 });
  });

  it('answers 410 for an ended link and 404 for an unknown one', async () => {
    const ended = setup(() => ({ rows: [{ ...row, ended: true }] }));
    await expect(ended.service.info(token)).rejects.toMatchObject({ status: 410 });
    const unknown = setup(() => ({ rows: [] }));
    await expect(unknown.service.info(token)).rejects.toMatchObject({ status: 404 });
  });

  it('lets a watcher in only while there is room', async () => {
    const full = setup((sql) =>
      /count\(\*\)/u.test(sql) ? { rows: [{ n: '2' }] } : { rows: [row] },
    );
    await expect(full.service.unlock(token, 'correct horse', '3.3.3.3')).rejects.toMatchObject({
      response: { code: 'MONITOR_SHARE_FULL' },
    });
    const room = setup((sql) =>
      /count\(\*\)/u.test(sql) ? { rows: [{ n: '1' }] } : { rows: [row] },
    );
    const opened = await room.service.unlock(token, 'correct horse', '4.4.4.4');
    expect(opened.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(room.queries.some((q) => /insert into monitor_share_sessions/u.test(q.sql))).toBe(true);
  });

  it('needs a session before it shows anything', async () => {
    const { service, monitor } = setup((sql) =>
      /from monitor_share_sessions where/u.test(sql) ? { rows: [] } : { rows: [row] },
    );
    await expect(service.view(token, undefined)).rejects.toMatchObject({
      response: { code: 'MONITOR_SHARE_LOCKED' },
    });
    expect(monitor.viewerView).not.toHaveBeenCalled();
  });

  it('shows the monitor as the link owner once the session is known', async () => {
    const { service, monitor } = setup((sql) => {
      if (/from monitor_share_sessions where/u.test(sql)) return { rows: [{ created: true }] };
      if (/count\(\*\)/u.test(sql)) return { rows: [{ n: '0' }] };
      if (/from workspaces/u.test(sql)) return { rows: [{ name: 'Acme' }] };
      return { rows: [row] };
    });
    const answer = await service.view(token, 'session');
    expect(answer.kind).toBe('viewer');
    expect(answer.look.workspaceName).toBe('Acme');
    expect(monitor.viewerView).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: context.workspaceId, actorId: context.actorId }),
    );
  });
});
