// Tests for package search normalize + sort semantics
import { describe, it, expect } from "vitest";
import { normalizeNpmObject, sortPackages, type PackageSortMode } from "../src/package";
import type { Package } from "../src/types";

function pkg(partial: Partial<Package> & { name: string }): Package {
  return {
    version: "1.0.0",
    description: null,
    url: `https://www.npmjs.com/package/${partial.name}`,
    downloads: 0,
    score: 0,
    publisher: null,
    keywords: [],
    registry: "npm",
    ...partial,
  };
}

const fixture = [
  pkg({ name: "zod", downloads: 10, score: 2396 }),
  pkg({ name: "zod-validation-error", downloads: 169, score: 498 }),
  pkg({ name: "drizzle-zod", downloads: 500, score: 450 }),
];

describe("sortPackages", () => {
  it("best-match preserves registry relevance order (no-op)", () => {
    const out = sortPackages(fixture, "best-match");
    expect(out.map((p) => p.name)).toEqual(["zod", "zod-validation-error", "drizzle-zod"]);
    expect(out).toBe(fixture); // identity: no copy, no mutation
  });

  it("score sorts descending by relevance score", () => {
    const out = sortPackages(fixture, "score");
    expect(out.map((p) => p.name)).toEqual(["zod", "zod-validation-error", "drizzle-zod"]);
  });

  it("downloads sorts descending by monthly downloads", () => {
    const out = sortPackages(fixture, "downloads");
    expect(out.map((p) => p.name)).toEqual(["drizzle-zod", "zod-validation-error", "zod"]);
  });

  it("name sorts ascending by package name", () => {
    const out = sortPackages(fixture, "name");
    expect(out.map((p) => p.name)).toEqual(["drizzle-zod", "zod", "zod-validation-error"]);
  });

  it("does not mutate the input array", () => {
    const before = fixture.map((p) => p.name);
    sortPackages(fixture, "downloads");
    expect(fixture.map((p) => p.name)).toEqual(before);
  });

  it("single-element and empty arrays return unchanged for non-best-match sorts", () => {
    const one = [pkg({ name: "solo" })];
    expect(sortPackages(one, "downloads")).toBe(one);
    expect(sortPackages([], "score")).toEqual([]);
  });

  it("every declared sort mode is accepted without throwing", () => {
    const modes: PackageSortMode[] = ["best-match", "score", "downloads", "name"];
    for (const m of modes) {
      expect(sortPackages(fixture, m).length).toBe(3);
    }
  });
});

describe("normalizeNpmObject", () => {
  it("maps npm search object to Package shape", () => {
    const out = normalizeNpmObject({
      package: {
        name: "zod",
        version: "3.25.0",
        description: "TypeScript-first schema validation",
        links: { npm: "https://www.npmjs.com/package/zod" },
        publisher: { username: "colinhacks" },
        keywords: ["validation", "typescript"],
      },
      downloads: { monthly: 1234567 },
      score: { final: 2396 },
    });
    expect(out).toMatchObject({
      name: "zod",
      version: "3.25.0",
      description: "TypeScript-first schema validation",
      url: "https://www.npmjs.com/package/zod",
      downloads: 1234567,
      score: 2396,
      publisher: "colinhacks",
      keywords: ["validation", "typescript"],
      registry: "npm",
    });
  });

  it("falls back to searchScore and npm URL when score/links are missing", () => {
    const out = normalizeNpmObject({
      package: { name: "ghfind" },
      searchScore: 42,
    });
    expect(out.score).toBe(42);
    expect(out.url).toBe("https://www.npmjs.com/package/ghfind");
    expect(out.description).toBeNull();
    expect(out.downloads).toBe(0);
  });
});