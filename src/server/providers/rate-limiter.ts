/**
 * In-process sliding-window limiter per provider. Cross-worker concurrency is enforced by the
 * job claim query; this caps request rate within a worker process.
 */
export class RateLimiter {
  private stamps: number[] = [];
  private blockedUntil = 0;

  constructor(private perMinute: number, private now: () => number = Date.now) {}

  /** Milliseconds to wait before the next request may be sent (0 = go now). */
  waitTime(): number {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    const blocked = Math.max(0, this.blockedUntil - t);
    if (this.stamps.length < this.perMinute) return blocked;
    return Math.max(blocked, 60_000 - (t - this.stamps[0]!));
  }

  record() { this.stamps.push(this.now()); }

  /** Honour a provider Retry-After. */
  pause(ms: number) { this.blockedUntil = Math.max(this.blockedUntil, this.now() + ms); }

  async acquire(signal?: AbortSignal) {
    for (;;) {
      const w = this.waitTime();
      if (w === 0) { this.record(); return; }
      if (signal?.aborted) throw new Error("aborted");
      await new Promise((r) => setTimeout(r, Math.min(w, 5_000)));
    }
  }
}

const limiters = new Map<string, RateLimiter>();
export function limiterFor(provider: string, perMinute: number): RateLimiter {
  let l = limiters.get(provider);
  if (!l) { l = new RateLimiter(perMinute); limiters.set(provider, l); }
  return l;
}
