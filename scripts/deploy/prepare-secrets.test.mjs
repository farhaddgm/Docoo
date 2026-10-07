import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { prepareSecrets, serviceEnvironments } from './prepare-secrets.mjs';
test('service secrets are separated and unknown secrets never reach web or workers', () => {
  const env = serviceEnvironments(
    { POSTGRES_RUNTIME_PASSWORD: 'a@b:c' },
    {
      SESSION_PEPPER: 'pepper',
      SECRET_MASTER_KEY: 'key',
      S3_SECRET_ACCESS_KEY: 's3',
      SMTP_URL: 'smtp://example',
      UNEXPECTED_SECRET: 'hidden',
      PDF_RENDERER_TOKEN: 'renderer',
    },
  );
  assert.match(env.api.DATABASE_URL, /a%40b%3Ac/);
  for (const service of ['web', 'worker-ingestion', 'document-renderer']) {
    assert.equal(env[service].SESSION_PEPPER, undefined);
    assert.equal(env[service].SECRET_MASTER_KEY, undefined);
  }
  assert.equal(env.web.S3_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.web.DATABASE_URL, undefined);
  assert.equal(env['worker-agent'].S3_SECRET_ACCESS_KEY, undefined);
  assert.equal(env['worker-agent'].SECRET_MASTER_KEY, 'key');
  for (const values of Object.values(env)) assert.equal(values.UNEXPECTED_SECRET, undefined);
});

test('preparing private files preserves JSON keys and dollar signs without rewriting installer settings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'docoo-secret-test-'));
  try {
    const settings =
      'DOCOO_VERSION=v0.23.0\nEDGE_PROXY=existing-proxy\nPOSTGRES_RUNTIME_PASSWORD=test-only\n';
    writeFileSync(join(directory, '.env'), settings);
    const previous = JSON.stringify({ old: 'A'.repeat(44) });
    writeFileSync(
      join(directory, '.env.production'),
      `SESSION_PEPPER='literal$dollar'\nSECRET_PREVIOUS_MASTER_KEYS='${previous}'\n`,
    );
    prepareSecrets(directory);
    prepareSecrets(directory);
    assert.ok(readFileSync(join(directory, '.env'), 'utf8').startsWith(settings));
    const app = parseEnv(readFileSync(join(directory, '.env.production'), 'utf8'));
    assert.equal(app.SECRET_PREVIOUS_MASTER_KEYS, previous);
    assert.equal(app.SESSION_PEPPER, 'literal$dollar');
    assert.ok(
      readFileSync(join(directory, '.env.api'), 'utf8').includes(
        'SECRET_PREVIOUS_MASTER_KEYS=' + previous,
      ),
    );
    for (const name of [
      '.env',
      '.env.production',
      '.env.api',
      '.env.web',
      '.env.document-renderer',
    ])
      assert.equal(statSync(join(directory, name)).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
