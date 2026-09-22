/**
 * Terminal image rendering — turns image bytes into half-block cells.
 *
 * A terminal cell is roughly twice as tall as it is wide, so one cell is
 * drawn with `▀`: the foreground colour paints the top half and the
 * background colour the bottom half. That gives two image pixels of
 * vertical resolution per character row with no image protocol support
 * needed — it works on any truecolor terminal, inside OpenTUI's own
 * cell buffer.
 */
import { decodePng, type DecodedImage } from "./png";

export type Rgb = readonly [number, number, number];

export interface HalfBlockCell {
  /** Colour of the top half of the cell. */
  top: Rgb;
  /** Colour of the bottom half of the cell. */
  bottom: Rgb;
}

export interface HalfBlockImage {
  cols: number;
  rows: number;
  /** Row-major, `cells[row][col]`. */
  cells: HalfBlockCell[][];
}

/** A run of cells sharing the same top/bottom colours. */
export interface ImageRun {
  text: string;
  top: Rgb;
  bottom: Rgb;
}

export interface FitOptions {
  /** Hard cap on the rendered width, in terminal cells. */
  maxCols: number;
  /** Hard cap on the rendered height, in terminal cells. */
  maxRows: number;
  /**
   * Width ÷ height of one terminal cell. Real cells are about half as wide
   * as tall, so the default keeps image proportions honest.
   */
  cellAspect?: number;
}

export interface RasterizeOptions extends FitOptions {
  /** Painted behind transparent pixels. Defaults to black. */
  background?: Rgb;
}

/** Default cell width ÷ height — standard terminal cells are ~1:2. */
export const DEFAULT_CELL_ASPECT = 0.5;

/** The character used to split a cell into two vertically stacked pixels. */
export const HALF_BLOCK = "\u2580";

/**
 * Largest cell grid that shows the whole image inside the given bounds
 * without distorting it.
 */
export function fitImageToCells(
  imgWidth: number,
  imgHeight: number,
  opts: FitOptions,
): { cols: number; rows: number } {
  const cellAspect = opts.cellAspect ?? DEFAULT_CELL_ASPECT;
  const minCols = Math.max(1, Math.min(opts.maxCols, 8));
  if (imgWidth <= 0 || imgHeight <= 0) {
    return { cols: minCols, rows: 1 };
  }

  // rows/cols = cellAspect * (imgHeight / imgWidth)
  const rowsPerCol = cellAspect * (imgHeight / imgWidth);
  let cols = Math.max(minCols, Math.floor(opts.maxCols));
  let rows = Math.max(1, Math.round(cols * rowsPerCol));

  if (rows > opts.maxRows) {
    rows = Math.max(1, opts.maxRows);
    cols = Math.max(
      minCols,
      Math.min(cols, Math.floor(rows / Math.max(rowsPerCol, 1e-6))),
    );
  }
  return { cols, rows };
}

/** Sample RGBA at a pixel, compositing over `background` when translucent. */
function pixelAt(
  img: DecodedImage,
  x: number,
  y: number,
  background: Rgb,
): Rgb {
  const o = (y * img.width + x) * 4;
  const a = img.data[o + 3] / 255;
  if (a >= 1) return [img.data[o], img.data[o + 1], img.data[o + 2]];
  const mix = (channel: number, bg: number) =>
    Math.round(channel * a + bg * (1 - a));
  return [
    mix(img.data[o], background[0]),
    mix(img.data[o + 1], background[1]),
    mix(img.data[o + 2], background[2]),
  ];
}

/** Convert decoded pixels into half-block cells, row-major. */
export function toHalfBlocks(
  img: DecodedImage,
  opts: { background?: Rgb } = {},
): HalfBlockImage {
  const background = opts.background ?? [0, 0, 0];
  const cells: HalfBlockCell[][] = [];
  for (let row = 0; row * 2 < img.height; row++) {
    const cellsRow: HalfBlockCell[] = [];
    const topY = row * 2;
    const bottomY = topY + 1;
    for (let x = 0; x < img.width; x++) {
      const top = pixelAt(img, x, topY, background);
      const bottom =
        bottomY < img.height ? pixelAt(img, x, bottomY, background) : top;
      cellsRow.push({ top, bottom });
    }
    cells.push(cellsRow);
  }
  return { cols: img.width, rows: cells.length, cells };
}

/** Collapse each cell row into runs of identical colours. */
export function toImageRuns(image: HalfBlockImage): ImageRun[][] {
  return image.cells.map((cells) => {
    const runs: ImageRun[] = [];
    for (const cell of cells) {
      const last = runs[runs.length - 1];
      if (
        last &&
        last.top[0] === cell.top[0] &&
        last.top[1] === cell.top[1] &&
        last.top[2] === cell.top[2] &&
        last.bottom[0] === cell.bottom[0] &&
        last.bottom[1] === cell.bottom[1] &&
        last.bottom[2] === cell.bottom[2]
      ) {
        last.text += HALF_BLOCK;
        continue;
      }
      runs.push({ text: HALF_BLOCK, top: cell.top, bottom: cell.bottom });
    }
    return runs;
  });
}

/**
 * Source image pixel budget. A README can link to anything, and a highly
 * compressible 20k×20k PNG is a few kilobytes on the wire, so refuse absurd
 * canvases before the decoder allocates for them.
 */
const MAX_SOURCE_PIXELS = 20_000_000;

/**
 * Decode any supported image format, scale it to the requested cell grid
 * and convert it to half blocks.
 *
 * Anything `Bun.Image` can read (PNG, JPEG, WebP, GIF first frame, BMP,
 * and HEIC/AVIF where the OS has a codec) is normalised to PNG here, so the
 * decoder only ever sees one format. Returns `null` when the runtime has no
 * image codec, the image is unreadable, or it is too large to bother with.
 */
export async function rasterizeImage(
  bytes: Uint8Array,
  opts: RasterizeOptions,
): Promise<HalfBlockImage | null> {
  const ImageCtor = (
    globalThis as {
      Bun?: {
        Image?: new (
          input: Uint8Array,
          constructorOptions?: { maxPixels?: number },
        ) => {
          metadata(): Promise<{ width: number; height: number }>;
          resize(
            width: number,
            height?: number,
            options?: { fit?: "fill" | "inside" },
          ): {
            png(options?: { compressionLevel?: number }): {
              bytes(): Promise<Uint8Array>;
            };
          };
        };
      };
    }
  ).Bun?.Image;
  if (!ImageCtor) return null;

  const source = new ImageCtor(bytes, { maxPixels: MAX_SOURCE_PIXELS });
  try {
    const meta = await source.metadata();
    const { cols, rows } = fitImageToCells(meta.width, meta.height, opts);
    const png = await source
      .resize(cols, rows * 2, { fit: "fill" })
      .png({ compressionLevel: 1 })
      .bytes();
    return toHalfBlocks(decodePng(png), { background: opts.background });
  } catch {
    return null;
  }
}
