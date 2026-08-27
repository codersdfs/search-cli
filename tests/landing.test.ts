import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createTestRenderer } from "@opentui/core/testing";
import { RGBA } from "@opentui/core";
import {
  createBookmarksButton,
  bookmarksButtonLabel,
  moveSelection,
  landingKeysActive,
  landingConsumesKey,
} from "../src/landing.ts";

const COLORS = {
  accent: "#89b4fa",
  border: "#45475a",
  text: "#e0e4f0",
};

describe("bookmarksButtonLabel", () => {
  test("says 'none yet' with zero bookmarks", () => {
    expect(bookmarksButtonLabel(0)).toContain("none yet");
  });

  test("uses singular for exactly one", () => {
    expect(bookmarksButtonLabel(1)).toContain("1 saved");
    expect(bookmarksButtonLabel(1)).not.toContain("1 saveds");
  });

  test("uses plural count for many", () => {
    expect(bookmarksButtonLabel(7)).toContain("7 saved");
  });

  test("treats negative counts as empty", () => {
    expect(bookmarksButtonLabel(-3)).toContain("none yet");
  });

  test("always includes the Bookmarks name", () => {
    for (const n of [0, 1, 42]) {
      expect(bookmarksButtonLabel(n)).toContain("Bookmarks");
    }
  });
});

describe("moveSelection", () => {
  // 3 mode cards + bookmarks button = 4 items
  const TOTAL = 4;

  test("moves down through cards into the bookmarks button", () => {
    expect(moveSelection(0, 1, TOTAL)).toBe(1);
    expect(moveSelection(2, 1, TOTAL)).toBe(3); // last card -> button
  });

  test("clamps at the bookmarks button (no wrap)", () => {
    expect(moveSelection(3, 1, TOTAL)).toBe(3);
  });

  test("clamps at the first card (no wrap)", () => {
    expect(moveSelection(0, -1, TOTAL)).toBe(0);
  });

  test("moves back up out of the button", () => {
    expect(moveSelection(3, -1, TOTAL)).toBe(2);
  });

  test("handles an empty menu", () => {
    expect(moveSelection(0, 1, 0)).toBe(0);
  });
});

describe("bookmarks button rendering", () => {
  let setup: Awaited<ReturnType<typeof createTestRenderer>>;

  beforeEach(async () => {
    setup = await createTestRenderer({ width: 80, height: 24 });
  });
  afterEach(() => setup.destroy?.());

  async function frame(): Promise<string> {
    await setup.renderOnce();
    return setup.captureCharFrame();
  }

  test("renders a bordered button with the count label", async () => {
    const btn = createBookmarksButton(setup.renderer, COLORS);
    setup.renderer.root.add(btn.box);
    btn.setCount(3);
    const f = await frame();
    expect(f).toContain("Bookmarks");
    expect(f).toContain("3 saved");
    expect(f).toMatch(/[┌╭]/); // has a border
  });

  test("count updates the visible label", async () => {
    const btn = createBookmarksButton(setup.renderer, COLORS);
    setup.renderer.root.add(btn.box);
    btn.setCount(0);
    expect(await frame()).toContain("none yet");
    btn.setCount(2);
    expect(await frame()).toContain("2 saved");
  });

  test("selection highlights border and label in the accent color", () => {
    const btn = createBookmarksButton(setup.renderer, COLORS);
    setup.renderer.root.add(btn.box);

    btn.setSelected(false);
    expect(String(btn.borderColor)).toBe(String(RGBA.fromHex(COLORS.border)));

    btn.setSelected(true);
    expect(String(btn.borderColor)).toBe(String(RGBA.fromHex(COLORS.accent)));
  });

  test("deselecting restores the unselected border", () => {
    const btn = createBookmarksButton(setup.renderer, COLORS);
    setup.renderer.root.add(btn.box);
    btn.setSelected(true);
    btn.setSelected(false);
    expect(String(btn.borderColor)).toBe(String(RGBA.fromHex(COLORS.border)));
  });
});

describe("landingKeysActive", () => {
  test("landing screen owns the keys when no overlay is open", () => {
    expect(landingKeysActive("landing", "none")).toBe(true);
  });

  test("bookmarks overlay takes the keys away from the landing screen", () => {
    expect(landingKeysActive("landing", "bookmarks")).toBe(false);
  });

  test("any other overlay also takes the keys", () => {
    for (const o of ["help", "saved", "notifications", "leader", "topics"]) {
      expect(landingKeysActive("landing", o)).toBe(false);
    }
  });

  test("non-landing modes never own the landing keys", () => {
    expect(landingKeysActive("search", "none")).toBe(false);
    expect(landingKeysActive("trending", "none")).toBe(false);
    expect(landingKeysActive("packages", "bookmarks")).toBe(false);
  });
});

describe("landingConsumesKey", () => {
  test("claims the keys the landing handler acts on", () => {
    for (const k of ["up", "down", "j", "k", "enter", "return", "b", "?", "h", "q"]) {
      expect(landingConsumesKey(k)).toBe(true);
    }
  });

  test("lets unrelated keys fall through", () => {
    for (const k of ["left", "right", "d", "escape", "x", "1", "/"]) {
      expect(landingConsumesKey(k)).toBe(false);
    }
  });
});

describe("landing + bookmarks overlay key routing", () => {
  /**
   * Mirrors tui.ts: two global keypress listeners run in registration order on
   * the *same* event object, and stopPropagation() on the first prevents the
   * second from seeing it (KeyHandler.emitWithPriority semantics). Bookmarks is
   * a full page (currentMode === "bookmarks"), not an overlay.
   */
  function harness() {
    let mode = "landing";
    let overlay = "none";
    let landingSel = 0;
    let bookmarkSel = 0;
    let quit = false;
    let browserOpens = 0;
    const landingItemCount = 4; // 3 cards + bookmarks button
    const bookmarkCount = 5;
    function press(name: string) {
      let stopped = false;
      const key = {
        name,
        stopPropagation: () => {
          stopped = true;
        },
      };
      // Listener 1 — landing handler (inactive once another mode owns the screen)
      if (landingKeysActive(mode, overlay)) {
        if (landingConsumesKey(key.name)) key.stopPropagation();
        if (name === "up" || name === "k") {
          landingSel = moveSelection(landingSel, -1, landingItemCount);
        } else if (name === "down" || name === "j") {
          landingSel = moveSelection(landingSel, 1, landingItemCount);
        } else if (name === "enter") {
          if (landingSel === landingItemCount - 1) {
            mode = "bookmarks"; // showBookmarksPage()
            bookmarkSel = 0;
          } else {
            mode = "search";
          }
        } else if (name === "b") {
          mode = "bookmarks";
          bookmarkSel = 0;
        } else if (name === "q") {
          quit = true;
        }
      }
      // Listener 2 — global handler (skipped if propagation stopped)
      if (stopped) return;
      // Other overlays (help, history, …) still close on Esc/q
      if (overlay !== "none") {
        if (name === "escape" || name === "q") overlay = "none";
        return;
      }
      // Bookmarks page keys (focused Select handles ↑ ↓ internally)
      if (mode === "bookmarks") {
        if (name === "escape" || name === "left") {
          mode = "landing"; // showLanding(true)
          landingSel = 0;
          return;
        }
        if (name === "up" || name === "k") {
          bookmarkSel = Math.max(0, bookmarkSel - 1);
          return;
        }
        if (name === "down" || name === "j") {
          bookmarkSel = Math.min(bookmarkCount - 1, bookmarkSel + 1);
          return;
        }
        if (name === "enter") {
          browserOpens++; // openUrl(selected bookmark)
          return;
        }
      }
      if (name === "q") quit = true; // shared quit
    }
    return {
      press,
      get state() {
        return { mode, overlay, landingSel, bookmarkSel, quit, browserOpens };
      },
    };
  }

  test("Enter on the bookmarks button opens the page without launching a browser", () => {
    const h = harness();
    h.press("down");
    h.press("down");
    h.press("down"); // bookmarks button
    expect(h.state.landingSel).toBe(3);

    h.press("enter");
    expect(h.state.mode).toBe("bookmarks");
    expect(h.state.browserOpens).toBe(0); // the bug: was 1
  });

  test("b jumps straight to the bookmarks page without launching a browser", () => {
    const h = harness();
    h.press("b");
    expect(h.state.mode).toBe("bookmarks");
    expect(h.state.browserOpens).toBe(0);
  });

  test("Enter on the page opens the selected bookmark", () => {
    const h = harness();
    h.press("b");
    h.press("down");
    h.press("enter");
    expect(h.state.bookmarkSel).toBe(1);
    expect(h.state.browserOpens).toBe(1);
  });

  test("Esc and left arrow both return to the landing menu", () => {
    const h = harness();
    h.press("b");
    h.press("escape");
    expect(h.state.mode).toBe("landing");

    h.press("b");
    h.press("left");
    expect(h.state.mode).toBe("landing");
  });

  test("keys route correctly after returning from the page", () => {
    const h = harness();
    h.press("b");
    h.press("escape");
    h.press("down"); // must land back on the landing handler
    expect(h.state.landingSel).toBe(1);

    h.press("down");
    h.press("down"); // bookmarks button again
    h.press("enter");
    expect(h.state.mode).toBe("bookmarks");
    expect(h.state.browserOpens).toBe(0);
  });

  test("reopening the page resets the bookmark selection", () => {
    const h = harness();
    h.press("b");
    h.press("down");
    h.press("down");
    expect(h.state.bookmarkSel).toBe(2);
    h.press("escape");
    h.press("b");
    expect(h.state.bookmarkSel).toBe(0);
  });

  test("arrows on the page do not move the landing selection", () => {
    const h = harness();
    h.press("down");
    h.press("down");
    h.press("down"); // bookmarks button
    expect(h.state.landingSel).toBe(3);
    h.press("enter"); // -> bookmarks page

    h.press("down");
    h.press("down");
    h.press("up");

    expect(h.state.bookmarkSel).toBe(1);
    expect(h.state.landingSel).toBe(3); // untouched by page arrows
  });

  test("Enter on a mode card never reaches the bookmarks page", () => {
    const h = harness();
    h.press("enter"); // Repo Search card
    expect(h.state.mode).toBe("search");
    expect(h.state.browserOpens).toBe(0);
  });

  test("q on the page quits the app (and would save mode=bookmarks)", () => {
    const h = harness();
    h.press("b");
    h.press("q");
    expect(h.state.quit).toBe(true);
    expect(h.state.mode).toBe("bookmarks");
  });

  test("q on the bare landing screen still quits", () => {
    const h = harness();
    h.press("q");
    expect(h.state.quit).toBe(true);
  });

  test("j/k vim keys route the same way as arrows", () => {
    const h = harness();
    h.press("j");
    expect(h.state.landingSel).toBe(1);
    h.press("b");
    h.press("j");
    h.press("j");
    expect(h.state.bookmarkSel).toBe(2);
  });
});
