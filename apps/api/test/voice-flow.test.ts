import { describe, expect, it } from 'vitest';

import {
  ABUSE_STRIKE_LIMIT,
  createStrikes,
  createTokenBucket,
} from '../src/live-assistant/voice-flow.js';

describe('the token bucket', () => {
  it('starts full, refuses what it does not have and takes nothing then', () => {
    let at = 0;
    const bucket = createTokenBucket({ ratePerSecond: 10, burst: 100, now: () => at });
    expect(bucket.take(60)).toBe(true);
    expect(bucket.take(60)).toBe(false); // 40 left
    expect(bucket.take(40)).toBe(true); // the refusal took nothing
    expect(bucket.take(1)).toBe(false);
    at = 1_000; // one second: ten more
    expect(bucket.take(10)).toBe(true);
    expect(bucket.take(1)).toBe(false);
  });

  it('never holds more than its burst, however long it was left alone', () => {
    let at = 0;
    const bucket = createTokenBucket({ ratePerSecond: 10, burst: 100, now: () => at });
    at = 3_600_000;
    expect(bucket.take(100)).toBe(true);
    expect(bucket.take(1)).toBe(false);
  });

  it('does not refill from a clock that goes backwards', () => {
    let at = 10_000;
    const bucket = createTokenBucket({ ratePerSecond: 10, burst: 100, now: () => at });
    expect(bucket.take(100)).toBe(true);
    at = 5_000;
    expect(bucket.take(1)).toBe(false);
  });
});

describe('strikes', () => {
  it('close the link only past the limit, and accepted items take strikes back', () => {
    const strikes = createStrikes(3);
    expect([strikes.dropped(), strikes.dropped(), strikes.dropped()]).toEqual([
      false,
      false,
      false,
    ]);
    strikes.accepted();
    expect(strikes.dropped()).toBe(false); // back to three
    expect(strikes.dropped()).toBe(true); // four: past the limit
  });

  it('never goes below zero, and has a sensible default limit', () => {
    const strikes = createStrikes();
    for (let i = 0; i < 1_000; i += 1) strikes.accepted();
    for (let i = 0; i < ABUSE_STRIKE_LIMIT; i += 1) expect(strikes.dropped()).toBe(false);
    expect(strikes.dropped()).toBe(true);
  });
});
