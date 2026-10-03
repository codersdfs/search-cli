/**
 * Mouse hit-test geometry.
 *
 * `hitIndexForY` is the one piece of mouse support with real arithmetic in it:
 * it maps a screen-space y coordinate onto a `SelectRenderable` option index.
 * OpenTUI keeps `scrollOffset` / `linesPerItem` private, so this function is fed
 * a plain geometry object and stays pure — the off-by-one surface at scroll
 * boundaries is exactly what these tests pin down.
 */
import { describe, test, expect } from "vitest";
import {
  hitIndexForY,
  DOUBLE_CLICK_MS,
  NON_INTERACTIVE_TEXT,
  type SelectGeometryLike,
} from "../src/tui/mouse";

/**
 * Build a geometry stub. Defaults model the real main results list:
 * 10 visible rows of pitch 1 starting at screen y 6.
 */
function geometry(
  overrides: Partial<SelectGeometryLike> = {},
): SelectGeometryLike {
  return {
    screenY: 6,
    height: 10,
    optionCount: 50,
    scrollOffset: 0,
    linesPerItem: 1,
    ...overrides,
  };
}

describe("hitIndexForY", () => {
  test("maps the first visible row when the list is unscrolled", () => {
    expect(hitIndexForY(geometry(), 6)).toBe(0);
  });

  test("maps the last visible row when the list is unscrolled", () => {
    // rows occupy y 6..15 inclusive; y 15 is the 10th (last) row
    expect(hitIndexForY(geometry(), 15)).toBe(9);
  });

  test("misses one row below the last visible row", () => {
    // The viewport is 10 rows tall (y 6..15). y 16 is past its bottom edge.
    expect(hitIndexForY(geometry(), 16)).toBe(-1);
  });

  test("misses above the first row", () => {
    expect(hitIndexForY(geometry(), 5)).toBe(-1);
  });

  test("misses a row far below the list", () => {
    expect(hitIndexForY(geometry(), 200)).toBe(-1);
  });

  test("offsets by scrollOffset when the list is scrolled", () => {
    const scrolled = geometry({ scrollOffset: 20 });
    expect(hitIndexForY(scrolled, 6)).toBe(20);
    expect(hitIndexForY(scrolled, 15)).toBe(29);
  });

  test("clamps a partial final row onto the last option", () => {
    // 5 options, 10-row viewport: y 10..15 are empty space below the last row
    // and must resolve to option 4, not -1 (users expect to click "the row").
    const short = geometry({ optionCount: 5 });
    expect(hitIndexForY(short, 10)).toBe(4);
    expect(hitIndexForY(short, 15)).toBe(4);
  });

  test("misses when the list has no options", () => {
    expect(hitIndexForY(geometry({ optionCount: 0 }), 6)).toBe(-1);
  });

  test("misses when the renderable is unmeasured (zero pitch)", () => {
    // Happens before the first layout pass, or if OpenTUI renames the private
    // field this projects onto. Must miss, never divide by zero.
    expect(hitIndexForY(geometry({ linesPerItem: 0 }), 6)).toBe(-1);
    expect(hitIndexForY(geometry({ linesPerItem: -2 }), 6)).toBe(-1);
  });

  test("misses when the viewport has no height", () => {
    expect(hitIndexForY(geometry({ height: 0 }), 0)).toBe(-1);
  });

  test("accounts for multi-line rows (descriptions)", () => {
    // Overlay lists set showDescription:true, so each option is 2 lines tall.
    const twoLine = geometry({ optionCount: 8, linesPerItem: 2 });
    expect(hitIndexForY(twoLine, 6)).toBe(0); // line 0 of row 0
    expect(hitIndexForY(twoLine, 7)).toBe(0); // line 1 of row 0
    expect(hitIndexForY(twoLine, 8)).toBe(1); // line 0 of row 1
    expect(hitIndexForY(twoLine, 9)).toBe(1); // line 1 of row 1
  });

  test("accounts for itemSpacing added to the pitch", () => {
    const spaced = geometry({ optionCount: 4, linesPerItem: 3 });
    expect(hitIndexForY(spaced, 6)).toBe(0);
    expect(hitIndexForY(spaced, 9)).toBe(1);
    expect(hitIndexForY(spaced, 12)).toBe(2);
  });

  test("handles a scrolled, multi-line, partially filled list", () => {
    const mixed = geometry({
      optionCount: 7,
      linesPerItem: 2,
      scrollOffset: 2,
      height: 8,
    });
    // scrollOffset 2, pitch 2, viewport y 6..13 → rows 0..3, options 2..5.
    expect(hitIndexForY(mixed, 6)).toBe(2);
    expect(hitIndexForY(mixed, 7)).toBe(2);
    expect(hitIndexForY(mixed, 8)).toBe(3);
    expect(hitIndexForY(mixed, 13)).toBe(5);
    // Option 6 (the last) is only reachable at row 4, whose first line is y 14
    // — already past the 8-row viewport, so the click correctly misses.
    expect(hitIndexForY(mixed, 14)).toBe(-1);
    // A taller viewport reveals it.
    expect(hitIndexForY({ ...mixed, height: 12 }, 14)).toBe(6);
  });
});

describe("mouse constants", () => {
  test("double-click window is a sane duration", () => {
    expect(DOUBLE_CLICK_MS).toBeGreaterThan(100);
    expect(DOUBLE_CLICK_MS).toBeLessThanOrEqual(500);
  });

  test("non-interactive text opts out of text selection", () => {
    expect(NON_INTERACTIVE_TEXT.selectable).toBe(false);
  });
});
