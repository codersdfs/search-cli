/**
 * Build script — compile search-cli for distribution.
 * Usage: bun run scripts/build.ts
 */
import { $ } from "bun";

async function main() {
  console.log("Building search-cli...");

  // Native binary for the current platform
  await $`bun build src/cli.ts --compile --target bun --outfile dist/search-cli`.quiet();

  // Portable JS bundle (requires bun runtime, @opentui/core as peer dep)
  await $`bun build src/cli.ts --target bun --outfile dist/search-cli.js --external @opentui/core`.quiet();

  console.log("✓ dist/search-cli (native binary)");
  console.log("✓ dist/search-cli.js (portable JS)");
}

main().catch(console.error);
