import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Repo } from "../src/types.ts";

const testDir = join(tmpdir(), `search-cli-test-bookmarks-${Date.now()}`);
process.env.XDG_STATE_HOME = testDir;

const makeRepo = (name: string, stars = 100): Repo => ({
  id: Math.random(),
  fullName: `owner/${name}`,
  name,
  owner: "owner",
  description: `Test repo ${name}`,
  url: `https://github.com/owner/${name}`,
  stars,
  forks: 0,
  watchers: 0,
  language: "TypeScript",
  topics: [],
  archived: false,
  isFork: false,
  private: false,
  createdAt: "",
  updatedAt: "",
  pushedAt: "",
  score: 0,
});

describe("bookmarks", () => {
  beforeEach(async () => {
    const { getBookmarks } = await import("../src/bookmarks.ts");
    // Clear all bookmarks
    for (const b of getBookmarks()) {
      const { removeBookmark } = await import("../src/bookmarks.ts");
      removeBookmark(b.repo.fullName);
    }
  });

  afterEach(() => {
    try { unlinkSync(join(testDir, "search-cli", "bookmarks.json")); } catch {}
  });

  it("adds a bookmark", async () => {
    const { toggleBookmark, isBookmarked } = await import("../src/bookmarks.ts");
    const repo = makeRepo("test-repo");
    const added = toggleBookmark(repo, ["test"]);
    expect(added).toBe(true);
    expect(isBookmarked(repo.fullName)).toBe(true);
  });

  it("removes a bookmark on second toggle", async () => {
    const { toggleBookmark, isBookmarked } = await import("../src/bookmarks.ts");
    const repo = makeRepo("test-repo");
    toggleBookmark(repo);
    const removed = toggleBookmark(repo);
    expect(removed).toBe(false);
    expect(isBookmarked(repo.fullName)).toBe(false);
  });

  it("returns bookmarks newest first", async () => {
    const { toggleBookmark, getBookmarks } = await import("../src/bookmarks.ts");
    const repo1 = makeRepo("first", 100);
    const repo2 = makeRepo("second", 200);
    toggleBookmark(repo1);
    await new Promise(r => setTimeout(r, 5)); // ensure different timestamps
    toggleBookmark(repo2);

    const bookmarks = getBookmarks();
    expect(bookmarks.length).toBe(2);
    expect(bookmarks[0].repo.fullName).toBe("owner/second"); // newest first
  });

  it("removes a bookmark by fullName", async () => {
    const { toggleBookmark, removeBookmark, getBookmarks } = await import("../src/bookmarks.ts");
    toggleBookmark(makeRepo("test"));
    removeBookmark("owner/test");
    expect(getBookmarks().length).toBe(0);
  });

  it("searches bookmarks by name", async () => {
    const { toggleBookmark, searchBookmarks } = await import("../src/bookmarks.ts");
    toggleBookmark(makeRepo("rusty-cli", 500), ["rust"]);
    toggleBookmark(makeRepo("typescript-tools", 300), ["ts"]);

    const results = searchBookmarks("rust");
    expect(results.length).toBe(1);
    expect(results[0].repo.fullName).toContain("rusty");
  });
});
