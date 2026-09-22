/**
 * README image loading — URL resolution, filtering and a small fetch cache.
 *
 * READMEs reference images in a half-dozen shapes: relative paths, absolute
 * paths from a branch root, `github.com/.../blob/...` pages, media hosts and
 * inline `data:` URIs. Only some of them are worth downloading, and all of
 * the downloads are cached because a README is re-opened often.
 */

/** Reject anything bigger than this before buffering it. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/**
 * Hosts that serve badges rather than pictures. They're tiny SVGs with text
 * baked in — unreadable once rasterised, so they're skipped.
 */
const BADGE_HOST =
  /(^|\.)(shields\.io|badgen\.net|badge\.fury\.io|codecov\.io|coveralls\.io|travis-ci\.(org|com)|snyk\.io|sonarcloud\.io|david-dm\.(org|io))$/i;

/** Hosts whose repo-relative image paths we are allowed to fetch. */
const RAW_HOSTS = new Set([
  "raw.githubusercontent.com",
  "camo.githubusercontent.com",
  "user-images.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "avatars.githubusercontent.com",
  "objects.githubusercontent.com",
]);

/** Formats the rasteriser cannot show — SVG is text, so it's skipped. */
const RASTER_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|heic|tiff?)(?:[?#]|$)/i;

/** Cap on memoised downloads — a long session can open many READMEs. */
const CACHE_LIMIT = 24;

const cache = new Map<string, Promise<Uint8Array | null>>();

/** Drop memoised image downloads (used by tests). */
export function clearImageByteCache(): void {
  cache.clear();
}

/** Decode a `data:image/...;base64,...` URI into raw bytes. */
function decodeDataUri(uri: string): Uint8Array | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(uri);
  if (!match) return null;
  const mime = (match[1] ?? "").toLowerCase();
  if (mime.includes("svg")) return null;
  const payload = match[3];
  try {
    if (match[2]) return new Uint8Array(Buffer.from(payload, "base64"));
    return new Uint8Array(Buffer.from(decodeURIComponent(payload), "binary"));
  } catch {
    return null;
  }
}

/**
 * Rewrite GitHub web URLs (`.../blob/<ref>/<path>`, `.../raw/<ref>/<path>`)
 * to their raw equivalents so they can be fetched as bytes.
 */
function toRawGitHubUrl(url: URL): URL {
  if (url.hostname.toLowerCase() !== "github.com") return url;
  const match = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(url.pathname);
  if (!match) return url;
  const [, owner, repo, rest] = match;
  return new URL(
    `https://raw.githubusercontent.com/${owner}/${repo}/${rest}${url.search}`,
  );
}

/**
 * GitHub resolves `/foo.png` against the *repository* root, not the host
 * root, so rebuild it on the base's `owner/repo/branch` prefix instead of
 * letting `new URL()` swap the whole path out.
 */
function resolveRootRelative(path: string, base: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== "raw.githubusercontent.com") {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 3) return null;
  return new URL(`${parsed.origin}/${segments.slice(0, 3).join("/")}${path}`);
}

/**
 * Resolve an image reference from a README into a fetchable URL, or `null`
 * when it isn't something we can render (SVG, badges, mailto, …).
 *
 * `base` is the URL of the README itself, so relative paths resolve against
 * the branch the README came from.
 */
export function resolveReadmeImageUrl(
  raw: string,
  base: string,
): string | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;

  if (/^data:/i.test(cleaned)) {
    return isRenderableImageUrl(cleaned) ? cleaned : null;
  }

  let url: URL | null = null;
  try {
    url = cleaned.startsWith("/")
      ? resolveRootRelative(cleaned, base)
      : new URL(cleaned, base);
  } catch {
    return null;
  }
  if (!url) return null;
  url = toRawGitHubUrl(url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  const resolved = url.toString();
  return isRenderableImageUrl(resolved) ? resolved : null;
}

/**
 * Whether a URL is likely to be a picture we can rasterise. Skipped:
 * SVG (vector text), badge services, and GitHub-hosted HTML pages.
 */
export function isRenderableImageUrl(url: string): boolean {
  if (/^data:/i.test(url)) return !/svg/i.test(url.slice(0, 64));
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (BADGE_HOST.test(parsed.hostname)) return false;

  const path = parsed.pathname.toLowerCase();
  if (path.endsWith(".svg") || path.endsWith(".svgz")) return false;
  // Unknown extension on a host we don't know: the fetch decides.
  if (/\.[a-z0-9]{1,5}$/.test(path) && !RASTER_EXT.test(path)) return false;
  if (
    parsed.hostname.endsWith("github.com") &&
    !RAW_HOSTS.has(parsed.hostname)
  ) {
    return /\.(png|jpe?g|webp|gif|bmp|avif|heic|tiff?)$/i.test(path);
  }
  return true;
}

/** Hosts that accept the caller's GitHub token. */
function isGitHubHost(hostname: string): boolean {
  return /(^|\.)githubusercontent\.com$|(^|\.)github\.com$/i.test(hostname);
}

/**
 * Download image bytes, memoised per URL. Returns `null` for anything that
 * fails, is too large, or turns out not to be an image.
 */
export async function fetchImageBytes(
  url: string,
  opts: { token?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Uint8Array | null> {
  const cached = cache.get(url);
  if (cached) return cached;
  const pending = loadImageBytes(url, opts);
  cache.set(url, pending);
  // Map iteration order is insertion order, so the first key is the oldest.
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return pending;
}

async function loadImageBytes(
  url: string,
  opts: { token?: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<Uint8Array | null> {
  if (/^data:/i.test(url)) return decodeDataUri(url);

  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "User-Agent": "ghfind/1.0",
      Accept: "image/*,*/*;q=0.5",
    };
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      return null;
    }
    if (opts.token && isGitHubHost(host)) {
      headers.Authorization = `Bearer ${opts.token}`;
    }

    const res = await fetchImpl(url, { headers, signal: controller.signal });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !/^image\//i.test(contentType)) return null;
    if (/svg/i.test(contentType)) return null;

    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES) return null;

    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }
    return buffer;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Absolute URL of the README file itself, used as the base for relative
 * image paths.
 */
export function readmeBaseUrl(
  owner: string,
  repo: string,
  branch: string,
  path = "README.md",
): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}
