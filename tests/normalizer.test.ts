import { describe, it, expect } from "vitest";
import {
  normalizeRepo,
  normalizeEnvelope,
  type GitHubApiItem,
  type GitHubSearchEnvelope,
  InMemoryAdapter,
  type SearchAdapter,
} from "../src/search.ts";
import { parseQuery } from "../src/search.ts";
import type { SearchOptions, SearchResponse } from "../src/types.ts";

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

describe("InMemoryAdapter (search without network)", () => {
  it("returns canned responses for matching queries", async () => {
    const adapter = new InMemoryAdapter();
    const response: SearchResponse = {
      totalCount: 1,
      repos: [normalizeRepo(sampleItem)],
      rateLimited: false,
      rateLimitRemaining: 42,
    };
    adapter.setResponse("ripgrep", response);

    const options: SearchOptions = { limit: 5, sort: "best-match", json: false, verbose: false };
    const res = await adapter.search(parseQuery("ripgrep"), options);
    expect(res.totalCount).toBe(1);
    expect(res.repos).toHaveLength(1);
    expect(res.repos[0].fullName).toBe("BurntSushi/ripgrep");
    expect(res.rateLimitRemaining).toBe(42);
  });

  it("returns default response for unmatched queries", async () => {
    const adapter = new InMemoryAdapter();
    adapter.setDefault({ totalCount: 0, repos: [], rateLimited: false });

    const options: SearchOptions = { limit: 5, sort: "best-match", json: false, verbose: false };
    const res = await adapter.search(parseQuery("unknown"), options);
    expect(res.totalCount).toBe(0);
    expect(res.repos).toHaveLength(0);
  });

  it("clear removes all canned responses", async () => {
    const adapter = new InMemoryAdapter();
    adapter.setResponse("x", { totalCount: 1, repos: [], rateLimited: false });
    adapter.clear();
    adapter.setDefault({ totalCount: 0, repos: [], rateLimited: false });

    const options: SearchOptions = { limit: 5, sort: "best-match", json: false, verbose: false };
    const res = await adapter.search(parseQuery("x"), options);
    expect(res.totalCount).toBe(0);
  });
});
