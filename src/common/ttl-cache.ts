/**
 * Minimal in-process TTL cache for expensive, repeatedly-hit read aggregates (pipeline
 * summaries, dashboard KPIs) — no Redis dependency, deliberately not shared across instances.
 * A short TTL (seconds, not minutes) means staleness self-heals on its own; there's no explicit
 * invalidation on write, matching the same "poll, don't push" tradeoff already used for the
 * public blog feed elsewhere in this app — simple and correct-enough beats exact-and-fragile for
 * numbers that are read far more often than they change.
 */
export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  async getOrSet(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await compute();
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }
}
