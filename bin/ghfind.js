#!/usr/bin/env node
/**
 * ghfind — npm bin entry point.
 * Requires Node.js >= 20.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
try {
  await import("../src/cli.ts");
} catch (err) {
  console.error("Failed to start ghfind. Node.js >= 20 required.");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}