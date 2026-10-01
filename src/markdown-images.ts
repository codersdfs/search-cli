/**
 * Markdown token helpers — pure functions over marked-shaped tokens.
 *
 * Kept free of any OpenTUI import so the token handling can be unit tested
 * without a renderer.
 */

/** Minimal shape of a marked inline token. */
export interface InlineTokenLike {
  type?: string;
  text?: string;
  href?: string;
  raw?: string;
  tokens?: InlineTokenLike[];
}

/**
 * A pixel size an image reference declares about itself — the `width`/`height`
 * attributes of an `<img>` tag, or the dimensions `Bun.Image.metadata()` reads
 * from an image header. `undefined` means "not declared".
 */
export interface DeclaredSize {
  width: number;
  height: number;
}

/**
 * Images whose larger declared edge is below this are skipped before any
 * request is made. Badges and 48x48 sponsor avatars are unreadable at cell
 * resolution and, at 24 rows per image, a README full of them is unusable —
 * 648 avatars in `openclaw/openclaw` measured 15,552 rows and 28 s to open.
 * The README is the authority here: it can hide an image whose declared size
 * understates it, which is judged better than a screen full of avatars.
 */
export const MIN_IMAGE_PIXELS = 100;

/** Minimal shape of a marked block token. */
export interface BlockTokenLike extends InlineTokenLike {
  depth?: number;
}

export interface ImageRef {
  href: string;
  alt: string;
  /** Size the reference declares about itself, when it does. */
  declared?: DeclaredSize;
  /** Link target when the image is wrapped in a link (`[![alt](src)](url)`). */
  linkUrl?: string;
}

const IMG_TAG = /<img\b[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>/gi;
const ALT_ATTR = /\balt\s*=\s*["']([^"']*)["']/i;
const LENGTH_ATTR = /\b(width|height)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
/** Whole-value integers, with or without a `px` suffix. */
const PIXEL_VALUE = /^(\d+)(?:px)?$/i;
const HTML_TAG = /<\/?[a-z][^>]*>/gi;

/**
 * Pixel size an `<img>` tag declares via its `width`/`height` attributes, or
 * `undefined` when it declares none. Only whole pixel values count —
 * percentages (`width="100%"`) say nothing about real pixels, so they are
 * ignored rather than read as a 100 px image.
 */
export function declaredImageSize(tag: string): DeclaredSize | undefined {
  const values: Partial<Record<"width" | "height", number>> = {};
  for (const [, name, dq, sq] of tag.matchAll(LENGTH_ATTR)) {
    const raw = dq ?? sq ?? "";
    const match = PIXEL_VALUE.exec(raw.trim());
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n) && n > 0) {
      values[name as "width" | "height"] = n;
    }
  }
  if (values.width === undefined && values.height === undefined)
    return undefined;
  return {
    width: values.width ?? values.height ?? 0,
    height: values.height ?? values.width ?? 0,
  };
}

/**
 * Whether a reference declaring `size` is too small to render: an edge under
 * the floor (the shipped contract — "images declaring an edge under 100px are
 * skipped"). `undefined` (nothing declared) is never too small — callers
 * decide from real pixels or render and let the rasteriser cap it.
 */
export function declaresTooSmall(size: DeclaredSize | undefined): boolean {
  if (!size) return false;
  return size.width < MIN_IMAGE_PIXELS || size.height < MIN_IMAGE_PIXELS;
}

/** Images embedded as raw `<img>` tags, when there's no other content. */
function imagesFromHtml(raw: string | undefined): ImageRef[] {
  if (!raw || !/<img\b/i.test(raw)) return [];
  // Anything other than an <img> tag with real text between the tags means
  // this isn't a pure image block (e.g. a centered figure with a caption).
  const withoutTags = raw
    .replace(IMG_TAG, "")
    .replace(/<\/?(?:p|div|center|br|a|picture|source)\b[^>]*>/gi, "")
    .trim();
  if (withoutTags) return [];

  const refs: ImageRef[] = [];
  for (const match of raw.matchAll(IMG_TAG)) {
    const tag = match[0];
    const alt = ALT_ATTR.exec(tag)?.[1] ?? "";
    refs.push({ href: match[1], alt, declared: declaredImageSize(tag) });
  }
  return refs;
}

/** Flatten inline tokens (bold, links, code, …) down to their text. */
export function inlinePlainText(tokens: InlineTokenLike[] | undefined): string {
  if (!tokens) return "";
  let out = "";
  for (const token of tokens) {
    if (token.type === "image") continue;
    if (token.type === "html") {
      out += (token.raw ?? "").replace(HTML_TAG, "");
      continue;
    }
    if (token.type === "br") {
      out += "\n";
      continue;
    }
    if (token.text && (!token.tokens || token.tokens.length === 0)) {
      out += token.text;
      continue;
    }
    if (token.tokens?.length) {
      out += inlinePlainText(token.tokens);
      continue;
    }
    if (token.raw) out += token.raw.replace(HTML_TAG, "");
  }
  return out;
}

/**
 * Image references for a block token, or `null` when the block isn't a pure
 * image block (markdown images and/or standalone `<img>` tags only).
 */
export function extractImageRefs(token: BlockTokenLike): ImageRef[] | null {
  const images: ImageRef[] = [];
  let linkUrl: string | undefined;

  const collect = (inline: InlineTokenLike): boolean => {
    if (inline.type === "image") {
      if (inline.href)
        images.push({ href: inline.href, alt: inline.text ?? "", linkUrl });
      return true;
    }
    if (inline.type === "link" || inline.type === "linkReference") {
      // `[![alt](img)](url)` — the badge-and-screenshot shape. marked hands
      // the image to us as a child of the link token, so recurse; rejecting
      // the block here discarded the image entirely (sst/opencode,
      // withastro/astro). A link whose content is prose still fails the
      // inner `text` check, so those blocks stay prose.
      if (inline.tokens?.length) {
        const outer = linkUrl;
        linkUrl = inline.href || outer;
        const ok = inline.tokens.every(collect);
        linkUrl = outer;
        return ok;
      }
      return false;
    }
    if (inline.type === "html") {
      const refs = imagesFromHtml(inline.raw);
      if (refs.length > 0) {
        images.push(...refs);
        return true;
      }
      // Inline markup such as <br> doesn't disqualify the block.
      return !(inline.raw ?? "").replace(HTML_TAG, "").trim();
    }
    // Whitespace-only text between images is fine; anything else means the
    // block is a paragraph that happens to contain an image.
    if (inline.type === "text" || inline.type === "escape") {
      return !(inline.text ?? "").trim();
    }
    return false;
  };

  if (token.type === "image" && token.href) {
    return [{ href: token.href, alt: token.text ?? "" }];
  }

  if (token.type === "html") {
    const refs = imagesFromHtml(token.raw);
    return refs.length > 0 ? dropTooSmall(refs) : null;
  }

  const inline = token.tokens ?? [];
  if (inline.length === 0) return null;
  for (const child of inline) {
    if (!collect(child)) return null;
  }
  return images.length > 0 ? dropTooSmall(images) : null;
}

/**
 * Filter out refs the README declares too small to be worth a request.
 * An empty return means "pure image block, but nothing in it is worth
 * drawing" — distinct from `null` (prose), so the view can render neither
 * prose nor the raw markdown of a filtered-out image.
 */
function dropTooSmall(refs: ImageRef[]): ImageRef[] {
  return refs.filter((image) => !declaresTooSmall(image.declared));
}
