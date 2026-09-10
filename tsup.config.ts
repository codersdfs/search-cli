import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: "esm",
  target: "node20",
  outDir: "dist",
  external: ["@opentui/core"],
  define: {
    // Prevent tui.ts/trending.ts auto-run guards from firing when bundled
    "process.env.GHFIND_BUNDLED": "true",
    // Embed version so dist works without package.json on disk
    __GHFIND_VERSION__: JSON.stringify(pkg.version),
  },
  clean: true,
});
