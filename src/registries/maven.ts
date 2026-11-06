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
import { defineSearch } from "./search";
import type { PackageProvider } from "./types";

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

export const mavenProvider: PackageProvider = defineSearch<RawMavenDoc>({
  id: "maven",
  url: (rawQuery, rows) => mavenSearchUrl(rawQuery, rows),
  rows: (data) =>
    (data as { response?: { docs?: RawMavenDoc[] } } | null)?.response?.docs ??
    [],
  total: (data) =>
    (data as { response?: { numFound?: number } } | null)?.response?.numFound,
  normalize: normalizeMavenDoc,
});
