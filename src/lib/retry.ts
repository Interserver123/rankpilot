/** Exponential backoff with full jitter, capped. `attempt` is 1-based. */
export function backoffDelayMs(attempt: number, baseMs = 30_000, capMs = 30 * 60_000, random = Math.random): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

/** Parses an HTTP Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
