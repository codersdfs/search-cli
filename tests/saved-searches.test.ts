import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testDir = join(tmpdir(), `search-cli-test-saved-${Date.now()}`);
process.env.XDG_STATE_HOME = testDir;

describe("saved-searches", () => {
  beforeEach(async () => {
    // Clear all saved searches
    const { getSavedSearches, deleteSavedSearch } = await import("../src/saved-searches.ts");
    for (const s of getSavedSearches()) {
      deleteSavedSearch(s.name);
    }
  });

  afterEach(() => {
    try { unlinkSync(join(testDir, "search-cli", "saved-searches.json")); } catch {}
  });

  it("saves and retrieves a search", async () => {
    const { saveSearch, getSavedSearches } = await import("../src/saved-searches.ts");
    saveSearch("Rust CLI tools", "language:Rust topic:cli", "search", "stars", 50);
    const saved = getSavedSearches();
    expect(saved.length).toBe(1);
    expect(saved[0].name).toBe("Rust CLI tools");
    expect(saved[0].query).toBe("language:Rust topic:cli");
    expect(saved[0].sort).toBe("stars");
  });

  it("overwrites an existing search with the same name", async () => {
    const { saveSearch, getSavedSearches } = await import("../src/saved-searches.ts");
    saveSearch("My Search", "query1", "search", "best-match", 25);
    saveSearch("My Search", "query2", "search", "stars", 50);
    const saved = getSavedSearches();
    expect(saved.length).toBe(1);
    expect(saved[0].query).toBe("query2");
    expect(saved[0].sort).toBe("stars");
  });

  it("deletes a saved search", async () => {
    const { saveSearch, deleteSavedSearch, getSavedSearches } = await import("../src/saved-searches.ts");
    saveSearch("S1", "q1", "search", "best-match", 25);
    saveSearch("S2", "q2", "search", "stars", 50);
    deleteSavedSearch("S1");
    const saved = getSavedSearches();
    expect(saved.length).toBe(1);
    expect(saved[0].name).toBe("S2");
  });

  it("touches lastRunAt on use", async () => {
    const { saveSearch, touchSavedSearch, getSavedSearches } = await import("../src/saved-searches.ts");
    saveSearch("Test", "query", "search", "best-match", 25);
    const before = getSavedSearches()[0].lastRunAt!;
    await new Promise(r => setTimeout(r, 2));
    touchSavedSearch("Test");
    const after = getSavedSearches()[0].lastRunAt!;
    expect(after).toBeGreaterThan(before);
  });

  it("returns empty list when no saved searches", async () => {
    const { getSavedSearches } = await import("../src/saved-searches.ts");
    expect(getSavedSearches()).toEqual([]);
  });
});
