import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDatabase } from './client.js';

for (const candidate of ['../../../.env', '../../../../.env']) {
  const localEnv = new URL(candidate, import.meta.url);
  if (existsSync(localEnv)) {
    process.loadEnvFile(localEnv);
    break;
  }
}

const connectionString = process.env['DATABASE_ADMIN_URL'];
if (!connectionString) {
  throw new Error('DATABASE_ADMIN_URL is required to run migrations.');
}

const { db, pool } = createDatabase({ connectionString, max: 1 });

try {
  // src/migrate.ts (tsx) and dist/src/migrate.js (production images) both find the folder.
  const migrationsFolder = ['../migrations', '../../migrations']
    .map((path) => fileURLToPath(new URL(path, import.meta.url)))
    .find((path) => existsSync(`${path}/meta/_journal.json`));
  if (!migrationsFolder) throw new Error('The migrations folder was not found.');
  await migrate(db, { migrationsFolder });
} finally {
  await pool.end();
}
