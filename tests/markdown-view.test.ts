import { describe, expect, test } from "vitest";
import { createMarkdownView } from "../src/markdown-view";
import { createTestRenderer } from "./trending.test.util.ts";
import { extractImageRefs, type BlockTokenLike } from "../src/markdown-images";

async function setupView() {
  return setupViewWithLoader(async () => new Uint8Array());
}

async function setupViewWithLoader(
  loader: (url: string) => Promise<Uint8Array | null>,
) {
  const setup = await createTestRenderer({ width: 80, height: 40 });
  const { renderer, flush, waitFor } = setup;
  renderer.start();
  const view = createMarkdownView({
    renderer,
    colors: {
      bg: "#000000",
      text: "#ffffff",
      accent: "#00ff88",
      surface: "#111111",
      muted: "#555555",
    },
    loadImage: loader,
    getImageWidth: () => 28,
  });
  return { renderer, flush, waitFor, view };
}

/**
 * Collect the text of every renderable under `node`. Content is either a
 * plain string or a StyledText whose chunks carry the text.
 */
function collectText(node: { getChildren: () => unknown[] }): string[] {
  const texts: string[] = [];
  const walk = (current: { getChildren: () => unknown[] }): void => {
    for (const child of current.getChildren()) {
      const maybe = child as {
        content?: unknown;
        getChildren?: () => unknown[];
      };
      const content = maybe.content as
        string | { chunks?: Array<{ text?: string }> } | undefined;
      if (typeof content === "string") {
        texts.push(content);
      } else if (content && Array.isArray(content.chunks)) {
        texts.push(content.chunks.map((c) => c.text ?? "").join(""));
      }
      if (typeof maybe.getChildren === "function") walk(maybe as never);
    }
  };
  walk(node);
  return texts;
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
    process.stderr.write = (chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    };
    view.setContent(
      "![alt](https://example.com/img.png)",
      "https://example.com/0",
    );
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
      tokens: [
        { type: "image", text: "logo", href: "https://example.com/logo.png" },
      ],
    };
    expect(extractImageRefs(token)).toEqual([
      { href: "https://example.com/logo.png", alt: "logo" },
    ]);
  });

  test("returns null for prose paragraph", () => {
    const token: BlockTokenLike = {
      type: "paragraph",
      raw: "Some text without images.",
      tokens: [{ type: "text", text: "Some text without images." }],
    };
    expect(extractImageRefs(token)).toBeNull();
  });

  test("linked-image block routes to the image node, not prose", () => {
    const token: BlockTokenLike = {
      type: "paragraph",
      tokens: [
        {
          type: "link",
          href: "https://opencode.ai",
          tokens: [
            { type: "image", href: "shot.png", text: "OpenCode Terminal UI" },
          ],
        },
      ],
    };
    // sst/opencode renders its hero exactly like this; before the link
    // recursion fix the whole block was treated as prose and dropped.
    expect(extractImageRefs(token)).toEqual([
      {
        href: "shot.png",
        alt: "OpenCode Terminal UI",
        linkUrl: "https://opencode.ai",
      },
    ]);
  });
});

describe("markdown-view image nodes", () => {
  test("linked image builds an image container, not prose", async () => {
    const { renderer, flush, view } = await setupView();
    view.setContent(
      "[![OpenCode Terminal UI](https://example.com/shot.png)](https://opencode.ai)",
      "https://example.com/0",
    );
    // Blocks are built on render, not synchronously in setContent.
    await flush();
    const joined = collectText(view.renderable).join("\n");
    // The image node renders the 🖼 alt caption (the load itself fails on
    // empty bytes, which is fine); prose rendering would show the raw
    // markdown markers instead.
    expect(joined).toContain("OpenCode Terminal UI");
    expect(joined).toContain("🖼");
    expect(joined).not.toContain("](");
    renderer.destroy();
  });
});
