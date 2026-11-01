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
import type { PackageSortMode, RegistryId } from "./registries/catalog";
import { registryMeta, type DownloadWindow } from "./registries/catalog";
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

/**
 * Sort fetched packages. "best-match" is a no-op: it preserves the registry's
 * relevance order, which is the canonical npm ranking.
 */
export function sortPackages(
  pkgs: Package[],
  sort: PackageSortMode,
): Package[] {
  if (sort === "best-match" || pkgs.length < 2) return pkgs;
  const arr = [...pkgs];
  if (sort === "score") {
    arr.sort((a, b) => b.score - a.score);
  } else if (sort === "downloads") {
    arr.sort((a, b) => b.downloads - a.downloads);
  } else {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  return arr;
}

// ── Package output formatters (parallel to output.ts for repo) ─────────
// Entity model (ticket 002-007): json/text/count/limit are shared generics
// (json uses JSON.stringify on Package[]); csv/markdown/urls/names get package
// variants here. git-only formats (ssh-urls, clone-commands, ids) stay repo-only.

function csvEscape(val: unknown): string {
  const str = String(val ?? "");
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatPackagesJson(pkgs: Package[]): string {
  return JSON.stringify(pkgs, null, 2);
}

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

export function formatPackagesUrls(pkgs: Package[]): string {
  return pkgs.map((p) => p.url).join("\n");
}

export function formatPackagesNames(pkgs: Package[]): string {
  return pkgs.map((p) => p.name).join("\n");
}
