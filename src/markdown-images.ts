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

/** Minimal shape of a marked block token. */
export interface BlockTokenLike extends InlineTokenLike {
  depth?: number;
}

export interface ImageRef {
  href: string;
  alt: string;
}

const IMG_TAG = /<img\b[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>/gi;
const ALT_ATTR = /\balt\s*=\s*["']([^"']*)["']/i;
const HTML_TAG = /<\/?[a-z][^>]*>/gi;

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
    refs.push({ href: match[1], alt });
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

  const collect = (inline: InlineTokenLike): boolean => {
    if (inline.type === "image") {
      if (inline.href)
        images.push({ href: inline.href, alt: inline.text ?? "" });
      return true;
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
    return refs.length > 0 ? refs : null;
  }

  const inline = token.tokens ?? [];
  if (inline.length === 0) return null;
  for (const child of inline) {
    if (!collect(child)) return null;
  }
  return images.length > 0 ? images : null;
}
