import {
  Controller,
  Get,
  Header,
  Inject,
  Req,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Environment } from '@docoo/config';
import type { Pool } from 'pg';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { API_CONFIG, DATABASE_POOL } from './tokens.js';
import { AuthService } from './auth/auth.service.js';

@Controller()
export class SecurityHealthController {
  constructor(
    @Inject(API_CONFIG) private readonly config: Environment,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly auth: AuthService,
  ) {}

  @Get('me/security-status')
  @Header('Cache-Control', 'no-store')
  async mailStatus(@Req() request: FastifyRequest) {
    const session = await this.auth.currentSession(request.cookies['docoo_session']);
    if (!this.auth.isOwner(session.user.email)) throw new ForbiddenException();
    return { emailConfigured: !!this.config.SMTP_URL };
  }

  @Get('health/security')
  @Header('Cache-Control', 'no-store')
  async signals(@Req() request: FastifyRequest) {
    const token = this.config.SECURITY_MONITOR_TOKEN;
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (
      token.length < 32 ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new UnauthorizedException();
    const rawSince = request.headers['x-docoo-monitor-since'];
    const parsedSince = typeof rawSince === 'string' ? Date.parse(rawSince) : NaN;
    const since =
      Number.isFinite(parsedSince) && parsedSince <= Date.now()
        ? new Date(Math.max(parsedSince, Date.now() - 31 * 24 * 3600 * 1000)).toISOString()
        : null;
    const counts = (
      await this.pool.query<{ failed_logins: string; access_changes: string }>(
        'select * from app.security_signal_counts($1::timestamptz)',
        [since],
      )
    ).rows[0]!;
    const backupConfigured = this.config.BACKUP_CONFIGURED === 'true';
    const last = async (name: string) => {
      try {
        const value = Number(await readFile(`/run/docoo-backup/${name}`, 'utf8'));
        return Number.isFinite(value) && value > 0 ? value : null;
      } catch {
        return null;
      }
    };
    const databaseBackup = await last('database-success');
    const objectBackup = await last('objects-success');
    const stale = (value: number | null) => value === null || Date.now() / 1000 - value > 26 * 3600;
    return {
      emailConfigured: !!this.config.SMTP_URL,
      backupConfigured,
      signals: [
        ...(Number(counts.failed_logins) >= 20 ? ['repeated_login_failures'] : []),
        ...(Number(counts.access_changes) > 0 ? ['account_access_changed'] : []),
        ...(backupConfigured && (stale(databaseBackup) || stale(objectBackup))
          ? ['backup_overdue']
          : []),
      ],
    };
  }
}
