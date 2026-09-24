import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';

import { DATABASE_POOL } from './tokens.js';

@Injectable()
export class HealthService implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async checkDatabase(): Promise<{ status: 'up' | 'down'; latencyMs?: number }> {
    const startedAt = performance.now();
    try {
      await this.pool.query('select 1');
      return { status: 'up', latencyMs: Math.round(performance.now() - startedAt) };
    } catch {
      return { status: 'down' };
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
