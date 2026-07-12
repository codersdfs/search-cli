#!/usr/bin/env bun
/**
 * search-cli — npm bin entry point.
 * Requires Bun (https://bun.sh) to run.
 */
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = join(__dirname, "..", "src", "cli.ts");

try {
  await import(cli);
} catch (err) {
  console.error("Failed to start search-cli. Is Bun installed? (https://bun.sh)");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
