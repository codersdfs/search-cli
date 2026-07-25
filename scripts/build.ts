/**
 * Build script — compile ghfind for distribution.
 * Usage: npm run build
 */
import { execFileSync } from "child_process";

async function main() {
  console.log("Building ghfind...");

  // ESM bundle via tsup
  execFileSync("npx", ["tsup", "src/cli.ts", "--format", "esm", "--target", "node20", "--out-dir", "dist", "--external", "@opentui/core"], { stdio: "inherit" });

  console.log("✓ dist/cli.js (Node.js ESM bundle)");
}

main().catch((err) => {
  console.error("Build failed:", err.message);
  process.exit(1);
});