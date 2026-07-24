/**
 * DecisionCache — a minimal TTL-keyed in-memory cache.
 *
 * Purpose: avoid redundant disk reads and network probes (e.g. browser.detect)
 * when the same decision inputs arrive within a short window. The cache is
 * entirely in-process and never persisted, so safety contracts are unaffected.
 *
 * Design constraints:
 *  - Maximum `maxEntries` items (LRU eviction by insertion order).
 *  - Each entry expires after `ttlMs` ms.
 *  - get() returns undefined for expired entries; they are removed lazily.
 *  - Thread-safe within a single-threaded Node.js event loop.
 */
export class DecisionCache<T> {
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  // Map insertion order is FIFO, used for LRU eviction.
  readonly #entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(options: { ttlMs: number; maxEntries?: number }) {
    this.#ttlMs = Math.max(50, Math.min(60_000, options.ttlMs));
    this.#maxEntries = Math.max(1, Math.min(1_000, options.maxEntries ?? 64));
  }

  get(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    // Evict oldest entry when at capacity.
    if (this.#entries.size >= this.#maxEntries && !this.#entries.has(key)) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    this.#entries.set(key, { value, expiresAt: Date.now() + this.#ttlMs });
  }

  /** Invalidate all entries whose key starts with `prefix`. */
  invalidatePrefix(prefix: string): void {
    for (const key of this.#entries.keys()) {
      if (key.startsWith(prefix)) this.#entries.delete(key);
    }
  }

  /** Remove all expired entries. Call periodically to reclaim memory. */
  evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (now > entry.expiresAt) this.#entries.delete(key);
    }
  }

  get size(): number { return this.#entries.size; }
  clear(): void { this.#entries.clear(); }
}

/**
 * BridgeProbeCache — a single-entry cache for browser bridge detect() results.
 *
 * The bridge probe (browser.detect) takes up to 500 ms and is called by both
 * AdaptiveActionRouter and CapabilityStrategyService independently on every
 * route/strategy decision. This cache serialises concurrent calls and reuses
 * the result for `ttlMs` ms (default 1 500 ms — short enough to catch bridge
 * disconnects quickly, long enough to avoid double probing per agent turn).
 */
export class BridgeProbeCache {
  readonly #ttlMs: number;
  #result: { value: { enabled: boolean; paired: boolean; connected: boolean; reason?: string }; expiresAt: number } | undefined;
  #inflight: Promise<{ enabled: boolean; paired: boolean; connected: boolean; reason?: string }> | undefined;
  #cacheHits = 0;
  #freshProbes = 0;

  constructor(ttlMs = 1_500) {
    this.#ttlMs = Math.max(200, Math.min(10_000, ttlMs));
  }

  /**
   * Returns a cached result if still fresh, otherwise calls `probe()` once,
   * caches the result, and returns it. Concurrent callers share the same
   * in-flight promise so the bridge is probed at most once per TTL window.
   */
  async get(
    probe: () => Promise<{ enabled: boolean; paired: boolean; connected: boolean; reason?: string }>
  ): Promise<{ enabled: boolean; paired: boolean; connected: boolean; reason?: string }> {
    const cached = this.#result;
    if (cached !== undefined && Date.now() <= cached.expiresAt) { this.#cacheHits += 1; return cached.value; }
    if (this.#inflight !== undefined) return this.#inflight;
    this.#freshProbes += 1;
    const call = probe().then(
      (value) => {
        this.#result = { value, expiresAt: Date.now() + this.#ttlMs };
        this.#inflight = undefined;
        return value;
      },
      (error: unknown) => {
        this.#inflight = undefined;
        throw error;
      }
    );
    this.#inflight = call;
    return call;
  }

  /** Invalidate the cached result (e.g. after a pairing change). */
  invalidate(): void {
    this.#result = undefined;
    this.#inflight = undefined;
  }

  stats(): { cacheHits: number; freshProbes: number } { return { cacheHits: this.#cacheHits, freshProbes: this.#freshProbes }; }
}
