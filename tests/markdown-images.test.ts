import { describe, expect, test } from "bun:test";
import { extractImageRefs, inlinePlainText } from "../src/markdown-images";

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

  test("ignores images wrapped in emphasis or links", () => {
    expect(
      extractImageRefs({
        type: "paragraph",
        tokens: [
          {
            type: "link",
            href: "https://ci.example.com",
            tokens: [{ type: "image", href: "badge.png", text: "CI" }],
          },
        ],
      }),
    ).toBeNull();
  });

  test("finds images embedded as HTML", () => {
    expect(
      extractImageRefs({
        type: "html",
        raw: '<img src="docs/demo.gif" alt="Demo" width="600" />',
      }),
    ).toEqual([{ href: "docs/demo.gif", alt: "Demo" }]);
  });

  test("tolerates wrapper markup but not captions", () => {
    expect(
      extractImageRefs({
        type: "html",
        raw: '<p align="center"><img src="a.png"><br/><img src="b.png"></p>',
      }),
    ).toEqual([
      { href: "a.png", alt: "" },
      { href: "b.png", alt: "" },
    ]);
    expect(
      extractImageRefs({
        type: "html",
        raw: '<img src="a.png"> a caption',
      }),
    ).toBeNull();
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
