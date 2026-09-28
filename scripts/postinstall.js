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
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

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

/**
 * Pinned SHA256 of every Bun release asset this script can install, taken
 * from that release's own SHASUMS256.txt. The download is verified before
 * anything is written, so a tampered or truncated archive can never become
 * an executable in vendor/.
 *
 * ponytail: hand-pinned per Bun release — regenerate this table (and bump
 * `version`) whenever the release is bumped; the check is what makes the
 * hardcoded `version` above trustworthy.
 */
const SHA256 = {
  "bun-windows-x64.zip":
    "0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922",
  "bun-windows-aarch64.zip":
    "89841f5a57f2348b67ec0839b718f4bf4ea7d07c371c9ba4b77b6c790f918953",
  "bun-darwin-x64.zip":
    "4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633",
  "bun-darwin-aarch64.zip":
    "d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620",
  "bun-linux-x64.zip":
    "951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f",
  "bun-linux-x64-musl.zip":
    "14bd9aedeebf1dba67e8def9531c89bc989ecfdf1de42e5bfcaf1b8cd9294719",
  "bun-linux-aarch64.zip":
    "a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b",
  "bun-linux-aarch64-musl.zip":
    "b98e0ad3625c5c00d1d5b5ff55605c7adddbfae151861e68ade57b2d3b8703bb",
};

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

  const expected = SHA256[assetName];
  const actual = createHash("sha256").update(buffer).digest("hex");
  if (expected !== actual) {
    throw new Error(
      `checksum mismatch for ${assetName} (expected ${expected}, got ${actual})`,
    );
  }

  // Find the central directory file header signature (PK\x01\x02)
  const cdSig = "PK\x01\x02";
  let cdOffset = buffer.indexOf(cdSig, 0);
  while (cdOffset !== -1) {
    const nameLen = buffer.readUInt16LE(cdOffset + 28);
    const _extraLen = buffer.readUInt16LE(cdOffset + 30);
    const _commentLen = buffer.readUInt16LE(cdOffset + 32);
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
