import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { normalizeRepo, normalizeEnvelope, type GitHubApiItem, type GitHubSearchEnvelope } from "../src/normalizer.ts";
import { GitHubSearchProvider } from "../src/provider.ts";
import { parseQuery } from "../src/query.ts";
import type { SearchOptions } from "../src/types.ts";

const sampleItem: GitHubApiItem = {
  id: 123,
  name: "ripgrep",
  full_name: "BurntSushi/ripgrep",
  owner: { login: "BurntSushi" },
  description: "A search tool",
  html_url: "https://github.com/BurntSushi/ripgrep",
  stargazers_count: 45000,
  forks_count: 1900,
  watchers_count: 450,
  language: "Rust",
  topics: ["search", "grep"],
  archived: false,
  fork: false,
  private: false,
  created_at: "2015-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  pushed_at: "2024-02-01T00:00:00Z",
  score: 12.3,
};

describe("normalizeRepo (API response mapping)", () => {
  it("maps a GitHub item to the internal Repo shape", () => {
    const repo = normalizeRepo(sampleItem);
    expect(repo.id).toBe(123);
    expect(repo.fullName).toBe("BurntSushi/ripgrep");
    expect(repo.owner).toBe("BurntSushi");
    expect(repo.name).toBe("ripgrep");
    expect(repo.stars).toBe(45000);
    expect(repo.forks).toBe(1900);
    expect(repo.language).toBe("Rust");
    expect(repo.topics).toEqual(["search", "grep"]);
    expect(repo.archived).toBe(false);
    expect(repo.isFork).toBe(false);
    expect(repo.url).toBe("https://github.com/BurntSushi/ripgrep");
  });

  it("falls back to full_name owner when owner.login is missing", () => {
    const { owner, ...rest } = sampleItem;
    const repo = normalizeRepo({ ...rest, full_name: "foo/bar" });
    expect(repo.owner).toBe("foo");
  });

  it("defaults topics to empty array", () => {
    const { topics, ...rest } = sampleItem;
    const repo = normalizeRepo(rest);
    expect(repo.topics).toEqual([]);
  });
});

describe("normalizeEnvelope", () => {
  it("maps all items", () => {
    const env: GitHubSearchEnvelope = { total_count: 2, incomplete_results: false, items: [sampleItem, sampleItem] };
    expect(normalizeEnvelope(env)).toHaveLength(2);
  });
});

describe("GitHubSearchProvider (integration with mocked fetch)", () => {
  const realFetch = globalThis.fetch;
  let lastUrl = "";

  beforeAll(() => {
    // @ts-expect-error override fetch for the test
    globalThis.fetch = async (input: any) => {
      lastUrl = String(input);
      const env: GitHubSearchEnvelope = {
        total_count: 1,
        incomplete_results: false,
        items: [sampleItem],
      };
      return new Response(JSON.stringify(env), {
        status: 200,
        headers: { "x-ratelimit-remaining": "42" },
      });
    };
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("calls the search endpoint and normalizes results", async () => {
    const provider = new GitHubSearchProvider();
    const options: SearchOptions = { limit: 5, sort: "best-match", json: false, verbose: false };
    const res = await provider.search(parseQuery("ripgrep"), options);
    expect(res.totalCount).toBe(1);
    expect(res.repos).toHaveLength(1);
    expect(res.repos[0].fullName).toBe("BurntSushi/ripgrep");
    expect(res.rateLimitRemaining).toBe(42);
    expect(lastUrl).toContain("api.github.com/search/repositories");
    expect(lastUrl).toContain("q=ripgrep");
  });

  it("respects the limit when slicing pages", async () => {
    const provider = new GitHubSearchProvider();
    const options: SearchOptions = { limit: 1, sort: "stars", json: false, verbose: false };
    const res = await provider.search(parseQuery("x"), options);
    expect(res.repos.length).toBeLessThanOrEqual(1);
    expect(lastUrl).toContain("sort=stars");
  });
});