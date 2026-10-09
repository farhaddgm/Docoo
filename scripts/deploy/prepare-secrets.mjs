import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const shared = [
  'NODE_ENV',
  'DATABASE_URL',
  'TEMPORAL_ADDRESS',
  'TEMPORAL_NAMESPACE',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'TEMPORAL_METRICS_ADDRESS',
];
export function serviceEnvironments(settings, app) {
  const common = {
    ...app,
    NODE_ENV: 'production',
    DATABASE_URL: `postgresql://docoo_runtime:${encodeURIComponent(settings.POSTGRES_RUNTIME_PASSWORD)}@postgres:5432/docoo`,
    TEMPORAL_ADDRESS: 'temporal:7233',
  };
  const pick = (keys) =>
    Object.fromEntries(
      keys.filter((key) => common[key] !== undefined).map((key) => [key, common[key]]),
    );
  const api = { ...common, BACKUP_CONFIGURED: String(!!settings.BACKUP_S3_PREFIX) };
  delete api.GOOGLE_CLIENT_SECRET;
  delete api.GOOGLE_CLIENT_ID;
  delete api.GOOGLE_REDIRECT_URI;
  // Values from the common source are selected explicitly: a newly added secret is never
  // silently inherited by the browser-facing web process or an unrelated worker.
  const apiKeys = [
    ...shared,
    'KNOWLEDGE_EMBEDDING_ENABLED',
    'KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL',
    'KNOWLEDGE_EMBEDDING_API_KEY',
    'KNOWLEDGE_EMBEDDING_MODEL',
    'WEB_ORIGIN',
    'API_PORT',
    'LOG_LEVEL',
    'REDIS_URL',
    'SESSION_PEPPER',
    'SESSION_IDLE_TTL_SECONDS',
    'SESSION_ABSOLUTE_TTL_SECONDS',
    'PASSWORD_ARGON2_MEMORY_KIB',
    'PASSWORD_ARGON2_ITERATIONS',
    'PASSWORD_ARGON2_PARALLELISM',
    'AUTH_LOCKOUT_THRESHOLD',
    'AUTH_LOCKOUT_BASE_SECONDS',
    'AUTH_LOCKOUT_MAX_SECONDS',
    'TRUST_PROXY_HOPS',
    'API_RATE_LIMIT_PER_MINUTE',
    'AUTH_RATE_LIMIT_PER_MINUTE',
    'PASSWORD_RESET_TTL_SECONDS',
    'SMTP_URL',
    'MAIL_FROM',
    'NOTIFICATION_MAIL_INTERVAL_SECONDS',
    'MODEL_PRICE_CATALOG_URL',
    'SECRET_MASTER_KEY',
    'SECRET_MASTER_KEY_ID',
    'SECRET_PREVIOUS_MASTER_KEYS',
    'ARTIFACT_SIGNING_KEY',
    'PDF_RENDERER_TOKEN',
    'SECURITY_MONITOR_TOKEN',
    'BACKUP_CONFIGURED',
    'OWNER_EMAIL',
    'S3_ENDPOINT',
    'S3_PUBLIC_ENDPOINT',
    'S3_REGION',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_FORCE_PATH_STYLE',
  ];
  const result = {
    api: Object.fromEntries(
      apiKeys.filter((key) => api[key] !== undefined).map((key) => [key, api[key]]),
    ),
    web: pick(['NODE_ENV', 'S3_PUBLIC_ENDPOINT']),
    'worker-agent': pick([
      ...shared,
      'SECRET_MASTER_KEY',
      'SECRET_MASTER_KEY_ID',
      'SECRET_PREVIOUS_MASTER_KEYS',
      'AGENT_CONCURRENCY',
    ]),
    'worker-ingestion': pick([
      ...shared,
      'S3_ENDPOINT',
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_FORCE_PATH_STYLE',
      'CLAMD_HOST',
      'CLAMD_PORT',
      'INGESTION_CONCURRENCY',
      'TRANSCRIPTION_API_KEY',
      'TRANSCRIPTION_BASE_URL',
      'TRANSCRIPTION_MODEL',
    ]),
    'document-renderer': pick(['NODE_ENV', 'PDF_RENDERER_TOKEN']),
  };
  result['worker-agent'].DATABASE_URL =
    `postgresql://docoo_worker_agent:${encodeURIComponent(settings.POSTGRES_AGENT_PASSWORD ?? settings.POSTGRES_RUNTIME_PASSWORD)}@postgres:5432/docoo`;
  result['worker-ingestion'].DATABASE_URL =
    `postgresql://docoo_worker_ingestion:${encodeURIComponent(settings.POSTGRES_INGESTION_PASSWORD ?? settings.POSTGRES_RUNTIME_PASSWORD)}@postgres:5432/docoo`;
  return result;
}
export function prepareSecrets(directory) {
  const settingsFile = resolve(directory, '.env');
  const originalSettings = readFileSync(settingsFile, 'utf8');
  const settings = parseEnv(originalSettings);
  const addedSettings = [];
  const file = resolve(directory, '.env.production');
  const app = parseEnv(readFileSync(file, 'utf8'));
  for (const name of ['POSTGRES_AGENT_PASSWORD', 'POSTGRES_INGESTION_PASSWORD'])
    if (!settings[name]) {
      settings[name] = randomBytes(32).toString('hex');
      addedSettings.push(`${name}=${settings[name]}`);
    }
  for (const name of ['PDF_RENDERER_TOKEN', 'SECURITY_MONITOR_TOKEN'])
    if (!app[name]) app[name] = randomBytes(32).toString('hex');
  const write = (path, values, raw = false) => {
    const encode = (value) => {
      if (/[\r\n]/u.test(value)) throw new Error('Multiline environment values are not supported.');
      if (raw) return value;
      const quote = value.includes("'") ? '"' : "'";
      if (value.includes(quote))
        throw new Error('Mixed quotes in environment value; use URL encoding for credentials.');
      return quote + value + quote;
    };
    writeFileSync(
      path,
      Object.entries(values)
        .map(([key, value]) => `${key}=${encode(value)}\n`)
        .join(''),
      { mode: 0o600 },
    );
    chmodSync(path, 0o600);
  };
  write(file, app);
  if (addedSettings.length)
    writeFileSync(
      settingsFile,
      originalSettings.trimEnd() + '\n' + addedSettings.join('\n') + '\n',
      { mode: 0o600 },
    );
  chmodSync(settingsFile, 0o600);
  for (const [service, values] of Object.entries(serviceEnvironments(settings, app)))
    write(resolve(directory, `.env.${service}`), values, true);
  return { mailConfigured: !!app.SMTP_URL };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const status = prepareSecrets(resolve(process.argv[2] ?? 'deploy'));
  console.log(
    `Service-specific private configuration prepared; SMTP configured: ${status.mailConfigured}.`,
  );
}
