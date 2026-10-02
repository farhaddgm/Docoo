import { Global, Module } from '@nestjs/common';
import { parseEnvironment, type Environment } from '@docoo/config';
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
      useFactory: (config: Environment): Pool =>
        new Pool({
          connectionString: config.DATABASE_URL,
          max: 10,
          application_name: 'docoo-api',
          statement_timeout: 15_000,
        }),
    },
    WorkspaceDatabase,
  ],
  exports: [API_CONFIG, DATABASE_POOL, WorkspaceDatabase],
})
export class CoreModule {}
