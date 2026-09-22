import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CELL_ASPECT,
  HALF_BLOCK,
  fitImageToCells,
  rasterizeImage,
  toHalfBlocks,
  toImageRuns,
} from "../src/image-render";
import type { DecodedImage } from "../src/png";

function image(width: number, height: number, rgba: number[]): DecodedImage {
  return { width, height, data: new Uint8Array(rgba) };
}

describe("fitImageToCells", () => {
  test("uses the whole width budget for a square image", () => {
    expect(fitImageToCells(100, 100, { maxCols: 40, maxRows: 24 })).toEqual({
      cols: 40,
      rows: 20,
    });
  });

  test("shrinks width when the height cap binds", () => {
    const fit = fitImageToCells(100, 400, { maxCols: 40, maxRows: 24 });
    expect(fit.rows).toBe(24);
    expect(fit.cols).toBe(12);
  });

  test("keeps short images flat", () => {
    expect(fitImageToCells(400, 100, { maxCols: 40, maxRows: 24 })).toEqual({
      cols: 40,
      rows: 5,
    });
  });

  test("never goes below a readable minimum width", () => {
    const fit = fitImageToCells(10, 1000, { maxCols: 40, maxRows: 4 });
    expect(fit.cols).toBeGreaterThanOrEqual(8);
    expect(fit.rows).toBe(4);
  });

  test("handles empty dimensions", () => {
    expect(fitImageToCells(0, 0, { maxCols: 40, maxRows: 24 }).rows).toBe(1);
  });

  test("honours a custom cell aspect", () => {
    const square = fitImageToCells(100, 100, {
      maxCols: 40,
      maxRows: 99,
      cellAspect: 1,
    });
    expect(square).toEqual({ cols: 40, rows: 40 });
    expect(DEFAULT_CELL_ASPECT).toBe(0.5);
  });
});

describe("toHalfBlocks", () => {
  test("stacks two pixel rows per cell", () => {
    const img = image(2, 2, [
      255,
      0,
      0,
      255,
      0,
      0,
      255,
      255, // top: red, blue
      0,
      255,
      0,
      255,
      255,
      255,
      255,
      255, // bottom: green, white
    ]);
    const cells = toHalfBlocks(img);
    expect(cells.rows).toBe(1);
    expect(cells.cols).toBe(2);
    expect(cells.cells[0][0]).toEqual({
      top: [255, 0, 0],
      bottom: [0, 255, 0],
    });
    expect(cells.cells[0][1]).toEqual({
      top: [0, 0, 255],
      bottom: [255, 255, 255],
    });
  });

  test("repeats the last pixel for an odd row count", () => {
    const cells = toHalfBlocks(image(1, 1, [12, 34, 56, 255]));
    expect(cells.rows).toBe(1);
    expect(cells.cells[0][0]).toEqual({
      top: [12, 34, 56],
      bottom: [12, 34, 56],
    });
  });

  test("composites translucent pixels onto the background", () => {
    const cells = toHalfBlocks(image(1, 2, [255, 0, 0, 255, 0, 0, 255, 0]), {
      background: [0, 0, 0],
    });
    expect(cells.cells[0][0].top).toEqual([255, 0, 0]);
    expect(cells.cells[0][0].bottom).toEqual([0, 0, 0]);

    const half = toHalfBlocks(image(1, 2, [255, 255, 255, 255, 0, 0, 0, 128]), {
      background: [0, 0, 0],
    });
    expect(half.cells[0][0].bottom).toEqual([0, 0, 0]);
  });
});

describe("toImageRuns", () => {
  test("merges neighbouring cells with the same colours", () => {
    const img = image(3, 2, [
      255,
      0,
      0,
      255,
      255,
      0,
      0,
      255,
      0,
      255,
      0,
      255, // top
      0,
      0,
      255,
      255,
      0,
      0,
      255,
      255,
      0,
      255,
      0,
      255, // bottom
    ]);
    const runs = toImageRuns(toHalfBlocks(img));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual([
      {
        text: `${HALF_BLOCK}${HALF_BLOCK}`,
        top: [255, 0, 0],
        bottom: [0, 0, 255],
      },
      { text: HALF_BLOCK, top: [0, 255, 0], bottom: [0, 255, 0] },
    ]);
  });
});

describe("rasterizeImage", () => {
  const ImageCtor = (Bun as { Image?: unknown }).Image;
  const maybe = typeof ImageCtor === "function" ? test : test.skip;

  maybe("scales and converts a real image", async () => {
    // 8×4 BMP: red on the left half, blue on the right.
    const bmp = bmp24(8, 4, (x) => (x < 4 ? [255, 0, 0] : [0, 0, 255]));
    const cells = await rasterizeImage(bmp, { maxCols: 8, maxRows: 4 });
    expect(cells).not.toBeNull();
    expect(cells!.cols).toBe(8);
    expect(cells!.rows).toBe(2);
    const left = cells!.cells[0][0].top;
    const right = cells!.cells[0][7].top;
    expect(left[0]).toBeGreaterThan(200);
    expect(left[2]).toBeLessThan(60);
    expect(right[2]).toBeGreaterThan(200);
  });

  maybe("returns null for bytes that aren't an image", async () => {
    expect(
      await rasterizeImage(new Uint8Array([1, 2, 3]), {
        maxCols: 8,
        maxRows: 4,
      }),
    ).toBeNull();
  });
});

function bmp24(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowSize * height;
  const out = new Uint8Array(54 + pixelSize);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, 54 + pixelSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelSize, true);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const o = 54 + (height - 1 - y) * rowSize + x * 3;
      out[o] = b;
      out[o + 1] = g;
      out[o + 2] = r;
    }
  }
  return out;
}
