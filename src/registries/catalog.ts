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
