import { describe, it, expect, beforeEach } from "vitest";
import { MemoryCache } from "../src/search.ts";

describe("MemoryCache", () => {
  let cache: MemoryCache<string>;

  beforeEach(() => {
    cache = new MemoryCache<string>(1000); // 1s TTL for tests
  });

  it("returns null on miss", () => {
    expect(cache.get("missing")).toBeNull();
  });

  it("returns data on hit", () => {
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("returns null after TTL expires", async () => {
    cache.set("key1", "value1", 10); // 10ms TTL
    expect(cache.get("key1")).toBe("value1");
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.get("key1")).toBeNull();
  });

  it("evicts oldest entry when at capacity", () => {
    for (let i = 0; i < 50; i++) {
      cache.set(`key${i}`, `value${i}`);
    }
    cache.set("overflow", "last"); // now exceeds, evicts LRU (key0)
    expect(cache.get("key0")).toBeNull(); // evicted
    expect(cache.get("overflow")).toBe("last");
    expect(cache.size).toBe(50);
  });

  it("deletes a key", () => {
    cache.set("key1", "value1");
    cache.delete("key1");
    expect(cache.get("key1")).toBeNull();
  });

  it("clears all entries", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("builds consistent keys", () => {
    const k1 = MemoryCache.key("hello", "world");
    const k2 = MemoryCache.key("hello", "world");
    expect(k1).toBe(k2);
  });

  it("moves accessed entry to MRU position", () => {
    for (let i = 0; i < 50; i++) {
      cache.set(`key${i}`, `value${i}`);
    }
    cache.get("key0");
    cache.set("overflow", "last");
    expect(cache.get("key0")).toBe("value0"); // still there (MRU)
    expect(cache.get("key1")).toBeNull(); // evicted (LRU)
  });
});
