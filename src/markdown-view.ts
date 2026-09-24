/**
 * Full markdown view for OpenTUI.
 *
 * A real `MarkdownRenderable` with a theme-derived syntax style, themed
 * headings, and inline images drawn as half blocks. Used by the README
 * viewer and by the update modal's release notes.
 */
import {
  BoxRenderable,
  MarkdownRenderable,
  RGBA,
  StyledText,
  SyntaxStyle,
  TextRenderable,
  createTextAttributes,
  type CliRenderer,
  type RenderNodeContext,
  type Renderable,
  type TextChunk,
} from "@opentui/core";
import {
  rasterizeImage,
  toImageRuns,
  type HalfBlockImage,
  type Rgb,
} from "./image-render";
import { resolveReadmeImageUrl } from "./image-loader";
import {
  extractImageRefs,
  inlinePlainText,
  type BlockTokenLike,
  type ImageRef,
} from "./markdown-images";

/** Tallest inline image, in terminal cells. */
export const MAX_IMAGE_ROWS = 24;

export interface MarkdownViewOptions {
  renderer: CliRenderer;
  /** Theme palette (see src/themes.ts). */
  colors: Record<string, string>;
  /** URL of the markdown document, used to resolve relative image paths. */
  imageBase?: string;
  /** Panel background, painted behind text, captions and images. Default: colors.bg. */
  background?: string;
  /** Render inline images. Default: true. */
  images?: boolean;
  /** Fetches bytes for a resolved image URL. */
  loadImage?: (url: string) => Promise<Uint8Array | null>;
  /** Width available for an image, in cells. */
  getImageWidth?: () => number;
  /** Height cap for one image, in cells. Default: MAX_IMAGE_ROWS. */
  maxImageRows?: number;
}

export interface MarkdownView {
  readonly renderable: MarkdownRenderable;
  readonly imagesEnabled: boolean;
  /** Replace the document; relative images resolve against `imageBase`. */
  setContent(markdown: string, imageBase?: string): void;
  /** Turn inline images on/off and rebuild the document. */
  setImagesEnabled(enabled: boolean): void;
}

/** Syntax style for the markdown grammar's highlight groups. */
export function createMarkdownStyle(
  colors: Record<string, string>,
): SyntaxStyle {
  const surface = colors.surface ?? colors.bg;
  return SyntaxStyle.fromStyles({
    default: { fg: colors.text ?? "#ffffff" },
    conceal: { fg: colors.muted ?? "#888888" },
    "markup.heading": { fg: colors.accent ?? colors.blue, bold: true },
    "markup.strong": { fg: colors.text ?? "#ffffff", bold: true },
    "markup.italic": { fg: colors.text ?? "#ffffff", italic: true },
    "markup.strikethrough": { fg: colors.muted ?? "#888888", dim: true },
    "markup.raw": { fg: colors.green ?? "#a6e3a1", bg: surface },
    "markup.raw.block": { fg: colors.green ?? "#a6e3a1" },
    "markup.link": { fg: colors.accent ?? colors.blue },
    "markup.link.label": {
      fg: colors.accent ?? colors.blue,
      underline: true,
    },
    "markup.link.url": { fg: colors.muted ?? "#888888", underline: true },
    "markup.quote": { fg: colors.muted ?? "#888888", italic: true },
    "markup.list": { fg: colors.blue ?? colors.accent },
  });
}

function hexToRgb(hex: string | undefined): Rgb {
  const fallback: Rgb = [0, 0, 0];
  if (!hex) return fallback;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return fallback;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function rgba(color: Rgb): RGBA {
  return RGBA.fromValues(color[0], color[1], color[2], 255);
}

/** Half-block rows as one styled-text block (one line per image row). */
function imageStyledText(image: HalfBlockImage): StyledText {
  const chunks: TextChunk[] = [];
  toImageRuns(image).forEach((runs, rowIndex) => {
    if (rowIndex > 0) chunks.push({ __isChunk: true, text: "\n" });
    for (const run of runs) {
      chunks.push({
        __isChunk: true,
        text: run.text,
        fg: rgba(run.top),
        bg: rgba(run.bottom),
      });
    }
  });
  return new StyledText(chunks);
}

/**
 * Build the markdown renderable and its block renderers.
 *
 * Two OpenTUI quirks shape the options below:
 *
 * - `streaming`: without a loaded tree-sitter markdown grammar a finished
 *   block has no highlights to draw and renders as blank lines, so the
 *   styled initial text has to be kept alive instead.
 * - `internalBlockMode: "top-level"`: in the default coalesced mode every
 *   style refresh re-renders blocks with the built-in renderers, which
 *   throws away the custom heading/image renderables created here.
 */
export function createMarkdownView(opts: MarkdownViewOptions): MarkdownView {
  const { renderer, colors } = opts;
  const maxImageRows = opts.maxImageRows ?? MAX_IMAGE_ROWS;
  const rasterCache = new Map<string, Promise<HalfBlockImage | null>>();
  let imagesEnabled = opts.images ?? true;
  let imageBase = opts.imageBase;

  const text = () => colors.text ?? "#ffffff";
  const bg = () => opts.background ?? colors.bg ?? "#000000";
  const muted = () => colors.muted ?? "#888888";

  const renderable = new MarkdownRenderable(renderer, {
    content: "",
    syntaxStyle: createMarkdownStyle(colors),
    fg: text(),
    bg: bg(),
    conceal: true,
    streaming: true,
    internalBlockMode: "top-level",
    // Borderless columns are the top-level default; boxed tables read better
    // for the multi-column tables READMEs use.
    tableOptions: { style: "grid" },
    width: "100%",
  });

  const caption = (label: string, color = muted()) =>
    new TextRenderable(renderer, {
      content: `  ${label}`,
      fg: color,
      bg: bg(),
      wrapMode: "word",
      flexShrink: 0,
      width: "100%",
    });

  const rasterize = (url: string): Promise<HalfBlockImage | null> => {
    // Size is part of the key: a resized terminal needs fresh cells.
    const maxCols = Math.max(8, Math.floor(opts.getImageWidth?.() ?? 100));
    const key = `${maxCols}|${url}`;
    const cached = rasterCache.get(key);
    if (cached) return cached;
    const pending = (async () => {
      const loader = opts.loadImage;
      if (!loader) return null;
      const bytes = await loader(url);
      if (!bytes) return null;
      return rasterizeImage(bytes, {
        maxCols,
        maxRows: maxImageRows,
        background: hexToRgb(bg()),
      });
    })();
    rasterCache.set(key, pending);
    return pending;
  };

  const imageNode = (image: ImageRef): Renderable => {
    const label = `🖼  ${image.alt.trim() || "image"}`;
    const url = imageBase ? resolveReadmeImageUrl(image.href, imageBase) : null;
    if (!imagesEnabled || !url || !opts.loadImage) return caption(label);

    const container = new BoxRenderable(renderer, {
      flexDirection: "column",
      flexShrink: 0,
      width: "100%",
    });
    const placeholder = caption(`${label}  (loading…)`);
    container.add(placeholder);

    void rasterize(url).then(
      (cells) => {
        console.error(
          `[dbg] image resolved: cells=${cells ? `${cells.cols}x${cells.rows}` : "null"} destroyed=${container.isDestroyed} parent=${!!container.parent} enabled=${imagesEnabled}`,
        );
        // The document may have been replaced (or the overlay closed) while
        // the image was downloading.
        if (container.isDestroyed || !container.parent) return;
        container.remove(placeholder);
        placeholder.destroy();
        container.add(caption(label));
        if (cells) {
          container.add(
            new TextRenderable(renderer, {
              content: imageStyledText(cells),
              bg: bg(),
              wrapMode: "none",
              selectable: false,
              flexShrink: 0,
            }),
          );
        }
        renderable.requestRender();
      },
      (err) => {
        console.error("[dbg] image promise rejected:", err);
      },
    );
    return container;
  };

  const headingNode = (token: BlockTokenLike): Renderable | undefined => {
    const heading = inlinePlainText(token.tokens).trim();
    if (!heading) return undefined;
    const depth = token.depth ?? 1;
    const color = depth <= 2 ? colors.accent : (colors.teal ?? colors.accent);
    return new TextRenderable(renderer, {
      content: new StyledText([
        {
          __isChunk: true,
          text: heading,
          fg: RGBA.fromHex(color ?? "#ffffff"),
          attributes: createTextAttributes({
            bold: true,
            underline: depth === 1,
          }),
        },
      ]),
      bg: bg(),
      wrapMode: "word",
      flexShrink: 0,
      width: "100%",
    });
  };

  const buildRenderNode =
    () =>
    (
      token: BlockTokenLike,
      _context: RenderNodeContext,
    ): Renderable | undefined => {
      if (token.type === "heading") return headingNode(token);
      const images = extractImageRefs(token);
      if (images && images.length > 0) {
        const box = new BoxRenderable(renderer, {
          flexDirection: "column",
          flexShrink: 0,
          width: "100%",
          marginTop: 1,
        });
        for (const image of images) box.add(imageNode(image));
        return box;
      }
      return undefined;
    };

  renderable.renderNode = buildRenderNode();

  return {
    renderable,
    get imagesEnabled() {
      return imagesEnabled;
    },
    setContent(markdown: string, base?: string) {
      if (base !== undefined) imageBase = base;
      // Rebuild the style so theme switches (which mutate `colors`) apply.
      renderable.syntaxStyle = createMarkdownStyle(colors);
      renderable.fg = text();
      renderable.bg = bg();
      renderable.content = markdown;
    },
    setImagesEnabled(enabled: boolean) {
      if (imagesEnabled === enabled) return;
      imagesEnabled = enabled;
      // A fresh renderNode identity forces a full block rebuild.
      renderable.renderNode = buildRenderNode();
      renderable.requestRender();
    },
  };
}
