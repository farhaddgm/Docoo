import { LIVE_VOICE_SAMPLE_RATE } from '@docoo/contracts';

/**
 * Limits on what the browser link may carry (ADR-0055 §4-3, hardening). The relay holds the
 * provider key and every second of microphone audio costs money, so the page is not trusted to send
 * at the pace of real time: a bucket fills at a little above it and anything beyond is dropped, and
 * a link that keeps pushing past the limit is closed. The same goes the other way: a browser that
 * cannot take the assistant's audio as fast as it comes does not get an unbounded buffer on the
 * server.
 */

/** 16-bit mono PCM: what one second of the microphone is. */
export const MIC_BYTES_PER_SECOND = LIVE_VOICE_SAMPLE_RATE * 2;

/** Sustained microphone rate allowed: twice real time (a page catching up after a stall). */
export const MIC_RATE_BYTES_PER_SECOND = MIC_BYTES_PER_SECOND * 2;
/** How much may arrive at once: two seconds of audio. */
export const MIC_BURST_BYTES = MIC_BYTES_PER_SECOND * 2;

/** Control messages (stop speaking, a change's result) a page has no reason to send often. */
export const CONTROL_MESSAGES_PER_SECOND = 20;
export const CONTROL_BURST = 40;

/** Dropped items, net of accepted ones, after which the link is closed. */
export const ABUSE_STRIKE_LIMIT = 120;

/** Audio the server holds for a slow browser: beyond the soft limit it drops, beyond the hard one it closes. */
export const CLIENT_BUFFER_SOFT_BYTES = 1024 * 1024;
export const CLIENT_BUFFER_HARD_BYTES = 4 * 1024 * 1024;

export interface TokenBucket {
  /** Takes `amount` if the bucket has it; false (and nothing taken) otherwise. */
  take(amount: number): boolean;
}

export function createTokenBucket(options: {
  readonly ratePerSecond: number;
  readonly burst: number;
  readonly now?: () => number;
}): TokenBucket {
  const now = options.now ?? Date.now;
  let tokens = options.burst;
  let last = now();
  return {
    take(amount) {
      const at = now();
      const elapsedSeconds = Math.max(0, (at - last) / 1000);
      last = at;
      tokens = Math.min(options.burst, tokens + elapsedSeconds * options.ratePerSecond);
      if (amount > tokens) return false;
      tokens -= amount;
      return true;
    },
  };
}

/**
 * Counts how often a link goes past its limits. Each dropped item is a strike and each accepted
 * one forgives a strike, so a page that is only a little fast is never closed and one that floods is
 * closed after a short run.
 */
export function createStrikes(limit: number = ABUSE_STRIKE_LIMIT): {
  dropped(): boolean;
  accepted(): void;
} {
  let strikes = 0;
  return {
    /** True when the limit is passed and the link should be closed. */
    dropped() {
      strikes += 1;
      return strikes > limit;
    },
    accepted() {
      if (strikes > 0) strikes -= 1;
    },
  };
}
