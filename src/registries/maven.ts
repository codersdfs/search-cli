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
