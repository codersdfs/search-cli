// The TUI view machine: modes × overlays → the main panels that are visible.
// These tests drive the machine directly (no renderer) and then check the one
// thing a pure module cannot guarantee on its own: that src/tui.ts actually
// paints from it instead of growing another copy of the matrix.
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FLOATING_OVERLAYS,
  OVERLAY_IDS,
  VIEW_MODES,
  isFloatingOverlay,
  panelsFor,
  setMode,
  type ViewState,
} from "../src/view-state.ts";

/** Read a source file with LF endings (Windows CI checks out CRLF). */
function readSource(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

const SHOWN = {
  landing: false,
  search: true,
  toolbar: true,
  body: true,
  trendingTabs: false,
};
const ALL_HIDDEN = {
  landing: false,
  search: false,
  toolbar: false,
  body: false,
  trendingTabs: false,
};

describe("panelsFor", () => {
  test("landing shows only the menu", () => {
    expect(panelsFor({ mode: "landing", overlay: "none" })).toEqual({
      landing: true,
      search: false,
      toolbar: false,
      body: false,
      trendingTabs: false,
    });
  });

  test("search shows the query row, toolbar, and body", () => {
    expect(panelsFor({ mode: "search", overlay: "none" })).toEqual(SHOWN);
  });

  test("packages share the search layout (registry lives in the toolbar)", () => {
    expect(panelsFor({ mode: "packages", overlay: "none" })).toEqual(SHOWN);
  });

  test("trending swaps the query row for its tab bar", () => {
    expect(panelsFor({ mode: "trending", overlay: "none" })).toEqual({
      landing: false,
      search: false,
      toolbar: false,
      body: true,
      trendingTabs: true,
    });
  });

  test("every full-screen overlay hides every main panel", () => {
    for (const overlay of OVERLAY_IDS) {
      if (overlay === "none" || isFloatingOverlay(overlay)) continue;
      for (const mode of VIEW_MODES) {
        expect(
          panelsFor({ mode, overlay }),
          `${overlay} over ${mode} must hide the main view`,
        ).toEqual(ALL_HIDDEN);
      }
    }
  });

  test("a floating overlay keeps the panels beneath it visible", () => {
    expect(panelsFor({ mode: "search", overlay: "leader" })).toEqual(SHOWN);
    expect(panelsFor({ mode: "trending", overlay: "leader" })).toEqual({
      landing: false,
      search: false,
      toolbar: false,
      body: true,
      trendingTabs: true,
    });
  });

  test("the landing menu steps aside for any overlay, floating included", () => {
    for (const overlay of FLOATING_OVERLAYS) {
      expect(panelsFor({ mode: "landing", overlay }).landing).toBe(false);
    }
  });

  test("only the leader menu floats", () => {
    expect(FLOATING_OVERLAYS).toEqual(["leader"]);
  });
});

describe("setMode", () => {
  test("changing mode leaves the overlay dimension alone", () => {
    const state: ViewState = { mode: "search", overlay: "help" };
    expect(setMode(state, "trending")).toEqual({
      mode: "trending",
      overlay: "help",
    });
  });

  test("does not mutate the state it was given", () => {
    const state: ViewState = { mode: "search", overlay: "none" };
    const next = setMode(state, "landing");
    expect(state).toEqual({ mode: "search", overlay: "none" });
    expect(next).not.toBe(state);
  });
});

describe("overlay id set", () => {
  test("ids are unique and include 'none'", () => {
    expect(new Set(OVERLAY_IDS).size).toBe(OVERLAY_IDS.length);
    expect(OVERLAY_IDS[0]).toBe("none");
  });

  test("landing is a mode, never an overlay id", () => {
    expect((OVERLAY_IDS as readonly string[]).includes("landing")).toBe(false);
    expect((VIEW_MODES as readonly string[]).includes("landing")).toBe(true);
  });
});

describe("the shell paints from the machine (source contract)", () => {
  test("tui.ts imports the machine and projects its own state", () => {
    const src = readSource("src/tui.ts");
    expect(src).toContain('from "./view-state"');
    expect(src).toContain("panelsFor(currentView())");
  });

  test("each mode switch is one transition, not a hand-written matrix", () => {
    const src = readSource("src/tui.ts");
    for (const mode of ["landing", "search", "packages", "trending"]) {
      expect(src, `missing enterMode("${mode}")`).toContain(
        `enterMode("${mode}")`,
      );
    }
    // The duplication this replaced: search/packages used to set the same
    // four flags by hand in two places.
    expect(src).not.toContain(
      "trendingTabBox.visible = false;\n    searchBox.visible = true;",
    );
  });
});
