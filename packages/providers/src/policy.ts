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

/**
 * Used when no price was entered for a model, so a missing price can never switch the cost ceiling
 * off: it deliberately errs high (USD per million tokens). The administrator enters the real price
 * on the providers page; calls priced this way are marked as estimates there and on the costs page.
 */
export const FALLBACK_PRICE: PriceSnapshot = {
  currency: 'USD',
  inputPerMillion: 10,
  outputPerMillion: 40,
  effectiveFrom: '1970-01-01T00:00:00.000Z',
};

/**
 * Cost of one call. `usage.outputTokens` never includes reasoning tokens (adapters split them), so
 * reasoning is added on top and, without its own price, billed like output.
 */
export function estimateCostUsd(usage: Usage, price: PriceSnapshot | null): number | null {
  if (!price) return null;
  const cached = usage.cachedInputTokens ?? 0;
  const freshInput = Math.max(0, usage.inputTokens - cached);
  const cost =
    (freshInput * price.inputPerMillion +
      cached * (price.cachedInputPerMillion ?? price.inputPerMillion) +
      usage.outputTokens * price.outputPerMillion +
      (usage.reasoningTokens ?? 0) * (price.reasoningPerMillion ?? price.outputPerMillion)) /
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

/** Tokens a call may generate, by what it is for; a long structured answer must not be cut at 4096. */
const OUTPUT_BUDGETS: readonly (readonly [prefix: string, tokens: number])[] = [
  ['analysis:round', 16_000],
  ['stage:', 16_000],
  ['solutions', 16_000],
  ['evaluation', 8_000],
  ['brain:evaluate', 8_000],
  ['selfcheck', 4_000],
];
const DEFAULT_OUTPUT_BUDGET = 8_000;
const MIN_OUTPUT_BUDGET = 1_024;

/**
 * The output limit sent with a call: the budget of its purpose, held under what the model can
 * produce when the model catalog says so (an older model rejects a limit above its own).
 */
export function outputBudgetTokens(purpose: string, modelMaxOutputTokens: number | null): number {
  const budget =
    OUTPUT_BUDGETS.find(([prefix]) => purpose.startsWith(prefix))?.[1] ?? DEFAULT_OUTPUT_BUDGET;
  if (modelMaxOutputTokens === null || !Number.isFinite(modelMaxOutputTokens)) return budget;
  return Math.max(MIN_OUTPUT_BUDGET, Math.min(budget, Math.floor(modelMaxOutputTokens)));
}
