import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: "esm",
  target: "node20",
  outDir: "dist",
  external: ["@opentui/core"],
  define: {
    // Prevent tui.ts/trending.ts auto-run guards from firing when bundled
    "process.env.GHFIND_BUNDLED": "true",
  },
  clean: true,
});
