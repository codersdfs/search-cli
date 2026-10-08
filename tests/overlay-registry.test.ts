import { describe, test, expect } from "vitest";
import {
  OVERLAYS,
  getOverlay,
  type Overlay,
} from "../src/tui/overlays/registry";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// These tests guard the registry seam: they fail if someone deletes the
// registry file, breaks the Overlay contract, or lets the registry drift
// out of sync with the overlay id strings used in src/tui.ts.
//
// The migration is gradual; tests do NOT require every overlay to be
// migrated yet — each new registration is a separate commit.

function readTui(): string {
  // Normalise CRLF (the Windows CI checkout) so multi-line expectations hold.
  return readFileSync(join(process.cwd(), "src/tui.ts"), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

function tuiOverlayIds(src: string): Set<string> {
  // Match the exact string literals used as overlay ids inside tui.ts.
  // Centralised here so the test fails loudly if the union drifts.
  const wanted = [
    "none",
    "history",
    "bookmarks",
    "saved",
    "help",
    "topics",
    "export",
    "compare",
    "notifications",
    "share",
    "leader",
    "readme",
    "update",
    "landing",
  ];
  const found = new Set<string>();
  for (const id of wanted) {
    const re = new RegExp(`"${id}"`);
    if (re.test(src)) found.add(id);
  }
  return found;
}

describe("overlay registry seam", () => {
  test("OVERLAYS is exported as an array", () => {
    expect(Array.isArray(OVERLAYS)).toBe(true);
  });

  test("registered overlay ids are unique (router breaks on duplicates)", () => {
    const ids = OVERLAYS.map((o: Overlay) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("getOverlay returns the registered overlay by id", () => {
    for (const o of OVERLAYS) {
      expect(getOverlay(o.id)).toBe(o);
    }
  });

  test("getOverlay returns undefined for unknown id", () => {
    expect(getOverlay("definitely-not-an-overlay")).toBeUndefined();
  });

  test("every registered id exists in tui.ts (no orphan registrations)", () => {
    const src = readTui();
    const used = tuiOverlayIds(src);
    for (const o of OVERLAYS) {
      expect(used.has(o.id)).toBe(true);
    }
  });

  test("no stale registered id has been deleted from tui.ts", () => {
    // A registered overlay whose id is no longer in tui.ts means somebody
    // removed the dispatcher branch but left the registry entry behind.
    // (Plain expect instead of expect.soft: bun-types has no soft API.)
    const src = readTui();
    const used = tuiOverlayIds(src);
    for (const o of OVERLAYS) {
      expect(used.has(o.id), `stale registration: ${o.id}`).toBe(true);
    }
  });

  test("showOverlay hides every overlay it can show", () => {
    // The regression that motivated this guard: `orgBox` was created as a
    // flexGrow sibling of `body` and had a `visible = true` branch, but was
    // missing from showOverlay()'s reset prologue. Opening the org panel and
    // pressing Esc left it visible forever — it kept half the content height
    // and swallowed every click in the lower half of the screen, which read as
    // "the TUI broke". A panel that can be shown must be resettable, so derive
    // both sides from the source instead of hard-coding the box list: the next
    // overlay added without a reset line fails here.
    const src = readTui();
    const start = src.indexOf("function showOverlay(");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("renderer.requestRender();\n  }", start);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);

    // Everything before the `type === "none"` early return is the prologue
    // that hides every panel on every switch.
    const prologue = body.slice(0, body.indexOf('if (type === "none") {'));
    const resetBoxes = new Set(
      [...prologue.matchAll(/(\w+)\.visible = false;/g)].map((m) => m[1]),
    );
    // Only the panels showOverlay turns on are in scope: start after the
    // `type === "none"` branch (which owns menuButton / landingBox / the main
    // content boxes) so those don't look like overlays with a missing reset.
    const dispatch = body.slice(body.indexOf("currentOverlay = type;"));
    const shownBoxes = new Set(
      [...dispatch.matchAll(/(\w+)\.visible = true;/g)].map((m) => m[1]),
    );

    expect(shownBoxes.size).toBeGreaterThan(0);
    for (const box of shownBoxes) {
      expect(
        resetBoxes.has(box),
        `${box} can be shown by showOverlay but is never reset to visible = false`,
      ).toBe(true);
    }
    // The regression itself, pinned by name so the failure names the box.
    expect(resetBoxes.has("orgBox")).toBe(true);
  });

  test("update modal never references the removed updateSelect", () => {
    // `updateSelect` was a vestigial reference from the 9.4.0 refactor. It
    // was never declared, and every boot with upgrade state hit
    // `showOverlay("update")` → `updateSelect.focus()` → ReferenceError →
    // `bun start` exited 1. The modal is driven by updateSelectedOption +
    // the global key handler, so any reintroduced `updateSelect` is a bug.
    // Word boundaries keep the legit `updateSelectedOption` state variable
    // from false-matching the guard.
    const src = readTui();
    expect(src).not.toMatch(/\bupdateSelect\b/);
  });
});
