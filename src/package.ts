/**
 * package.ts — package-registry search provider (prototype for ticket 002-008).
 *
 * npm-only for the MVP (ticket 002-005). Query is passed through verbatim to npm's
 * native `/-/v1/search` (ticket 002-006) and the response normalized to the parallel
 * `Package` shape (ticket 002-007). Rough on purpose — this is the artifact to react to.
 */
import type { Package } from "./types";

export interface PackageSearchResult {
  totalCount: number;
  packages: Package[];
}

/** The npm `/-/v1/search` object shape we actually consume (research 002-001). */
interface NpmSearchObject {
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
  score?: { final?: number; detail?: { quality?: number; popularity?: number; maintenance?: number } };
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

export function createPackageSearch() {
  return {
    async searchPackage(rawQuery: string, limit: number): Promise<PackageSearchResult> {
      const size = Math.min(Math.max(Math.trunc(limit) || 50, 1), 250); // npm caps size at 250
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(rawQuery)}&size=${size}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "ghfind", Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`npm search failed: HTTP ${res.status}`);
      }
      const data = (await res.json()) as { objects?: NpmSearchObject[]; total?: number };
      const packages = (data.objects ?? []).map(normalizeNpmObject);
      return { totalCount: data.total ?? packages.length, packages };
    },
  };
}

/** Sort strategies for package results (npm registry order IS best-match). */
export type PackageSortMode = "best-match" | "score" | "downloads" | "name";

/** Sort modes in cycle order for the TUI Sort menu. */
export const PACKAGE_SORT_MODES: { key: PackageSortMode; label: string }[] = [
  { key: "best-match", label: "best-match" },
  { key: "downloads", label: "downloads" },
  { key: "score", label: "score" },
  { key: "name", label: "name" },
];

/**
 * Sort fetched packages. "best-match" is a no-op: it preserves the registry's
 * relevance order, which is the canonical npm ranking.
 */
export function sortPackages(pkgs: Package[], sort: PackageSortMode): Package[] {
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

export function formatPackagesCsv(pkgs: Package[]): string {
  const header = "rank,name,version,downloads,score,url";
  const rows = pkgs.map(
    (p, i) =>
      `${i + 1},${csvEscape(p.name)},${p.version},${p.downloads},${p.score.toFixed(2)},${csvEscape(p.url)}`,
  );
  return [header, ...rows].join("\n");
}

export function formatPackagesMarkdown(pkgs: Package[]): string {
  const header = "| # | Package | Version | Downloads | Score |";
  const sep = "|---|---------|---------|-----------|-------|";
  const rows = pkgs.map(
    (p, i) =>
      `| ${i + 1} | [${p.name}@${p.version}](${p.url}) | ${p.version} | ${p.downloads.toLocaleString()} | ${p.score.toFixed(2)} |`,
  );
  return [header, sep, ...rows].join("\n");
}

export function formatPackagesUrls(pkgs: Package[]): string {
  return pkgs.map((p) => p.url).join("\n");
}

export function formatPackagesNames(pkgs: Package[]): string {
  return pkgs.map((p) => p.name).join("\n");
}
