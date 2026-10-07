import { describe, expect, it, vi } from 'vitest';
import type { Environment } from '@docoo/config';
import type { Pool } from 'pg';
import type { FastifyRequest } from 'fastify';
import { SecurityHealthController } from '../src/security-health.controller.js';
import type { AuthService } from '../src/auth/auth.service.js';

describe('security monitor access', () => {
  const monitorToken = 'test-monitor-token-longer-than-32-characters';
  const request = (token?: string) =>
    ({ headers: token ? { authorization: `Bearer ${token}` } : {}, cookies: {} }) as FastifyRequest;
  it('rejects missing, wrong and unconfigured tokens before querying audit data', async () => {
    const query = vi.fn();
    for (const configured of ['', monitorToken]) {
      const controller = new SecurityHealthController(
        { SECURITY_MONITOR_TOKEN: configured } as Environment,
        { query } as unknown as Pool,
        {} as AuthService,
      );
      await expect(controller.signals(request())).rejects.toThrow();
      await expect(controller.signals(request('wrong-token'))).rejects.toThrow();
    }
    expect(query).not.toHaveBeenCalled();
  });
  it('returns only aggregate signals and distinguishes absent mail and backups from failures', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ failed_logins: '20', access_changes: '1', private_data: 'never expose' }],
    });
    const controller = new SecurityHealthController(
      {
        SECURITY_MONITOR_TOKEN: monitorToken,
        SMTP_URL: '',
        BACKUP_CONFIGURED: 'false',
      } as Environment,
      { query } as unknown as Pool,
      {} as AuthService,
    );
    expect(await controller.signals(request(monitorToken))).toEqual({
      emailConfigured: false,
      backupConfigured: false,
      signals: ['repeated_login_failures', 'account_access_changed'],
    });
  });
  it('only lets the owner inspect mail configuration', async () => {
    const auth = {
      currentSession: vi.fn().mockResolvedValue({ user: { email: 'user@example.test' } }),
      isOwner: vi.fn().mockReturnValue(false),
    };
    const controller = new SecurityHealthController(
      { SMTP_URL: '' } as Environment,
      {} as Pool,
      auth as unknown as AuthService,
    );
    await expect(controller.mailStatus(request())).rejects.toThrow();
    auth.isOwner.mockReturnValue(true);
    expect(await controller.mailStatus(request())).toEqual({ emailConfigured: false });
  });
});
