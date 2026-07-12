import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Set state dir before importing
const testDir = join(tmpdir(), `search-cli-test-history-${Date.now()}`);
process.env.XDG_STATE_HOME = testDir;

describe("history", () => {
  beforeEach(async () => {
    // Clear module cache to get fresh stateDir per test
    const { clearHistory } = await import("../src/history.ts");
    clearHistory();
  });

  afterEach(() => {
    try { unlinkSync(join(testDir, "search-cli", "history.jsonl")); } catch {}
  });

  it("appends and reads history entries", async () => {
    const { appendHistory, readHistory } = await import("../src/history.ts");
    appendHistory({ query: "rust cli", mode: "search", timestamp: 1000, resultCount: 42 });
    appendHistory({ query: "language:Rust", mode: "search", timestamp: 2000, resultCount: 10 });
    const entries = readHistory();
    expect(entries.length).toBe(2);
    expect(entries[0].query).toBe("language:Rust"); // newest first
    expect(entries[1].query).toBe("rust cli");
  });

  it("deduplicates consecutive identical queries (keeps newest)", async () => {
    const { appendHistory, readHistory } = await import("../src/history.ts");
    appendHistory({ query: "rust", mode: "search", timestamp: 1000, resultCount: 5 });
    appendHistory({ query: "rust", mode: "search", timestamp: 2000, resultCount: 10 });
    const entries = readHistory();
    expect(entries.length).toBe(1);
    expect(entries[0].timestamp).toBe(2000);
    expect(entries[0].resultCount).toBe(10);
  });

  it("returns empty array when no history", async () => {
    const { readHistory } = await import("../src/history.ts");
    expect(readHistory()).toEqual([]);
  });

  it("deletes a history entry by index", async () => {
    const { appendHistory, readHistory, deleteHistoryEntry } = await import("../src/history.ts");
    appendHistory({ query: "first", mode: "search", timestamp: 1000, resultCount: 1 });
    appendHistory({ query: "second", mode: "search", timestamp: 2000, resultCount: 2 });
    appendHistory({ query: "third", mode: "search", timestamp: 3000, resultCount: 3 });

    deleteHistoryEntry(0); // delete "third" (newest = index 0)
    const entries = readHistory();
    expect(entries.length).toBe(2);
    expect(entries[0].query).toBe("second");
  });

  it("clears all history", async () => {
    const { appendHistory, readHistory, clearHistory } = await import("../src/history.ts");
    appendHistory({ query: "rust", mode: "search", timestamp: 1000, resultCount: 5 });
    clearHistory();
    expect(readHistory()).toEqual([]);
  });

  it("stores trending mode entries", async () => {
    const { appendHistory, readHistory } = await import("../src/history.ts");
    appendHistory({ query: "trending:This Week", mode: "trending", tab: "This Week", timestamp: 1000, resultCount: 25 });
    const entries = readHistory();
    expect(entries[0].mode).toBe("trending");
    expect(entries[0].tab).toBe("This Week");
  });
});
