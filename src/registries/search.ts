/**
 * search.ts — the pipeline every registry provider runs.
 *
 * A provider is a descriptor: a URL shape, an envelope reader, a row
 * normalizer, and nothing else. This module owns everything around that —
 * the clamp, the fetch, the status guard, the missing-total policy — so the
 * five registries differ only in the facts that actually differ between them.
 *
 * The missing-total policy is the load-bearing one: when a registry says
 * nothing about how many matches exist, the count we print is a bound, and
 * `totalIsExact: false` is how every surface knows. A descriptor cannot
 * forget to set it, because the coalesce path sets it.
 */
import type { Package } from "../types";
import { clampRegistryLimit, registryMeta, type RegistryId } from "./catalog";
import { readJson } from "./parse";
import type {
  PackageSearchResult,
  PackageProvider,
  ProviderFetch,
} from "./types";

export interface RegistrySearchDescriptor<Row = unknown> {
  id: RegistryId;
  /** Build the request URL. `limit` is already clamped to the registry's ceiling. */
  url(rawQuery: string, limit: number): string;
  /** Pull the raw rows out of the decoded body, whatever envelope it uses. */
  rows(data: unknown): Row[];
  /** Pull the registry-reported total; omit it when the API publishes none. */
  total?(data: unknown): number | undefined;
  normalize(row: Row): Package;
  /** Request headers; defaults to `{ Accept: "application/json" }`. */
  headers?(): Record<string, string>;
  /** Render a non-OK response into a useful message (crates parses error bodies). */
  errorDetail?(res: Response): Promise<string>;
}

export function defineSearch<Row>(
  descriptor: RegistrySearchDescriptor<Row>,
): PackageProvider {
  const label = registryMeta(descriptor.id).label;
  return {
    id: descriptor.id,
    async search(
      rawQuery: string,
      limit: number,
      fetchImpl: ProviderFetch = fetch,
    ): Promise<PackageSearchResult> {
      const size = clampRegistryLimit(limit, descriptor.id);
      const res = await fetchImpl(descriptor.url(rawQuery, size), {
        headers: descriptor.headers?.() ?? { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(
          descriptor.errorDetail
            ? await descriptor.errorDetail(res)
            : `${label} search failed: HTTP ${res.status}`,
        );
      }
      const data = await readJson(res, label);
      const rows = descriptor.rows(data).slice(0, size);
      const packages = rows.map(descriptor.normalize);
      const reported = descriptor.total?.(data);
      if (typeof reported === "number" && Number.isFinite(reported)) {
        return { totalCount: reported, packages };
      }
      // The registry said nothing: our count is a bound, never an exact tally.
      return { totalCount: packages.length, packages, totalIsExact: false };
    },
  };
}
