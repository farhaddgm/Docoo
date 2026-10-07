import { z } from 'zod';

const emptyStringToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://docoo_runtime:docoo-runtime-local-change-me@localhost:5432/docoo'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  SESSION_PEPPER: z.string().min(32),
  SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().min(300).default(1800),
  SESSION_ABSOLUTE_TTL_SECONDS: z.coerce.number().int().min(3600).default(86400),
  PASSWORD_ARGON2_MEMORY_KIB: z.coerce.number().int().min(19_456).max(1_048_576).default(19_456),
  PASSWORD_ARGON2_ITERATIONS: z.coerce.number().int().min(2).max(20).default(2),
  PASSWORD_ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),
  AUTH_LOCKOUT_THRESHOLD: z.coerce.number().int().min(3).max(20).default(5),
  AUTH_LOCKOUT_BASE_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  AUTH_LOCKOUT_MAX_SECONDS: z.coerce.number().int().min(60).max(604_800).default(86_400),
  /** Reverse-proxy hops in front of the API (1 behind Caddy); 0 ignores X-Forwarded-For. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** Per-IP request ceiling; raised only for single-source load and DAST runs. */
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(1_000_000).default(120),
  /** Per-IP ceiling for sign-in and password reset; production keeps 10, only the browser tests raise it. */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(3).max(1_000_000).default(10),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(1800),
  /** SMTP server for password-reset mail, e.g. smtps://user:pass@smtp.example.com:465. */
  SMTP_URL: z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .regex(/^smtps?:\/\//u)
      .optional(),
  ),
  MAIL_FROM: z.string().min(3).default('Docoo <no-reply@localhost>'),
  /** How often the API sends the emails of notifications (ADR-0025); a mail is at most this late. */
  NOTIFICATION_MAIL_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  /**
   * Where the "get prices from the public catalog" button reads from (https only). Empty means
   * LiteLLM's public price catalog; set it to a mirror when the server may not reach GitHub. https only
   * (plain http is accepted for this machine alone, as a stand-in in tests).
   */
  MODEL_PRICE_CATALOG_URL: z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .regex(/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$))/u)
      .max(500)
      .optional(),
  ),
  OTEL_SERVICE_NAME: z.string().min(1).default('docoo-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(emptyStringToUndefined, z.url().optional()),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(input: NodeJS.ProcessEnv): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const errors = z.treeifyError(result.error);
    throw new Error(`Invalid environment configuration: ${JSON.stringify(errors)}`);
  }

  return result.data;
}
