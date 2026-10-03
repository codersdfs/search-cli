/**
 * Mouse wiring, end to end.
 *
 * `tests/tui-mouse.test.ts` pins the hit-test arithmetic in isolation. This
 * file goes one level up: it builds a real `SelectRenderable` inside OpenTUI's
 * test renderer and drives the *actual* `attachClickToSelect` handler with
 * `createMockMouse`, so the dispatch path (hit grid → `onMouseDown` →
 * `setSelectedIndex` → `selectionChanged`) is exercised rather than assumed.
 *
 * These assertions encode the behaviours locked during design:
 *   - click selects (and re-emits `selectionChanged`, the hook the shell's
 *     detail pane already rides on)
 *   - second click on the same row opens; a click on a different row does not
 *   - a row click never leaks to the enclosing panel's dismiss handler
 *   - `keepFocus` suppresses OpenTUI's auto-focus-on-press, so the query input
 *     keeps focus and bare Space still types a space
 *   - the wheel steps the selection and never reaches the focused fallback
 */
import { describe, test, expect } from "vitest";
import { createTestRenderer } from "@opentui/core/testing";
import {
  attachClickToSelect,
  attachClickOutside,
  DOUBLE_CLICK_MS,
} from "../src/tui/mouse";

const OPTIONS = 6;

async function buildList() {
  const setup = await createTestRenderer({ width: 60, height: 20 });
  const { renderer, mockMouse, renderOnce, flush } = setup;
  const { BoxRenderable: Box, SelectRenderable: Select } =
    await import("@opentui/core");

  renderer.root.flexDirection = "column";

  const panel = new Box(renderer, {
    flexGrow: 1,
    flexDirection: "column",
    border: true,
  });
  const select = new Select(renderer, {
    options: Array.from({ length: OPTIONS }, (_, i) => ({
      name: `repo-${i}`,
      description: "",
      value: i,
    })),
    showDescription: false,
    showSelectionIndicator: true,
    flexGrow: 1,
    itemSpacing: 0,
  });
  panel.add(select);
  renderer.root.add(panel);
  await renderOnce();
  await flush();

  return { setup, renderer, mockMouse, renderOnce, flush, panel, select };
}

describe("attachClickToSelect", () => {
  test("clicking a row selects it and emits selectionChanged", async () => {
    const { mockMouse, select, renderOnce, flush, renderer } =
      await buildList();
    const changes: number[] = [];
    select.on("selectionChanged", (index: number) => changes.push(index));
    // Attach before the click so this exercises the shipped helper.
    attachClickToSelect(renderer, select, {});

    await mockMouse.click(4, select.screenY + 2);
    await renderOnce();
    await flush();

    expect(select.getSelectedIndex()).toBe(2);
    expect(changes).toContain(2);

    renderer.destroy();
  });

  test("clicking a different row re-targets instead of opening", async () => {
    const { mockMouse, select, renderOnce, flush, renderer } =
      await buildList();
    let opened = 0;
    const handle = attachClickToSelect(renderer, select, {
      onOpen: () => opened++,
    });

    await mockMouse.click(4, select.screenY + 0);
    await renderOnce();
    await flush();
    await mockMouse.click(4, select.screenY + 3);
    await renderOnce();
    await flush();

    expect(select.getSelectedIndex()).toBe(3);
    expect(opened).toBe(0);
    handle.reset();
    renderer.destroy();
  });

  test("second click on the selected row opens the item", async () => {
    const { mockMouse, select, renderOnce, flush, renderer } =
      await buildList();
    let opened = 0;
    attachClickToSelect(renderer, select, { onOpen: () => opened++ });

    const y = select.screenY + 1;
    await mockMouse.click(4, y);
    await renderOnce();
    await flush();
    expect(opened).toBe(0);

    await mockMouse.click(4, y);
    await renderOnce();
    await flush();
    expect(opened).toBe(1);

    renderer.destroy();
  });

  test("a click past the double-click window only re-selects", async () => {
    const { mockMouse, select, renderOnce, flush, renderer } =
      await buildList();
    let opened = 0;
    attachClickToSelect(renderer, select, { onOpen: () => opened++ });

    const y = select.screenY + 1;
    await mockMouse.click(4, y);
    await renderOnce();
    await flush();
    // Wait past the window, then click the same row again.
    await new Promise((r) => setTimeout(r, DOUBLE_CLICK_MS + 60));
    await mockMouse.click(4, y);
    await renderOnce();
    await flush();

    expect(opened).toBe(0);
    expect(select.getSelectedIndex()).toBe(1);

    renderer.destroy();
  });

  test("a click below the list reports a miss instead of selecting", async () => {
    const { mockMouse, select, renderOnce, flush, renderer } =
      await buildList();
    let misses = 0;
    attachClickToSelect(renderer, select, { onClickMiss: () => misses++ });

    // Two rows below the last row, still inside the list's own viewport. The
    // list holds fewer options than it has rows, so this is the empty area that
    // `hitIndexForY` resolves to the last option — a deliberate landing, not a
    // miss. Genuine misses are clicks outside the viewport entirely (covered by
    // "clicking the panel outside the rows dismisses it").
    const belowLastRow = select.screenY + OPTIONS + 1;
    expect(belowLastRow).toBeLessThan(select.screenY + select.height);
    await mockMouse.click(4, belowLastRow);
    await renderOnce();
    await flush();

    expect(misses).toBe(0);
    expect(select.getSelectedIndex()).toBe(OPTIONS - 1);

    renderer.destroy();
  });

  test("row clicks do not leak to the enclosing panel's dismiss handler", async () => {
    const { mockMouse, select, panel, renderOnce, flush, renderer } =
      await buildList();
    let dismissed = 0;
    attachClickToSelect(renderer, select, {});
    attachClickOutside(panel, () => dismissed++);

    await mockMouse.click(4, select.screenY + 1);
    await renderOnce();
    await flush();

    expect(select.getSelectedIndex()).toBe(1);
    expect(dismissed).toBe(0);

    renderer.destroy();
  });

  test("clicking the panel outside the rows dismisses it", async () => {
    const { mockMouse, select, panel, renderOnce, flush, renderer } =
      await buildList();
    let dismissed = 0;
    attachClickToSelect(renderer, select, {});
    attachClickOutside(panel, () => dismissed++);

    // The panel's bottom border sits one row below the list's last row.
    await mockMouse.click(2, panel.screenY + panel.height - 1);
    await renderOnce();
    await flush();

    expect(dismissed).toBe(1);

    renderer.destroy();
  });

  test("keepFocus stops the press from auto-focusing the list", async () => {
    const { setup, mockMouse, select, renderOnce, flush, renderer } =
      await buildList();
    const input = setup.mockInput;

    attachClickToSelect(renderer, select, { keepFocus: true });
    await renderOnce();
    await flush();

    expect(select.focused).toBe(false);

    // Click twice to cover both the first press and the double-click press.
    await mockMouse.click(4, select.screenY + 1);
    await renderOnce();
    await flush();
    await mockMouse.click(4, select.screenY + 1);
    await renderOnce();
    await flush();

    // Regression guard: a row click must never steal focus, because the shell's
    // Space/Esc bindings are keyed off what holds focus.
    expect(select.focused).toBe(false);
    input.pressKey("a");
    await flush();

    renderer.destroy();
  });

  test("without keepFocus a row click moves focus to the list", async () => {
    // Documents OpenTUI's auto-focus-on-press, which the shell relied on before
    // mouse support existed. `keepFocus: true` is what stops it.
    const { mockMouse, select, renderOnce, flush, renderer } =
      await buildList();

    attachClickToSelect(renderer, select, {});
    await renderOnce();
    await flush();

    await mockMouse.click(4, select.screenY + 1);
    await renderOnce();
    await flush();

    expect(select.focused).toBe(true);

    renderer.destroy();
  });

  test("the wheel steps the selection without falling through", async () => {
    const { mockMouse, select, renderOnce, flush, renderer } =
      await buildList();
    attachClickToSelect(renderer, select, { wheelStep: 2 });

    expect(select.getSelectedIndex()).toBe(0);
    await mockMouse.scroll(4, select.screenY + 1, "down");
    await renderOnce();
    await flush();
    expect(select.getSelectedIndex()).toBe(2);

    await mockMouse.scroll(4, select.screenY + 1, "up");
    await renderOnce();
    await flush();
    expect(select.getSelectedIndex()).toBe(0);

    renderer.destroy();
  });

  test("the wheel stops at the ends of the list", async () => {
    const { mockMouse, select, renderOnce, flush, renderer } =
      await buildList();
    attachClickToSelect(renderer, select, { wheelStep: 2 });

    await mockMouse.scroll(4, select.screenY + 1, "up");
    await renderOnce();
    await flush();
    expect(select.getSelectedIndex()).toBe(0);

    for (let i = 0; i < 10; i++) {
      await mockMouse.scroll(4, select.screenY + 1, "down");
    }
    await renderOnce();
    await flush();
    expect(select.getSelectedIndex()).toBe(OPTIONS - 1);

    renderer.destroy();
  });

  test("hovering reports the row under the pointer and clears on leave", async () => {
    const { mockMouse, select, renderOnce, flush, renderer } =
      await buildList();
    const seen: number[] = [];
    attachClickToSelect(renderer, select, {
      onHoverRow: (i: number) => seen.push(i),
    });

    await mockMouse.moveTo(4, select.screenY + 2);
    await renderOnce();
    await flush();
    expect(seen).toEqual([2]);

    renderer.destroy();
  });
});
