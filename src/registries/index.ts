/**
 * index.ts — provider dispatch. The only module that imports every provider,
 * so `src/package.ts` stays a thin facade and adding a registry touches
 * exactly one line here plus the catalog entry.
 */
import type { RegistryId } from "./catalog";
import type { PackageProvider } from "./types";
import { npmProvider } from "./npm";

const PROVIDERS: Partial<Record<RegistryId, PackageProvider>> = {
  [npmProvider.id]: npmProvider,
};

/** The provider for `id`. Throws if the catalog advertises an unbuilt registry. */
export function getProvider(id: RegistryId): PackageProvider {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(`Registry "${id}" has no search provider.`);
  }
  return provider;
}
