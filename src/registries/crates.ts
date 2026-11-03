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
import { readJson } from "./parse";
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
  const data = (await readJson(res, "crates.io")) as {
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
