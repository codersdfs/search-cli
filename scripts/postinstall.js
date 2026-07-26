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
  "win32-x64": "bun-x64-windows.zip",
  "win32-arm64": "bun-arm64-windows.zip",
  "darwin-x64": "bun-x64-darwin.zip",
  "darwin-arm64": "bun-arm64-darwin.zip",
  "linux-x64": "bun-x64-linux.zip",
  "linux-arm64": "bun-arm64-linux.zip",
};

const key = `${platform()}-${arch()}`;
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

  // Parse zip to find the bun binary
  // Bun releases are zip files with the binary at the root
  const view = new DataView(buffer.buffer);
  const text = new TextDecoder("latin1").decode(buffer);

  // Find local file header signature (PK\x03\x04)
  const sig = "PK\x03\x04";
  let offset = text.indexOf(sig);
  while (offset !== -1) {
    // Read filename length (offset + 26) and extra field length (offset + 28)
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const fileName = text.substring(nameStart, nameStart + nameLen);

    if (fileName.endsWith(bunName)) {
      const dataOffset = nameStart + nameLen + extraLen;
      // Read compressed size (offset + 18)
      const compSize = view.getUint32(offset + 18, true);
      const compMethod = view.getUint16(offset + 8, true);

      let fileData;
      if (compMethod === 0) {
        // Stored (no compression)
        fileData = buffer.subarray(dataOffset, dataOffset + compSize);
      } else {
        // Deflated
        const { gunzipSync, inflateRawSync } = await import("zlib");
        fileData = inflateRawSync(buffer.subarray(dataOffset, dataOffset + compSize));
      }

      writeFileSync(bunPath, fileData);
      if (platform() !== "win32") chmodSync(bunPath, 0o755);
      console.error(`[ghfind] Bun installed to vendor/${bunName}`);
      process.exit(0);
    }

    offset = text.indexOf(sig, offset + 4);
  }

  throw new Error("Bun binary not found in archive");
} catch (err) {
  console.error(`[ghfind] Failed to download Bun: ${err instanceof Error ? err.message : String(err)}`);
  console.error("[ghfind] Install Bun manually: https://bun.sh/docs/install");
  process.exit(0);
}
