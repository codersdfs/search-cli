#!/usr/bin/env node
/**
 * ghfind — npm bin entry point.
 * Requires Node.js >= 20 or Bun.
 *
 * Uses the bundled Bun binary (vendor/bun.exe) to run the TypeScript source
 * directly, so users don't need to install Bun separately. Falls back to
 * the bundled dist/cli.js if present, or system Bun/Node.
 */
import { existsSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { platform } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");

// Path to bundled Bun binary
const BUN_BIN = join(PKG_DIR, "vendor", platform() === "win32" ? "bun.exe" : "bun");

// Path to bundled dist
const distCli = join(PKG_DIR, "dist", "cli.js");

// Path to source
const srcCli = join(PKG_DIR, "src", "cli.ts");

// Strategy 1: Use bundled Bun to run source directly (always works, no Node FFI needed)
if (existsSync(BUN_BIN) && existsSync(srcCli)) {
  const result = spawnSync(BUN_BIN, ["run", srcCli, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, GHFIND_BUNDLED: "1" },
  });
  process.exit(result.status ?? 0);
}

// Strategy 2: Use bundled dist/cli.js with Node (non-interactive only on Node 23+)
if (existsSync(distCli)) {
  try {
    await import(distCli);
  } catch (err) {
    console.error("Failed to start ghfind. Node.js >= 20 or Bun required.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
} else {
  // Strategy 3: Fallback to system Bun/Node running source
  try {
    await import("../src/cli.ts");
  } catch (err) {
    console.error("Failed to start ghfind. Node.js >= 20 or Bun required.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
