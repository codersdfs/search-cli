/**
 * Minimal PNG decoder — pure TypeScript, no native deps.
 *
 * Only used to turn an image into cells we can print, so it covers the
 * subset every encoder emits: no interlace, all five colour types, bit
 * depths 1–16, tRNS transparency. Palette + tRNS are expanded to RGBA so
 * callers only ever see 8-bit RGBA.
 *
 * Sources that aren't PNG (JPEG, WebP, GIF, AVIF, …) are normalised
 * upstream by `Bun.Image` before they get here.
 */
import { inflateSync } from "node:zlib";

export interface DecodedImage {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  data: Uint8Array;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Number of samples per pixel for each PNG colour type. */
function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1; // greyscale
    case 2:
      return 3; // truecolour
    case 3:
      return 1; // palette index
    case 4:
      return 2; // greyscale + alpha
    case 6:
      return 4; // truecolour + alpha
    default:
      throw new Error(`Unsupported PNG colour type ${colorType}`);
  }
}

/** Paeth predictor, per the PNG spec (§9.4). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Reverse the per-scanline filters applied by the encoder. */
function unfilter(
  raw: Uint8Array,
  height: number,
  bytesPerRow: number,
  bytesPerPixel: number,
): Uint8Array {
  const out = new Uint8Array(height * bytesPerRow);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const rowStart = y * bytesPerRow;
    const prevStart = rowStart - bytesPerRow;
    for (let x = 0; x < bytesPerRow; x++) {
      const value = raw[src + x];
      const left = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft =
        y > 0 && x >= bytesPerPixel ? out[prevStart + x - bytesPerPixel] : 0;
      let result: number;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + up;
          break;
        case 3:
          result = value + ((left + up) >> 1);
          break;
        case 4:
          result = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Unsupported PNG filter type ${filter}`);
      }
      out[rowStart + x] = result & 0xff;
    }
    src += bytesPerRow;
  }
  return out;
}

/** Read the `index`-th sample of a row for sub-byte bit depths. */
function sampleAt(
  row: Uint8Array,
  offsetInRow: number,
  index: number,
  bitDepth: number,
): number {
  if (bitDepth === 8) return row[offsetInRow + index];
  if (bitDepth === 16) return row[offsetInRow + index * 2];
  const bitOffset = index * bitDepth;
  const byte = row[offsetInRow + (bitOffset >> 3)];
  const shift = 8 - bitDepth - (bitOffset & 7);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

/** Decode PNG bytes into 8-bit RGBA. Throws on unsupported variants. */
export function decodePng(bytes: Uint8Array): DecodedImage {
  if (bytes.length < 8) throw new Error("PNG too short");
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("Not a PNG file");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  let offset = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) throw new Error("Truncated PNG chunk");

    switch (type) {
      case "IHDR": {
        width = view.getUint32(dataStart);
        height = view.getUint32(dataStart + 4);
        bitDepth = bytes[dataStart + 8];
        colorType = bytes[dataStart + 9];
        interlace = bytes[dataStart + 12];
        break;
      }
      case "PLTE":
        palette = bytes.subarray(dataStart, dataEnd);
        break;
      case "tRNS":
        transparency = bytes.subarray(dataStart, dataEnd);
        break;
      case "IDAT":
        idat.push(bytes.subarray(dataStart, dataEnd));
        break;
      default:
        break;
    }
    offset = dataEnd + 4; // skip CRC
    if (type === "IEND") break;
  }

  if (width === 0 || height === 0) throw new Error("PNG has no IHDR");
  if (interlace !== 0) throw new Error("Interlaced PNG is not supported");

  const channels = channelsForColorType(colorType);
  const bitsPerPixel = channels * bitDepth;
  const bytesPerRow = Math.ceil((width * bitsPerPixel) / 8);
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));

  const compressed = idat.length === 1 ? idat[0] : concat(idat);
  const raw = new Uint8Array(inflateSync(compressed));
  // One filter byte per scanline plus the samples themselves.
  if (raw.length < height * (bytesPerRow + 1)) {
    throw new Error("Truncated PNG pixel data");
  }
  const rows = unfilter(raw, height, bytesPerRow, bytesPerPixel);

  const out = new Uint8Array(width * height * 4);
  const maxSample = (1 << Math.min(bitDepth, 8)) - 1;
  const scale = bitDepth === 16 ? 1 / 257 : 255 / maxSample;

  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * bytesPerRow, (y + 1) * bytesPerRow);
    for (let x = 0; x < width; x++) {
      const to8 = (sample: number) =>
        bitDepth === 8 || bitDepth === 16 ? sample : Math.round(sample * scale);
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      switch (colorType) {
        case 0: {
          const grey = to8(sampleAt(row, 0, x, bitDepth));
          r = g = b = grey;
          break;
        }
        case 2:
          r = to8(sampleAt(row, 0, x * 3, bitDepth));
          g = to8(sampleAt(row, 0, x * 3 + 1, bitDepth));
          b = to8(sampleAt(row, 0, x * 3 + 2, bitDepth));
          break;
        case 3: {
          const index = sampleAt(row, 0, x, bitDepth);
          const p = index * 3;
          if (!palette || p + 2 >= palette.length)
            throw new Error("PNG palette entry missing");
          r = palette[p];
          g = palette[p + 1];
          b = palette[p + 2];
          if (transparency && index < transparency.length)
            a = transparency[index];
          break;
        }
        case 4: {
          const grey = to8(sampleAt(row, 0, x * 2, bitDepth));
          r = g = b = grey;
          a = to8(sampleAt(row, 0, x * 2 + 1, bitDepth));
          break;
        }
        default: {
          r = to8(sampleAt(row, 0, x * 4, bitDepth));
          g = to8(sampleAt(row, 0, x * 4 + 1, bitDepth));
          b = to8(sampleAt(row, 0, x * 4 + 2, bitDepth));
          a = to8(sampleAt(row, 0, x * 4 + 3, bitDepth));
          break;
        }
      }
      if (colorType === 0 && transparency && transparency.length >= 2) {
        const key = (transparency[0] << 8) | transparency[1];
        const sample = sampleAt(row, 0, x, bitDepth);
        if (sample === key) a = 0;
      }
      const o = (y * width + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }

  return { width, height, data: out };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged;
}
