import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createTestRenderer } from "@opentui/core/testing";
import { RGBA } from "@opentui/core";
import { createToast } from "../src/toast.ts";

const COLORS = {
  green: "#a6e3a1",
  yellow: "#f9e2af",
  text: "#e0e4f0",
  surfaceDim: "#1a1919",
};

describe("toast", () => {
  let cleanup: () => void;
  let setup: Awaited<ReturnType<typeof createTestRenderer>>;

  beforeEach(async () => {
    setup = await createTestRenderer({ width: 80, height: 24 });
    cleanup = setup.destroy ?? (() => {});
  });
  afterEach(() => cleanup());

  async function frame(): Promise<string> {
    await setup.renderOnce();
    return setup.captureCharFrame();
  }

  test("renders message in a rounded bordered card pinned top-right", async () => {
    const toast = createToast(setup.renderer, setup.renderer.root, COLORS);
    toast.show("★ Bookmarked owner/repo");
    const f = await frame();
    expect(f).toContain("★ Bookmarked owner/repo");
    // Rounded border corners present
    expect(f).toContain("╭");
    expect(f).toContain("╯");
    // Pinned to the top-right region of the frame
    const lines = f.split("\n");
    const row = lines.findIndex((l) => l.includes("★ Bookmarked"));
    expect(row).toBeGreaterThanOrEqual(1); // below row 0
    const col = lines[row].indexOf("★ Bookmarked");
    expect(col).toBeGreaterThan(40); // right half of an 80-col frame
  });

  test("hidden by default and disappears after hide()", async () => {
    const toast = createToast(setup.renderer, setup.renderer.root, COLORS);
    expect(toast.visible).toBe(false);
    expect(await frame()).not.toContain("Bookmarked");

    toast.show("★ Bookmarked owner/repo");
    expect((await frame())).toContain("Bookmarked");

    toast.hide();
    expect(toast.visible).toBe(false);
    expect(await frame()).not.toContain("Bookmarked");
  });

  test("auto-hides after the timeout", async () => {
    const toast = createToast(setup.renderer, setup.renderer.root, COLORS);
    toast.show("★ Bookmarked owner/repo", 30);
    expect((await frame())).toContain("Bookmarked");
    await new Promise((r) => setTimeout(r, 80));
    expect(toast.visible).toBe(false);
    expect(await frame()).not.toContain("Bookmarked");
  });

  test("re-showing resets the hide timer", async () => {
    const toast = createToast(setup.renderer, setup.renderer.root, COLORS);
    toast.show("first", 50);
    await new Promise((r) => setTimeout(r, 30));
    toast.show("second", 50); // resets timer at t=30ms; would fire at t=80
    await new Promise((r) => setTimeout(r, 40)); // t=70 — original timer would have fired
    expect(toast.visible).toBe(true);
    expect((await frame())).toContain("second");
    await new Promise((r) => setTimeout(r, 60)); // t=130 — reset timer has fired
    expect(toast.visible).toBe(false);
  });

  test("accent overrides border color (green bookmark vs yellow unbookmark)", async () => {
    const toast = createToast(setup.renderer, setup.renderer.root, COLORS);
    toast.show("★ Bookmarked r");
    expect(String(toast.borderColor)).toBe(String(RGBA.fromHex(COLORS.green)));
    toast.show("☆ Unbookmarked r", 2000, COLORS.yellow);
    expect(String(toast.borderColor)).toBe(String(RGBA.fromHex(COLORS.yellow)));
  });

  test("width hugs the message", async () => {
    const toast = createToast(setup.renderer, setup.renderer.root, COLORS);
    toast.show("hi"); // width = 2 + 4 = 6
    const lines = (await frame()).split("\n");
    const boxLine = lines.find((l) => l.includes("╭"))!;
    // Border run for this card should be exactly 6 chars wide
    const m = boxLine.match(/╭─+╮/);
    expect(m![0].length).toBe(6);
  });
});
