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
import { readJson } from "./parse";
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
  const data = await readJson(res, "RubyGems");
  // Bare array on success, and an object-shaped error body on some failures.
  const rows = Array.isArray(data) ? (data as RawGem[]) : [];
  const packages = rows.slice(0, want).map(normalizeGem);
  return {
    totalCount: Math.min(rows.length, RUBYGEMS_SERVER_CAP, want),
    packages,
    // The API publishes no total: our count is a ceiling, never an exact tally.
    totalIsExact: false,
  };
}

export const rubygemsProvider: PackageProvider = {
  id: "rubygems",
  search: searchRubygems,
};
