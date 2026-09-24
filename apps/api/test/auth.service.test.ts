import { hash } from '@node-rs/argon2';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Pool } from 'pg';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseEnvironment } from '@docoo/config';

import { AuthService } from '../src/auth/auth.service.js';
import { digestSecret } from '../src/auth/auth.crypto.js';

const pepper = 'a-test-only-session-pepper-with-32-characters';
const user = {
  id: '405c9eaa-d469-493c-94b3-6ec7744df8e7',
  email: 'admin@example.test',
  password_hash: '',
  display_name: 'Docoo Admin',
  status: 'active' as const,
};
const workspace = {
  id: '810b1170-629e-4718-b880-5cb0b81d6f32',
  code: 'main',
  name: 'Docoo',
  role: 'super_admin' as const,
};
const metadata = {
  correlationId: '3cfbfa56-0d37-4d82-927a-398a5cf3f86f',
  origin: 'http://localhost:3000',
  ip: '127.0.0.1',
  userAgent: 'auth-service-test',
};

describe('AuthService', () => {
  beforeAll(async () => {
    user.password_hash = await hash('correct-test-password', {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  });

  it('stores only a peppered session digest and returns workspace-scoped identity', async () => {
    const clientQuery = vi.fn((statement: string, values?: readonly unknown[]) => {
      if (statement.includes('from users')) return { rows: [user], rowCount: 1 };
      if (statement.includes('auth_user_workspaces')) return { rows: [workspace], rowCount: 1 };
      if (statement.includes('insert into sessions')) return { rows: [], rowCount: 1, values };
      if (statement.includes('insert into auth_events')) return { rows: [], rowCount: 1, values };
      return { rows: [], rowCount: 1 };
    });
    const poolQuery = vi.fn((statement: string) => {
      if (statement.includes('from users')) return { rows: [user], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const pool = {
      query: poolQuery,
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
    } as unknown as Pool;
    const service = new AuthService(pool, parseEnvironment({ SESSION_PEPPER: pepper }));

    const result = await service.login('ADMIN@example.test', 'correct-test-password', metadata);
    const sessionInsert = clientQuery.mock.calls.find(([statement]) =>
      statement.includes('insert into sessions'),
    );
    const auditInsert = clientQuery.mock.calls.find(([statement]) =>
      statement.includes('insert into auth_events'),
    );

    expect(result.user).toMatchObject({ id: user.id, role: 'super_admin' });
    expect(result.workspaces).toEqual([workspace]);
    expect(sessionInsert?.[1]?.[1]).toBe(digestSecret(result.token, pepper));
    expect(sessionInsert?.[1]?.[1]).not.toBe(result.token);
    expect(auditInsert?.[1]?.[1]).toBe('login.succeeded');
    expect(auditInsert?.[1]?.[2]).toBe(digestSecret('admin@example.test', pepper));
    expect(auditInsert?.[1]?.[2]).not.toBe('admin@example.test');
  });

  it('records a generic failure for unknown identifiers without storing the raw identifier', async () => {
    const poolQuery = vi.fn((statement: string, values?: readonly unknown[]) => ({
      rows: [],
      rowCount: 0,
      statement,
      values,
    }));
    const pool = { query: poolQuery } as unknown as Pool;
    const service = new AuthService(pool, parseEnvironment({ SESSION_PEPPER: pepper }));

    await expect(
      service.login('missing@example.test', 'wrong-password', metadata),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const auditInsert = poolQuery.mock.calls.find(([statement]) =>
      statement.includes('insert into auth_events'),
    );
    expect(auditInsert?.[1]?.[1]).toBe('login.failed');
    expect(auditInsert?.[1]?.[2]).toBe(digestSecret('missing@example.test', pepper));
    expect(auditInsert?.[1]?.[2]).not.toBe('missing@example.test');
  });

  it('rejects cross-origin state changes', () => {
    const service = new AuthService({} as Pool, parseEnvironment({ SESSION_PEPPER: pepper }));

    expect(() =>
      service.assertSameOrigin({ ...metadata, origin: 'https://attacker.invalid' }),
    ).toThrow(ForbiddenException);
  });

  it('revokes a session and records logout atomically', async () => {
    const statements: string[] = [];
    const clientQuery = vi.fn((statement: string) => {
      statements.push(statement);
      if (statement.includes('update sessions')) {
        return { rows: [{ user_id: user.id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release }),
    } as unknown as Pool;
    const service = new AuthService(pool, parseEnvironment({ SESSION_PEPPER: pepper }));

    await service.logout('test-session-token', metadata);

    expect(statements).toEqual([
      'begin',
      expect.stringContaining('update sessions'),
      expect.stringContaining('insert into auth_events'),
      'commit',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not claim a successful logout for an unknown session', async () => {
    const clientQuery = vi.fn((statement: string) => {
      if (statement.includes('update sessions')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() });
    const pool = {
      connect,
    } as unknown as Pool;
    const service = new AuthService(pool, parseEnvironment({ SESSION_PEPPER: pepper }));

    await service.logout(undefined, metadata);
    expect(connect).not.toHaveBeenCalled();

    await service.logout('unknown-session-token', metadata);
    expect(clientQuery.mock.calls.some(([statement]) => statement.includes('auth_events'))).toBe(
      false,
    );
  });

  it('rolls back revocation if the logout audit insert fails', async () => {
    const statements: string[] = [];
    const clientQuery = vi.fn((statement: string) => {
      statements.push(statement);
      if (statement.includes('update sessions')) {
        return Promise.resolve({ rows: [{ user_id: user.id }], rowCount: 1 });
      }
      if (statement.includes('insert into auth_events')) {
        return Promise.reject(new Error('audit unavailable'));
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const pool = {
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
    } as unknown as Pool;
    const service = new AuthService(pool, parseEnvironment({ SESSION_PEPPER: pepper }));

    await expect(service.logout('test-session-token', metadata)).rejects.toThrow(
      'audit unavailable',
    );
    expect(statements.at(-1)).toBe('rollback');
    expect(statements).not.toContain('commit');
  });
});
