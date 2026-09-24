import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync } from 'node:fs';

import { createDatabase } from './client.js';

const localEnv = new URL('../../../.env', import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const connectionString = process.env['DATABASE_ADMIN_URL'];
if (!connectionString) {
  throw new Error('DATABASE_ADMIN_URL is required to run migrations.');
}

const { db, pool } = createDatabase({ connectionString, max: 1 });

try {
  await migrate(db, { migrationsFolder: new URL('../migrations', import.meta.url).pathname });
} finally {
  await pool.end();
}
