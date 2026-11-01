/**
 * types.ts — the contract every registry provider satisfies. Type-only:
 * importing this module adds nothing to the bundle.
 */
import type { Package } from "../types";
import type { RegistryId } from "./catalog";

/** The fetch signature a provider needs; injectable so tests stay offline. */
export type ProviderFetch = typeof fetch;

export interface PackageSearchResult {
  /** Total matches the registry reports, not the page we fetched. */
  totalCount: number;
  packages: Package[];
}

export interface PackageProvider {
  readonly id: RegistryId;
  search(
    rawQuery: string,
    limit: number,
    fetchImpl?: ProviderFetch,
  ): Promise<PackageSearchResult>;
}
