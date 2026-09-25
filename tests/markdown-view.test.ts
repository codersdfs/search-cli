
import { describe, expect, test } from "vitest";
import { createMarkdownView } from "../src/markdown-view";
import { createTestRenderer } from "./trending.test.util.ts";
import { extractImageRefs, type BlockTokenLike } from "../src/markdown-images";

async function setupView() {
  const setup = await createTestRenderer({ width: 80, height: 40 });
  const { renderer } = setup;
  renderer.start();
  const view = createMarkdownView({
    renderer,
    colors: { bg: "#000000", text: "#ffffff", accent: "#00ff88", surface: "#111111", muted: "#555555" },
    loadImage: async () => new Uint8Array(),
    getImageWidth: () => 28,
  });
  return { renderer, view };
}

describe("markdown-view setContent", () => {
  test("finalizes streaming after setting content", async () => {
    const { renderer, view } = await setupView();
    expect(view.renderable.streaming).toBe(true);
    view.setContent("# hello", "https://example.com/0");
    expect(view.renderable.streaming).toBe(false);
    renderer.destroy();
  });

  test("does not emit dbg logs to stderr", async () => {
    const { renderer, view } = await setupView();
    const chunks: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { chunks.push(String(chunk)); return true; };
    view.setContent("![alt](https://example.com/img.png)", "https://example.com/0");
    process.stderr.write = orig;
    renderer.destroy();
    expect(chunks.join("")).not.toContain("[dbg]");
  });
});

describe("extractImageRefs", () => {
  test("extracts single image from paragraph", () => {
    const token: BlockTokenLike = {
      type: "paragraph",
      raw: "![logo](https://example.com/logo.png)",
      tokens: [{ type: "image", text: "logo", href: "https://example.com/logo.png" }],
    };
    expect(extractImageRefs(token)).toEqual([{ href: "https://example.com/logo.png", alt: "logo" }]);
  });

  test("returns null for prose paragraph", () => {
    const token: BlockTokenLike = {
      type: "paragraph",
      raw: "Some text without images.",
      tokens: [{ type: "text", text: "Some text without images." }],
    };
    expect(extractImageRefs(token)).toBeNull();
  });
});
