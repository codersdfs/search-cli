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
