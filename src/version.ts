/**
 * Package version resolution.
 *
 * Primary source: `__GHFIND_VERSION__`, injected at build time by tsup
 * (`define`) and by `bun build --compile` (`--define`) — required for
 * standalone single-file binaries where package.json is not present.
 * Fallback: read package.json relative to this module (source / dist trees).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

declare const __GHFIND_VERSION__: string | undefined;

let cached: string | null = null;

export function getVersion(): string {
  if (cached) return cached;
  if (typeof __GHFIND_VERSION__ === "string") {
    cached = __GHFIND_VERSION__;
    return cached;
  }
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(here, "..", "package.json"), "utf-8"),
    ) as { version?: string };
    cached = pkg.version ?? "unknown";
  } catch {
    cached = "unknown";
  }
  return cached;
}
