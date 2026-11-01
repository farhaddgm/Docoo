/**
 * A sliding window per account for the voice calls that cost money (ADR-0046). The account's AI
 * allowance caps the total; this stops a burst (a loop, a stuck button) from spending it in seconds.
 * It lives in the memory of one API process, which is enough to stop a burst; the allowance is
 * what holds across processes.
 */
export class VoiceRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a call and returns 0, or the milliseconds to wait when the window is full. */
  take(key: string): number {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return this.windowMs - (now - recent[0]!);
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Idle accounts are dropped now and then so the map cannot grow without end.
    if (this.hits.size > 5000) {
      for (const [id, times] of this.hits)
        if (times.every((time) => now - time >= this.windowMs)) this.hits.delete(id);
    }
    return 0;
  }
}
