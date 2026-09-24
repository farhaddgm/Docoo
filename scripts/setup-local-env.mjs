import { randomBytes } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { stdout } from 'node:process';

const templateUrl = new URL('../.env.example', import.meta.url);
const envUrl = new URL('../.env', import.meta.url);
const template = await readFile(templateUrl, 'utf8');

if (!/^SESSION_PEPPER=.*$/m.test(template)) {
  throw new Error('.env.example must define SESSION_PEPPER.');
}

const localEnvironment = template.replace(
  /^SESSION_PEPPER=.*$/m,
  `SESSION_PEPPER=${randomBytes(32).toString('base64')}`,
);

let file;
try {
  file = await open(envUrl, 'wx', 0o600);
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
    throw new Error('.env already exists; refusing to overwrite local configuration.');
  }
  throw error;
}

try {
  await file.writeFile(localEnvironment, 'utf8');
  await file.close();
  stdout.write('Created .env with a fresh local SESSION_PEPPER. Keep this file private.\n');
} catch (error) {
  await file.close().catch(() => undefined);
  throw error;
}
