import { Inject, Injectable } from '@nestjs/common';
import { setDatabaseRequestContext } from '@docoo/database';
import type { Pool, PoolClient } from 'pg';

import { DATABASE_POOL } from '../tokens.js';
import type { WorkspaceRequestContext } from './request-context.js';

/** Runs work in one transaction with the RLS tenant context set (ADR-0003). */
@Injectable()
export class WorkspaceDatabase {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * `snapshot` reads everything from one point in time, so a view assembled from several
   * queries cannot mix the states before and after a concurrent commit.
   */
  async run<T>(
    context: WorkspaceRequestContext,
    operation: (client: PoolClient) => Promise<T>,
    options: { snapshot?: boolean } = {},
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(
        options.snapshot ? 'begin isolation level repeatable read read only' : 'begin',
      );
      await setDatabaseRequestContext(client, context);
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
