/**
 * In-memory LRU cache with TTL for API responses.
 * 
 * ponytail: in-memory only. Disk cache adds ~70 lines for marginal benefit
 * (re-cache on restart rather than re-fetch). Add disk layer if cache-miss
 * rate after restart becomes a problem.
 */
import type { CacheEntry } from "./types.ts";

const MAX_SIZE = 50;

export class MemoryCache<T> {
  private cache = new Map<string, CacheEntry<T>>();

  constructor(private defaultTtlMs: number = 300_000) {}

  /** Build a normalized cache key. */
  static key(...parts: string[]): string {
    return parts.join("::").toLowerCase().replace(/\s+/g, " ");
  }

  /** Get entry if not expired. Returns null on miss or expiry. */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    // Move to most-recently-used position
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }

  /** Set entry with optional per-entry TTL. */
  set(key: string, data: T, ttlMs?: number): void {
    if (this.cache.size >= MAX_SIZE) {
      // Evict least-recently-used (first inserted key)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      data,
      cachedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
  }

  /** Remove entry. */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /** Clear all entries. */
  clear(): void {
    this.cache.clear();
  }

  /** Number of entries in cache. */
  get size(): number {
    return this.cache.size;
  }
}
