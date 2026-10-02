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
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(1800),
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
