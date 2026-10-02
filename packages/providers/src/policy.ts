import { ProviderError, type Usage } from './contract.js';

/** Approved retry schedule in seconds (provider orchestration §10). After it: pause. */
export const RETRY_SCHEDULE_SECONDS = [5, 5, 5, 10, 15, 20, 25, 30, 35, 40] as const;
/** Upper bound for a provider `Retry-After` value. */
export const MAX_RETRY_AFTER_SECONDS = 300;

/**
 * Delay before retry number `retry` (1-based), or null when the schedule is exhausted or
 * the error is not retryable. A larger provider `Retry-After` wins, capped by policy.
 */
export function retryDelaySeconds(retry: number, error: unknown): number | null {
  if (!(error instanceof ProviderError) || !error.retryable) return null;
  const scheduled = RETRY_SCHEDULE_SECONDS[retry - 1];
  if (scheduled === undefined) return null;
  const hint =
    error.retryAfterSeconds === null
      ? 0
      : Math.min(error.retryAfterSeconds, MAX_RETRY_AFTER_SECONDS);
  return Math.max(scheduled, hint);
}

/** Prices are dated snapshots in USD per million tokens and only give estimates. */
export interface PriceSnapshot {
  readonly currency: 'USD';
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cachedInputPerMillion?: number | undefined;
  readonly reasoningPerMillion?: number | undefined;
  readonly effectiveFrom: string;
}

export function estimateCostUsd(usage: Usage, price: PriceSnapshot | null): number | null {
  if (!price) return null;
  const cached = usage.cachedInputTokens ?? 0;
  const freshInput = Math.max(0, usage.inputTokens - cached);
  const cost =
    (freshInput * price.inputPerMillion +
      cached * (price.cachedInputPerMillion ?? price.inputPerMillion) +
      usage.outputTokens * price.outputPerMillion +
      (usage.reasoningTokens ?? 0) * (price.reasoningPerMillion ?? 0)) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export type CostCheck = {
  readonly status: 'ok' | 'warning' | 'exceeded';
  readonly spentUsd: number;
  readonly limitUsd: number;
};

/** Compares the project spend with its ceiling; a warning starts at 80 %. */
export function checkCostLimit(spentUsd: number, limitUsd: number): CostCheck {
  const status = spentUsd >= limitUsd ? 'exceeded' : spentUsd >= limitUsd * 0.8 ? 'warning' : 'ok';
  return { status, spentUsd: Math.round(spentUsd * 1_000_000) / 1_000_000, limitUsd };
}
