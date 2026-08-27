#!/usr/bin/env node
/**
 * Postinstall script — downloads a Bun binary for ghfind's TUI.
 *
 * If a runnable vendor/bun or vendor/bun.exe already exists, this is a no-op.
 * Otherwise, it downloads the correct Bun binary for the user's platform
 * (including the right libc flavor for Linux: glibc vs musl).
 * On failure, prints a warning and exits 0 so npm install still succeeds.
 */
import {
  existsSync,
  mkdirSync,
  chmodSync,
  writeFileSync,
  readFileSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { platform, arch } from "os";
import { spawnSync } from "child_process";
import { inflateRawSync } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const VENDOR_DIR = join(ROOT, "vendor");

const bunName = platform() === "win32" ? "bun.exe" : "bun";
const bunPath = join(VENDOR_DIR, bunName);

/**
 * Detect whether the current Linux system uses musl or glibc.
 * Bun ships separate builds for each; musl binaries cannot run on glibc
 * systems and vice versa.
 */
function libcFlavor() {
  if (platform() !== "linux") return "glibc";
  // Check /etc/os-release first (fast, no subprocess)
  try {
    const osRelease = readFileSync("/etc/os-release", "utf8");
    if (/alpine|musl/i.test(osRelease)) return "musl";
  } catch {
    // ignore
  }
  // Fall back to ldd --version output
  try {
    const ldd = spawnSync("ldd", ["--version"], { encoding: "utf8" });
    const out = `${ldd.stdout}${ldd.stderr}`;
    if (/musl/i.test(out)) return "musl";
    if (/glibc|GNU libc/i.test(out)) return "glibc";
  } catch {
    // ignore
  }
  return "glibc";
}

// Skip in CI/test environments
if (process.env.GHFIND_SKIP_BUN === "1" || process.env.CI === "true") {
  process.exit(0);
}

/**
 * Returns true if an existing Bun binary is actually runnable.
 * A binary of the wrong libc flavor (e.g. musl build on a glibc system)
 * fails to launch with ENOENT because its dynamic loader is missing.
 */
function binaryRuns(path) {
  try {
    const res = spawnSync(path, ["--version"], { encoding: "utf8" });
    return res.status === 0;
  } catch {
    return false;
  }
}

// Already bundled and runnable — nothing to do
if (existsSync(bunPath) && binaryRuns(bunPath)) {
  process.exit(0);
}

// Try to download
const linuxLibc = libcFlavor();
const map = {
  "win32-x64": "bun-windows-x64.zip",
  "win32-arm64": "bun-windows-aarch64.zip",
  "darwin-x64": "bun-darwin-x64.zip",
  "darwin-arm64": "bun-darwin-aarch64.zip",
  "linux-x64":
    linuxLibc === "musl" ? "bun-linux-x64-musl.zip" : "bun-linux-x64.zip",
  "linux-arm64":
    linuxLibc === "musl"
      ? "bun-linux-aarch64-musl.zip"
      : "bun-linux-aarch64.zip",
};

const key = `${platform()}-${arch}`;
const assetName = map[key];
const version = "1.3.14";

if (!assetName) {
  console.error(
    `[ghfind] Unsupported platform: ${key}. Install Bun manually: https://bun.sh`,
  );
  process.exit(0);
}

const url = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${assetName}`;

try {
  mkdirSync(VENDOR_DIR, { recursive: true });
  console.error(
    `[ghfind] Downloading Bun ${version} for ${key}${linuxLibc === "musl" ? " (musl)" : ""}...`,
  );

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());

  // Find the central directory file header signature (PK\x01\x02)
  const cdSig = "PK\x01\x02";
  let cdOffset = buffer.indexOf(cdSig, 0);
  while (cdOffset !== -1) {
    const nameLen = buffer.readUInt16LE(cdOffset + 28);
    const extraLen = buffer.readUInt16LE(cdOffset + 30);
    const commentLen = buffer.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(cdOffset + 42);
    const compSize = buffer.readUInt32LE(cdOffset + 20);
    const compMethod = buffer.readUInt16LE(cdOffset + 10);
    const nameStart = cdOffset + 46;
    const fileName = buffer
      .subarray(nameStart, nameStart + nameLen)
      .toString("utf8");

    if (fileName.endsWith(bunName)) {
      // Read the local file header to get the actual data offset
      const localSig = buffer.readUInt32LE(localHeaderOffset);
      if (localSig !== 0x04034b50) throw new Error("Invalid local file header");
      const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

      let fileData;
      if (compMethod === 0) {
        // Stored (no compression)
        fileData = buffer.subarray(dataOffset, dataOffset + compSize);
      } else {
        // Deflated
        fileData = inflateRawSync(
          buffer.subarray(dataOffset, dataOffset + compSize),
        );
      }

      writeFileSync(bunPath, fileData);
      if (platform() !== "win32") chmodSync(bunPath, 0o755);
      console.error(`[ghfind] Bun installed to vendor/${bunName}`);
      process.exit(0);
    }

    cdOffset = buffer.indexOf(cdSig, cdOffset + 4);
  }

  throw new Error("Bun binary not found in archive");
} catch (err) {
  console.warn(
    `[ghfind] ⚠ Could not download Bun: ${err instanceof Error ? err.message : String(err)}`,
  );
  console.warn(
    "[ghfind] The interactive TUI requires Bun. Install it manually:",
  );
  console.warn("[ghfind]   curl -fsSL https://bun.sh/install | bash");
  console.warn("[ghfind]   # or: npm install -g bun");
  console.warn(
    "[ghfind] Non-interactive modes (--json, --csv, etc.) will still work with Node.js 20+.",
  );
  process.exit(0);
}
