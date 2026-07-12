/**
 * Build script — compile search-cli for distribution.
 * Usage: bun run scripts/build.ts
 */
import { $ } from "bun";

async function main() {
  console.log("Building search-cli...");

  // Bundle for the current platform
  await $`bun build src/cli.ts --compile --outfile dist/search-cli`.quiet();

  // Also produce a portable JS bundle
  await $`bun build src/cli.ts --outfile dist/search-cli.js --external @opentui/core`.quiet();

  console.log("✓ dist/search-cli (native binary)");
  console.log("✓ dist/search-cli.js (portable JS)");
}

main().catch(console.error);
