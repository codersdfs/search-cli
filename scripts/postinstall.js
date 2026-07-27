#!/usr/bin/env node
/**
 * Postinstall script — ensures a Bun binary is available for ghfind.
 *
 * If vendor/bun or vendor/bun.exe already exists (bundled with the package),
 * this is a no-op. Otherwise, it attempts to download the correct binary
 * for the user's platform.
 */
import { existsSync, mkdirSync, chmodSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { platform, arch } from "os";
import { inflateRawSync } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const VENDOR_DIR = join(ROOT, "vendor");

const bunName = platform() === "win32" ? "bun.exe" : "bun";
const bunPath = join(VENDOR_DIR, bunName);

// Already bundled — nothing to do
if (existsSync(bunPath)) {
  process.exit(0);
}

// Skip in CI/test environments
if (process.env.GHFIND_SKIP_BUN === "1" || process.env.CI === "true") {
  process.exit(0);
}

// Try to download
const map = {
  "win32-x64": "bun-windows-x64.zip",
  "win32-arm64": "bun-windows-aarch64.zip",
  "darwin-x64": "bun-darwin-x64.zip",
  "darwin-arm64": "bun-darwin-aarch64.zip",
  "linux-x64": "bun-linux-x64-musl.zip",
  "linux-arm64": "bun-linux-aarch64-musl.zip",
};

const key = `${platform()}-${arch}`;
const assetName = map[key];
const version = "1.3.12";

if (!assetName) {
  console.error(`[ghfind] Unsupported platform: ${key}. Install Bun manually: https://bun.sh`);
  process.exit(0);
}

const url = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${assetName}`;

try {
  mkdirSync(VENDOR_DIR, { recursive: true });
  console.error(`[ghfind] Downloading Bun ${version} for ${key}...`);

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
    const fileName = buffer.subarray(nameStart, nameStart + nameLen).toString("utf8");

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
        fileData = inflateRawSync(buffer.subarray(dataOffset, dataOffset + compSize));
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
  console.error(`[ghfind] Failed to download Bun: ${err instanceof Error ? err.message : String(err)}`);
  console.error("[ghfind] Install Bun manually: https://bun.sh/docs/install");
  process.exit(0);
}
