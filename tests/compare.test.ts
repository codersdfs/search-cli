import { describe, it, expect } from "vitest";
import {
  buildComparisonTable,
  comparisonJson,
  comparisonCsv,
  comparisonMarkdown,
} from "../src/compare.ts";
import type { Repo } from "../src/types.ts";

const makeRepo = (
  name: string,
  stars: number,
  forks: number,
  lang: string,
): Repo => ({
  id: Math.random(),
  fullName: `owner/${name}`,
  name,
  owner: "owner",
  description: `Repo ${name}`,
  url: `https://github.com/owner/${name}`,
  stars,
  forks,
  watchers: 0,
  language: lang,
  topics: ["topic1"],
  archived: false,
  isFork: false,
  private: false,
  createdAt: "2023-01-01T00:00:00Z",
  updatedAt: "2024-06-15T00:00:00Z",
  pushedAt: "2024-06-15T00:00:00Z",
  score: 0,
});

describe("compare", () => {
  it("returns message when fewer than 2 repos", () => {
    const result = buildComparisonTable([makeRepo("one", 100, 10, "Rust")]);
    expect(result).toContain("Select at least 2 repos");
  });

  it("builds table for 2 repos", () => {
    const r1 = makeRepo("repo-a", 5000, 200, "Rust");
    const r2 = makeRepo("repo-b", 3000, 150, "Go");
    const table = buildComparisonTable([r1, r2]);

    expect(table).toContain("repo-a");
    expect(table).toContain("repo-b");
    expect(table).toContain("Stars");
    expect(table).toContain("Forks");
    expect(table).toContain("Language");
    expect(table).toContain("5,000");
    expect(table).toContain("3,000");
    expect(table).toContain("Rust");
    expect(table).toContain("Go");
  });

  it("builds table for 3 repos", () => {
    const repos = [
      makeRepo("a", 100, 10, "Rust"),
      makeRepo("b", 200, 20, "TS"),
      makeRepo("c", 300, 30, "Py"),
    ];
    const table = buildComparisonTable(repos);
    expect(table).toContain("owner/a");
    expect(table).toContain("owner/b");
    expect(table).toContain("owner/c");
  });

  it("includes created and updated columns", () => {
    const r1 = makeRepo("a", 100, 10, "Rust");
    const r2 = makeRepo("b", 200, 20, "TS");
    const table = buildComparisonTable([r1, r2]);

    expect(table).toContain("Created");
    expect(table).toContain("Updated");
    expect(table).toContain("2023-01");
    expect(table).toContain("2024-06-15");
  });
});

describe("comparison exports", () => {
  const repos = [
    makeRepo("a", 1000, 100, "Rust"),
    makeRepo("b", 2000, 200, "TypeScript"),
  ];

  it("comparisonJson emits a repo array with the comparison fields", () => {
    const parsed = JSON.parse(comparisonJson(repos));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      fullName: "owner/a",
      stars: 1000,
      forks: 100,
      language: "Rust",
      url: "https://github.com/owner/a",
    });
  });

  it("comparisonCsv has a header row and one row per repo", () => {
    const lines = comparisonCsv(repos).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "full_name,stars,forks,language,created,updated,archived,url",
    );
    expect(lines[1]).toContain("owner/a");
    expect(lines[1]).toContain("1000");
  });

  it("comparisonCsv escapes values containing commas", () => {
    const tricky = [makeRepo("x", 1, 1, "a,b lang")];
    const lines = comparisonCsv([tricky[0], makeRepo("y", 2, 2, "Go")]).split(
      "\n",
    );
    expect(lines[1]).toContain('"a,b lang"');
  });

  it("comparisonMarkdown links the repo names", () => {
    const md = comparisonMarkdown(repos);
    expect(md).toContain(
      "| Repo | Stars | Forks | Language | Created | Updated | Topics |",
    );
    expect(md).toContain("[owner/a](https://github.com/owner/a)");
    expect(md).toContain("1,000");
  });
});
