// Tests for package search normalize + sort semantics
import { describe, it, expect, afterEach } from "vitest";
import {
  createPackageSearch,
  sortPackages,
  type PackageSortMode,
} from "../src/package.ts";
import { normalizeNpmObject } from "../src/registries/npm.ts";
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
    expect(out.map((p) => p.name)).toEqual([
      "zod",
      "zod-validation-error",
      "drizzle-zod",
    ]);
    expect(out).toBe(fixture); // identity: no copy, no mutation
  });

  it("score sorts descending by relevance score", () => {
    const out = sortPackages(fixture, "score");
    expect(out.map((p) => p.name)).toEqual([
      "zod",
      "zod-validation-error",
      "drizzle-zod",
    ]);
  });

  it("downloads sorts descending by monthly downloads", () => {
    const out = sortPackages(fixture, "downloads");
    expect(out.map((p) => p.name)).toEqual([
      "drizzle-zod",
      "zod-validation-error",
      "zod",
    ]);
  });

  it("name sorts ascending by package name", () => {
    const out = sortPackages(fixture, "name");
    expect(out.map((p) => p.name)).toEqual([
      "drizzle-zod",
      "zod",
      "zod-validation-error",
    ]);
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
    const modes: PackageSortMode[] = [
      "best-match",
      "score",
      "downloads",
      "name",
    ];
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

describe("createPackageSearch facade", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /**
   * Stub the registry and hand back a reader for the URL it was called with.
   * The stub must be installed BEFORE createPackageSearch() runs: the facade's
   * `fetchImpl` default binds at factory-call time, so a later swap would be
   * invisible to the provider it just captured.
   */
  function stubNpmSearch(body: unknown): () => string {
    let seenUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return () => seenUrl;
  }

  const ZOD_ROW = {
    package: {
      name: "zod",
      version: "3.25.0",
      description: "TypeScript-first schema validation",
      links: { npm: "https://www.npmjs.com/package/zod" },
      publisher: { username: "colinhacks" },
    },
    downloads: { monthly: 1234567 },
    score: { final: 2396 },
  };

  it("routes searchPackage to the npm provider with the requested size", async () => {
    const seenUrl = stubNpmSearch({ total: 1, objects: [ZOD_ROW] });
    const search = createPackageSearch();
    const res = await search.searchPackage("zod", 20);
    expect(seenUrl()).toContain("/-/v1/search");
    expect(seenUrl()).toContain("text=zod");
    expect(seenUrl()).toContain("size=20");
    expect(res.packages).toHaveLength(1);
    expect(res.packages[0]).toMatchObject({ name: "zod", registry: "npm" });
  });

  it("returns the registry total through the facade", async () => {
    stubNpmSearch({ total: 447322, objects: [ZOD_ROW] });
    const search = createPackageSearch();
    const res = await search.searchPackage("cli", 50);
    expect(res.totalCount).toBe(447322);
  });

  it("passes the injected fetchImpl through to searchNpm", async () => {
    // The seam that kills "facade drops fetchImpl": the injected stub must be
    // the one that gets called. globalThis.fetch is a tripwire, not a fallback,
    // so a dropped argument fails this test offline instead of quietly issuing
    // a live npm request through the provider's own default parameter.
    let seenUrl = "";
    const stub = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return new Response(JSON.stringify({ total: 1, objects: [ZOD_ROW] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    globalThis.fetch = (async () => {
      throw new Error(
        "searchNpm reached for globalThis.fetch instead of the injected fetchImpl",
      );
    }) as unknown as typeof fetch;
    const search = createPackageSearch("npm", stub);
    const res = await search.searchPackage("zod", 20);
    expect(seenUrl).toContain("/-/v1/search");
    expect(seenUrl).toContain("text=zod");
    expect(res.packages).toHaveLength(1);
    expect(res.packages[0]).toMatchObject({ name: "zod", registry: "npm" });
  });
});
