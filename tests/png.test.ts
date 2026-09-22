import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { decodePng } from "../src/png";

// ── Tiny PNG encoder, just enough to build fixtures ──────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

interface PngSpec {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** One entry per row, each starting with its filter byte. */
  scanlines: Uint8Array[];
  palette?: Uint8Array;
  trns?: Uint8Array;
  interlace?: number;
}

function encodePng(spec: PngSpec): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, spec.width);
  view.setUint32(4, spec.height);
  ihdr[8] = spec.bitDepth;
  ihdr[9] = spec.colorType;
  ihdr[12] = spec.interlace ?? 0;

  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
  ];
  if (spec.palette) parts.push(chunk("PLTE", spec.palette));
  if (spec.trns) parts.push(chunk("tRNS", spec.trns));

  const raw = new Uint8Array(
    spec.scanlines.reduce((sum, line) => sum + line.length, 0),
  );
  let offset = 0;
  for (const line of spec.scanlines) {
    raw.set(line, offset);
    offset += line.length;
  }
  parts.push(chunk("IDAT", new Uint8Array(deflateSync(raw))));
  parts.push(chunk("IEND", new Uint8Array(0)));

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const png = new Uint8Array(total);
  offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** Apply a PNG scanline filter to raw samples. */
function filterRows(
  raw: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
  pngFilter: number,
): Uint8Array[] {
  const rowLength = width * bytesPerPixel;
  const lines: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const line = new Uint8Array(rowLength + 1);
    line[0] = pngFilter;
    for (let x = 0; x < rowLength; x++) {
      const value = raw[y * rowLength + x];
      const left =
        x >= bytesPerPixel ? raw[y * rowLength + x - bytesPerPixel] : 0;
      const up = y > 0 ? raw[(y - 1) * rowLength + x] : 0;
      const upLeft =
        y > 0 && x >= bytesPerPixel
          ? raw[(y - 1) * rowLength + x - bytesPerPixel]
          : 0;
      let filtered = value;
      if (pngFilter === 1) filtered = value - left;
      if (pngFilter === 2) filtered = value - up;
      if (pngFilter === 3) filtered = value - ((left + up) >> 1);
      if (pngFilter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        filtered = value - predictor;
      }
      line[x + 1] = filtered & 0xff;
    }
    lines.push(line);
  }
  return lines;
}

const RGBA_PIXELS = new Uint8Array([
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 10, 20,
  30, 255, 40, 50, 60, 128,
]);

describe("decodePng", () => {
  test("decodes 8-bit RGBA", () => {
    const png = encodePng({
      width: 3,
      height: 2,
      bitDepth: 8,
      colorType: 6,
      scanlines: filterRows(RGBA_PIXELS, 3, 2, 4, 0),
    });
    const image = decodePng(png);
    expect(image.width).toBe(3);
    expect(image.height).toBe(2);
    expect(Array.from(image.data)).toEqual(Array.from(RGBA_PIXELS));
  });

  test("undoes every scanline filter", () => {
    for (const filter of [1, 2, 3, 4]) {
      const png = encodePng({
        width: 3,
        height: 2,
        bitDepth: 8,
        colorType: 6,
        scanlines: filterRows(RGBA_PIXELS, 3, 2, 4, filter),
      });
      // Same pixels must come back regardless of the encoder's filter choice.
      expect(Array.from(decodePng(png).data)).toEqual(Array.from(RGBA_PIXELS));
    }
  });

  test("decodes truecolour without alpha", () => {
    const pixels = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const png = encodePng({
      width: 2,
      height: 1,
      bitDepth: 8,
      colorType: 2,
      scanlines: filterRows(pixels, 2, 1, 3, 0),
    });
    expect(Array.from(decodePng(png).data)).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255,
    ]);
  });

  test("decodes greyscale and applies the tRNS colour key", () => {
    const pixels = new Uint8Array([0, 128, 255, 64]);
    const png = encodePng({
      width: 4,
      height: 1,
      bitDepth: 8,
      colorType: 0,
      scanlines: filterRows(pixels, 4, 1, 1, 0),
      // Colour key 128: the second pixel is transparent, the first isn't.
      trns: new Uint8Array([0, 128]),
    });
    expect(Array.from(decodePng(png).data)).toEqual([
      0, 0, 0, 255, 128, 128, 128, 0, 255, 255, 255, 255, 64, 64, 64, 255,
    ]);
  });

  test("decodes greyscale + alpha", () => {
    const pixels = new Uint8Array([9, 255, 200, 128]);
    const png = encodePng({
      width: 2,
      height: 1,
      bitDepth: 8,
      colorType: 4,
      scanlines: filterRows(pixels, 2, 1, 2, 0),
    });
    expect(Array.from(decodePng(png).data)).toEqual([
      9, 9, 9, 255, 200, 200, 200, 128,
    ]);
  });

  test("expands a 4-bit palette with transparency", () => {
    // Two pixels per byte: 0x0f -> index 0 then index 15.
    const png = encodePng({
      width: 3,
      height: 1,
      bitDepth: 4,
      colorType: 3,
      palette: new Uint8Array([255, 0, 0, 0, 255, 0]),
      trns: new Uint8Array([128, 255]),
      scanlines: [new Uint8Array([0, 0x01, 0x00])],
    });
    expect(Array.from(decodePng(png).data)).toEqual([
      255, 0, 0, 128, 0, 255, 0, 255, 255, 0, 0, 128,
    ]);
  });

  test("decodes 1-bit greyscale", () => {
    const png = encodePng({
      width: 4,
      height: 1,
      bitDepth: 1,
      colorType: 0,
      scanlines: [new Uint8Array([0, 0b1010_0000])],
    });
    expect(Array.from(decodePng(png).data)).toEqual([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]);
  });

  test("keeps the high byte of 16-bit samples", () => {
    const png = encodePng({
      width: 1,
      height: 1,
      bitDepth: 16,
      colorType: 6,
      scanlines: [
        new Uint8Array([0, 0xff, 0x80, 0x12, 0x34, 0x00, 0x00, 0xff, 0xff]),
      ],
    });
    expect(Array.from(decodePng(png).data)).toEqual([255, 18, 0, 255]);
  });

  test("rejects non-PNG input", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(
      "Not a PNG file",
    );
    expect(() => decodePng(new Uint8Array([137, 80]))).toThrow("too short");
  });

  test("rejects interlaced PNGs", () => {
    const png = encodePng({
      width: 1,
      height: 1,
      bitDepth: 8,
      colorType: 6,
      interlace: 1,
      scanlines: [new Uint8Array([0, 1, 2, 3, 4])],
    });
    expect(() => decodePng(png)).toThrow("Interlaced");
  });

  test("decodes PNGs written by a real encoder", async () => {
    const ImageCtor = (Bun as { Image?: unknown }).Image;
    if (typeof ImageCtor !== "function") return; // runtime without Bun.Image

    // 3×2 BMP: red, green, blue / white, various, black.
    const bmp = bmp24(3, 2, [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
      [10, 20, 30],
      [0, 0, 0],
    ]);
    const png = await new (
      ImageCtor as new (b: Uint8Array) => {
        png(): { bytes(): Promise<Uint8Array> };
      }
    )(bmp)
      .png()
      .bytes();

    const image = decodePng(png);
    expect(image.width).toBe(3);
    expect(image.height).toBe(2);
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 2, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(image, 1, 1)).toEqual([10, 20, 30, 255]);
  });
});

function pixel(
  image: { width: number; data: Uint8Array },
  x: number,
  y: number,
): number[] {
  const o = (y * image.width + x) * 4;
  return Array.from(image.data.subarray(o, o + 4));
}

/** Minimal 24-bit BMP encoder for fixtures. */
function bmp24(
  width: number,
  height: number,
  pixels: Array<[number, number, number]>,
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
      const [r, g, b] = pixels[y * width + x];
      const o = 54 + (height - 1 - y) * rowSize + x * 3;
      out[o] = b;
      out[o + 1] = g;
      out[o + 2] = r;
    }
  }
  return out;
}
