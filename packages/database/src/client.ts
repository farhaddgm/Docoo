import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema.js';

export function createDatabase(config: PoolConfig) {
  const pool = new Pool(config);
  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}

export type Database = ReturnType<typeof createDatabase>['db'];
