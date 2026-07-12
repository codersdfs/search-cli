/**
 * Bridge module: re-export trending's formatters + OpenTUI test utilities.
 *
 * OpenTUI's `@opentui/core/testing` module is importable via its package
 * exports field (`"./testing": { "import": "./testing.js" }`).
 */
export {
  fmtStars,
  fmtSigned,
  formatRepoLine,
  getTrendingQuery,
} from "../src/trending.ts";

export {
  createTestRenderer,
} from "@opentui/core/testing";
