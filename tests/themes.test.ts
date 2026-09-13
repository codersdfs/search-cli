import { describe, expect, test } from "bun:test";
import { parseOscColor, mixHex, isDarkHex, deriveSurfaceLayers } from "../src/themes";

describe("parseOscColor", () => {
  test("parses Windows Terminal's real OSC 11 reply", () => {
    // Captured from a live WT session: ESC ] 11 ; rgb:0c0c/0c0c/0c0c ESC \
    expect(parseOscColor("rgb:0c0c/0c0c/0c0c")).toBe("#0c0c0c");
  });

  test("parses 16-bit channels scaled to 8-bit", () => {
    expect(parseOscColor("rgb:ffff/ffff/ffff")).toBe("#ffffff");
    expect(parseOscColor("rgb:1a1b/2626/3838")).toBe("#1a2638");
  });

  test("parses 8-bit and 4-bit channels", () => {
    expect(parseOscColor("rgb:1a/1b/26")).toBe("#1a1b26");
    expect(parseOscColor("rgb:f/0/0")).toBe("#ff0000");
  });

  test("ignores alpha component of rgba replies", () => {
    expect(parseOscColor("rgba:0c0c/0c0c/0c0c/ffff")).toBe("#0c0c0c");
  });

  test("tolerates surrounding whitespace", () => {
    expect(parseOscColor("  rgb:1a/1b/26  ")).toBe("#1a1b26");
  });

  test("returns null for malformed specs", () => {
    expect(parseOscColor("")).toBe(null);
    expect(parseOscColor("rgb:1a/1b")).toBe(null);
    expect(parseOscColor("#1a1b26")).toBe(null);
    expect(parseOscColor("rgb:zz/11/22")).toBe(null);
    expect(parseOscColor("rgb:1a1b26")).toBe(null);
  });
});

describe("mixHex", () => {
  test("t=0 returns a, t=1 returns b", () => {
    expect(mixHex("#0c0c0c", "#ffffff", 0)).toBe("#0c0c0c");
    expect(mixHex("#0c0c0c", "#ffffff", 1)).toBe("#ffffff");
  });

  test("midpoint is rounded to nearest 8-bit value", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  test("expands 3-digit hex", () => {
    expect(mixHex("#fff", "#000", 1)).toBe("#000000");
    expect(mixHex("#0c0c0c", "#fff", 0)).toBe("#0c0c0c");
  });

  test("returns the first color unchanged on invalid input", () => {
    expect(mixHex("#123456", "nope", 0.5)).toBe("#123456");
    expect(mixHex("nope", "#ffffff", 0.5)).toBe("nope");
  });

  test("real layered values off Windows Terminal's #0c0c0c", () => {
    // 12 + 243*0.045 = 22.935 → 23 → 0x17
    expect(mixHex("#0c0c0c", "#ffffff", 0.045)).toBe("#171717");
    // 12 * 0.85 = 10.2 → 10 → 0x0a
    expect(mixHex("#0c0c0c", "#000000", 0.15)).toBe("#0a0a0a");
  });
});

describe("isDarkHex", () => {
  test("classifies dark backgrounds", () => {
    expect(isDarkHex("#0c0c0c")).toBe(true);
    expect(isDarkHex("#1a1b26")).toBe(true);
    expect(isDarkHex("#000000")).toBe(true);
  });

  test("classifies light backgrounds", () => {
    expect(isDarkHex("#ffffff")).toBe(false);
    expect(isDarkHex("#f0f0f0")).toBe(false);
    expect(isDarkHex("#808080")).toBe(false);
  });

  test("is false on invalid input", () => {
    expect(isDarkHex("nope")).toBe(false);
  });
});

describe("deriveSurfaceLayers", () => {
  test("returns null for light or invalid backgrounds", () => {
    expect(deriveSurfaceLayers("#ffffff")).toBe(null);
    expect(deriveSurfaceLayers("#808080")).toBe(null);
    expect(deriveSurfaceLayers("nope")).toBe(null);
  });

  test("layers are distinct steps above the terminal background", () => {
    const layers = deriveSurfaceLayers("#0c0c0c");
    expect(layers).not.toBe(null);
    if (!layers) return;
    const lum = (hex: string) => {
      const h = hex.slice(1);
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    // Sunken modal darker than the backdrop; surfaces and borders above it.
    expect(lum(layers.surfaceDim)).toBeLessThan(lum("#0c0c0c"));
    expect(lum(layers.surface)).toBeGreaterThan(lum("#0c0c0c"));
    expect(lum(layers.surfaceAlt)).toBeGreaterThan(lum(layers.surface));
    expect(lum(layers.border)).toBeGreaterThan(lum(layers.surfaceAlt));
    // Every layer stays well below text-level brightness — subtle tints only.
    for (const value of Object.values(layers)) {
      expect(lum(value)).toBeLessThan(0.25);
    }
  });

  test("covers every chrome key callers rely on", () => {
    const layers = deriveSurfaceLayers("#0c0c0c");
    expect(Object.keys(layers ?? {}).sort()).toEqual(
      ["border", "borderAccent", "borderAlt", "separator", "surface", "surfaceAlt", "surfaceDim"].sort(),
    );
  });
});
