import { describe, expect, it } from 'vitest';

import { VoiceRateLimiter } from '../src/voice/voice-rate-limit.js';

describe('voice rate limiter', () => {
  it('lets a burst up to the limit through and then says how long to wait', () => {
    let now = 1_000;
    const limiter = new VoiceRateLimiter(3, 60_000, () => now);
    expect([limiter.take('a'), limiter.take('a'), limiter.take('a')]).toEqual([0, 0, 0]);
    now += 10_000;
    expect(limiter.take('a')).toBe(50_000);
  });

  it('frees a slot as the window passes and counts each account on its own', () => {
    let now = 0;
    const limiter = new VoiceRateLimiter(1, 1_000, () => now);
    expect(limiter.take('a')).toBe(0);
    expect(limiter.take('b')).toBe(0);
    expect(limiter.take('a')).toBeGreaterThan(0);
    now = 1_000;
    expect(limiter.take('a')).toBe(0);
  });

  it('does not count a refused call against the account', () => {
    let now = 0;
    const limiter = new VoiceRateLimiter(1, 1_000, () => now);
    limiter.take('a');
    for (let i = 0; i < 5; i += 1) limiter.take('a');
    now = 1_000;
    expect(limiter.take('a')).toBe(0);
  });
});
