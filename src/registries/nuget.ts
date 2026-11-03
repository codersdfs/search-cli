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
import { readJson } from "./parse";
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
  const data = (await readJson(res, "NuGet")) as {
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
