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
  return readFileSync(join(process.cwd(), "src/tui.ts"), "utf8");
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
