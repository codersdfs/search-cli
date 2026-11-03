// The registry table is the single source of truth for which package registries
// exist, how many results each will accept, and what its download number means.
import { describe, it, expect } from "vitest";
import type { Package } from "../src/types.ts";
import {
  REGISTRY_IDS,
  clampRegistryLimit,
  isRegistryId,
  registryHelp,
  registryMeta,
  resolveRegistry,
  sortableModesFor,
  type RegistryId,
} from "../src/registries/catalog.ts";
import { getProvider } from "../src/registries/index.ts";

describe("REGISTRY_IDS", () => {
  it("lists the five shipped registries with npm first", () => {
    expect(REGISTRY_IDS).toEqual([
      "npm",
      "crates",
      "rubygems",
      "nuget",
      "maven",
    ]);
  });

  it("every id has metadata whose id matches its key", () => {
    for (const id of REGISTRY_IDS) {
      expect(registryMeta(id).id).toBe(id);
    }
  });

  it("every registry offers best-match and at least two modes", () => {
    for (const id of REGISTRY_IDS) {
      const modes = sortableModesFor(id);
      expect(modes[0]).toBe("best-match");
      expect(modes.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("registry ceilings", () => {
  it("matches the ceilings measured live on 2026-11-01", () => {
    expect(registryMeta("npm").maxResults).toBe(250);
    expect(registryMeta("crates").maxResults).toBe(100);
    expect(registryMeta("rubygems").maxResults).toBe(30);
    expect(registryMeta("nuget").maxResults).toBe(250);
    expect(registryMeta("maven").maxResults).toBe(200);
  });

  it("clampRegistryLimit keeps npm's existing behaviour exactly", () => {
    expect(clampRegistryLimit(0, "npm")).toBe(50); // falsy → default 50
    expect(clampRegistryLimit(Number.NaN, "npm")).toBe(50);
    expect(clampRegistryLimit(-5, "npm")).toBe(1);
    expect(clampRegistryLimit(1000, "npm")).toBe(250);
    expect(clampRegistryLimit(30.7, "npm")).toBe(30); // truncates
  });

  it("clampRegistryLimit clamps to each registry's own ceiling", () => {
    expect(clampRegistryLimit(50, "rubygems")).toBe(30);
    expect(clampRegistryLimit(200, "crates")).toBe(100);
    expect(clampRegistryLimit(250, "maven")).toBe(200);
  });
});

describe("download windows", () => {
  it("labels each registry's downloads honestly", () => {
    expect(registryMeta("npm").downloadsWindow).toBe("monthly");
    expect(registryMeta("crates").downloadsWindow).toBe("quarterly");
    expect(registryMeta("rubygems").downloadsWindow).toBe("lifetime");
    expect(registryMeta("nuget").downloadsWindow).toBe("lifetime");
    expect(registryMeta("maven").downloadsWindow).toBe("none");
  });

  it("only npm reports a relevance score", () => {
    for (const id of REGISTRY_IDS) {
      expect(registryMeta(id).hasScore).toBe(id === "npm");
    }
  });
});

describe("resolveRegistry", () => {
  it("accepts every canonical id", () => {
    for (const id of REGISTRY_IDS) {
      expect(resolveRegistry(id)).toBe(id);
    }
  });

  it("accepts the aliases users actually type", () => {
    expect(resolveRegistry("crates.io")).toBe("crates");
    expect(resolveRegistry("CRATES")).toBe("crates");
    expect(resolveRegistry("  NuGet ")).toBe("nuget");
    expect(resolveRegistry("ruby")).toBe("rubygems");
    expect(resolveRegistry("gems")).toBe("rubygems");
    expect(resolveRegistry("maven-central")).toBe("maven");
    expect(resolveRegistry("central")).toBe("maven");
  });

  it("returns null for an unknown registry rather than guessing", () => {
    expect(resolveRegistry("pypi")).toBeNull();
    expect(resolveRegistry("")).toBeNull();
    expect(resolveRegistry("npm;rm -rf")).toBeNull();
    // Prototype names must not resolve through the object-literal table.
    expect(resolveRegistry("constructor")).toBeNull();
    expect(resolveRegistry("__proto__")).toBeNull();
  });

  it("isRegistryId agrees with resolveRegistry", () => {
    expect(isRegistryId("crates")).toBe(true);
    expect(isRegistryId("crates.io")).toBe(false);
    expect(isRegistryId(42 as unknown as RegistryId)).toBe(false);
  });
});

describe("registryHelp", () => {
  it("lists the canonical ids in table order", () => {
    expect(registryHelp()).toBe("npm|crates|rubygems|nuget|maven");
  });
});

describe("prototype-name ids are refused, not resolved", () => {
  it("registryMeta throws instead of returning an Object.prototype member", () => {
    // A typed-but-wrong id reaching the lookup table must not come back as a
    // RegistryMeta; the guard is the catalog's invariant, not a call-site habit.
    expect(() => registryMeta("constructor" as RegistryId)).toThrow(
      /Unknown registry id/,
    );
    expect(() => registryMeta("__proto__" as RegistryId)).toThrow(
      /Unknown registry id/,
    );
  });

  it("getProvider throws for the same ids", () => {
    expect(() => getProvider("constructor" as never)).toThrow(
      /has no search provider/,
    );
    expect(() => getProvider("__proto__" as never)).toThrow(
      /has no search provider/,
    );
  });
});

describe("Package.registry accepts every catalog id", () => {
  it("the entity's registry field is the catalog union, not the npm literal", () => {
    // Compile-level guard: this array only typechecks if Package.registry is
    // RegistryId. Before the widening it is `"npm"`, and tsc rejects every
    // other row. Written as a runtime loop so bun test counts it too.
    const rows: Package[] = REGISTRY_IDS.map((registry) => ({
      name: `pkg-${registry}`,
      version: "1.0.0",
      description: null,
      url: `https://example.test/${registry}`,
      downloads: 0,
      score: 0,
      publisher: null,
      keywords: [],
      registry,
    }));
    expect(rows.map((r) => r.registry)).toEqual([...REGISTRY_IDS]);
  });
});

describe("every catalog id has a provider", () => {
  it("getProvider resolves each id without throwing", () => {
    for (const id of REGISTRY_IDS) {
      expect(getProvider(id).id).toBe(id);
    }
  });
});
