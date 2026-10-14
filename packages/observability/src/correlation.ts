import { AsyncLocalStorage } from 'node:async_hooks';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const uuidPattern = new RegExp(`^${uuid}$`, 'u');
const workflowPattern = new RegExp(
  `^(?:project-${uuid}-run-[1-9][0-9]{0,8}|document-writing-${uuid}|decision-research-${uuid}|ingest-${uuid})$`,
  'u',
);

export const correlationKeys = [
  'tenantId',
  'projectId',
  'workflowId',
  'runId',
  'temporalRunId',
  'stageRunId',
  'attemptId',
  'requestId',
  'traceId',
  'spanId',
] as const;
export type CorrelationKey = (typeof correlationKeys)[number];
export type CorrelationFields = Readonly<Record<CorrelationKey, string | null>>;
export type CorrelationInput = Partial<Record<CorrelationKey, unknown>>;

const store = new AsyncLocalStorage<CorrelationFields>();

/** Identifiers have strict shapes; unknown fields and payloads never enter the log context. */
export function correlationFields(input: CorrelationInput = {}): CorrelationFields {
  return Object.fromEntries(
    correlationKeys.map((key) => {
      const value = input[key];
      const pattern =
        key === 'workflowId'
          ? workflowPattern
          : key === 'traceId'
            ? /^(?!0{32}$)[0-9a-f]{32}$/u
            : key === 'spanId'
              ? /^(?!0{16}$)[0-9a-f]{16}$/u
              : uuidPattern;
      return [key, typeof value === 'string' && pattern.test(value) ? value : null];
    }),
  ) as Record<CorrelationKey, string | null>;
}

export function currentCorrelation(): CorrelationFields {
  return store.getStore() ?? correlationFields();
}

/** Nested work may inherit its request, but switching tenant clears every inherited identifier. */
export function withCorrelation<T>(input: CorrelationInput, work: () => T): T {
  const current = currentCorrelation();
  const inherited =
    input.tenantId !== undefined && input.tenantId !== current.tenantId ? {} : current;
  const supplied = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  return store.run(correlationFields({ ...inherited, ...supplied }), work);
}

export type CorrelationEvent =
  | 'api.request.completed'
  | 'api.runtime'
  | 'api.lifecycle'
  | 'api.lifecycle.failed'
  | 'workflow.activity.started'
  | 'workflow.activity.completed'
  | 'workflow.activity.failed'
  | 'provider.invoke.started'
  | 'provider.invoke.completed'
  | 'provider.invoke.failed'
  | 'worker.ready'
  | 'worker.stopping'
  | 'worker.failed'
  | 'worker.secret_key.missing'
  | 'worker.scanner.missing'
  | 'worker.sdk';

/** A whitelist, rather than redaction, keeps prompts, exceptions and secret-shaped metadata out. */
export function correlationRecord(
  event: CorrelationEvent,
  details: Record<string, unknown> = {},
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: event.endsWith('.failed') || event === 'worker.secret_key.missing' ? 'error' : 'info',
    event,
    ...currentCorrelation(),
  };
  if (['debug', 'info', 'warn', 'error'].includes(details['logLevel'] as string))
    record['level'] = details['logLevel'];
  for (const [key, values] of Object.entries({
    service: ['api', 'worker-agent', 'worker-ingestion', 'provider-runtime'],
    provider: ['openai', 'anthropic', 'google', 'gemini', 'openrouter', 'fake'],
    outcome: ['succeeded', 'failed', 'cancelled'],
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
  })) {
    if (values.includes(details[key] as string)) record[key] = details[key];
  }
  for (const key of ['durationMs', 'retryNo', 'httpStatus']) {
    const value = details[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000)
      record[key] = value;
  }
  if (typeof details['invocationId'] === 'string' && uuidPattern.test(details['invocationId']))
    record['invocationId'] = details['invocationId'];
  return record;
}

export function logCorrelation(
  event: CorrelationEvent,
  details: Record<string, unknown> = {},
): void {
  const record = correlationRecord(event, details);
  const ranks: Record<string, number> = {
    trace: 0,
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    fatal: 50,
    silent: 100,
  };
  const minimum = process.env['LOG_LEVEL'] ?? 'info';
  if ((ranks[record['level'] as string] ?? 20) < (ranks[minimum] ?? 20)) return;
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
