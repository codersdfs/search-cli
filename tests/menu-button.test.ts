/**
 * Menu button geometry.
 *
 * The button is absolutely positioned in the bottom-right corner, so its
 * placement is a layout concern that a pure unit test cannot cover. This builds
 * the same renderable shape against OpenTUI's test renderer and asserts it
 * actually lands in the corner — a `bottom`/`right` mistake (wrong property
 * name, or `bottom` unsupported) would silently render it off-screen or at the
 * top-left, and the app would look like it had no button at all.
 */
import { describe, test, expect } from "vitest";
import { createTestRenderer } from "@opentui/core/testing";
import { NON_INTERACTIVE_TEXT } from "../src/tui/mouse";

const WIDTH = 80;
const HEIGHT = 24;

async function buildButton() {
  const setup = await createTestRenderer({ width: WIDTH, height: HEIGHT });
  const { renderer, mockMouse, renderOnce, flush, captureCharFrame } = setup;
  const { BoxRenderable: Box, TextRenderable: Text } =
    await import("@opentui/core");

  renderer.root.flexDirection = "column";
  // A filler row so the button has real layout to overlay.
  const filler = new Text(renderer, { content: "x".repeat(WIDTH), height: 20 });
  renderer.root.add(filler);

  const button = new Box(renderer, {
    position: "absolute",
    bottom: 1,
    right: 1,
    height: 1,
    paddingX: 1,
    focusable: false,
  });
  const label = new Text(renderer, {
    ...NON_INTERACTIVE_TEXT,
    content: "☰ menu",
    height: 1,
  });
  button.add(label);
  renderer.root.add(button);
  await renderOnce();
  await flush();

  return {
    setup,
    renderer,
    mockMouse,
    renderOnce,
    flush,
    captureCharFrame,
    button,
    label,
  };
}

describe("menu button placement", () => {
  test("lands in the bottom-right corner of the root", async () => {
    const { renderer, button, captureCharFrame } = await buildButton();

    // It must be on the last row, not the first.
    expect(button.screenY).toBeGreaterThanOrEqual(HEIGHT - 2);
    expect(button.screenY).toBeLessThan(HEIGHT);

    // Its right edge must touch the viewport's right edge.
    const rightEdge = button.screenX + button.width;
    expect(rightEdge).toBeLessThanOrEqual(WIDTH);
    expect(rightEdge).toBeGreaterThan(WIDTH - 10);

    // And it must be horizontally offset (right-aligned, not full-width).
    expect(button.screenX).toBeGreaterThan(WIDTH - 12);

    const frame = captureCharFrame();
    expect(frame).toContain("☰ menu");
    expect(frame.split("\n").length).toBeGreaterThan(0);

    renderer.destroy();
  });

  test("the label is rendered inside the button bounds", async () => {
    const { renderer, button, label, captureCharFrame } = await buildButton();

    expect(label.screenX).toBeGreaterThanOrEqual(button.screenX);
    expect(label.screenY).toBeGreaterThanOrEqual(button.screenY);
    expect(label.screenX).toBeLessThan(button.screenX + button.width);

    expect(captureCharFrame()).toContain("☰ menu");

    renderer.destroy();
  });

  test("clicking it fires the handler and stops propagation", async () => {
    const { renderer, mockMouse, button, renderOnce, flush } =
      await buildButton();

    let clicked = 0;
    let bubbled = 0;
    button.onMouseDown = (event) => {
      event.stopPropagation();
      clicked++;
    };
    // A sibling that would receive the event if propagation were not stopped.
    renderer.root.onMouseDown = () => bubbled++;

    await mockMouse.click(button.screenX + 2, button.screenY);
    await renderOnce();
    await flush();

    expect(clicked).toBe(1);
    expect(bubbled).toBe(0);

    renderer.destroy();
  });

  test("hidden buttons do not render or receive clicks", async () => {
    const { renderer, mockMouse, button, renderOnce, flush, captureCharFrame } =
      await buildButton();

    let clicked = 0;
    button.onMouseDown = () => clicked++;
    button.visible = false;
    await renderOnce();
    await flush();

    expect(captureCharFrame()).not.toContain("☰ menu");

    // Clicking where it used to be must not reach a hidden renderable.
    await mockMouse.click(button.screenX + 2, button.screenY);
    await renderOnce();
    await flush();
    expect(clicked).toBe(0);

    renderer.destroy();
  });
});
