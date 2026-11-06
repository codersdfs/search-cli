/**
 * rubygems.ts — RubyGems search (survey ticket 002-003).
 *
 * Two API quirks decide the shape: search.json returns a bare JSON array with no
 * total field, so `totalCount` is only ever the number of rows we kept; and the
 * endpoint ignores any size parameter, capping at 30 gems server-side. The
 * download tally is a lifetime figure, so the label comes from the catalog.
 */
import type { Package } from "../types";
import { defineSearch } from "./search";
import type { PackageProvider } from "./types";

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

export const rubygemsProvider: PackageProvider = defineSearch<RawGem>({
  id: "rubygems",
  // search.json ignores any size parameter; the ceiling lives in the catalog.
  url: (rawQuery) => rubygemsSearchUrl(rawQuery),
  // Bare array on success, and an object-shaped error body on some failures.
  rows: (data) => (Array.isArray(data) ? (data as RawGem[]) : []),
  // The API publishes no total: omit it, and the pipeline marks the count a bound.
  normalize: normalizeGem,
});
