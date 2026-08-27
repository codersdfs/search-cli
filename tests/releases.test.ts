import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Repo } from "../src/types";

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "ghfind-test-releases-"));
const { toggleBookmark, getLastSeen, markSeen } = await import("../src/bookmarks.ts");
const { checkReleases, allCachedReleases } = await import("../src/releases.ts");
const { writeJSON } = await import("../src/storage.ts");

const makeRepo = (name: string): Repo => ({
  id: Math.random(),
  fullName: `owner/${name}`,
  name,
  owner: "owner",
  description: `Test repo ${name}`,
  url: `https://github.com/owner/${name}`,
  stars: 100,
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

/** Fake GitHub releases API, keyed by repo fullName. Etag round-trips through the cache file. */
let fakeApi: Record<string, Array<Record<string, unknown>>> = {};
const fetchCalls: Array<{ fullName: string; ifNoneMatch?: string }> = [];
const realFetch = globalThis.fetch;

// partial Response shim is fine for our code paths
function fakeFetch(url: string | URL, init?: { headers?: Record<string, string> }) {
  const fullName = String(url).match(/repos\/(.+?)\/releases/)?.[1] ?? "";
  const etag = `W/"etag-${fullName}"`;
  fetchCalls.push({ fullName, ifNoneMatch: init?.headers?.["If-None-Match"] });
  // Serve a real 304 only when the client sends back the exact etag we issued.
  if (init?.headers?.["If-None-Match"] === etag) return Promise.resolve({ status: 304, ok: false });
  return Promise.resolve({
    status: 200,
    ok: true,
    headers: new Map([["etag", etag]]),
    json: async () => fakeApi[fullName] ?? [],
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const rel = (tag: string, daysAgo: number, extra: object = {}) => ({
  id: Math.random(),
  tag_name: tag,
  name: tag,
  html_url: `https://github.com/owner/x/releases/tag/${tag}`,
  published_at: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
  draft: false,
  prerelease: false,
  ...extra,
});

describe("release tracker", () => {
  beforeEach(() => {
    fakeApi = {};
    fetchCalls.length = 0;
    writeJSON("release-cache.json", {}); // isolate etag state between tests
    globalThis.fetch = fakeFetch as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("flags releases newer than lastSeenAt as new", async () => {
    toggleBookmark(makeRepo("a"));
    fakeApi["owner/a"] = [rel("v1.0.0", 1), rel("v0.9.0", 10)];
    const results = await checkReleases();
    expect(results).toHaveLength(1);
    expect(results[0].newReleases.map((r) => r.tagName)).toEqual(["v1.0.0", "v0.9.0"]);
  });

  it("never stores drafts and tags prereleases", async () => {
    toggleBookmark(makeRepo("b"));
    fakeApi["owner/b"] = [
      rel("v2.0.0-rc.1", 1, { prerelease: true }),
      rel("v1.5.0", 3),
      rel("draft-thing", 0, { draft: true }),
    ];
    await checkReleases();
    const cached = allCachedReleases().filter((r) => r.fullName === "owner/b");
    expect(cached.map((r) => r.tagName)).toEqual(["v2.0.0-rc.1", "v1.5.0"]);
    expect(cached.find((r) => r.prerelease)?.tagName).toBe("v2.0.0-rc.1");
  });

  it("304 short-circuits upstream; releases stay new until markSeen", async () => {
    toggleBookmark(makeRepo("c"));
    fakeApi["owner/c"] = [rel("v1.0.0", 2)];
    await checkReleases();
    const results = await checkReleases();
    expect(fetchCalls.filter((c) => c.fullName === "owner/c")).toHaveLength(2);
    expect(fetchCalls.find((c) => c.fullName === "owner/c" && c.ifNoneMatch)?.ifNoneMatch).toBe('W/"etag-owner/c"');
    // Never seen yet → still reported as new even on 304.
    expect(results[0].newReleases).toHaveLength(1);
    // Viewing the feed marks seen → next 304 reports nothing.
    markSeen("owner/c");
    const results3 = await checkReleases();
    expect(results3[0].newReleases).toHaveLength(0);
  });

  it("markSeen moves lastSeenAt so old releases stop being new", async () => {
    toggleBookmark(makeRepo("d"));
    fakeApi["owner/d"] = [rel("v1.0.0", 5)];
    markSeen("owner/d");
    expect(getLastSeen("owner/d")).toBeGreaterThan(0);
    writeJSON("release-cache.json", {}); // force fresh-fetch path
    const results = await checkReleases();
    expect(results[0].newReleases).toHaveLength(0);
  });

  it("handles repos with no releases without error", async () => {
    toggleBookmark(makeRepo("e"));
    fakeApi["owner/e"] = [];
    const results = await checkReleases();
    expect(results[0].newReleases).toHaveLength(0);
    expect(allCachedReleases()).toHaveLength(0);
  });
});
