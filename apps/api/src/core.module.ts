import { Global, Module } from '@nestjs/common';
import { parseEnvironment, type Environment } from '@docoo/config';
import { logCorrelation } from '@docoo/observability';
import { Pool } from 'pg';

import { WorkspaceDatabase } from './common/workspace-database.js';
import { API_CONFIG, DATABASE_POOL } from './tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: API_CONFIG,
      useFactory: (): Environment => parseEnvironment(process.env),
    },
    {
      provide: DATABASE_POOL,
      inject: [API_CONFIG],
      useFactory: (config: Environment): Pool => {
        const pool = new Pool({
          connectionString: config.DATABASE_URL,
          max: 10,
          connectionTimeoutMillis: 5000,
          application_name: 'docoo-api',
          statement_timeout: 15_000,
          keepAlive: true,
        });
        // An idle connection can be dropped (database restart, network blip). Without an 'error' listener
        // pg re-throws it as an uncaught exception and the whole process dies; with one, the pool
        // discards the broken client and opens a new one on the next query.
        pool.on('error', () => logCorrelation('api.lifecycle.failed', { service: 'api' }));
        return pool;
      },
    },
    WorkspaceDatabase,
  ],
  exports: [API_CONFIG, DATABASE_POOL, WorkspaceDatabase],
})
export class CoreModule {}
