import { describe, it, expect } from "bun:test";
import { rankRepos, compositeScore } from "../src/ranking.ts";
import type { Repo } from "../src/types.ts";

function makeRepo(over: Partial<Repo>): Repo {
  return {
    id: 1,
    fullName: "a/b",
    name: "b",
    owner: "a",
    description: null,
    url: "https://github.com/a/b",
    stars: 0,
    forks: 0,
    watchers: 0,
    language: null,
    topics: [],
    archived: false,
    isFork: false,
    private: false,
    createdAt: "2020-01-01T00:00:00Z",
    updatedAt: "2020-01-01T00:00:00Z",
    pushedAt: "2020-01-01T00:00:00Z",
    score: 0,
    ...over,
  };
}

describe("rankRepos", () => {
  const repos = [
    makeRepo({ id: 1, fullName: "a/low", stars: 10, updatedAt: "2021-01-01T00:00:00Z" }),
    makeRepo({ id: 2, fullName: "b/high", stars: 5000, updatedAt: "2022-01-01T00:00:00Z" }),
    makeRepo({ id: 3, fullName: "c/mid", stars: 500, updatedAt: "2023-01-01T00:00:00Z" }),
  ];

  it("sorts by stars descending", () => {
    const out = rankRepos(repos, "stars");
    expect(out.map((r) => r.fullName)).toEqual(["b/high", "c/mid", "a/low"]);
  });

  it("sorts by updated descending", () => {
    const out = rankRepos(repos, "updated");
    expect(out.map((r) => r.fullName)).toEqual(["c/mid", "b/high", "a/low"]);
  });

  it("sorts by forks descending", () => {
    const forked = [
      makeRepo({ id: 1, fullName: "a/x", forks: 1 }),
      makeRepo({ id: 2, fullName: "b/y", forks: 99 }),
    ];
    const out = rankRepos(forked, "forks");
    expect(out.map((r) => r.fullName)).toEqual(["b/y", "a/x"]);
  });

  it("is deterministic for equal primary keys (tie-break by stars then id)", () => {
    const tied = [
      makeRepo({ id: 5, fullName: "z/last", stars: 10 }),
      makeRepo({ id: 2, fullName: "m/mid", stars: 10 }),
      makeRepo({ id: 1, fullName: "f/first", stars: 10 }),
    ];
    const out = rankRepos(tied, "stars");
    expect(out.map((r) => r.id)).toEqual([1, 2, 5]);
  });

  it("does not mutate the input array", () => {
    const copy = [...repos];
    rankRepos(repos, "stars");
    expect(repos).toEqual(copy);
  });
});

describe("compositeScore", () => {
  it("returns a higher score for more stars", () => {
    const low = makeRepo({ stars: 1, pushedAt: new Date().toISOString() });
    const high = makeRepo({ stars: 100000, pushedAt: new Date().toISOString() });
    expect(compositeScore(high)).toBeGreaterThan(compositeScore(low));
  });
});