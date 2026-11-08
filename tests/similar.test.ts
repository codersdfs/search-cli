import { describe, it, expect } from "vitest";
import {
  SIMILAR_DEFAULT_LIMIT,
  findSimilarRepos,
  formatSimilarText,
  similarQueries,
  similarStarFloor,
} from "../src/similar.ts";
import type { Repo } from "../src/types.ts";

const makeRepo = (
  name: string,
  stars: number,
  language: string | null,
  topics: string[],
): Repo => ({
  id: Math.random(),
  fullName: `owner/${name}`,
  name,
  owner: "owner",
  description: `Repo ${name}`,
  url: `https://github.com/owner/${name}`,
  stars,
  forks: 0,
  watchers: 0,
  language,
  topics,
  archived: false,
  isFork: false,
  private: false,
  createdAt: "2023-01-01T00:00:00Z",
  updatedAt: "2024-06-15T00:00:00Z",
  pushedAt: "2024-06-15T00:00:00Z",
  score: 0,
});

describe("similarStarFloor", () => {
  it("scales with the source repo's popularity", () => {
    expect(similarStarFloor(230_000)).toBe(11_500);
    expect(similarStarFloor(1_000)).toBe(50);
  });

  it("never goes below one star, and skips the filter with no stars", () => {
    expect(similarStarFloor(5)).toBe(1);
    expect(similarStarFloor(0)).toBe(0);
    expect(similarStarFloor(Number.NaN)).toBe(0);
  });
});

describe("similarQueries", () => {
  const repo = makeRepo("react", 230_000, "JavaScript", ["react", "ui"]);

  it("starts with topic + language, tightest signal first", () => {
    const queries = similarQueries(repo);
    expect(queries[0]).toBe(
      "topic:react language:JavaScript fork:false archived:false stars:>=11500",
    );
    expect(queries[1]).toContain("topic:ui language:JavaScript");
  });

  it("widens one step at a time and ends with language alone", () => {
    const queries = similarQueries(repo);
    expect(queries).toContain(
      "topic:react fork:false archived:false stars:>=11500",
    );
    expect(queries.at(-1)).toBe(
      "language:JavaScript fork:false archived:false stars:>=11500",
    );
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("excludes forks and archived repos in every candidate", () => {
    for (const query of similarQueries(repo)) {
      expect(query).toContain("fork:false");
      expect(query).toContain("archived:false");
    }
  });

  it("always produces at least one query when there is a signal", () => {
    expect(similarQueries(makeRepo("x", 0, null, ["cli"]))).toHaveLength(1);
    expect(similarQueries(makeRepo("x", 0, "Rust", []))).toHaveLength(1);
  });

  it("returns nothing when a repo has neither topics nor a language", () => {
    expect(similarQueries(makeRepo("x", 100, null, []))).toEqual([]);
  });

  it("quotes multi-word languages so they stay one qualifier", () => {
    const queries = similarQueries(
      makeRepo("notebook", 100, "Jupyter Notebook", ["data-science"]),
    );
    expect(queries[0]).toContain('language:"Jupyter Notebook"');
    expect(queries.join(" ")).not.toContain("language:Jupyter Notebook");
  });

  it("skips topics that cannot be GitHub topic names", () => {
    const queries = similarQueries(
      makeRepo("x", 100, "Go", ["ok-topic", "bad topic"]),
    );
    expect(queries.join("\n")).toContain("topic:ok-topic");
    expect(queries.join("\n")).not.toContain("bad topic");
  });
});

describe("formatSimilarText", () => {
  it("renders one line per repo with stars, language and description", () => {
    const text = formatSimilarText({
      repo: makeRepo("react", 230_000, "JavaScript", ["react"]),
      repos: [
        makeRepo("vue", 12_345, "TypeScript", ["vue"]),
        makeRepo("svelte", 5_000, null, ["svelte"]),
      ],
      queries: ["topic:react"],
    });
    expect(text).toContain("Similar to owner/react");
    expect(text).toContain("2 repos");
    expect(text).toContain("owner/vue");
    expect(text).toContain("★ 12,345");
    expect(text).toContain("TypeScript");
    expect(text).toContain("owner/svelte");
    expect(text).toContain("n/a");
  });

  it("explains an empty result instead of printing a bare header", () => {
    const text = formatSimilarText({
      repo: makeRepo("react", 230_000, "JavaScript", ["react"]),
      repos: [],
      queries: [],
    });
    expect(text).toContain("No repos found similar to owner/react");
    expect(text).toContain("topics and language");
    expect(text).toContain("has neither");
  });

  it("does not blame missing signals when the queries just found nothing", () => {
    const text = formatSimilarText({
      repo: makeRepo("react", 230_000, "JavaScript", ["react"]),
      repos: [],
      queries: ["topic:react language:JavaScript"],
    });
    expect(text).toContain("did not turn up any comparable repos");
    expect(text).not.toContain("has neither");
  });
});

describe("findSimilarRepos", () => {
  it("validates the ref before any network call", async () => {
    await expect(findSimilarRepos("not-a-repo")).rejects.toThrow(/owner\/name/);
  });

  it("defaults to a small result set", () => {
    expect(SIMILAR_DEFAULT_LIMIT).toBe(10);
  });
});
