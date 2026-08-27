#!/usr/bin/env node
/**
 * ghfind — npm bin entry point.
 * Requires Node.js >= 20 or Bun.
 *
 * Strategy 1: Use a Bun binary to run TypeScript source directly. Prefers the
 *   bundled vendor/bun (downloaded by postinstall), then falls back to a
 *   system-installed `bun` on PATH. Only runnable binaries are considered.
 * Strategy 2: Fall back to the bundled dist/cli.js with Node.js (works for
 *   non-interactive modes).
 */
import { existsSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { platform } from "os";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");

// Path to bundled Bun binary
const BUN_BIN = join(
  PKG_DIR,
  "vendor",
  platform() === "win32" ? "bun.exe" : "bun",
);

// Path to bundled dist
const distCli = join(PKG_DIR, "dist", "cli.js");

// Path to source
const srcCli = join(PKG_DIR, "src", "cli.ts");

/** Returns "bun" if a system Bun is available on PATH, else undefined. */
function systemBun() {
  try {
    const res = spawnSync("bun", ["--version"], {
      encoding: "utf8",
      timeout: 15000,
    });
    return res.status === 0 ? "bun" : undefined;
  } catch {
    return undefined;
  }
}

/** Returns true if the given Bun binary actually runs. */
function bunRuns(bin) {
  try {
    const res = spawnSync(bin, ["--version"], {
      encoding: "utf8",
      timeout: 15000,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

// Strategy 1: Use Bun to run source directly (bundled binary first, then system bun)
if (existsSync(srcCli)) {
  const candidates = [];
  if (existsSync(BUN_BIN)) candidates.push(BUN_BIN);
  const sysBun = systemBun();
  if (sysBun) candidates.push(sysBun);

  for (const bunBin of candidates) {
    if (!bunRuns(bunBin)) continue;
    const result = spawnSync(
      bunBin,
      ["run", srcCli, ...process.argv.slice(2)],
      {
        stdio: "inherit",
        env: { ...process.env, GHFIND_BUNDLED: "1" },
      },
    );
    process.exit(result.status ?? 0);
  }
}

// Strategy 2: Use bundled dist/cli.js with Node (non-interactive only on Node 23+)
if (existsSync(distCli)) {
  try {
    await import(pathToFileURL(distCli).href);
  } catch (err) {
    console.error("Failed to start ghfind. Node.js >= 20 or Bun required.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
