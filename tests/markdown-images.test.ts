import { describe, expect, test } from "bun:test";
import {
  declaredImageSize,
  declaresTooSmall,
  extractImageRefs,
  inlinePlainText,
  MIN_IMAGE_PIXELS,
} from "../src/markdown-images";

describe("extractImageRefs", () => {
  test("finds a lone markdown image", () => {
    expect(
      extractImageRefs({
        type: "paragraph",
        tokens: [{ type: "image", href: "docs/a.png", text: "Screenshot" }],
      }),
    ).toEqual([{ href: "docs/a.png", alt: "Screenshot" }]);
  });

  test("accepts an image token on its own", () => {
    expect(
      extractImageRefs({ type: "image", href: "a.png", text: "" }),
    ).toEqual([{ href: "a.png", alt: "" }]);
  });

  test("finds several images separated by whitespace", () => {
    expect(
      extractImageRefs({
        type: "paragraph",
        tokens: [
          { type: "image", href: "a.png", text: "A" },
          { type: "text", text: "\n" },
          { type: "image", href: "b.png", text: "B" },
        ],
      }),
    ).toEqual([
      { href: "a.png", alt: "A" },
      { href: "b.png", alt: "B" },
    ]);
  });

  test("ignores paragraphs that mix images with prose", () => {
    expect(
      extractImageRefs({
        type: "paragraph",
        tokens: [
          { type: "text", text: "See " },
          { type: "image", href: "a.png", text: "A" },
        ],
      }),
    ).toBeNull();
  });

  test("extracts an image wrapped in a link, keeping the link", () => {
    // sst/opencode: `[![alt](img)](url)` rendered nothing before — the link
    // token fell through `collect()` and the whole block became prose.
    expect(
      extractImageRefs({
        type: "paragraph",
        tokens: [
          {
            type: "link",
            href: "https://example.com",
            tokens: [{ type: "image", href: "shot.png", text: "Shot" }],
          },
        ],
      }),
    ).toEqual([
      {
        href: "shot.png",
        alt: "Shot",
        linkUrl: "https://example.com",
      },
    ]);
  });

  test("a link whose content is prose still disqualifies the block", () => {
    expect(
      extractImageRefs({
        type: "paragraph",
        tokens: [
          {
            type: "link",
            href: "https://example.com",
            tokens: [{ type: "text", text: "Docs" }],
          },
        ],
      }),
    ).toBeNull();
  });

  test("nested links take the innermost href", () => {
    expect(
      extractImageRefs({
        type: "paragraph",
        tokens: [
          {
            type: "link",
            href: "https://outer.example.com",
            tokens: [
              {
                type: "link",
                href: "https://inner.example.com",
                tokens: [{ type: "image", href: "a.png", text: "A" }],
              },
            ],
          },
        ],
      }),
    ).toEqual([
      { href: "a.png", alt: "A", linkUrl: "https://inner.example.com" },
    ]);
  });

  test("finds images embedded as HTML", () => {
    expect(
      extractImageRefs({
        type: "html",
        raw: '<img src="docs/demo.gif" alt="Demo" width="600" />',
      }),
    ).toEqual([
      {
        href: "docs/demo.gif",
        alt: "Demo",
        declared: { width: 600, height: 600 },
      },
    ]);
  });

  test("reads declared width/height from img tags", () => {
    expect(
      declaredImageSize('<img src="a.png" width="48" height="48">'),
    ).toEqual({ width: 48, height: 48 });
    expect(declaredImageSize('<img src="a.png" width="48px">')).toEqual({
      width: 48,
      height: 48,
    });
    expect(declaredImageSize('<img src="a.png" width="100%">')).toBeUndefined();
    expect(
      declaredImageSize('<img src="a.png" width="600" height="200">'),
    ).toEqual({ width: 600, height: 200 });
    expect(declaredImageSize('<img src="a.png">')).toBeUndefined();
    expect(declaredImageSize('<img src="a.png" width="abc">')).toBeUndefined();
  });

  test("tolerates wrapper markup but not captions", () => {
    expect(
      extractImageRefs({
        type: "html",
        raw: '<p align="center"><img src="a.png"><br/><img src="b.png"></p>',
      }),
    ).toEqual([
      { href: "a.png", alt: "", declared: undefined },
      { href: "b.png", alt: "", declared: undefined },
    ]);
    expect(
      extractImageRefs({
        type: "html",
        raw: '<img src="a.png"> a caption',
      }),
    ).toBeNull();
  });

  test("drops img tags that declare an edge under the size floor", () => {
    expect(
      extractImageRefs({
        type: "html",
        raw: '<img src="a.png" width="48">',
      }),
    ).toEqual([]);
    // Mixed block: the small one is dropped, the large one survives.
    expect(
      extractImageRefs({
        type: "html",
        raw: '<img src="a.png" width="48"><img src="b.png" width="600">',
      }),
    ).toEqual([
      { href: "b.png", alt: "", declared: { width: 600, height: 600 } },
    ]);
  });

  test("a markdown image cannot declare a size", () => {
    // Markdown images carry no size attributes, so they are never filtered
    // at parse time — the pixel check in image-loader decides after the
    // download instead.
    expect(
      extractImageRefs({
        type: "paragraph",
        tokens: [{ type: "image", href: "badge.png", text: "" }],
      }),
    ).toEqual([{ href: "badge.png", alt: "" }]);
  });

  test("MIN_IMAGE_PIXELS floor is 100, on any edge", () => {
    expect(MIN_IMAGE_PIXELS).toBe(100);
    // Any edge under the floor skips the image — a 99x999 sliver is as
    // unreadable at cell resolution as a 48x48 avatar.
    expect(declaresTooSmall({ width: 99, height: 999 })).toBe(true);
    expect(declaresTooSmall({ width: 600, height: 99 })).toBe(true);
    expect(declaresTooSmall({ width: 100, height: 100 })).toBe(false);
    expect(declaresTooSmall({ width: 600, height: 200 })).toBe(false);
    expect(declaresTooSmall(undefined)).toBe(false);
  });

  test("allows inline <br> next to a markdown image", () => {
    expect(
      extractImageRefs({
        type: "paragraph",
        tokens: [
          { type: "image", href: "a.png", text: "A" },
          { type: "html", raw: "<br>" },
        ],
      }),
    ).toEqual([{ href: "a.png", alt: "A" }]);
  });

  test("returns null when there are no images at all", () => {
    expect(
      extractImageRefs({
        type: "paragraph",
        tokens: [{ type: "text", text: "plain" }],
      }),
    ).toBeNull();
    expect(extractImageRefs({ type: "paragraph" })).toBeNull();
  });
});

describe("inlinePlainText", () => {
  test("flattens nested inline tokens", () => {
    expect(
      inlinePlainText([
        { type: "text", text: "Install " },
        {
          type: "strong",
          tokens: [
            { type: "text", text: "gh" },
            { type: "codespan", text: "find" },
          ],
        },
      ]),
    ).toBe("Install ghfind");
  });

  test("skips images, keeps link labels and strips raw HTML", () => {
    expect(
      inlinePlainText([
        { type: "image", href: "a.png", text: "Logo" },
        { type: "link", tokens: [{ type: "text", text: "Docs" }] },
        { type: "html", raw: "<kbd>" },
        { type: "br" },
      ]),
    ).toBe("Docs\n");
  });

  test("falls back to raw text when no children exist", () => {
    expect(inlinePlainText([{ type: "text", text: "hello" }])).toBe("hello");
    expect(inlinePlainText(undefined)).toBe("");
  });
});
