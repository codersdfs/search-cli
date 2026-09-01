/**
 * Help overlay — smallest of the 12, uses only pure data from src/help.ts.
 * First overlay migrated out of tui.ts to prove the registry seam works.
 */
import { buildHelpSections, HELP_KEYS_COLUMN } from "../../help";
import type { Overlay } from "./registry";

export const helpOverlay: Overlay = {
  id: "help",
  build() {
    // Defer to the existing data builder; rendering stays in tui.ts until
    // the next migration step (this is a structural refactor, not a
    // visual rewrite).
    return {
      sections: buildHelpSections(),
      keysColumn: HELP_KEYS_COLUMN,
    };
  },
};
