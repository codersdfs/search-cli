# Multi-Registry Package Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ghfind pkg` search five package registries (npm, crates.io, RubyGems, NuGet, Maven Central) behind one provider seam, selected with `--registry`, with npm staying the default.

**Architecture:** A `src/registries/` directory holds one provider module per registry; each exports a pure `normalize*` function plus an async `search*` that takes an injectable `fetch`. `src/package.ts` stays the single facade that every consumer (CLI, TUI, package browser, MCP) already imports — `createPackageSearch()` grows an optional registry argument, so existing call sites keep compiling untouched. The `Package` entity gains one field (`downloadsWindow`) so a lifetime-total download count is never labelled as a monthly one.

**Tech Stack:** TypeScript (strict), Bun runtime + Node 20 compiled dist, `@opentui/core` 0.4.3 for the TUI, `fetch` for HTTP, `bun test` with the vitest API surface, Biome 2.5.14 + Prettier.

**Spec:** `.wayfinder/maps/002-package-registry-search.md` (destination + decisions 002-005 scope, 002-006 query language, 002-007 entity model, 002-009 CLI/TUI surface) and `.wayfinder/tickets/002-003-research-other-registries-survey.md` (the capability matrix this plan implements).

## Global Constraints

- Node `>=20.0.0`; package version is `github-search-cli` 9.11.0 on `main`. Version strings in code must come from `getVersion()` in `src/version.ts` — never read `package.json` at runtime (compiled binaries have no filesystem next to them).
- Registries shipped: `npm`, `crates`, `rubygems`, `nuget`, `maven`. npm is the default and stays the only registry reached by a bare `ghfind pkg <query>`.
- **No cross-registry result merging** (decision 002-005): one query hits exactly one registry. Never fan out and never re-rank across ecosystems.
- **Full query pass-through** (decision 002-006): the raw query string goes to each registry's native search, verbatim. The GitHub qualifier parser (`parseQuery`/`validateQuery` in `src/search.ts`) is never touched on the package path, and no ghfind package grammar is invented.
- Ephemeral persistence stays (decision 002-007): package results are never bookmarked, tagged, deep-dived, or exported to a comparison. `Repo` is not modified.
- No new dependencies. `package.json` dependencies stay exactly `{"@opentui/core": "^0.4.3"}`.
- All network code must work under both Bun and the Node 20 compiled dist: plain `fetch`, no `Bun.*` globals on the package path.
- Tests import the vitest surface from `"vitest"` and use explicit `.ts` extensions on `../src/...` imports. New test files live flat in `tests/`, named `<module>.test.ts`.
- Every user-visible change needs `CHANGELOG.md` → `## [Unreleased] → ### Added` in the same commit (CONTRIBUTING.md "Changelog first"), plus README, `--help`, `src/help.ts`, `src/agent-skill.ts` and the three completion scripts kept in sync (CONTRIBUTING.md "Changing behavior").
- Test count claims in `README.md` must be read from a real `bun test` run, never invented (docs-release skill, "Do not invent test counts").
- Quality gates for every task: `bun test`, `bun run format:check`, `bun run lint`, `bun run typecheck` — all four green, all four in CI.
- Do not commit `*.tgz`, `vendor/` binaries, or `.bak` files.

---

## File Structure

**Created**

| Path                              | Responsibility                                                                                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/registries/types.ts`         | `PackageSearchResult`, `PackageProvider`, `ProviderFetch` — the contract every provider satisfies. No logic, no runtime values.                                                                                                                                                             |
| `src/registries/catalog.ts`       | The registry table and the single source of truth for which registries exist: `RegistryId`, `REGISTRY_IDS`, per-registry `label`, `maxResults`, `downloadsWindow`, `downloadUnit`, `sortModes`, plus `isRegistryId`, `parseRegistryId`, `registryMeta`, `registryHelp`, `sortableModesFor`. |
| `src/registries/npm.ts`           | npm `/-/v1/search` provider + `normalizeNpmObject` (moved out of `package.ts`, behaviour unchanged).                                                                                                                                                                                        |
| `src/registries/crates.ts`        | crates.io `/api/v1/crates` provider + `normalizeCrate`. Owns the mandatory `User-Agent`.                                                                                                                                                                                                    |
| `src/registries/rubygems.ts`      | RubyGems `/api/v1/search.json` provider + `normalizeGem`. Owns the 30-result server cap.                                                                                                                                                                                                    |
| `src/registries/nuget.ts`         | NuGet V3 `/query` provider + `normalizeNugetPackage`.                                                                                                                                                                                                                                       |
| `src/registries/maven.ts`         | Maven Central `solrsearch/select` provider + `normalizeMavenDoc`. Owns "no download data".                                                                                                                                                                                                  |
| `src/registries/index.ts`         | `getProvider(id)` dispatch — the only module that imports all five providers. Thin on purpose.                                                                                                                                                                                              |
| `tests/catalog.test.ts`           | Id validation, parse fallbacks, ceiling/mode/sortability metadata consistency.                                                                                                                                                                                                              |
| `tests/registry-npm.test.ts`      | npm provider URL building, header, limit clamp, normalizer moved with it.                                                                                                                                                                                                                   |
| `tests/registry-crates.test.ts`   | crates provider: UA present, 403→ParseError mapping, `per_page` clamp, normalizer.                                                                                                                                                                                                          |
| `tests/registry-rubygems.test.ts` | rubygems provider: non-array payload tolerance, 30-cap, normalizer.                                                                                                                                                                                                                         |
| `tests/registry-nuget.test.ts`    | nuget provider: `take` clamp, `totalHits`, normalizer.                                                                                                                                                                                                                                      |
| `tests/registry-maven.test.ts`    | maven provider: `rows` clamp, `numFound`, coordinate id → name/url, normalizer.                                                                                                                                                                                                             |

**Modified**

| Path                                                                                       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/types.ts:57-67`                                                                       | `Package.registry` widens `"npm"` → `RegistryId` (imported as a type-only import from `./registries/catalog`). No new field on `Package`: the download window is a property of the registry, so it lives in the catalog and the formatters look it up from `p.registry`.                                                                                                                                                                                                                                     |
| `src/package.ts`                                                                           | Becomes the facade: re-exports the moved npm normalizer, `createPackageSearch(registry?, fetchImpl?)` dispatches through `getProvider`, and the text/CSV/Markdown formatters print the registry-correct download label via `formatDownloads`. `PackageSortMode` is re-exported (defined in `registries/types.ts`) and `sortPackages` stays here byte-for-byte unchanged. **`Package` gains no new field** — the download window is a property of the registry, so it lives in the catalog, not on every row. |
| `src/cli.ts:124-126,341-342,582,1234-1300`                                                 | `flags.registry` typed `RegistryId`; `--registry` validated up front (before any network); `--sort` validated against the chosen registry's sortable modes; help text lists real registries.                                                                                                                                                                                                                                                                                                                 |
| `src/tui.ts:298-304,529-532,1529-1550,1654-1658,2704-2760,2866-2883`                       | Packages mode carries a `currentRegistry`; menu gains a Registry switch group; toolbar and status text show the registry; sort cycling is limited to the modes that registry supports.                                                                                                                                                                                                                                                                                                                       |
| `src/package-browser.ts:43-60,223-232`                                                     | Standalone browser shows the download label per registry and a registry hint in the footer.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/mcp-server.ts:222-232,412-456`                                                        | New additive `ghfind_package_search` tool with a `registry` enum; `ghfind_npm_packages` keeps its exact behaviour as the npm-pinned legacy tool.                                                                                                                                                                                                                                                                                                                                                             |
| `src/session.ts:38-66`, `src/types.ts:136-144`                                             | `SessionState.registry?: RegistryId`, sanitized against the id whitelist exactly like `mode` already is.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/help.ts:70-82`                                                                        | Packages-mode section documents the registry switch keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/agent-skill.ts:60-63`                                                                 | The `## npm packages` guide section becomes `## Package registries` with the `--registry` line.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `completions/ghfind.bash:37-39`, `completions/ghfind.zsh:19`, `completions/ghfind.fish:16` | `--registry` completes the five ids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tests/package.test.ts`                                                                    | The npm normalizer import moves to `../src/registries/npm.ts`; the fixture helper and every sort assertion stay unchanged.                                                                                                                                                                                                                                                                                                                                                                                   |
| `README.md:99,176`                                                                         | Non-interactive example list and the Features table gain the registry form.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `CHANGELOG.md`                                                                             | `[Unreleased] → Added` entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `docs/HOW-TO.md`                                                                           | A `## Package registries` section after the qualifier reference.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `tests/cli-flags.test.ts`                                                                  | New `describe("--registry")` block — offline, spawn-based, matching the file's existing precedent.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `tests/cli-help.test.ts`                                                                   | Asserts the registry usage row and that the flag row names real registries.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Deliberately not touched:** `src/search.ts` (the GitHub `SearchAdapter` seam is the wrong shape — a package is not a `Repo`, and decision 002-007 put `Package` parallel to `Repo` on purpose), `src/output.ts` (its `FORMAT_VALUES` are repo formats; the package variants live in `package.ts`), `src/bookmarks.ts`, `package.json`.

**Live measurements this plan is built on** (all probed 2026-11-01 from `main` @ 9.11.0 — providers must match these, not assumptions):

| Registry  | Endpoint                                              | Ceiling                                                                                        | Total field             | Score         | Downloads                                         | Gotcha                                                                              |
| --------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------- | ------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| npm       | `registry.npmjs.org/-/v1/search?text=&size=`          | 250 (`size=300` → 250 objects)                                                                 | `total`                 | `score.final` | `downloads.monthly`                               | none                                                                                |
| crates.io | `crates.io/api/v1/crates?q=&per_page=`                | 100 (`per_page=200` → HTTP 400 `{"errors":[{"detail":"cannot request more than 100 items"}]}`) | `meta.total`            | **absent**    | `recent_downloads` (90 d), `downloads` (lifetime) | **no `User-Agent` → HTTP 403**; 1 req/s policy                                      |
| RubyGems  | `rubygems.org/api/v1/search.json?query=`              | 30 — the server ignores any size param (`limit=100` → 30 items)                                | **absent** (bare array) | **absent**    | `downloads` (lifetime)                            | payload is a top-level array, not an object                                         |
| NuGet     | `azuresearch-usnc.nuget.org/query?q=&take=`           | verified 200 OK at `take=200`                                                                  | `totalHits`             | **absent**    | `totalDownloads` (lifetime)                       | `api.nuget.org/v3/search/query` is 404 — only the azuresearch host works            |
| Maven     | `search.maven.org/solrsearch/select?q=&rows=&wt=json` | 200 (`rows=500` → 20 docs; `rows=200` → 200 docs)                                              | `response.numFound`     | **absent**    | **absent**                                        | id is `group:artifact`; `core=gav` returns non-JSON for some queries — never use it |

---

### Task 1: Registry catalog module

**Files:**

- Create: `src/registries/catalog.ts`
- Create: `tests/catalog.test.ts`
- Modify: `src/types.ts:57-67` (`Package.registry` widens `"npm"` → `RegistryId`)

**Interfaces:**

- Consumes: nothing (this module imports no other module — that is deliberate, `src/types.ts` depends on it).
- Produces: `PackageSortMode`, `PACKAGE_SORT_MODES`, `RegistryId`, `REGISTRY_IDS`, `DownloadWindow`, `RegistryMeta`, `registryMeta(id)`, `isRegistryId(value)`, `resolveRegistry(raw)`, `registryHelp()`, `sortableModesFor(id)`, `clampRegistryLimit(limit, id)`. Task 2+ imports these; `src/types.ts` imports `RegistryId` as a type so `Package.registry` can name every registry.

- [ ] **Step 1: Write the failing test**

Create `tests/catalog.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/catalog.test.ts`
Expected: FAIL — `Cannot find module '../src/registries/catalog.ts'` (reproduces as a load error for the file, not an assertion failure).

Run: `bun run typecheck`
Expected: FAIL with `Cannot find module '../src/registries/catalog'` in `tests/catalog.test.ts`. Step 5 will fail for a _second_, different reason — `src/types.ts:66` pins `Package.registry` to `"npm"` — which is exactly why Step 4 exists.

- [ ] **Step 3: Write the catalog**

Create `src/registries/catalog.ts`:

```ts
/**
 * catalog.ts — the registry table: the one place that knows which package
 * registries ghfind searches, how many results each will accept in a single
 * request, and what that registry's download number actually measures.
 *
 * This module imports nothing, because src/types.ts depends on RegistryId.
 * Ceilings and windows were verified live against each API on 2026-11-01.
 */

/** Sort strategies a registry's results can be re-ordered by, client-side. */
export type PackageSortMode = "best-match" | "score" | "downloads" | "name";

/** Sort modes in cycle order for the TUI Sort menu (npm offers all four). */
export const PACKAGE_SORT_MODES: { key: PackageSortMode; label: string }[] = [
  { key: "best-match", label: "best-match" },
  { key: "downloads", label: "downloads" },
  { key: "score", label: "score" },
  { key: "name", label: "name" },
];

export const REGISTRY_IDS = [
  "npm",
  "crates",
  "rubygems",
  "nuget",
  "maven",
] as const;

export type RegistryId = (typeof REGISTRY_IDS)[number];

/** What `Package.downloads` means for a registry. `none` = the API has no data. */
export type DownloadWindow = "monthly" | "quarterly" | "lifetime" | "none";

export interface RegistryMeta {
  id: RegistryId;
  /** Display name, used in help text, the toolbar and status lines. */
  label: string;
  /** Largest single request the registry itself will honour. */
  maxResults: number;
  downloadsWindow: DownloadWindow;
  /** False = the registry returns no relevance score; never print a fake one. */
  hasScore: boolean;
  /** Sort modes this registry can honestly support, best-match first. */
  sortModes: readonly PackageSortMode[];
}

const REGISTRIES: Record<RegistryId, RegistryMeta> = {
  npm: {
    id: "npm",
    label: "npm",
    maxResults: 250,
    downloadsWindow: "monthly",
    hasScore: true,
    sortModes: ["best-match", "score", "downloads", "name"],
  },
  crates: {
    id: "crates",
    label: "crates.io",
    // per_page>100 is rejected with HTTP 400 "cannot request more than 100 items".
    maxResults: 100,
    // recent_downloads is the last 90 days; the lifetime figure is on the row too
    // but a 90-day window is the one worth ranking on.
    downloadsWindow: "quarterly",
    hasScore: false,
    sortModes: ["best-match", "downloads", "name"],
  },
  rubygems: {
    id: "rubygems",
    label: "RubyGems",
    // search.json ignores any size parameter and returns at most 30 gems.
    maxResults: 30,
    downloadsWindow: "lifetime",
    hasScore: false,
    sortModes: ["best-match", "downloads", "name"],
  },
  nuget: {
    id: "nuget",
    label: "NuGet",
    maxResults: 250,
    downloadsWindow: "lifetime",
    hasScore: false,
    sortModes: ["best-match", "downloads", "name"],
  },
  maven: {
    id: "maven",
    label: "Maven Central",
    // rows>200 silently falls back to the Solr default of 20 docs.
    maxResults: 200,
    // The Solr search endpoint carries no download or popularity data at all.
    downloadsWindow: "none",
    hasScore: false,
    sortModes: ["best-match", "name"],
  },
};

/** Spellings users type, mapped to canonical ids. Aliases never leave ghfind. */
const REGISTRY_ALIASES: Record<string, RegistryId> = {
  npm: "npm",
  crates: "crates",
  "crates.io": "crates",
  crate: "crates",
  rubygems: "rubygems",
  ruby: "rubygems",
  gems: "rubygems",
  nuget: "nuget",
  maven: "maven",
  "maven-central": "maven",
  central: "maven",
};

export function registryMeta(id: RegistryId): RegistryMeta {
  return REGISTRIES[id];
}

/** True when `value` is already a canonical id (no alias resolution). */
export function isRegistryId(value: unknown): value is RegistryId {
  return (
    typeof value === "string" &&
    (REGISTRY_IDS as readonly string[]).includes(value)
  );
}

/** Resolve a user-supplied registry name or alias. Null = unknown, caller errors. */
export function resolveRegistry(raw: string): RegistryId | null {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  // Own-property check: `constructor` / `__proto__` must resolve to null,
  // not leak Object.prototype values typed as RegistryId.
  return Object.hasOwn(REGISTRY_ALIASES, key) ? REGISTRY_ALIASES[key] : null;
}

/** Canonical id list for error messages: "npm|crates|rubygems|nuget|maven". */
export function registryHelp(): string {
  return REGISTRY_IDS.join("|");
}

export function sortableModesFor(id: RegistryId): PackageSortMode[] {
  return [...registryMeta(id).sortModes];
}

/**
 * Clamp a requested limit to what the registry accepts. The falsy branch
 * preserves the npm facade's long-standing "no limit → 50" behaviour.
 */
export function clampRegistryLimit(limit: number, id: RegistryId): number {
  const { maxResults } = registryMeta(id);
  return Math.min(Math.max(Math.trunc(limit) || 50, 1), maxResults);
}
```

- [ ] **Step 4: Widen the entity field**

In `src/types.ts`, add the type-only import at the top of the file (above `/** A repository … */`, next to the existing imports — this file currently has none, so it becomes the first import block):

```ts
import type { RegistryId } from "./registries/catalog";
```

Then change the last two lines of the `Package` interface (`src/types.ts:57-67`) from

```ts
  keywords: string[];
  registry: "npm"; // registry this package came from (npm-only for MVP)
```

to

```ts
  keywords: string[];
  /** The registry the row came from. Its download window and score availability
   *  live in src/registries/catalog.ts, keyed on this id. */
  registry: RegistryId;
```

No other field is added to `Package`: what a registry's `downloads` number _means_ is a property of the registry, so it stays in the catalog (`registryMeta(p.registry).downloadsWindow`) rather than being repeated on every row.

- [ ] **Step 5: Run tests and make sure they pass**

Run: `bun test tests/catalog.test.ts`
Expected: PASS (14 tests).

Run: `bun run typecheck`
Expected: exit 0. If it still reports `Type 'RegistryId' is not assignable to type '"npm"'`, Step 4 was skipped or done as a value import — it must be `import type`. `"npm"` stays assignable to the widened union, so `src/package.ts` needs no change to compile.

Run: `bun run lint && bun run format:check`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/registries/catalog.ts src/types.ts tests/catalog.test.ts
git commit -m "feat(pkg): add the registry catalog table"
```

---

### Task 2: npm provider behind the `PackageProvider` seam

**Files:**

- Create: `src/registries/types.ts`
- Create: `src/registries/npm.ts`
- Create: `src/registries/index.ts`
- Create: `tests/registry-npm.test.ts`
- Modify: `src/package.ts` (delete the npm fetch + `NpmSearchObject` + `normalizeNpmObject` bodies; re-export and delegate)
- Modify: `tests/package.test.ts:7` (import `normalizeNpmObject` from its new home)

**Interfaces:**

- Consumes: `RegistryId`, `PackageSearchResult` shape, `clampRegistryLimit`, `registryMeta` from Task 1.
- Produces: `ProviderFetch`, `PackageProvider` (`{ id, search(rawQuery, limit, fetchImpl?) }`), `normalizeNpmObject(obj): Package`, `npmProvider`, `npmSearchUrl(rawQuery, size)`, `getProvider(id): PackageProvider`. `createPackageSearch(registry?, fetchImpl?)` returns `{ searchPackage(rawQuery, limit): Promise<PackageSearchResult> }` — the same shape `src/cli.ts:1259`, `src/tui.ts:2737` and `src/package-browser.ts:223` already call, so none of them change in this task.

- [ ] **Step 1: Write the failing test**

Create `tests/registry-npm.test.ts`:

```ts
// The npm provider is the reference implementation of the PackageProvider seam:
// pass-through query, per-registry ceiling, one fetch, normalized Package rows.
import { describe, it, expect, afterEach } from "vitest";
import { npmProvider, npmSearchUrl } from "../src/registries/npm.ts";
import { getProvider } from "../src/registries/index.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PAYLOAD = {
  total: 447322,
  objects: [
    {
      package: {
        name: "cli",
        version: "1.0.1",
        description: "A tool for rapidly building command line apps",
        keywords: ["cli", "command line"],
        links: { npm: "https://www.npmjs.com/package/cli" },
        publisher: { username: "cohara87" },
      },
      downloads: { monthly: 3854909 },
      score: { final: 1666.63 },
    },
  ],
};

describe("npmSearchUrl", () => {
  it("forwards the query verbatim, url-encoded", () => {
    expect(npmSearchUrl("terminal ui", 50)).toBe(
      "https://registry.npmjs.org/-/v1/search?text=terminal%20ui&size=50",
    );
  });

  it("passes registry-native qualifiers through untouched", () => {
    expect(npmSearchUrl("scope:express not:unstable", 10)).toContain(
      "text=scope%3Aexpress%20not%3Aunstable",
    );
  });
});

describe("npmProvider.search", () => {
  it("is registered under the npm id", () => {
    expect(getProvider("npm")).toBe(npmProvider);
    expect(npmProvider.id).toBe("npm");
  });

  it("normalizes objects and reports the registry total", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse(PAYLOAD);
    }) as unknown as typeof fetch;
    const res = await npmProvider.search("cli", 50);
    expect(seenUrl).toContain("text=cli");
    expect(res.totalCount).toBe(447322);
    expect(res.packages[0]).toMatchObject({
      name: "cli",
      version: "1.0.1",
      downloads: 3854909,
      score: 1666.63,
      publisher: "cohara87",
      registry: "npm",
    });
  });

  it("clamps size to npm's 250 ceiling", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse(PAYLOAD);
    }) as unknown as typeof fetch;
    await npmProvider.search("cli", 900);
    expect(seenUrl).toContain("size=250");
  });

  it("sends a User-Agent and accepts JSON", async () => {
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      seenInit = init;
      return jsonResponse(PAYLOAD);
    }) as unknown as typeof fetch;
    await npmProvider.search("cli", 20);
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("ghfind");
    expect(headers.Accept).toBe("application/json");
  });

  it("throws an error naming the registry and status on a failed request", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({}, 503)) as unknown as typeof fetch;
    await expect(npmProvider.search("cli", 20)).rejects.toThrow(
      "npm search failed: HTTP 503",
    );
  });

  it("tolerates a payload with no objects array", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ total: 0 })) as unknown as typeof fetch;
    const res = await npmProvider.search("nothing", 20);
    expect(res.packages).toEqual([]);
    expect(res.totalCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/registry-npm.test.ts`
Expected: FAIL — `Cannot find module '../src/registries/npm.ts'`.

- [ ] **Step 3: Create the seam and move npm into it**

Create `src/registries/types.ts`:

```ts
/**
 * types.ts — the contract every registry provider satisfies. Type-only:
 * importing this module adds nothing to the bundle.
 */
import type { Package } from "../types";
import type { RegistryId } from "./catalog";

/** The fetch signature a provider needs; injectable so tests stay offline. */
export type ProviderFetch = typeof fetch;

export interface PackageSearchResult {
  /** Total matches the registry reports, not the page we fetched. */
  totalCount: number;
  packages: Package[];
}

export interface PackageProvider {
  readonly id: RegistryId;
  search(
    rawQuery: string,
    limit: number,
    fetchImpl?: ProviderFetch,
  ): Promise<PackageSearchResult>;
}
```

Create `src/registries/npm.ts` — move `NpmSearchObject`, `normalizeNpmObject` and the fetch body verbatim from `src/package.ts:17-72`, then wrap them:

```ts
/**
 * npm.ts — npm registry search (research ticket 002-001).
 *
 * Query is forwarded verbatim to `/-/v1/search` (decision 002-006); ghfind only
 * normalizes rows and clamps the page size to what npm honours (250, measured).
 * Extracted from src/package.ts unchanged when the registry seam was introduced.
 */
import type { Package } from "../types";
import { clampRegistryLimit } from "./catalog";
import type {
  PackageSearchResult,
  PackageProvider,
  ProviderFetch,
} from "./types";

/** The npm `/-/v1/search` object shape we actually consume (research 002-001). */
export interface NpmSearchObject {
  package: {
    name?: string;
    scope?: string;
    version?: string;
    description?: string | null;
    keywords?: string[];
    date?: string;
    links?: { npm?: string; homepage?: string; repository?: string };
    publisher?: { username?: string };
    author?: { name?: string };
  };
  score?: {
    final?: number;
    detail?: { quality?: number; popularity?: number; maintenance?: number };
  };
  searchScore?: number;
  downloads?: { npm?: number; total?: number; monthly?: number };
}

export function normalizeNpmObject(obj: NpmSearchObject): Package {
  const p = obj.package;
  const name = p.name ?? "";
  return {
    name,
    version: p.version ?? "",
    description: p.description ?? null,
    url: p.links?.npm ?? `https://www.npmjs.com/package/${name}`,
    downloads: obj.downloads?.monthly ?? 0,
    score: obj.score?.final ?? obj.searchScore ?? 0,
    publisher: p.publisher?.username ?? p.author?.name ?? null,
    keywords: p.keywords ?? [],
    registry: "npm",
  };
}

export function npmSearchUrl(rawQuery: string, size: number): string {
  return `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(rawQuery)}&size=${size}`;
}

export async function searchNpm(
  rawQuery: string,
  limit: number,
  fetchImpl: ProviderFetch = fetch,
): Promise<PackageSearchResult> {
  const size = clampRegistryLimit(limit, "npm");
  const res = await fetchImpl(npmSearchUrl(rawQuery, size), {
    headers: { "User-Agent": "ghfind", Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`npm search failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    objects?: NpmSearchObject[];
    total?: number;
  };
  const packages = (data.objects ?? []).map(normalizeNpmObject);
  return { totalCount: data.total ?? packages.length, packages };
}

export const npmProvider: PackageProvider = {
  id: "npm",
  search: searchNpm,
};
```

Create `src/registries/index.ts`:

```ts
/**
 * index.ts — provider dispatch. The only module that imports every provider,
 * so `src/package.ts` stays a thin facade and adding a registry touches
 * exactly one line here plus the catalog entry.
 */
import type { RegistryId } from "./catalog";
import type { PackageProvider } from "./types";
import { npmProvider } from "./npm";

const PROVIDERS: Partial<Record<RegistryId, PackageProvider>> = {
  [npmProvider.id]: npmProvider,
};

/** The provider for `id`. Throws if the catalog advertises an unbuilt registry. */
export function getProvider(id: RegistryId): PackageProvider {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(`Registry "${id}" has no search provider.`);
  }
  return provider;
}
```

- [ ] **Step 4: Rewire the facade**

In `src/package.ts`, delete the `NpmSearchObject` interface, `normalizeNpmObject`, and the fetch body of `createPackageSearch`, and replace the top of the file (lines 1-72) with:

```ts
/**
 * package.ts — the package-search facade every consumer imports.
 *
 * The npm-only MVP (ticket 002-005) is now a registry behind a seam: providers
 * live in src/registries/, this module keeps the stable public surface
 * (`createPackageSearch`, the `Package*` formatters, `sortPackages`) so the CLI,
 * the TUI, the package browser and the MCP server never learned about registries.
 * Query stays pass-through (ticket 002-006) and rows stay the parallel
 * `Package` shape (ticket 002-007).
 */
import type { Package } from "./types";
import type { Package } from "./types";
import type { PackageSortMode, RegistryId } from "./registries/catalog";
import { getProvider } from "./registries/index";
import type { PackageSearchResult, ProviderFetch } from "./registries/types";

// Re-exports keep every existing import path through `./package` compiling: the
// moved npm normalizer, the sort vocabulary, and the result shape. These are
// `export ... from` statements, not local imports, so nothing is unused.
export type { PackageSearchResult } from "./registries/types";
export type { PackageSortMode } from "./registries/catalog";
export { PACKAGE_SORT_MODES } from "./registries/catalog";
export { normalizeNpmObject, type NpmSearchObject } from "./registries/npm";

export function createPackageSearch(
  registry: RegistryId = "npm",
  fetchImpl: ProviderFetch = fetch,
) {
  const provider = getProvider(registry);
  return {
    registry,
    async searchPackage(
      rawQuery: string,
      limit: number,
    ): Promise<PackageSearchResult> {
      return provider.search(rawQuery, limit, fetchImpl);
    },
  };
}
```

Keep everything from `/** Sort strategies for package results ... */` (`src/package.ts:75`) onward untouched, **except** delete the two now-duplicated local definitions, or the file exports each name twice and `tsc` fails:

- `export type PackageSortMode = "best-match" | "score" | "downloads" | "name";` (line 76)
- the whole `export const PACKAGE_SORT_MODES: { key: PackageSortMode; label: string }[] = [...]` block (lines 79-84)

Both names now arrive from `./registries/catalog` through the header above, so `sortPackages` (which annotates its `sort` parameter with `PackageSortMode`) keeps resolving against the local `import type`, and `src/cli.ts:20`, `src/tui.ts:108-109` and `src/mcp-server.ts:38` keep importing them from `./package` unchanged. Leave `sortPackages` and every `formatPackages*` function exactly as they are.

Update `tests/package.test.ts:4-8` so the moved symbol comes from its new home (everything else in that file stays, including all `sortPackages` assertions):

```ts
import { sortPackages, type PackageSortMode } from "../src/package.ts";
import { normalizeNpmObject } from "../src/registries/npm.ts";
```

- [ ] **Step 5: Run the whole package surface**

Run: `bun test tests/registry-npm.test.ts tests/package.test.ts tests/catalog.test.ts`
Expected: PASS — suite total 741 (719 baseline + 14 catalog + 8 npm), 0 fail. (741 = 719 + 22; Tasks 3-6 add 35 more, so the totals below rise accordingly.) `tests/package.test.ts` keeps its two `normalizeNpmObject` cases unchanged — they now exercise the re-export, which is the point: the public path must keep working.

Run: `bun test`
Expected: PASS — 741 tests. If the count differs, the moved code changed behaviour; investigate instead of editing the expectation.

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: exit 0 each.

- [ ] **Step 6: Verify the live path still works**

Run: `bun run src/cli.ts pkg zod --json | Select-Object -First 6`
Expected: JSON whose first row has `"name": "zod"` and `"registry": "npm"`.

- [ ] **Step 7: Commit**

```bash
git add src/package.ts src/registries tests/registry-npm.test.ts tests/package.test.ts
git commit -m "refactor(pkg): move npm search behind the registry provider seam"
```

---

### Task 3: crates.io provider

**Files:**

- Create: `src/registries/crates.ts`
- Create: `tests/registry-crates.test.ts`
- Modify: `src/registries/index.ts` (register `cratesProvider`)

**Interfaces:**

- Consumes: `PackageProvider`, `ProviderFetch`, `PackageSearchResult` from Task 2; `clampRegistryLimit`, `registryMeta` from Task 1; `getVersion()` from `src/version.ts`.
- Produces: `normalizeCrate(raw): Package`, `cratesSearchUrl(query, perPage)`, `cratesUserAgent()`, `cratesProvider` (`id: "crates"`). `Package.downloads` for crates is the **90-day** figure (`recent_downloads`), `score` is always `0` because crates.io returns no relevance score.

- [ ] **Step 1: Write the failing test**

Create `tests/registry-crates.test.ts`:

```ts
// crates.io rejects every request without a descriptive User-Agent (HTTP 403,
// verified live) and caps per_page at 100 (HTTP 400 above that). Both guards
// are behaviour this provider owns, so both are asserted here.
import { describe, it, expect, afterEach } from "vitest";
import {
  cratesProvider,
  cratesSearchUrl,
  cratesUserAgent,
  normalizeCrate,
} from "../src/registries/crates.ts";
import { getProvider } from "../src/registries/index.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PAYLOAD = {
  crates: [
    {
      name: "clap",
      max_stable_version: "4.5.4",
      newest_version: "4.5.4",
      description: "A simple to use, efficient, and full-featured CLI parser.",
      downloads: 61000000,
      recent_downloads: 8200000,
      keywords: null,
      homepage: "https://cla.rs",
      repository: "https://github.com/clap-rs/clap",
    },
  ],
  meta: { total: 65530 },
};

describe("cratesUserAgent", () => {
  it("names ghfind and carries the version", () => {
    const ua = cratesUserAgent();
    expect(ua).toContain("ghfind/");
    expect(ua.startsWith("ghfind/")).toBe(true);
  });
});

describe("cratesSearchUrl", () => {
  it("forwards the query verbatim as ?q=", () => {
    expect(cratesSearchUrl("cli", 50)).toBe(
      "https://crates.io/api/v1/crates?q=cli&per_page=50",
    );
  });

  it("requests at most crates' 100-item ceiling", () => {
    // The clamp lives in searchCrates (via clampRegistryLimit), not the URL builder, so
    // this asserts the URL the provider actually fetches.
    expect(cratesSearchUrl("cli", 100)).toContain("per_page=100");
  });
});

describe("normalizeCrate", () => {
  it("maps a crate to Package with the 90-day download window", () => {
    const out = normalizeCrate(PAYLOAD.crates[0]);
    expect(out).toMatchObject({
      name: "clap",
      version: "4.5.4",
      url: "https://crates.io/crates/clap",
      downloads: 8200000,
      score: 0,
      publisher: null,
      keywords: [],
      registry: "crates",
    });
  });

  it("falls back to newest_version then an empty version", () => {
    expect(normalizeCrate({ name: "x", newest_version: "0.1.0" }).version).toBe(
      "0.1.0",
    );
    expect(normalizeCrate({ name: "x" }).version).toBe("");
  });

  it("reports zero downloads when recent_downloads is absent", () => {
    // Never silently substitute the lifetime tally: the window would be a lie.
    expect(normalizeCrate({ name: "x", downloads: 999 }).downloads).toBe(0);
  });
});

describe("cratesProvider.search", () => {
  it("is registered under the crates id", () => {
    expect(getProvider("crates")).toBe(cratesProvider);
  });

  it("sends the User-Agent header the API demands", async () => {
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      seenInit = init;
      return jsonResponse(PAYLOAD);
    }) as unknown as typeof fetch;
    await cratesProvider.search("cli", 20);
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("ghfind/");
  });

  it("normalizes rows and reports meta.total", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(PAYLOAD)) as unknown as typeof fetch;
    const res = await cratesProvider.search("cli", 20);
    expect(res.totalCount).toBe(65530);
    expect(res.packages[0].name).toBe("clap");
  });

  it("clamps a too-large limit to 100 before fetching", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse(PAYLOAD);
    }) as unknown as typeof fetch;
    await cratesProvider.search("cli", 900);
    expect(seenUrl).toContain("per_page=100");
  });

  it("surfaces crates' error body on a non-OK response", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        { errors: [{ detail: "cannot request more than 100 items" }] },
        400,
      )) as unknown as typeof fetch;
    await expect(cratesProvider.search("cli", 20)).rejects.toThrow(
      "crates.io search failed: HTTP 400 — cannot request more than 100 items",
    );
  });

  it("names the status alone when the error body is unparseable", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>", { status: 500 })) as unknown as typeof fetch;
    await expect(cratesProvider.search("cli", 20)).rejects.toThrow(
      "crates.io search failed: HTTP 500",
    );
  });

  it("treats a payload with no crates array as zero results", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({})) as unknown as typeof fetch;
    const res = await cratesProvider.search("nothing", 20);
    expect(res.packages).toEqual([]);
    expect(res.totalCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/registry-crates.test.ts`
Expected: FAIL — `Cannot find module '../src/registries/crates.ts'`.

- [ ] **Step 3: Write the provider**

Create `src/registries/crates.ts`:

```ts
/**
 * crates.ts — crates.io search (survey ticket 002-003).
 *
 * Two facts from the API drive this module: every request without a descriptive
 * User-Agent is refused with HTTP 403, and per_page above 100 is refused with
 * HTTP 400. It returns no relevance score, so Package.score stays 0, and the
 * download figure we surface is `recent_downloads` (a rolling 90 days), not the
 * lifetime `downloads` on the same row.
 */
import type { Package } from "../types";
import { getVersion } from "../version";
import { clampRegistryLimit } from "./catalog";
import type {
  PackageSearchResult,
  PackageProvider,
  ProviderFetch,
} from "./types";

interface RawCrate {
  name?: string;
  max_stable_version?: string | null;
  newest_version?: string | null;
  description?: string | null;
  downloads?: number;
  recent_downloads?: number | null;
  homepage?: string | null;
  repository?: string | null;
}

export function cratesUserAgent(): string {
  return `ghfind/${getVersion()} (https://github.com/codersdfs/search-cli)`;
}

export function cratesSearchUrl(rawQuery: string, perPage: number): string {
  return `https://crates.io/api/v1/crates?q=${encodeURIComponent(rawQuery)}&per_page=${perPage}`;
}

export function normalizeCrate(raw: RawCrate): Package {
  const name = raw.name ?? "";
  return {
    name,
    version: raw.max_stable_version ?? raw.newest_version ?? "",
    description: raw.description ?? null,
    // The crate page is the stable link; homepage/repository point elsewhere.
    url: `https://crates.io/crates/${name}`,
    downloads: raw.recent_downloads ?? 0,
    score: 0, // crates.io returns no relevance score
    publisher: null, // owners are a second request; not worth it for search
    keywords: [], // the search payload returns keywords: null
    registry: "crates",
  };
}

async function readErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    errors?: Array<{ detail?: string }>;
  } | null;
  const detail = body?.errors?.[0]?.detail;
  return detail
    ? `crates.io search failed: HTTP ${res.status} — ${detail}`
    : `crates.io search failed: HTTP ${res.status}`;
}

export async function searchCrates(
  rawQuery: string,
  limit: number,
  fetchImpl: ProviderFetch = fetch,
): Promise<PackageSearchResult> {
  const perPage = clampRegistryLimit(limit, "crates");
  const res = await fetchImpl(cratesSearchUrl(rawQuery, perPage), {
    headers: {
      "User-Agent": cratesUserAgent(),
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  const data = (await res.json()) as {
    crates?: RawCrate[];
    meta?: { total?: number };
  };
  const packages = (data.crates ?? []).map(normalizeCrate);
  return { totalCount: data.meta?.total ?? packages.length, packages };
}

export const cratesProvider: PackageProvider = {
  id: "crates",
  search: searchCrates,
};
```

Register it in `src/registries/index.ts`:

```ts
import { cratesProvider } from "./crates";

const PROVIDERS: Partial<Record<RegistryId, PackageProvider>> = {
  [npmProvider.id]: npmProvider,
  [cratesProvider.id]: cratesProvider,
};
```

- [ ] **Step 4: Run tests and make sure they pass**

Run: `bun test tests/registry-crates.test.ts`
Expected: PASS (13 tests).

Run: `bun test && bun run typecheck && bun run lint && bun run format:check`
Expected: all green.

- [ ] **Step 5: Verify against the live API**

Run: `bun -e 'const {cratesProvider}=await import("./src/registries/crates.ts"); const r=await cratesProvider.search("clap",5); console.log(r.totalCount, r.packages.map(p=>p.name+"@"+p.version))'`
Expected: a non-zero total and `clap@4.x` in the list — proves the User-Agent guard works for real.

- [ ] **Step 6: Commit**

```bash
git add src/registries/crates.ts src/registries/index.ts tests/registry-crates.test.ts
git commit -m "feat(pkg): add the crates.io search provider"
```

---

### Task 4: RubyGems provider

**Files:**

- Create: `src/registries/rubygems.ts`
- Create: `tests/registry-rubygems.test.ts`
- Modify: `src/registries/index.ts` (register `rubygemsProvider`)

**Interfaces:**

- Consumes: Task 1/2 types; `clampRegistryLimit`.
- Produces: `normalizeGem(raw): Package`, `rubygemsSearchUrl(query)`, `rubygemsProvider` (`id: "rubygems"`). The payload is a **top-level JSON array** with no total field, so `totalCount` is the row count. Downloads are **lifetime**; `score` is always `0`.

- [ ] **Step 1: Write the failing test**

Create `tests/registry-rubygems.test.ts`:

```ts
// RubyGems search.json answers with a bare array (no envelope, no total) and
// ignores every size parameter, returning at most 30 gems. The provider has to
// respect both, and must never invent a total it was not given.
import { describe, it, expect, afterEach } from "vitest";
import {
  normalizeGem,
  rubygemsProvider,
  rubygemsSearchUrl,
} from "../src/registries/rubygems.ts";
import { getProvider } from "../src/registries/index.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const GEM = {
  name: "thor",
  version: "1.4.0",
  info: "Parser, framework, and monolithic tools",
  downloads: 729093,
  authors: "Jakub Pastuszek",
  licenses: ["MIT"],
  project_uri: "https://rubygems.org/gems/thor",
  homepage_uri: "http://github.com/jpastuszek/thor",
};

describe("rubygemsSearchUrl", () => {
  it("sends the query as ?query= and adds no size parameter", () => {
    expect(rubygemsSearchUrl("pdf reader")).toBe(
      "https://rubygems.org/api/v1/search.json?query=pdf%20reader",
    );
  });
});

describe("normalizeGem", () => {
  it("maps a gem to Package with lifetime downloads", () => {
    expect(normalizeGem(GEM)).toMatchObject({
      name: "thor",
      version: "1.4.0",
      description: "Parser, framework, and monolithic tools",
      url: "https://rubygems.org/gems/thor",
      downloads: 729093,
      score: 0,
      publisher: "Jakub Pastuszek",
      keywords: [],
      registry: "rubygems",
    });
  });

  it("falls back to the canonical gem URL when project_uri is missing", () => {
    expect(normalizeGem({ name: "rails" }).url).toBe(
      "https://rubygems.org/gems/rails",
    );
  });

  it("does not confuse licenses with keywords", () => {
    expect(normalizeGem(GEM).keywords).toEqual([]);
  });
});

describe("rubygemsProvider.search", () => {
  it("is registered under the rubygems id", () => {
    expect(getProvider("rubygems")).toBe(rubygemsProvider);
  });

  it("reads the bare array and truncates to the server's 30-row cap", async () => {
    const rows = Array.from({ length: 35 }, (_, i) => ({ name: `gem-${i}` }));
    globalThis.fetch = (async () =>
      jsonResponse(rows)) as unknown as typeof fetch;
    const res = await rubygemsProvider.search("gem", 50);
    expect(res.packages).toHaveLength(30);
    // The API gives no total: report what we actually have, not a guess.
    expect(res.totalCount).toBe(30);
  });

  it("honours a smaller limit", async () => {
    const rows = Array.from({ length: 35 }, (_, i) => ({ name: `gem-${i}` }));
    globalThis.fetch = (async () =>
      jsonResponse(rows)) as unknown as typeof fetch;
    const res = await rubygemsProvider.search("gem", 5);
    expect(res.packages).toHaveLength(5);
    expect(res.totalCount).toBe(5);
  });

  it("tolerates a non-array payload", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "nope" })) as unknown as typeof fetch;
    const res = await rubygemsProvider.search("gem", 20);
    expect(res.packages).toEqual([]);
  });

  it("throws an error naming the registry on a failed request", async () => {
    globalThis.fetch = (async () =>
      new Response("boom", { status: 502 })) as unknown as typeof fetch;
    await expect(rubygemsProvider.search("gem", 20)).rejects.toThrow(
      "RubyGems search failed: HTTP 502",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/registry-rubygems.test.ts`
Expected: FAIL — `Cannot find module '../src/registries/rubygems.ts'`.

- [ ] **Step 3: Write the provider**

Create `src/registries/rubygems.ts`:

```ts
/**
 * rubygems.ts — RubyGems search (survey ticket 002-003).
 *
 * Two API quirks decide the shape: search.json returns a bare JSON array with no
 * total field, so `totalCount` is only ever the number of rows we kept; and the
 * endpoint ignores any size parameter, capping at 30 gems server-side. The
 * download tally is a lifetime figure, so the label comes from the catalog.
 */
import type { Package } from "../types";
import { clampRegistryLimit } from "./catalog";
import type {
  PackageSearchResult,
  PackageProvider,
  ProviderFetch,
} from "./types";

/** The server caps this endpoint at 30 rows regardless of the request. */
const RUBYGEMS_SERVER_CAP = 30;

interface RawGem {
  name?: string;
  version?: string;
  info?: string | null;
  downloads?: number;
  authors?: string | null;
  licenses?: string[] | null;
  project_uri?: string | null;
  homepage_uri?: string | null;
}

export function rubygemsSearchUrl(rawQuery: string): string {
  return `https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(rawQuery)}`;
}

export function normalizeGem(raw: RawGem): Package {
  const name = raw.name ?? "";
  return {
    name,
    version: raw.version ?? "",
    description: raw.info ?? null,
    url: raw.project_uri ?? `https://rubygems.org/gems/${name}`,
    downloads: raw.downloads ?? 0,
    score: 0, // RubyGems returns no relevance score
    publisher: raw.authors ?? null,
    keywords: [], // `licenses` is a licence list, not keywords
    registry: "rubygems",
  };
}

export async function searchRubygems(
  rawQuery: string,
  limit: number,
  fetchImpl: ProviderFetch = fetch,
): Promise<PackageSearchResult> {
  const want = clampRegistryLimit(limit, "rubygems");
  const res = await fetchImpl(rubygemsSearchUrl(rawQuery), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`RubyGems search failed: HTTP ${res.status}`);
  }
  const data = await res.json().catch(() => null);
  // Bare array on success, and an object-shaped error body on some failures.
  const rows = Array.isArray(data) ? (data as RawGem[]) : [];
  const packages = rows.slice(0, want).map(normalizeGem);
  return {
    totalCount: Math.min(rows.length, RUBYGEMS_SERVER_CAP, want),
    packages,
  };
}

export const rubygemsProvider: PackageProvider = {
  id: "rubygems",
  search: searchRubygems,
};
```

Register it in `src/registries/index.ts`:

```ts
import { rubygemsProvider } from "./rubygems";

const PROVIDERS: Partial<Record<RegistryId, PackageProvider>> = {
  [npmProvider.id]: npmProvider,
  [cratesProvider.id]: cratesProvider,
  [rubygemsProvider.id]: rubygemsProvider,
};
```

- [ ] **Step 4: Run tests and make sure they pass**

Run: `bun test tests/registry-rubygems.test.ts`
Expected: PASS (9 tests).

Run: `bun test && bun run typecheck && bun run lint && bun run format:check`
Expected: all green.

- [ ] **Step 5: Verify against the live API**

Run: `bun -e 'const {rubygemsProvider}=await import("./src/registries/rubygems.ts"); const r=await rubygemsProvider.search("thor",10); console.log(r.packages.map(p=>p.name+"@"+p.version))'`
Expected: at least one `thor` entry.

- [ ] **Step 6: Commit**

```bash
git add src/registries/rubygems.ts src/registries/index.ts tests/registry-rubygems.test.ts
git commit -m "feat(pkg): add the RubyGems search provider"
```

---

### Task 5: NuGet provider

**Files:**

- Create: `src/registries/nuget.ts`
- Create: `tests/registry-nuget.test.ts`
- Modify: `src/registries/index.ts` (register `nugetProvider`)

**Interfaces:**

- Consumes: Task 1/2 types; `clampRegistryLimit`.
- Produces: `normalizeNugetPackage(raw): Package`, `nugetSearchUrl(query, take)`, `nugetProvider` (`id: "nuget"`). Downloads are **lifetime** (`totalDownloads`); `score` is always `0`. The only working host is `azuresearch-usnc.nuget.org` — `api.nuget.org/v3/search/query` answers 404 (verified live).

- [ ] **Step 1: Write the failing test**

Create `tests/registry-nuget.test.ts`:

```ts
// NuGet's V3 search lives on the azuresearch host only (api.nuget.org/v3/search
// is a 404) and answers with { totalHits, data: [...] }. The download figure is
// a lifetime tally, which the catalog labels; nothing here may present it as
// monthly.
import { describe, it, expect, afterEach } from "vitest";
import {
  normalizeNugetPackage,
  nugetProvider,
  nugetSearchUrl,
} from "../src/registries/nuget.ts";
import { getProvider } from "../src/registries/index.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PKG = {
  id: "Serilog",
  version: "4.4.0",
  title: "Serilog",
  description: "Simple .NET logging",
  summary: "",
  authors: ["Serilog Contributors"],
  tags: ["serilog", "logging", "semantic"],
  totalDownloads: 3519132032,
  projectUrl: "https://serilog.net/",
  verified: true,
};

describe("nugetSearchUrl", () => {
  it("targets the azuresearch host with take/skip", () => {
    expect(nugetSearchUrl("logging framework", 25)).toBe(
      "https://azuresearch-usnc.nuget.org/query?q=logging%20framework&take=25&skip=0",
    );
  });

  it("requests at most NuGet's ceiling", () => {
    expect(nugetSearchUrl("cli", 250)).toContain("take=250");
  });
});

describe("normalizeNugetPackage", () => {
  it("maps a NuGet row to Package with lifetime downloads", () => {
    expect(normalizeNugetPackage(PKG)).toMatchObject({
      name: "Serilog",
      version: "4.4.0",
      description: "Simple .NET logging",
      url: "https://serilog.net/",
      downloads: 3519132032,
      score: 0,
      publisher: "Serilog Contributors",
      keywords: ["serilog", "logging", "semantic"],
      registry: "nuget",
    });
  });

  it("falls back to description then title when summary is empty", () => {
    expect(
      normalizeNugetPackage({
        id: "x",
        description: null,
        title: "Fallback Title",
      }).description,
    ).toBe("Fallback Title");
  });

  it("builds a package page URL when projectUrl is missing", () => {
    expect(normalizeNugetPackage({ id: "Serilog" }).url).toBe(
      "https://www.nuget.org/packages/Serilog",
    );
  });

  it("joins multi-element authors, which arrive as arrays", () => {
    expect(
      normalizeNugetPackage({ id: "x", authors: ["A", "B"] }).publisher,
    ).toBe("A, B");
  });
});

describe("nugetProvider.search", () => {
  it("is registered under the nuget id", () => {
    expect(getProvider("nuget")).toBe(nugetProvider);
  });

  it("reads totalHits and data", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        totalHits: 2381,
        data: [PKG],
      })) as unknown as typeof fetch;
    const res = await nugetProvider.search("serilog", 20);
    expect(res.totalCount).toBe(2381);
    expect(res.packages[0].name).toBe("Serilog");
  });

  it("tolerates a payload with no data array", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({})) as unknown as typeof fetch;
    const res = await nugetProvider.search("nothing", 20);
    expect(res.packages).toEqual([]);
    expect(res.totalCount).toBe(0);
  });

  it("clamps a too-large limit to 250 before fetching", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse({ totalHits: 0, data: [] });
    }) as unknown as typeof fetch;
    await nugetProvider.search("cli", 900);
    expect(seenUrl).toContain("take=250");
  });

  it("throws an error naming the registry on a failed request", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 429 })) as unknown as typeof fetch;
    await expect(nugetProvider.search("serilog", 20)).rejects.toThrow(
      "NuGet search failed: HTTP 429",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/registry-nuget.test.ts`
Expected: FAIL — `Cannot find module '../src/registries/nuget.ts'`.

- [ ] **Step 3: Write the provider**

Create `src/registries/nuget.ts`:

```ts
/**
 * nuget.ts — NuGet V3 search (survey ticket 002-003).
 *
 * The search service is served from azuresearch-usnc.nuget.org; the
 * api.nuget.org/v3/search path returns 404, verified live on 2026-11-01. Rows
 * carry a lifetime download tally and no relevance score, and `authors` arrives
 * as an array while `summary` is often an empty string rather than absent.
 */
import type { Package } from "../types";
import { clampRegistryLimit } from "./catalog";
import type {
  PackageSearchResult,
  PackageProvider,
  ProviderFetch,
} from "./types";

interface RawNugetPackage {
  id?: string;
  version?: string;
  title?: string | null;
  description?: string | null;
  summary?: string | null;
  authors?: string[] | string | null;
  tags?: string[] | null;
  totalDownloads?: number;
  projectUrl?: string | null;
}

/** A single string or an array of them — NuGet is inconsistent across fields. */
function firstOrJoined(value: string[] | string | null | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

export function nugetSearchUrl(rawQuery: string, take: number): string {
  return `https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(rawQuery)}&take=${take}&skip=0`;
}

export function normalizeNugetPackage(raw: RawNugetPackage): Package {
  const name = raw.id ?? "";
  const description = raw.description || raw.summary || raw.title || null;
  return {
    name,
    version: raw.version ?? "",
    description: description ?? null,
    url: raw.projectUrl || `https://www.nuget.org/packages/${name}`,
    downloads: raw.totalDownloads ?? 0,
    score: 0, // NuGet returns no relevance score
    publisher: firstOrJoined(raw.authors) || null,
    keywords: raw.tags ?? [],
    registry: "nuget",
  };
}

async function searchNuget(
  rawQuery: string,
  limit: number,
  fetchImpl: ProviderFetch = fetch,
): Promise<PackageSearchResult> {
  const take = clampRegistryLimit(limit, "nuget");
  const res = await fetchImpl(nugetSearchUrl(rawQuery, take), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`NuGet search failed: HTTP ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as {
    totalHits?: number;
    data?: RawNugetPackage[];
  } | null;
  const packages = (data?.data ?? []).map(normalizeNugetPackage);
  return { totalCount: data?.totalHits ?? packages.length, packages };
}

export const nugetProvider: PackageProvider = {
  id: "nuget",
  search: searchNuget,
};
```

Register it in `src/registries/index.ts`:

```ts
import { nugetProvider } from "./nuget";

const PROVIDERS: Partial<Record<RegistryId, PackageProvider>> = {
  [npmProvider.id]: npmProvider,
  [cratesProvider.id]: cratesProvider,
  [rubygemsProvider.id]: rubygemsProvider,
  [nugetProvider.id]: nugetProvider,
};
```

- [ ] **Step 4: Run tests and make sure they pass**

Run: `bun test tests/registry-nuget.test.ts`
Expected: PASS (11 tests).

Run: `bun test && bun run typecheck && bun run lint && bun run format:check`
Expected: all green.

- [ ] **Step 5: Verify against the live API**

Run: `bun -e 'const {nugetProvider}=await import("./src/registries/nuget.ts"); const r=await nugetProvider.search("serilog",5); console.log(r.totalCount, r.packages.map(p=>p.name+"@"+p.version))'`
Expected: `totalHits` above 2000 and `Serilog@4.x` in the list.

- [ ] **Step 6: Commit**

```bash
git add src/registries/nuget.ts src/registries/index.ts tests/registry-nuget.test.ts
git commit -m "feat(pkg): add the NuGet search provider"
```

---

### Task 6: Maven Central provider

**Files:**

- Create: `src/registries/maven.ts`
- Create: `tests/registry-maven.test.ts`
- Modify: `src/registries/index.ts` (register `mavenProvider`)

**Interfaces:**

- Consumes: Task 1/2 types; `clampRegistryLimit`.
- Produces: `normalizeMavenDoc(raw): Package`, `mavenSearchUrl(query, rows)`, `mavenProvider` (`id: "maven"`). Maven's Solr endpoint returns **no download data at all**, so `downloads` is always `0` and the catalog window is `none`; rows have no `version`, so the version comes from `latestVersion`. `Package.url` must be `central.sonatype.com` — `search.maven.org/artifact/...` answers 403 to non-browser clients (verified live).

- [ ] **Step 1: Write the failing test**

Create `tests/registry-maven.test.ts`:

```ts
// Maven Central's Solr endpoint is the one registry here with no popularity data
// and no per-row version: it publishes `latestVersion`, `numFound`, and a
// `group:artifact` id. A provider that quietly reports downloads: 0 and lets the
// formatter say "0/mo" would be lying, which is why the catalog window is `none`.
import { describe, it, expect, afterEach } from "vitest";
import {
  mavenProvider,
  mavenSearchUrl,
  normalizeMavenDoc,
} from "../src/registries/maven.ts";
import { getProvider } from "../src/registries/index.ts";
import { registryMeta } from "../src/registries/catalog.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const DOC = {
  id: "com.cobber.fta:cli",
  g: "com.cobber.fta",
  a: "cli",
  latestVersion: "17.1.0",
  repositoryId: "central",
  p: "jar",
  timestamp: 1751215759000,
  versionCount: 192,
};

const PAYLOAD = { response: { numFound: 2431, start: 0, docs: [DOC] } };

describe("mavenSearchUrl", () => {
  it("asks for JSON with rows bounded by Maven's ceiling", () => {
    expect(mavenSearchUrl("json parser", 25)).toBe(
      "https://search.maven.org/solrsearch/select?q=json%20parser&rows=25&wt=json",
    );
    expect(mavenSearchUrl("json", 200)).toContain("rows=200");
  });

  it("never uses core=gav, which returns non-JSON for some queries", () => {
    expect(mavenSearchUrl("cli", 20)).not.toContain("core=");
  });
});

describe("normalizeMavenDoc", () => {
  it("maps a coordinate to Package using latestVersion", () => {
    expect(normalizeMavenDoc(DOC)).toMatchObject({
      name: "com.cobber.fta:cli",
      version: "17.1.0",
      description: null,
      url: "https://central.sonatype.com/artifact/com.cobber.fta/cli",
      downloads: 0,
      score: 0,
      publisher: "com.cobber.fta",
      keywords: [],
      registry: "maven",
    });
  });

  it("keeps the whole coordinate as the name so groupId is not lost", () => {
    expect(normalizeMavenDoc(DOC).name).toContain(":");
  });

  it("survives a doc with no group/artifact id", () => {
    const out = normalizeMavenDoc({});
    expect(out.name).toBe("");
    expect(out.url).toBe("https://central.sonatype.com/");
  });

  it("the catalog declares Maven's download window as none", () => {
    expect(registryMeta("maven").downloadsWindow).toBe("none");
  });
});

describe("mavenProvider.search", () => {
  it("is registered under the maven id", () => {
    expect(getProvider("maven")).toBe(mavenProvider);
  });

  it("reads numFound and docs", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(PAYLOAD)) as unknown as typeof fetch;
    const res = await mavenProvider.search("cli", 20);
    expect(res.totalCount).toBe(2431);
    expect(res.packages[0].name).toBe("com.cobber.fta:cli");
  });

  it("tolerates a payload with no response object", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        responseHeader: { status: 0 },
      })) as unknown as typeof fetch;
    const res = await mavenProvider.search("nothing", 20);
    expect(res.packages).toEqual([]);
    expect(res.totalCount).toBe(0);
  });

  it("clamps a too-large limit to 200 before fetching", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse({ response: { numFound: 0, docs: [] } });
    }) as unknown as typeof fetch;
    await mavenProvider.search("cli", 500);
    expect(seenUrl).toContain("rows=200");
  });

  it("throws an error naming the registry on a failed request", async () => {
    globalThis.fetch = (async () =>
      new Response("blocked", { status: 403 })) as unknown as typeof fetch;
    await expect(mavenProvider.search("cli", 20)).rejects.toThrow(
      "Maven Central search failed: HTTP 403",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/registry-maven.test.ts`
Expected: FAIL — `Cannot find module '../src/registries/maven.ts'`.

- [ ] **Step 3: Write the provider**

Create `src/registries/maven.ts`:

```ts
/**
 * maven.ts — Maven Central Solr search (survey ticket 002-003).
 *
 * This is the registry with the least to say: no download counts, no relevance
 * score exposed per row, and no version field other than `latestVersion`. rows
 * above 200 silently falls back to Solr's 20-doc default, so the ceiling is
 * enforced client-side. `core=gav` returns non-JSON for some queries, so it is
 * never used. Links go to central.sonatype.com because search.maven.org/artifact
 * refuses non-browser clients with 403.
 */
import type { Package } from "../types";
import { clampRegistryLimit } from "./catalog";
import type {
  PackageSearchResult,
  PackageProvider,
  ProviderFetch,
} from "./types";

interface RawMavenDoc {
  id?: string;
  g?: string;
  a?: string;
  latestVersion?: string;
  p?: string;
  timestamp?: number;
  versionCount?: number;
}

export function mavenSearchUrl(rawQuery: string, rows: number): string {
  return `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(rawQuery)}&rows=${rows}&wt=json`;
}

export function normalizeMavenDoc(raw: RawMavenDoc): Package {
  const group = raw.g ?? "";
  const artifact = raw.a ?? "";
  // The coordinate is the identity a Java developer searches for; keep both halves.
  const name =
    raw.id ?? (group && artifact ? `${group}:${artifact}` : artifact);
  const url =
    group && artifact
      ? `https://central.sonatype.com/artifact/${group}/${artifact}`
      : "https://central.sonatype.com/";
  return {
    name,
    version: raw.latestVersion ?? "",
    description: null, // the search endpoint returns no description
    url,
    downloads: 0, // Maven Central publishes no download counts
    score: 0, // Solr scores are not returned per doc
    publisher: group || null,
    keywords: [],
    registry: "maven",
  };
}

async function searchMaven(
  rawQuery: string,
  limit: number,
  fetchImpl: ProviderFetch = fetch,
): Promise<PackageSearchResult> {
  const rows = clampRegistryLimit(limit, "maven");
  const res = await fetchImpl(mavenSearchUrl(rawQuery, rows), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Maven Central search failed: HTTP ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as {
    response?: { numFound?: number; docs?: RawMavenDoc[] };
  } | null;
  const packages = (data?.response?.docs ?? []).map(normalizeMavenDoc);
  return {
    totalCount: data?.response?.numFound ?? packages.length,
    packages,
  };
}

export const mavenProvider: PackageProvider = {
  id: "maven",
  search: searchMaven,
};
```

Register it in `src/registries/index.ts`:

```ts
import { mavenProvider } from "./maven";

const PROVIDERS: Partial<Record<RegistryId, PackageProvider>> = {
  [npmProvider.id]: npmProvider,
  [cratesProvider.id]: cratesProvider,
  [rubygemsProvider.id]: rubygemsProvider,
  [nugetProvider.id]: nugetProvider,
  [mavenProvider.id]: mavenProvider,
};
```

- [ ] **Step 4: Run the catalog consistency test**

Every id in `REGISTRY_IDS` now has a provider. Add to `tests/catalog.test.ts` — it belongs to the catalog because "the table advertises a registry nobody built" is a catalog bug:

```ts
import { getProvider } from "../src/registries/index.ts";

describe("every catalog id has a provider", () => {
  it("getProvider resolves each id without throwing", () => {
    for (const id of REGISTRY_IDS) {
      expect(getProvider(id).id).toBe(id);
    }
  });
});
```

Run: `bun test tests/catalog.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Run tests and make sure they pass**

Run: `bun test tests/registry-maven.test.ts`
Expected: PASS (11 tests).

Suite total after this task: 786 tests (719 baseline + 67 new across Tasks 1-6), 0 fail. Verify against the runner's own line.

---

### Task 7: Registry-honest output formatters

**Files:**

- Modify: `src/package.ts:104-160` (the `formatPackages*` functions)
- Create: `tests/package-output.test.ts`

**Interfaces:**

- Consumes: `registryMeta`, `DownloadWindow` from `src/registries/catalog.ts`; `Package.registry` (now `RegistryId`) from Task 1.
- Produces: `formatDownloads(p: Package): string`, `formatScore(p: Package): string` — the only two places that decide how a download number and a relevance score are printed. `src/cli.ts` text output, `src/package-browser.ts`, and every `formatPackages*` function call these, so a registry's window is labelled in one place or not at all. CSV gains `registry` and `downloads_window` columns; Markdown gains a `Registry` column. `formatPackagesJson`, `formatPackagesUrls`, `formatPackagesNames` keep their exact output.

- [ ] **Step 1: Write the failing test**

Create `tests/package-output.test.ts`:

```ts
// A download number without its window is a lie: npm's figure is monthly,
// crates.io' is a rolling 90 days, RubyGems' and NuGet's are lifetime, and Maven
// publishes nothing at all. These formatters are the only place that decides how
// each is printed, so the rules live under test.
import { describe, it, expect } from "vitest";
import type { Package } from "../src/types.ts";
import {
  formatDownloads,
  formatPackagesCsv,
  formatPackagesMarkdown,
  formatScore,
} from "../src/package.ts";

function pkg(partial: Partial<Package> & { name: string }): Package {
  return {
    version: "1.0.0",
    description: null,
    url: `https://example.test/${partial.name}`,
    downloads: 0,
    score: 0,
    publisher: null,
    keywords: [],
    registry: "npm",
    ...partial,
  };
}

describe("formatDownloads", () => {
  it("labels npm's monthly window", () => {
    expect(
      formatDownloads(
        pkg({ name: "zod", registry: "npm", downloads: 1234567 }),
      ),
    ).toBe("1,234,567/mo");
  });

  it("labels crates' 90-day window", () => {
    expect(
      formatDownloads(
        pkg({ name: "clap", registry: "crates", downloads: 8200000 }),
      ),
    ).toBe("8,200,000/90d");
  });

  it("labels RubyGems and NuGet as lifetime tallies", () => {
    expect(
      formatDownloads(
        pkg({ name: "thor", registry: "rubygems", downloads: 729 }),
      ),
    ).toBe("729 total");
    expect(
      formatDownloads(
        pkg({ name: "Serilog", registry: "nuget", downloads: 10 }),
      ),
    ).toBe("10 total");
  });

  it("says n/a for Maven instead of printing a fake zero", () => {
    expect(
      formatDownloads(pkg({ name: "g:a", registry: "maven", downloads: 0 })),
    ).toBe("n/a");
  });
});

describe("formatScore", () => {
  it("prints npm's relevance score to two decimals", () => {
    expect(formatScore(pkg({ name: "zod", score: 1666.6299 }))).toBe("1666.63");
  });

  it("prints an em dash for registries that publish no score", () => {
    for (const registry of ["crates", "rubygems", "nuget", "maven"] as const) {
      expect(formatScore(pkg({ name: "x", registry, score: 0 }))).toBe("—");
    }
  });
});

describe("formatPackagesCsv", () => {
  it("carries the registry and its download window in every row", () => {
    const rows = formatPackagesCsv([
      pkg({ name: "zod", registry: "npm", downloads: 100, score: 3.5 }),
      pkg({ name: "clap", registry: "crates", downloads: 200, score: 0 }),
    ]);
    expect(rows.split("\n")[0]).toBe(
      "rank,registry,name,version,downloads,downloads_window,score,url",
    );
    expect(rows).toContain(
      "1,npm,zod,1.0.0,100,monthly,3.50,https://example.test/zod",
    );
    // Score is empty, never zero, when the registry has no relevance data.
    expect(rows).toContain(
      "2,crates,clap,1.0.0,200,quarterly,,https://example.test/clap",
    );
  });
});

describe("formatPackagesMarkdown", () => {
  it("names the registry column and window-suffixes the downloads", () => {
    const out = formatPackagesMarkdown([
      pkg({ name: "thor", registry: "rubygems", downloads: 729093 }),
    ]);
    expect(out.split("\n")[0]).toBe(
      "| # | Registry | Package | Version | Downloads | Score |",
    );
    expect(out).toContain("| 1 | RubyGems | [thor@1.0.0]");
    expect(out).toContain("729,093 total");
    expect(out).toContain("| — |");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/package-output.test.ts`
Expected: FAIL — `formatDownloads` is not exported (`does not provide an export named 'formatDownloads'`).

- [ ] **Step 3: Write the formatters**

In `src/package.ts`, add to the existing catalog import line:

```ts
import { registryMeta, type DownloadWindow } from "./registries/catalog";
```

Then add above `formatPackagesJson` (`src/package.ts:118`) and replace the four CSV/Markdown/text-affecting functions:

```ts
/** Printed suffix for each registry's download tally. Never a bare number. */
const DOWNLOAD_SUFFIX: Record<DownloadWindow, string> = {
  monthly: "/mo",
  quarterly: "/90d",
  lifetime: " total",
  none: "",
};

/** `1,234,567/mo`, `729 total`, or `n/a` — the window comes from the catalog. */
export function formatDownloads(
  p: Pick<Package, "registry" | "downloads">,
): string {
  const meta = registryMeta(p.registry);
  if (meta.downloadsWindow === "none") return "n/a";
  return `${p.downloads.toLocaleString()}${DOWNLOAD_SUFFIX[meta.downloadsWindow]}`;
}

/** npm's relevance score, or an em dash for registries that publish none. */
export function formatScore(p: Pick<Package, "registry" | "score">): string {
  return registryMeta(p.registry).hasScore ? p.score.toFixed(2) : "—";
}

export function formatPackagesCsv(pkgs: Package[]): string {
  const header =
    "rank,registry,name,version,downloads,downloads_window,score,url";
  const rows = pkgs.map((p, i) => {
    const score = registryMeta(p.registry).hasScore ? p.score.toFixed(2) : "";
    return [
      i + 1,
      p.registry,
      csvEscape(p.name),
      p.version,
      p.downloads,
      registryMeta(p.registry).downloadsWindow,
      score,
      csvEscape(p.url),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

export function formatPackagesMarkdown(pkgs: Package[]): string {
  const header = "| # | Registry | Package | Version | Downloads | Score |";
  const sep = "|---|----------|---------|---------|-----------|-------|";
  const rows = pkgs.map(
    (p, i) =>
      `| ${i + 1} | ${registryMeta(p.registry).label} | [${p.name}@${p.version}](${p.url}) | ${p.version} | ${formatDownloads(p)} | ${formatScore(p)} |`,
  );
  return [header, sep, ...rows].join("\n");
}
```

- [ ] **Step 4: Route the CLI's text rows through the same helpers**

In `src/cli.ts`, the default branch of `runPackageSearch` (the `} else {` right before `} catch (err) {` inside `runPackageSearch`, `src/cli.ts:1281-1287`) prints the download figure with its own `toLocaleString()` and a hardcoded `↓`. Replace the loop so text output can never disagree with CSV/Markdown:

```ts
for (const p of sorted) {
  console.log(
    `${p.name}@${p.version}  ↓ ${formatDownloads(p)}  ${formatScore(p)}  ${p.description ?? ""}`,
  );
}
```

Add `formatDownloads, formatScore` to the `from "./package"` import at `src/cli.ts:12-21`. The current line, verbatim from `src/cli.ts:1285` (arrow is U+2193), so the edit is unambiguous — replace only the two interpolated expressions, keep the arrow and the spacing:

```ts
for (const p of sorted) {
  console.log(
    `${p.name}@${p.version}  ↓ ${p.downloads.toLocaleString()}  ${p.score.toFixed(2)}  ${p.description ?? ""}`,
  );
}
```

In `src/package-browser.ts:47-49`, `formatPackageLine` hardcodes the `↓` tally and `score ${pack.score.toFixed(2)}`. Replace those two lines so the browser shows the same honesty:

```ts
const dlStr = `↓ ${formatDownloads(pack)}`.padEnd(24);
const scoreStr = `score ${formatScore(pack)}`.padEnd(14);
```

Add `import { formatDownloads, formatScore } from "./package";` next to the existing `createPackageSearch` import (`src/package-browser.ts:17`).

- [ ] **Step 5: Run tests and make sure they pass**

Run: `bun test tests/package-output.test.ts tests/package.test.ts`
Expected: PASS (8 new tests); suite total 794 (786 + 8). `bun test tests/package.test.ts` must still report its 9 existing cases green — the facade re-exports kept them valid.

Run: `bun test && bun run typecheck && bun run lint && bun run format:check`
Expected: all green.

- [ ] **Step 6: Verify the live output reads honestly**

Run: `bun run src/cli.ts pkg clap --registry crates --limit 3`
Expected: every row prints `↓ <number>/90d` and an em dash where the score would be. If a row says `/mo`, the catalog lookup is wrong; if it shows a numeric score, `hasScore` is being ignored.

Run: `bun run src/cli.ts pkg zod --registry npm --markdown | Select-Object -First 3`
Expected: header `| # | Registry | Package | Version | Downloads | Score |` with a `/mo` figure and a numeric score.

- [ ] **Step 7: Commit**

```bash
git add src/package.ts src/cli.ts src/package-browser.ts tests/package-output.test.ts
git commit -m "feat(pkg): label each registry's download window in every format"
```

---

### Task 8: `--registry` on the CLI

**Files:**

- Modify: `src/cli.ts:125` (the `registry` field of `CLIFlags`)
- Modify: `src/cli.ts:341-342` (the `--registry` parse case)
- Modify: `src/cli.ts:1234-1250` (`runPackageSearch`'s registry guard + sort validation)
- Modify: `src/cli.ts:582` (the `--help` option row)
- Modify: `tests/cli-flags.test.ts` (new `describe("--registry")` block)
- Modify: `completions/ghfind.bash:37-39`, `completions/ghfind.zsh:19`, `completions/ghfind.fish:16` (advertise the five ids)

**Interfaces:**

- Consumes: `resolveRegistry`, `registryHelp`, `registryMeta`, `sortableModesFor` from `src/registries/catalog.ts`; `createPackageSearch(registry)` from Task 2.
- Produces: `CLIFlags.registry: RegistryId`; `--registry <name>` accepts the five ids and their aliases, and exits 1 **before any network call** on an unknown one; `--sort <mode>` on `pkg` is rejected when the chosen registry cannot support it, naming that registry's modes.

- [ ] **Step 1: Write the failing test**

Append to `tests/cli-flags.test.ts` (the file already spawns the real CLI because `parseArgs`/`main` are not importable, and every case here is offline because validation happens before the fetch):

```ts
describe("--registry", () => {
  test("rejects an unknown registry before touching the network", () => {
    const { code, err } = runCli(
      "pkg",
      "express",
      "--registry",
      "pypi",
      "--json",
    );
    expect(code).toBe(1);
    expect(err).toContain('Unknown registry: "pypi"');
    expect(err).toContain("npm|crates|rubygems|nuget|maven");
    expect(err).not.toContain("search failed");
    expect(err).not.toContain("Network error");
  });

  test("a missing value is reported as a missing value", () => {
    const { code, err } = runCli("pkg", "express", "--registry", "--json");
    expect(code).toBe(1);
    expect(err).toContain("Missing value for --registry");
  });

  test("accepts each canonical id", () => {
    for (const id of ["npm", "crates", "rubygems", "nuget", "maven"]) {
      // --help short-circuits before any search, so this proves acceptance
      // without a network round trip.
      const { code, err } = runCli("pkg", "cli", "--registry", id, "--help");
      expect(code, `--registry ${id} rejected: ${err}`).toBe(0);
    }
  });

  test("accepts the crates.io spelling", () => {
    const { code } = runCli("pkg", "cli", "--registry", "crates.io", "--help");
    expect(code).toBe(0);
  });

  test("rejects a sort the chosen registry cannot do, naming its modes", () => {
    const { code, err } = runCli(
      "pkg",
      "json",
      "--registry",
      "maven",
      "--sort",
      "downloads",
      "--count",
    );
    expect(code).toBe(1);
    expect(err).toContain("Invalid sort for maven");
    expect(err).toContain("best-match|name");
    expect(err).not.toContain("Network error");
  });

  test("the flag row in --help names the real registries", () => {
    const { out } = runCli("--help");
    expect(out).toContain(
      "Registry for pkg: npm (default)|crates|rubygems|nuget|maven",
    );
    expect(out).not.toContain("others TBD");
  });
  test("completions advertise every id", () => {
    expect(readSrc("completions/ghfind.bash")).toContain(
      'compgen -W "npm crates rubygems nuget maven"',
    );
    expect(readSrc("completions/ghfind.zsh")).toContain(
      "'--registry[Registry for pkg]:(npm crates rubygems nuget maven)'",
    );
    expect(readSrc("completions/ghfind.fish")).toContain(
      '-a "npm crates rubygems nuget maven"',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli-flags.test.ts`
Expected: FAIL — `Unknown registry: "pypi"` never appears (the current guard prints `Registry "pypi" not yet supported (only npm).`) and the help row still says `others TBD`. The completions cases fail because the scripts still list only `npm`.

- [ ] **Step 3: Validate the flag at parse time**

In `src/cli.ts`, extend the package import (lines 12-21) and add the catalog import after it:

```ts
import {
  registryHelp,
  registryMeta,
  resolveRegistry,
  sortableModesFor,
  type RegistryId,
} from "./registries/catalog";
```

Change the `CLIFlags` field at `src/cli.ts:125` from:

```ts
registry: string;
```

to:

```ts
/** Registry id for `pkg`. Validated at parse time, so it is always canonical. */
registry: RegistryId;
```

Replace the parse case at `src/cli.ts:341-342`:

```ts
      case "--registry": {
        const raw = args[++i];
        if (!raw || raw.startsWith("-")) {
          console.error(`Missing value for --registry (use ${registryHelp()}).`);
          process.exit(1);
        }
        const resolved = resolveRegistry(raw);
        if (!resolved) {
          console.error(
            `Unknown registry: "${raw}" (use ${registryHelp()}).`,
          );
          process.exit(1);
        }
        flags.registry = resolved;
        break;
      }
```

The `registry: "npm"` initializer at `src/cli.ts:195` needs no change — it is now a `RegistryId` literal.

- [ ] **Step 4: Make `runPackageSearch` registry-aware**

In `src/cli.ts`, replace the guard and sort check at the top of `runPackageSearch` (`src/cli.ts:1234-1250`) — the whole block from `if (flags.registry !== "npm") {` through the closing `}` of the sort check — with:

```ts
const registry = flags.registry;
const meta = registryMeta(registry);
const allowedSorts = sortableModesFor(registry);
const pkgSort = flags.sort as PackageSortMode;
if (!allowedSorts.includes(pkgSort)) {
  console.error(
    `Invalid sort for ${registry}: "${flags.sort}" (use ${allowedSorts.join("|")}).`,
  );
  process.exit(1);
}
```

Then the local `PKG_SORTS` array is gone: delete it. Update the search call and the usage string in the same function:

```ts
const search = createPackageSearch(registry);
```

```ts
console.error(
  "Usage: ghfind pkg <query> [--registry npm|crates|rubygems|nuget|maven] [--json|--csv|--markdown|--count|--format urls|names] [--limit <n>]",
);
```

and the per-registry ceiling message — a `--limit` above what the registry accepts is clamped by `clampRegistryLimit` inside the provider, which is the right behaviour, so no new error is needed. The provider clamps it (Task 1's `clampRegistryLimit`), which is the right behaviour, so no new error is needed - Step 5's completions and the HOW-TO section (Task 11) document the ceilings instead of hiding them.

- [ ] **Step 5: Update the `--help` row**

At `src/cli.ts:582` replace:

```
  --registry <name>                  Registry for pkg: npm (default) | others TBD
```

with:

```
  --registry <name>                  Registry for pkg: npm (default)|crates|rubygems|nuget|maven
```

The option block's rows are **not** covered by the `DESCRIPTION_COLUMN = 35` guard in `tests/cli-help.test.ts`: that test's `USAGE_ROW` regex only matches lines beginning ` ghfind`. This row's description starts at column 37 while its neighbours sit at 39 — a pre-existing misalignment. Keep the existing leading padding and change only the tail, so the diff stays one line and no unrelated reflow is dragged in.

- [ ] **Step 6: Update the two `ghfind pkg` usage rows**

`src/cli.ts:551-552` advertise the subcommand as npm-only, which is now false, and `tests/cli-help.test.ts` _does_ enforce column 35 on these rows. Change the descriptions only; keep both rows at column 35 exactly:

```
  ghfind pkg <query> --json        Search registries, output JSON
  ghfind pkg <query>               Search registries, text list
```

and assert it in `tests/cli-help.test.ts`, inside the existing `describe("cli --help usage block")`, next to the `documents the read-only and skill-search subcommands` case it mirrors:

```ts
test("no package usage row claims npm alone", () => {
  const rows = usageRows(readCli());
  const pkgRows = rows.filter((r) => r.includes("ghfind pkg"));
  expect(pkgRows.length).toBeGreaterThanOrEqual(2);
  for (const row of pkgRows) {
    expect(row, `usage row still npm-only: ${row}`).not.toMatch(/npm packages/);
  }
});
```

- [ ] **Step 7: Teach the completions the new ids**

The three scripts are what the flag's contract looks like to a shell, and `tests/cli-flags.test.ts` asserts them in Step 1, so they land in this task rather than drifting into a later one.

`completions/ghfind.bash:37-39` — replace the single word list:

```bash
    --registry)
      COMPREPLY=( $(compgen -W "npm crates rubygems nuget maven" -- "${cur}") )
      return 0
      ;;
```

`completions/ghfind.zsh:19` — replace the whole line:

```zsh
    '--registry[Registry for pkg]:(npm crates rubygems nuget maven)'
```

`completions/ghfind.fish:16` — replace the whole line:

```fish
complete -c ghfind -l registry -d "Registry for pkg" -r -f -a "npm crates rubygems nuget maven"
```

- [ ] **Step 8: Run tests and make sure they pass**

Run: `bun test tests/cli-flags.test.ts tests/cli-help.test.ts`
Expected: PASS, 0 fail — including the three completions assertions and the new `no package usage row claims npm alone` case from Step 6.

Run: `bun test && bun run typecheck && bun run lint && bun run format:check`
Expected: all four exit 0. `tests/cli-flags.test.ts` runs 34 cases (27 + the 7 above), `tests/cli-help.test.ts` gains 1, and the whole suite is 802 tests (786 through Task 6 + 8 formatters + 7 registry flags + 1 help-row guard), 0 fail.

- [ ] **Step 9: Verify offline and live**

Run: `bun run src/cli.ts pkg clap --registry crates --limit 3`
Expected: three crate rows, each `↓ …/90d  —`.

Run: `bun run src/cli.ts pkg express --registry npm --count`
Expected: a large integer, unchanged from 9.11.0 behaviour — the default path must not regress.

- [ ] **Step 10: Commit**

```bash
git add src/cli.ts tests/cli-flags.test.ts tests/cli-help.test.ts completions/ghfind.bash completions/ghfind.zsh completions/ghfind.fish
git commit -m "feat(pkg): validate --registry and --sort per registry"
```

---

### Task 9: Registry switching in the TUI and package browser

**Files:**

- Modify: `src/tui.ts:298-305` (state), `:527-536` (landing card), `:1529-1551` (Esc → Search group, packages branch), `:1652-1660` (Esc → Navigate group), `:2337-2357` (session snapshot + toolbar), `:2704-2760` (`showPackagesMode` + `doPackageSearch`), `:2866-2883` (`changePackageSort`), `:2925-2935` (detail pane), `:3478-3505` (bare-key handlers)
- Modify: `src/package-browser.ts:61` (signature), `:43-58` (`formatPackageLine`), `:107` (header), `:223-232` (`runSearch`) — the `:193` footer stays as-is, see Step 7
- Modify: `src/cli.ts:692` (`launchPackageBrowser()` call site)
- Modify: `src/help.ts:70-82` (Packages Mode section)
- Modify: `src/types.ts:136-144` (`SessionState.registry`) and `src/session.ts:38-66` (`sanitizeSession` keeps the field) — both land here because this task is what reads and writes them; a task boundary must never leave the tree red.
- Create: `tests/tui-registry.test.ts`

**Interfaces:**

- Consumes: `REGISTRY_IDS`, `RegistryId`, `registryMeta`, `sortableModesFor` from `src/registries/catalog.ts`; `createPackageSearch(registry)` from Task 2; `formatDownloads`/`formatScore` from Task 7; `registryLabel()` which this task adds to `src/tui.ts`.
- Produces: `launchPackageBrowser(registry?: RegistryId): Promise<void>` — the CLI passes the resolved `--registry` so a browser launched from `ghfind pkg --registry crates` searches crates, not npm. The TUI gains `currentRegistry: RegistryId`, `cycleRegistry()`, and `registryLabel(): string`. `SessionState.registry?: RegistryId` is restored on launch, whitelist-checked like `mode` already is. Task 11's docs describe the `Registry` menu entry created here.

- [ ] **Step 1: Write the failing test**

The TUI is not importable (launching it takes over the terminal), so this follows the precedent in `tests/overlay-registry.test.ts` and `tests/session.test.ts:136`: normalise CRLF, grep the source for the wiring, and fail if a string that is now untrue survived the change.

Create `tests/tui-registry.test.ts`:

```ts
// The packages view must not claim "npm" once it can search five registries,
// and it must refuse sort modes the active registry cannot honour. src/tui.ts is
// not importable (it takes over the terminal), so these are source-shape guards
// — the same technique as tests/overlay-registry.test.ts and tests/session.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Read a source file with LF endings (Windows CI checks out CRLF). */
function readSource(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
}

describe("src/tui.ts package registry wiring", () => {
  const src = readSource("src/tui.ts");

  it("imports the catalog it needs", () => {
    expect(src).toContain('from "./registries/catalog"');
    expect(src).toMatch(/REGISTRY_IDS/);
    expect(src).toMatch(/sortableModesFor/);
  });

  it("keeps a currentRegistry alongside currentPackageSort", () => {
    expect(src).toMatch(
      /let currentRegistry: RegistryId = session\?\.registry \?\? "npm"/,
    );
  });

  it("searches through the active registry", () => {
    // No bare createPackageSearch() left: every call must name the registry.
    expect(src).not.toMatch(/createPackageSearch\(\s*\)/);
    expect(src).toMatch(/createPackageSearch\(currentRegistry\)/);
  });

  it("cycles sort only through modes the registry supports", () => {
    expect(src).toMatch(/sortableModesFor\(currentRegistry\)/);
    // The npm-only constant must no longer drive the TUI's package sort cycle.
    expect(src).not.toMatch(/PACKAGE_SORT_MODES\[\(idx \+ 1\)/);
  });

  it("no longer hard-codes npm in the packages copy", () => {
    expect(src).not.toContain('"Search npm packages"');
    expect(src).not.toContain(
      "Search npm packages by name, description, or tags",
    );
    expect(src).not.toMatch(/Searching npm for/);
  });

  it("offers Registry in the Esc menu", () => {
    expect(src).toMatch(/name: "Registry"/);
    expect(src).toMatch(/cycleRegistry/);
  });
});

describe("src/package-browser.ts registry awareness", () => {
  const src = readSource("src/package-browser.ts");

  it("takes the registry from its caller", () => {
    expect(src).toMatch(
      /export async function launchPackageBrowser\(\s*registry: RegistryId = "npm",?\s*\)/,
    );
    expect(src).toMatch(/createPackageSearch\(registry\)/);
  });

  it("prints downloads through the shared formatter", () => {
    expect(src).toMatch(/formatDownloads\(pack\)/);
    expect(src).not.toMatch(/score \$\{pack\.score\.toFixed\(2\)\}/);
  });
});

describe("the CLI passes the flag through to the browser", () => {
  it("launches the browser with the resolved registry", () => {
    expect(readSource("src/cli.ts")).toMatch(
      /launchPackageBrowser\(flags\.registry\)/,
    );
  });
});

describe("help overlay documents the registry", () => {
  it("the packages section names the Registry keys, not npm alone", () => {
    const src = readSource("src/help.ts");
    expect(src).toContain('action: "Cycle package registry"');
    expect(src).not.toContain('action: "Search npm packages"');
  });
});

describe("session persistence of the registry", () => {
  it("keeps a known registry and drops an unknown one", async () => {
    const { sanitizeSession } = await import("../src/session.ts");
    expect(
      sanitizeSession({
        mode: "packages",
        query: "cli",
        sort: "best-match",
        limit: 50,
        trendingTab: "This Week",
        registry: "crates",
      })?.registry,
    ).toBe("crates");
    // A stale or hand-edited session must never select an unbuilt registry.
    expect(
      sanitizeSession({
        mode: "packages",
        query: "cli",
        sort: "best-match",
        limit: 50,
        registry: "pypi",
      })?.registry,
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tui-registry.test.ts`
Expected: FAIL — every assertion in the first two describes is false against the current 9.11.0 source (`"Search npm packages"` is still present at `src/tui.ts:530` and `:1655`, `createPackageSearch()` is still called bare at `src/tui.ts:2737` and `src/package-browser.ts:223`).

- [ ] **Step 3: Add the TUI state and helpers**

In `src/tui.ts`, extend the package import block at lines 106-110 and add the catalog import below it:

```ts
import {
  REGISTRY_IDS,
  registryMeta,
  sortableModesFor,
  type RegistryId,
} from "./registries/catalog";
```

In the state block, after `let packageResultsRaw: Package[] = [];` (`src/tui.ts:304`) add:

```ts
// Active package registry. npm is the default (ticket 002-005); the Esc menu
// and `p` cycle it, and a sort unsupported by the new registry is dropped.
let currentRegistry: RegistryId = session?.registry ?? "npm";
```

`session?.registry` only typechecks once `SessionState` carries the field. Add it to `src/types.ts` after `trendingTab?: string;` (`src/types.ts:142`), using the `RegistryId` type-only import Task 1 already added at the top of that file:

```ts
  /** Active package registry (restored when mode is "packages"). */
  registry?: RegistryId;
```

and teach `sanitizeSession` (`src/session.ts:38-66`) to keep it, following the exact shape of the `mode` whitelist two lines above:

```ts
const registry = isRegistryId(state.registry) ? state.registry : undefined;
```

then add `registry,` to the object `sanitizeSession` returns. Import it at the top of `src/session.ts`:

```ts
import { isRegistryId } from "./registries/catalog";
```

`saveSession` needs no change — it writes whatever `sanitizeSession` returns.

`src/tui.ts:303` stays `let currentPackageSort: PackageSortMode = "best-match";` — Task 11 is documentation only; do not conflate the two changes — the sort default stays `"best-match"` for all registries, which every registry supports.

Next to `changePackageSort` (`src/tui.ts:2866`) add the two helpers:

```ts
/** Short registry name for the toolbar, e.g. "crates.io". */
function registryLabel(): string {
  return registryMeta(currentRegistry).label;
}

/** Advance to the next registry, then re-run the search if one is on screen. */
function cycleRegistry() {
  const idx = REGISTRY_IDS.indexOf(currentRegistry);
  currentRegistry = REGISTRY_IDS[(idx + 1) % REGISTRY_IDS.length];
  // A sort the new registry cannot provide (score, downloads) falls back to
  // the registry's own relevance order rather than printing a meaningless 0.
  const allowed = sortableModesFor(currentRegistry);
  if (!allowed.includes(currentPackageSort)) {
    currentPackageSort = "best-match";
  }
  setToolbar();
  if (currentQueryInput) doPackageSearch(currentQueryInput);
}
```

- [ ] **Step 4: Route every package search and label through the registry**

`showPackagesMode` (`src/tui.ts:2704-2723`) — replace the placeholder line:

```ts
searchInput.placeholder = `Search ${registryLabel()} packages`;
```

`doPackageSearch` (`src/tui.ts:2724-2760`) — two edits inside it:

```ts
statusMgr.set("searching", `Searching ${registryLabel()} for "${q}"`);
```

```ts
const search = createPackageSearch(currentRegistry);
```

The success status line keeps its shape: `statusMgr.set("success", \`${packages.length} packages found\`)` is registry-neutral and needs no change.

The detail pane (`src/tui.ts:2925-2935`) prints a bare tally and an npm-style score. Replace the assignment so a crates row reads `/90d` and a Maven row does not claim zero downloads:

```ts
if (pack) {
  detailText.content = `Package: ${pack.name}@${pack.version}  [${registryMeta(pack.registry).label}]
Downloads: ${formatDownloads(pack)}
Score: ${formatScore(pack)}
${pack.description ?? ""}`;
}
```

Add `formatDownloads, formatScore` to the `from "./package"` import block at `src/tui.ts:106-110`.

The toolbar (`src/tui.ts:3637-3644`) gets the registry, but only where it is meaningful:

```ts
function formatToolbar(
  sort: SortStrategy | PackageSortMode,
  limit: number,
  totalCount: number,
  registry?: string,
): string {
  const sortLabel = SORT_MODES.find((m) => m.key === sort)?.label ?? sort;
  const registryPart = registry ? `registry: ${registry}   ` : "";
  return ` ${registryPart}sort: ${sortLabel}   limit: ${limit}   results: ${totalCount.toLocaleString()}`;
}
```

and at `src/tui.ts:2354-2357` pass it only in packages mode:

```ts
function setToolbar() {
  const isPackages = currentMode === "packages";
  const sort = isPackages ? currentPackageSort : currentSort;
  toolbarText.content = formatToolbar(
    sort,
    currentLimit,
    totalCount,
    isPackages ? registryLabel() : undefined,
  );
  renderer.requestRender();
}
```

`buildSessionState` (`src/tui.ts:2337-2352`) — the snapshot must carry the registry, and the `PackageSortMode`/`RegistryId` types are already in scope from Steps 3:

```ts
return {
  mode,
  query: currentQueryInput,
  sort: currentSort,
  limit: currentLimit,
  trendingTab,
  registry: currentRegistry,
};
```

- [ ] **Step 5: Sort cycling becomes registry-scoped**

Replace `changePackageSort` (`src/tui.ts:2866-2883`) so the mode list comes from the catalog instead of the npm-only constant:

```ts
function changePackageSort() {
  const allowed = sortableModesFor(currentRegistry);
  const idx = allowed.indexOf(currentPackageSort);
  currentPackageSort = allowed[(idx + 1) % allowed.length] ?? "best-match";
  setToolbar();
  if (packageResultsRaw.length > 0) {
    packages = sortPackages(packageResultsRaw, currentPackageSort);
    resultsSelect.options = packages.map((p) => ({
      name: `${p.name}@${p.version}`,
      description: p.description ?? "",
      value: p,
    }));
    resultsSelect.setSelectedIndex(0);
    renderer.requestRender();
  }
}
```

The re-sort reuses the rows already fetched for the active registry — switching sort never refetches, which is why `packageResultsRaw` exists. Leave that array's semantics untouched.

Delete the now-unused `PACKAGE_SORT_MODES` entry from the `from "./package"` import block at `src/tui.ts:106-110`; leaving it makes `bun run lint` fail on `noUnusedImports`.

- [ ] **Step 6: Put Registry in the menus and on a key**

In the Esc → Search group's packages branch (`src/tui.ts:1529-1551`), insert the entry **before** the existing `Sort` item, so the order reads registry → sort → limit → refresh (the widest choice first):

```ts
        {
          type: "action",
          name: "Registry",
          description: `Switch registry (current: ${registryLabel()})`,
          action: () => cycleRegistry(),
        },
```

In the landing card (`src/tui.ts:527-536`) and the Navigate group item (`src/tui.ts:1652-1660`), replace the npm-specific copy:

```ts
      title: "Package Search",
      desc: "Search packages across npm, crates.io, RubyGems, NuGet, Maven Central",
```

```ts
        name: "Packages",
        description: "Search package registries",
```

Add the bare-key cycle after the `c`-compare handler (`src/tui.ts:3499-3504`), guarded exactly like its neighbours so typing `p` in the query box still types `p`:

```ts
// 'p' cycles the package registry (only outside the query input)
if (key.name === "p" && !searchInput.focused && currentMode === "packages") {
  cycleRegistry();
  return;
}
```

- [ ] **Step 7: Make the standalone browser registry-aware**

`src/package-browser.ts:61` — accept the registry and use it for the label:

```ts
export async function launchPackageBrowser(
  registry: RegistryId = "npm",
): Promise<void> {
```

Add above it:

```ts
import { registryMeta, type RegistryId } from "./registries/catalog";
import { formatDownloads, formatScore } from "./package";
```

`src/package-browser.ts:223` — the search call becomes `createPackageSearch(registry)` (import already present at line 17; `createPackageSearch` must stay in that import list).

`src/package-browser.ts:47-49` — replace the two hardcoded columns inside `formatPackageLine`:

```ts
const dlStr = `↓ ${formatDownloads(pack)}`.padEnd(24);
const scoreStr = `score ${formatScore(pack)}`.padEnd(14);
```

In the header at `src/package-browser.ts:107`, replace the literal `" — Packages"` suffix so the screen states what it searched. The brand string on that line is `⟠ tulipsearch` — a pre-existing wrong name in this view (the app is `ghfind`); leave it exactly as shown below. It is out of scope for this plan, and no test here depends on it:

```ts
    content: t`${bold(fg(C.purple)("⟠ tulipsearch"))}${fg(C.muted)(` — Packages · ${registryMeta(registry).label}`)}`,
```

**The footer at `src/package-browser.ts:193` stays untouched, deliberately:** this view gets no `p` key. Its keypress listener (`src/package-browser.ts:264-309`) treats every single-character key name as query text (`if (name.length === 1) query += name`) — there is no focus concept to guard it — so claiming `p` would silently eat the letter from queries like `pdf`. The registry here is fixed at launch by `--registry`, which is exactly why the header names it. The cycle key belongs to the main TUI only, where `!searchInput.focused` already guards the bare-letter keys (Step 6).

`src/cli.ts:692` — pass the flag:

```ts
await launchPackageBrowser(flags.registry);
```

- [ ] **Step 8: Update the help overlay**

`src/help.ts:70-82` — in the `Packages Mode` section replace the npm row and add the cycle key, and reword the note:

```ts
        { keys: "/", action: "Search packages" },
        { keys: "p", action: "Cycle package registry" },
        { keys: "↑ ↓ / j k", action: "Move selection" },
        { keys: "Enter", action: "View package details" },
        { keys: "Esc", action: "Open command menu" },
      ],
      note: "Registries: npm, crates.io, RubyGems, NuGet, Maven Central.",
```

`src/help.ts:95` keeps `{ keys: "Packages", action: "Switch to npm packages" }`? No — that string is npm-specific and the test in Step 1 forbids `"Search npm packages"`; `help.ts:95` reads "Switch to npm packages", which the grep does not match but is now equally untrue. Change it to `action: "Switch to package registries"`.

- [ ] **Step 9: Run tests and make sure they pass**

Run: `bun test tests/tui-registry.test.ts`
Expected: PASS (11 tests: 6 over src/tui.ts, 2 over src/package-browser.ts, 1 CLI call site, 1 help.ts, 1 session case).

Run: `bun test && bun run typecheck && bun run lint && bun run format:check`
Expected: all four green — the session field and its sanitizer were added inside this task precisely so nothing is left half-wired. Suite total: 813 tests (802 through Task 8 + 11 here), 0 fail.

- [ ] **Step 10: Smoke the view**

Run: `bun run src/cli.ts pkg --registry crates`
Expected: the browser opens with a header ending `Packages · crates.io`; typing `clap` and pressing enter lists crates rows whose downloads read `…/90d` and whose score column is an em dash. Typing the letter `p` (as in `pdf`) must still appear in the query line.

Run: `bun run src/tui.ts`
Expected: the landing card reads "Search packages across npm, crates.io, RubyGems, NuGet, Maven Central"; entering packages mode, pressing Esc, choosing Registry, then pressing `p` outside the input both cycle the registry and re-run the current search, with the toolbar showing `registry: …`.

If the TUI cannot be driven in this environment (no TTY), say so in the commit body and record it in the plan's task list rather than claiming the check passed.

- [ ] **Step 11: Commit**

```bash
git add src/tui.ts src/package-browser.ts src/cli.ts src/help.ts src/types.ts tests/tui-registry.test.ts
git commit -m "feat(tui): switch package registries in packages mode"
```

---

### Task 10: `ghfind_package_search` over MCP

**Files:**

- Modify: `src/mcp-server.ts:13` (the tool/module table in the header comment), `:226-228` (sort/enum constants), `:412-456` (the npm tool), `:827` (the `initialize` instructions string)
- Modify: `tests/mcp-server.test.ts:174` (the `tools/list` name assertions) and a new `describe("ghfind_package_search")` block

**Interfaces:**

- Consumes: `REGISTRY_IDS`, `resolveRegistry`, `registryMeta`, `sortableModesFor` from `src/registries/catalog.ts`; `createPackageSearch(registry)`; `formatDownloads`/`formatScore` (Task 7) via `formatPackageLines`, which this task rewrites.
- Produces: MCP tool `ghfind_package_search` with `registry` (enum of the five ids, default `npm`) and per-registry `sort` validation; `ghfind_npm_packages` stays exported, unchanged in behaviour, documented as the npm-pinned alias.

- [ ] **Step 1: Write the failing test**

Append to `tests/mcp-server.test.ts` (the file already mocks `globalThis.fetch` and drives the protocol through `rpc`/`callTool`):

```ts
describe("ghfind_package_search", () => {
  const NPM_ROW = {
    package: {
      name: "zod",
      version: "3.25.0",
      description: "TypeScript schema validation",
      links: { npm: "https://www.npmjs.com/package/zod" },
      publisher: { username: "colinhacks" },
    },
    downloads: { monthly: 4000000 },
    score: { final: 2396.5 },
  };

  it("is listed with a registry enum covering the five ids", async () => {
    const state = freshState();
    await init(state);
    const res = await rpc("tools/list", undefined, state);
    const tools = (res.result as Record<string, unknown>).tools as Array<
      Record<string, unknown>
    >;
    const tool = tools.find((t) => t.name === "ghfind_package_search");
    expect(tool, "ghfind_package_search missing from tools/list").toBeTruthy();
    const schema = tool?.inputSchema as {
      properties: Record<string, { enum?: string[] }>;
    };
    expect(schema.properties.registry.enum).toEqual([
      "npm",
      "crates",
      "rubygems",
      "nuget",
      "maven",
    ]);
  });

  it("defaults to npm and keeps ghfind_npm_packages working identically", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        total: 1,
        objects: [NPM_ROW],
      })) as unknown as typeof fetch;
    const state = freshState();
    const legacy = await callTool(
      "ghfind_npm_packages",
      { query: "zod" },
      state,
    );
    globalThis.fetch = (async () =>
      jsonResponse({
        total: 1,
        objects: [NPM_ROW],
      })) as unknown as typeof fetch;
    const modern = await callTool(
      "ghfind_package_search",
      { query: "zod" },
      state,
    );
    expect(modern.text).toBe(legacy.text);
    expect((modern.data as Record<string, unknown>).registry).toBe("npm");
  });

  it("queries crates.io and labels the download window", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse({
        crates: [
          {
            name: "clap",
            max_stable_version: "4.5.4",
            description: "A command line argument parser",
            recent_downloads: 8200000,
          },
        ],
        meta: { total: 65530 },
      });
    }) as unknown as typeof fetch;
    const out = await callTool(
      "ghfind_package_search",
      { query: "cli", registry: "crates" },
      freshState(),
    );
    expect(seenUrl).toContain("crates.io/api/v1/crates");
    expect(out.text).toContain("clap@4.5.4");
    expect(out.text).toContain("/90d");
    // No relevance score exists on crates.io, so none is invented.
    expect(out.text).not.toMatch(/score \d/);
    const data = out.data as Record<string, unknown>;
    expect(data.registry).toBe("crates");
    expect(data.downloadsWindow).toBe("quarterly");
    expect((data.packages as Array<Record<string, unknown>>)[0].registry).toBe(
      "crates",
    );
  });

  it("rejects an unknown registry with a tool error, not a crash", async () => {
    await expect(
      callTool(
        "ghfind_package_search",
        { query: "x", registry: "pypi" },
        freshState(),
      ),
    ).rejects.toThrow(/registry/i);
  });

  it("rejects a sort the chosen registry cannot do", async () => {
    await expect(
      callTool(
        "ghfind_package_search",
        { query: "x", registry: "maven", sort: "downloads" },
        freshState(),
      ),
    ).rejects.toThrow(/downloadsWindow|sort/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/mcp-server.test.ts`
Expected: FAIL — `Unknown tool: ghfind_package_search` and the `tools/list` lookup finding nothing.

- [ ] **Step 3: Add the imports**

No new module-level constant: the tool's `registry` enum spreads `REGISTRY_IDS` directly, and a second alias for it would be dead code that `bun run lint` rejects. Extend the package import block at `:34-38`:

```ts
import {
  createPackageSearch,
  formatDownloads,
  formatScore,
  sortPackages,
  type PackageSortMode,
} from "./package";
import {
  REGISTRY_IDS,
  registryMeta,
  resolveRegistry,
  sortableModesFor,
  type RegistryId,
} from "./registries/catalog";
```

- [ ] **Step 4: Make the line formatter registry-aware**

`formatPackageLines` (`src/mcp-server.ts:199-213`) hardcodes `/mo` semantics and `score`. Replace its body so both tools share the honest shape, and widen the row type to `Package`:

```ts
function formatPackageLines(pkgs: Package[]): string {
  return pkgs
    .map((p, i) => {
      const desc = p.description ? ` — ${truncate(p.description, 90)}` : "";
      const score = formatScore(p);
      const scorePart = score === "—" ? "" : ` · score ${score}`;
      return `${i + 1}. ${p.name}@${p.version}${desc} (↓ ${formatDownloads(p)}${scorePart})`;
    })
    .join("\n");
}
```

Add `import type { Package } from "./types";` to the existing `import type { Repo, SearchOptions, SortStrategy } from "./types";` line at `src/mcp-server.ts:29`.

- [ ] **Step 5: Add the tool**

Insert into `TOOLS` immediately after the `ghfind_npm_packages` object (ends `src/mcp-server.ts:456`):

```ts
  {
    name: "ghfind_package_search",
    title: "Search package registries",
    description:
      "Search a package registry: npm (default), crates, rubygems, nuget, or maven. Returns name, version, downloads (with each registry's own window — npm monthly, crates.io 90 days, RubyGems/NuGet lifetime, Maven none), and description. Query text is passed through to the registry's native search unchanged, so npm's own qualifiers (scope:, keywords:, not:) work when registry is npm.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Package search text, e.g. "terminal ui".',
        },
        registry: {
          type: "string",
          description:
            "Registry to search (default npm). Aliases like crates.io are accepted.",
          enum: [...REGISTRY_IDS],
        },
        limit: {
          type: "number",
          description:
            "Max results, 1-100 (default 20). Clamped to the registry's own ceiling.",
          minimum: 1,
          maximum: 100,
        },
        sort: {
          type: "string",
          description:
            "Sort strategy. Registries differ: npm allows all four; crates/rubygems/nuget have no score; maven has no downloads. Invalid values for the chosen registry raise a tool error.",
          enum: [...PKG_SORTS],
        },
      },
      required: ["query"],
    },
    async run(args) {
      const query = String(args.query ?? "").trim();
      if (!query) throw new McpToolError("query must be a non-empty string.");
      const rawRegistry = args.registry;
      if (
        rawRegistry !== undefined &&
        rawRegistry !== null &&
        !resolveRegistry(String(rawRegistry))
      ) {
        throw new McpToolError(
          `Unknown registry "${String(rawRegistry)}" (use ${registryHelp()}).`,
        );
      }
      const registry = resolveRegistry(String(rawRegistry ?? "npm")) ?? "npm";
      const limit = coerceInt(args.limit, 20, 1, 100);
      // Unlike the repo tools, an unsupported sort is an error rather than a
      // silent fallback: "score" on crates.io would order rows by a number that
      // does not exist, so the agent must be told the registry's real modes.
      const allowedSorts = sortableModesFor(registry);
      const requestedSort = args.sort === undefined ? "" : String(args.sort);
      if (requestedSort && !allowedSorts.includes(requestedSort as PackageSortMode)) {
        throw new McpToolError(
          `sort "${requestedSort}" is not supported by ${registry} (use ${allowedSorts.join("|")}).`,
        );
      }
      const sort = (requestedSort || "best-match") as PackageSortMode;

      const { totalCount, packages } = await createPackageSearch(
        registry,
      ).searchPackage(query, limit);
      const sorted = sortPackages(packages, sort);
      const meta = registryMeta(registry);
      const text =
        sorted.length === 0
          ? `No ${meta.label} packages found for "${query}".`
          : formatPackageLines(sorted);
      return {
        text,
        data: {
          registry,
          downloadsWindow: meta.downloadsWindow,
          totalCount,
          packages: sorted,
        },
      };
    },
  },
```

`coerceEnum` is now unused by this tool but still used by the repo tools beside it, so its definition stays. Add `registryHelp` to the catalog import from Step 3. The `RegistryId` import from Step 3 is still needed for the `sortPackages` cast sites; if `bun run typecheck` reports it unused after this step, remove it rather than adding a use for it.

- [ ] **Step 6: Keep the legacy tool honest**

`ghfind_npm_packages` (`src/mcp-server.ts:412-456`) keeps its name, title, schema, and npm-only behaviour — agents have it pinned in configs. Only two edits:

at `:452` the empty-result string stays `No npm packages found for "${query}".` (unchanged); and mark the description as the pinned alias so new callers choose the general tool:

```ts
    description:
      "Search the npm registry (pinned alias of ghfind_package_search with registry=npm): name, version, monthly downloads, quality score, and description for each package.",
```

- [ ] **Step 7: Update the server instructions and header table**

`src/mcp-server.ts:827` — the instructions line advertises npm only:

```ts
            "ghfind gives agents GitHub search: repositories, trending, package registries (npm, crates.io, RubyGems, NuGet, Maven Central), org/user profiles, repo comparison and deep-dives. " +
```

`src/mcp-server.ts:13` — the header table gains the new row, keeping the column alignment:

```
 *   ghfind_package_search        package.ts + registries/
 *   ghfind_npm_packages          package.ts (npm-pinned alias)
```

- [ ] **Step 8: Update the `tools/list` assertion**

In `tests/mcp-server.test.ts:174`, add after the `ghfind_npm_packages` line:

```ts
expect(names).toContain("ghfind_package_search");
```

- [ ] **Step 9: Run tests and make sure they pass**

Run: `bun test tests/mcp-server.test.ts`
Expected: PASS — the five new cases plus the whole existing protocol suite.

Run: `bun test && bun run typecheck && bun run lint && bun run format:check`
Expected: all green. Suite total: 818 tests (813 + the 5 new MCP cases), 0 fail.

Record the printed number in the commit body; Task 11 Step 7 re-runs `bun test` and copies its own fresh number into the README rather than trusting this one.

- [ ] **Step 10: Verify the MCP handshake stays pure JSON-RPC**

Per the docs-release skill (§4b), stdout must carry only JSON-RPC. Run:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"t","version":"1"}}}' | bun run src/cli.ts mcp
```

Expected: exactly one line of JSON on stdout whose `result.tools` is absent (initialize returns capabilities) and whose `result.serverInfo.name` is `ghfind`. No log lines, no banners.

- [ ] **Step 11: Commit**

```bash
git add src/mcp-server.ts tests/mcp-server.test.ts
git commit -m "feat(mcp): expose ghfind_package_search across registries"
```

---

### Task 11: Documentation and the agent skill guide

**Files:**

- Modify: `README.md:99` (Non-interactive examples), `:135-137` (MCP tool list), `:176` (Features table Packages row), `:49` (the `Why ghfind?` comparison row), `:355` and `:362` (test counts)
- Modify: `docs/HOW-TO.md` (new `## Package registries` section)
- Modify: `CHANGELOG.md` (`[Unreleased] → ### Added`)
- Modify: `src/agent-skill.ts:36`, `:40`, `:60-63` (the guide agents read)
- Create: `tests/docs-registries.test.ts`

**Interfaces:**

- Consumes: `REGISTRY_IDS` from the catalog (the doc test asserts against it, so a future registry cannot ship undocumented).
- Produces: nothing further depends on this task.

- [ ] **Step 1: Write the failing test**

Create `tests/docs-registries.test.ts`, following the doc-claim guard precedent in `tests/docs-howto.test.ts`:

```ts
// Every registry ghfind can search must be documented in the same places users
// and agents look, and the README's test count must match the real suite. Both
// have drifted before (the `--interval` and Ctrl+E incidents in the CHANGELOG).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY_IDS } from "../src/registries/catalog.ts";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("registry documentation", () => {
  it("README names every registry in its examples", () => {
    const readme = read("README.md");
    for (const id of REGISTRY_IDS) {
      expect(readme, `README missing --registry ${id}`).toContain(
        `--registry ${id}`,
      );
    }
  });

  it("HOW-TO documents the windows each registry reports", () => {
    const doc = read("docs/HOW-TO.md");
    const section = doc.split("## Package registries")[1];
    expect(
      section,
      "docs/HOW-TO.md has no Package registries section",
    ).toBeTruthy();
    for (const id of REGISTRY_IDS) {
      expect(section, `HOW-TO omits ${id}`).toContain(id);
    }
    for (const claim of ["monthly", "90 days", "lifetime", "no download"]) {
      expect(section, `HOW-TO must explain ${claim}`).toContain(claim);
    }
  });

  it("the agent skill guide carries the --registry flag", () => {
    const guide = read("src/agent-skill.ts");
    for (const id of REGISTRY_IDS) {
      expect(guide, `skill guide omits ${id}`).toContain(id);
    }
    expect(guide).toContain("--registry");
  });

  it("CHANGELOG records the feature under Unreleased", () => {
    const log = read("CHANGELOG.md");
    const unreleased = log.split("## [Unreleased]")[1].split("## [")[0];
    expect(unreleased).toContain("registry");
    expect(unreleased).toContain("ghfind pkg");
  });

  it("README advertises one test count, stated identically twice", () => {
    const counts = [...read("README.md").matchAll(/# (\d+) tests/g)].map((m) =>
      Number(m[1]),
    );
    expect(
      counts.length,
      "README should state the count in both install paths",
    ).toBeGreaterThanOrEqual(2);
    // Two numbers that disagree is the drift this guard exists for; the value
    // itself comes from a real `bun test` run (Step 7), never from a guess.
    expect(
      new Set(counts).size,
      `README counts disagree: ${counts.join(", ")}`,
    ).toBe(1);
  });
});
```

Note on what this file does **not** do: it never shells out to `bun test` to compare the README number against a live count. A test that spawns the suite it belongs to recurses. Step 7 is where the real number is read from the runner and written into both lines.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/docs-registries.test.ts`
Expected: FAIL — `docs/HOW-TO.md has no Package registries section`, and the README/skill-guide lookups for `crates`, `rubygems`, `nuget`, `maven` come back missing.

- [ ] **Step 3: README**

At `README.md:99` the npm line stays and gains the registry form:

```bash
ghfind pkg "query" --json    # npm package search as JSON
ghfind pkg clap --registry crates --json          # crates.io
ghfind pkg Newtonsoft --registry nuget --limit 5  # NuGet, --registry: npm|crates|rubygems|nuget|maven
```

In the MCP tool list (`README.md:135-137`) add `ghfind_package_search` next to `ghfind_npm_packages`, and say the general tool is the registry-aware one:

```
Exposed tools: `ghfind_search_repos`, `ghfind_trending`,
`ghfind_npm_packages`, `ghfind_package_search` (npm, crates.io, RubyGems, NuGet,
Maven Central — `registry` selects it, npm by default), `ghfind_org_profile`, …
```

In the Features table (`README.md:176`) replace the npm-only row:

```html
<tr>
  <td><b>Packages</b></td>
  <td>
    Search 5 package registries (npm, crates.io, RubyGems, NuGet, Maven Central)
    — <code>ghfind pkg "query" --registry crates</code>
  </td>
</tr>
```

At `README.md:49` the comparison row reads `| npm package search                          | ✅       | ❌                       | ❌    |` (the header of the table is at lines 42-43). The comparison genuinely changed, so this is the one permitted edit to the `Why ghfind?` table: rewrite the label in place and keep the cell widths so the table stays aligned. New label: `Package search, 5 registries`.

- [ ] **Step 4: HOW-TO section**

Insert into `docs/HOW-TO.md` after the `## Qualifier reference` section (before `## Read the results`) and add its link to the table of contents at the top of that file, between `- [Qualifier reference](#qualifier-reference)` and `- [Read the results](#read-the-results)`:

````markdown
---

## Package registries

`ghfind pkg` searches package registries, not GitHub. One query hits exactly one
registry; the default is npm and `--registry` selects another:

```bash
ghfind pkg "terminal ui"                        # npm (default)
ghfind pkg clap --registry crates               # crates.io (alias: crates.io)
ghfind pkg pdf --registry rubygems              # RubyGems
ghfind pkg Serilog --registry nuget             # NuGet
ghfind pkg jackson --registry maven              # Maven Central
```
````

**The query is passed through verbatim.** Each registry gets its own syntax and
ghfind does not translate: npm understands `scope:`, `keywords:`, `not:` and
`is:insecure`; crates.io understands `category:`; the others take plain text
only. GitHub qualifiers (`language:`, `stars:`) mean nothing here — they are left
untouched rather than rewritten.

**A download number is not comparable across registries.** Each publishes a
different window, and ghfind labels it rather than flattening it:

| Registry      | What the figure measures | Sort modes offered              | Relevance score |
| ------------- | ------------------------ | ------------------------------- | --------------- |
| npm           | monthly                  | best-match/score/downloads/name | yes             |
| crates.io     | last 90 days             | best-match/downloads/name       | no              |
| RubyGems      | lifetime                 | best-match/downloads/name       | no              |
| NuGet         | lifetime                 | best-match/downloads/name       | no              |
| Maven Central | no download data at all  | best-match/name                 | no              |

So `12,000/mo` on npm and `12,000 total` on RubyGems are not near-neighbours —
one is a rate, the other an accumulation. Rows from different registries are
never merged into one list.

**Result ceilings are the registry's own.** npm honours 250, Maven 200, NuGet
250, crates.io 100, and RubyGems caps at 30 regardless of what you ask for, so
`--limit 100 --registry rubygems` still returns 30 rows. A `--sort` a registry
cannot perform is rejected with its real mode list rather than silently ignored.

````

- [ ] **Step 5: CHANGELOG**

Under `## [Unreleased]` → `### Added` (above the existing `ghfind release run` bullet, which is already there and stays), add:

```markdown
- **`ghfind pkg` searches five package registries** — `--registry
  npm|crates|rubygems|nuget|maven` selects which one, npm stays the default, and
  each registry's query is passed through to its own native search untouched.
  Downloads are labelled with the window each registry actually publishes
  (`1,234,567/mo` on npm, `/90d` on crates.io, `total` on RubyGems and NuGet,
  `n/a` on Maven Central, which has no download data), `--sort` is validated
  against the chosen registry, and the TUI cycles registries with `p` or
  `Esc` → Search → Registry. Agents get `ghfind_package_search` over MCP;
  `ghfind_npm_packages` keeps working unchanged as the npm-pinned alias.
````

- [ ] **Step 6: Agent skill guide**

`src/agent-skill.ts:60-63` — the section an agent reads becomes:

```markdown
## Package registries

    ghfind pkg "QUERY" --json [--registry npm|crates|rubygems|nuget|maven] \\
      [--limit N] [--sort best-match|score|downloads|name]

Query text goes to that registry's native search unchanged (npm supports
scope:/keywords:/not: qualifiers). Downloads carry each registry's own window:
npm monthly, crates.io 90 days, RubyGems/NuGet lifetime, Maven Central publishes
none. --sort is validated per registry; score exists on npm only.
```

Also update the two one-line summaries that say "npm packages": `src/agent-skill.ts:36` (`Search GitHub (repos, trending, npm packages, …)`) and `:40` (`repositories, trending, npm`) → say `package registries`. Keep the guide's line budget: it is tuned to be token-efficient, so replace rather than append.

- [ ] **Step 7: Sync the README test counts**

Run: `bun test 2>&1 | Select-String "pass"`
Take the printed pass count, then set both `README.md:355` (`bun test # N tests`) and `README.md:362` (`npm test # N tests`) to that number. Never invent it (docs-release skill: "Do not invent test counts"). The expected total at this point is 819 (814 through Task 10 + the 5 doc cases). Use whatever the runner prints; if it differs from 819, work out why before writing it into the README.

- [ ] **Step 8: Run tests and make sure they pass**

Run: `bun test tests/docs-registries.test.ts tests/docs-howto.test.ts`
Expected: PASS — the 5 doc cases, plus every pre-existing `tests/docs-howto.test.ts` claim (11 cases), which the new section must not have disturbed.

Run: `bun test && bun run typecheck && bun run lint && bun run format:check`
Expected: all green.

- [ ] **Step 9: Verify the guide renders**

Run: `bun run src/cli.ts skill ghfind-cli | Select-String "registry"`
Expected: the new `## Package registries` block prints with the five ids.

- [ ] **Step 10: Commit**

```bash
git add README.md docs/HOW-TO.md CHANGELOG.md src/agent-skill.ts tests/docs-registries.test.ts
git commit -m "docs(pkg): document multi-registry package search"
```

---

### Task 12: Final gate and map bookkeeping

**Files:**

- Modify: `.wayfinder/maps/002-package-registry-search.md` (local bookkeeping — this path is in `.git/info/exclude`, so it is **not committed**)

**Interfaces:**

- Consumes: everything above.
- Produces: a release-ready `main` working tree, and a wayfinder map whose "second registry" fog is closed.

- [ ] **Step 1: Run all four gates plus the build**

```bash
bun test
bun run format:check
bun run lint
bun run typecheck
bun run build
```

Expected: each exits 0. `bun run build` must emit `dist/` — the compiled Node path is what a piped `ghfind pkg --registry crates --json` uses in production, and tsup `define` injects the version.

- [ ] **Step 2: Smoke the compiled build, not just the source**

```bash
node dist/cli.js pkg clap --registry crates --limit 2
node dist/cli.js pkg zod --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].registry))'
```

Expected: the first prints two crate rows with `/90d` figures; the second prints `npm`. This is the check that a `package.json`-reading version resolution or a Node-only fetch difference would fail.

- [ ] **Step 3: Verify the offline guards never reach the network**

```bash
node dist/cli.js pkg x --registry pypi
node dist/cli.js pkg x --registry maven --sort downloads
```

Expected: exit 1 each, with `Unknown registry: "pypi"` and `Invalid sort for maven` respectively, and no `search failed` line.

- [ ] **Step 4: Record the decision in the wayfinder map**

In `.wayfinder/maps/002-package-registry-search.md`, append to `## Decisions so far`:

```markdown
- [Multi-registry build](docs/superpowers/plans/2026-11-01-multi-registry-package-search.md) — five registries shipped behind a provider seam (npm, crates.io, RubyGems, NuGet, Maven Central); `--registry` selects, npm default, no cross-registry merging; each registry's download window is labelled rather than flattened.
```

and strike the closed item from `## Not yet specified` ("Second-registry priority/order"). The map lives in `.git/info/exclude`, so this is a local edit: do not `git add` it, and do not commit `.wayfinder/`.

- [ ] **Step 5: Confirm nothing stray is staged**

Run: `git status --short`
Expected: clean apart from the plan file under `docs/superpowers/plans/`, which lands in the first commit below. No `*.tgz`, no `vendor/`, no `.bak` (CONTRIBUTING.md "No stray repo-junk").

- [ ] **Step 6: Commit the plan**

```bash
git add docs/superpowers/plans/2026-11-01-multi-registry-package-search.md
git commit -m "docs(plan): multi-registry package search implementation plan"
```

---

## Self-Review

**1. Spec coverage** — every 002-map requirement has a task:

| Spec requirement                                                         | Task                                                                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `--registry` is the multi-registry path (002-005)                        | 1, 8, 9                                                                             |
| npm stays the default; bare query → npm (002-005)                        | 2, 8 (Step 7 live check)                                                            |
| No cross-ecosystem merging (002-005)                                     | Global Constraints; 6 rows and 9 toolbar never mix registries                       |
| bun out, PyPI deferred (002-005)                                         | not in `REGISTRY_IDS`; `resolveRegistry("pypi")` is a tested error (Tasks 1, 8, 10) |
| Cheap seconds = crates.io, RubyGems, NuGet; Maven possible (002-003)     | 3, 4, 5, 6                                                                          |
| Pass-through query, no ghfind package grammar (002-006)                  | 2-6 (`encodeURIComponent(rawQuery)` only); 11 documents it                          |
| `--sort` not applied to package results by the repo parser (002-006)     | 8 (`pkg` validates its own registry-scoped modes)                                   |
| Parallel `Package` entity, `Repo` untouched (002-007)                    | 1 (widens one field), Global Constraints (`src/search.ts`/`Repo` unmodified)        |
| Ephemeral persistence, no bookmarks (002-007)                            | not added anywhere; `src/bookmarks.ts` untouched                                    |
| Generic outputs shared, csv/markdown/urls get package variants (002-007) | 7                                                                                   |
| `ghfind pkg` subcommand + `--registry` (002-009)                         | 8                                                                                   |
| TUI package tab, browse/list only (002-009)                              | 9 — no bookmark/deep-dive actions added                                             |
| Help + bash/zsh/fish completions updated (002-009)                       | 8 Step 5b, 9 Step 8                                                                 |
| Registry-specific parsing stays in its own module (map Notes)            | `src/registries/<name>.ts` per registry                                             |

**2. Placeholder scan** — no TBD/TODO/"appropriate error handling" steps. Two strings in this plan are deliberately quoted from the current source as _things to remove_ (`others TBD` at `src/cli.ts:582` in Task 8 Step 1, and ` tulipsearch` left in place in Task 9 Step 7) — they are assertions and instructions, not unfinished work.

**3. Type consistency** — checked across tasks: `RegistryId` (catalog) is the type of `CLIFlags.registry` (8), `currentRegistry` (9), `SessionState.registry` (9), and `Package.registry` (1). `PackageSortMode` is defined once in `src/registries/catalog.ts` and re-exported by `src/package.ts` (2), so `src/cli.ts:20`, `src/tui.ts:109`, `src/mcp-server.ts:38`, `tests/package.test.ts:6` and `tests/registry-*` all keep resolving. `createPackageSearch(registry?, fetchImpl?)` (2) is the only search entry point used by 8, 9 and 10. `formatDownloads`/`formatScore` (7) are the only formatters that print a tally or a score, used by CLI text (7), the browser (7, 9), the TUI detail pane (9) and MCP (10). `clampRegistryLimit` (1) is the single ceiling rule, called by every provider.

**Known accepted gaps** (not placeholders, recorded so an executor does not "fix" them):

- RubyGems `publisher` is the `authors` string, and `keywords` is always empty — the API's `licenses` field is not keywords. Task 4 tests pin this.
- crates.io `keywords` is `null` in the search payload, so it is `[]`; fetching keywords would be a second request per row.
- Maven rows have `downloads: 0` by construction; the catalog's `none` window is what stops that printing as a real zero. Task 7 tests the label, Task 6 tests the field.
- `ghfind_npm_packages` keeps its name for agent-config compatibility even though `ghfind_package_search` supersedes it (Task 10 Step 6).
- `--watch`, bookmarks and deep-dive stay repo-only. The map lists them as unresolved fog, not as this feature's scope.
- crates.io's 1 req/s policy is not throttled client-side. A single `pkg` search is one request; the TUI's registry cycle re-runs one search per keypress, which stays well inside the limit. No rate limiter is added (YAGNI).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-01-multi-registry-package-search.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — run the tasks in this session with checkpoints.

Which approach?

Run: `bun test && bun run typecheck && bun run lint && bun run format:check`
Expected: all green.

- [ ] **Step 6: Verify against the live API**

Run: `bun -e 'const {mavenProvider}=await import("./src/registries/maven.ts"); const r=await mavenProvider.search("jackson-databind",5); console.log(r.totalCount, r.packages.map(p=>p.name+"@"+p.version))'`
Expected: a non-zero `numFound` and a row whose name ends `:jackson-databind` with a `2.x` version (the exact groupId varies with relevance order, so do not pin it).

- [ ] **Step 7: Commit**

```bash
git add src/registries/maven.ts src/registries/index.ts tests/registry-maven.test.ts tests/catalog.test.ts
git commit -m "feat(pkg): add the Maven Central search provider"
```
