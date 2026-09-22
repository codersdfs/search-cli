import { beforeEach, describe, expect, test } from "bun:test";
import {
  MAX_IMAGE_BYTES,
  clearImageByteCache,
  fetchImageBytes,
  isRenderableImageUrl,
  readmeBaseUrl,
  resolveReadmeImageUrl,
} from "../src/image-loader";

const BASE = readmeBaseUrl("octo", "demo", "main");

/** `fetch` shim used to keep the tests off the network. */
type FetchShim = (input: string, init?: RequestInit) => Promise<Response>;
const asFetch = (shim: FetchShim) => shim as unknown as typeof fetch;

beforeEach(() => {
  clearImageByteCache();
});

describe("resolveReadmeImageUrl", () => {
  test("resolves paths relative to the README file", () => {
    expect(resolveReadmeImageUrl("docs/shot.png", BASE)).toBe(
      "https://raw.githubusercontent.com/octo/demo/main/docs/shot.png",
    );
    expect(resolveReadmeImageUrl("./img/a.jpg", BASE)).toBe(
      "https://raw.githubusercontent.com/octo/demo/main/img/a.jpg",
    );
  });

  test("resolves root-relative paths against the repository root", () => {
    expect(resolveReadmeImageUrl("/assets/banner.webp", BASE)).toBe(
      "https://raw.githubusercontent.com/octo/demo/main/assets/banner.webp",
    );
  });

  test("keeps absolute URLs", () => {
    expect(
      resolveReadmeImageUrl(
        "https://user-images.githubusercontent.com/1/x.png",
        BASE,
      ),
    ).toBe("https://user-images.githubusercontent.com/1/x.png");
  });

  test("rewrites GitHub blob and raw page URLs to raw content", () => {
    expect(
      resolveReadmeImageUrl(
        "https://github.com/octo/demo/blob/main/img/x.png",
        BASE,
      ),
    ).toBe("https://raw.githubusercontent.com/octo/demo/main/img/x.png");
    expect(
      resolveReadmeImageUrl(
        "https://github.com/octo/demo/raw/main/img/x.png",
        BASE,
      ),
    ).toBe("https://raw.githubusercontent.com/octo/demo/main/img/x.png");
  });

  test("strips fragments such as #gh-dark-mode-only", () => {
    expect(resolveReadmeImageUrl("img/x.png#gh-dark-mode-only", BASE)).toBe(
      "https://raw.githubusercontent.com/octo/demo/main/img/x.png",
    );
  });

  test("keeps inline data URIs (when rasterisable)", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    expect(resolveReadmeImageUrl(dataUrl, BASE)).toBe(dataUrl);
    expect(resolveReadmeImageUrl("data:image/svg+xml,<svg/>", BASE)).toBeNull();
  });

  test("skips SVG, badges and non-http references", () => {
    expect(resolveReadmeImageUrl("logo.svg", BASE)).toBeNull();
    expect(
      resolveReadmeImageUrl("https://img.shields.io/badge/x-y-blue", BASE),
    ).toBeNull();
    expect(resolveReadmeImageUrl("mailto:x@y.z", BASE)).toBeNull();
    expect(resolveReadmeImageUrl("   ", BASE)).toBeNull();
  });
});

describe("isRenderableImageUrl", () => {
  test("accepts raster formats", () => {
    for (const url of [
      "https://example.com/a.png",
      "https://example.com/a.JPEG",
      "https://example.com/a.webp",
      "https://example.com/a.gif",
      "https://example.com/no-extension-asset",
    ]) {
      expect(isRenderableImageUrl(url)).toBe(true);
    }
  });

  test("rejects vector, badge and document URLs", () => {
    for (const url of [
      "https://example.com/a.svg",
      "https://example.com/a.md",
      "https://img.shields.io/npm/v/x.svg",
      "https://camo.githubusercontent.com/x/badge.svg",
      "https://github.com/octo/demo/blob/main/README.md",
      "ftp://example.com/a.png",
      "not a url",
    ]) {
      expect(isRenderableImageUrl(url)).toBe(false);
    }
  });
});

describe("fetchImageBytes", () => {
  test("downloads image bytes with a user agent", async () => {
    const calls: string[] = [];
    const fetchImpl = asFetch(async (input, init) => {
      calls.push(String(input));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers["User-Agent"]).toBe("ghfind/1.0");
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
    });

    const bytes = await fetchImageBytes("https://example.com/a.png", {
      fetchImpl,
    });
    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3]);
  });

  test("memoises repeat requests", async () => {
    let calls = 0;
    const fetchImpl = asFetch(async () => {
      calls++;
      return new Response(new Uint8Array([9]), {
        headers: { "content-type": "image/png" },
      });
    });

    await fetchImageBytes("https://example.com/cached.png", { fetchImpl });
    await fetchImageBytes("https://example.com/cached.png", { fetchImpl });
    expect(calls).toBe(1);
  });

  test("adds the token only for GitHub hosts", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = asFetch(async (_input, init) => {
      seen.push(init?.headers as Record<string, string>);
      return new Response(new Uint8Array([1]), {
        headers: { "content-type": "image/png" },
      });
    });

    await fetchImageBytes("https://raw.githubusercontent.com/o/r/main/a.png", {
      token: "ghp_x",
      fetchImpl,
    });
    await fetchImageBytes("https://example.com/a.png", {
      token: "ghp_x",
      fetchImpl,
    });
    expect(seen[0].Authorization).toBe("Bearer ghp_x");
    expect(seen[1].Authorization).toBeUndefined();
  });

  test("rejects non-image responses and failures", async () => {
    const html = asFetch(
      async () =>
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        }),
    );
    expect(
      await fetchImageBytes("https://example.com/page", { fetchImpl: html }),
    ).toBeNull();

    const svg = asFetch(
      async () =>
        new Response("<svg/>", {
          headers: { "content-type": "image/svg+xml" },
        }),
    );
    expect(
      await fetchImageBytes("https://example.com/a.svg", { fetchImpl: svg }),
    ).toBeNull();

    const missing = asFetch(async () => new Response("nope", { status: 404 }));
    expect(
      await fetchImageBytes("https://example.com/x.png", {
        fetchImpl: missing,
      }),
    ).toBeNull();

    const boom = asFetch(async () => {
      throw new Error("network down");
    });
    expect(
      await fetchImageBytes("https://example.com/y.png", { fetchImpl: boom }),
    ).toBeNull();
  });

  test("refuses oversized images", async () => {
    const big = asFetch(
      async () =>
        new Response(new Uint8Array([1]), {
          headers: {
            "content-type": "image/png",
            "content-length": String(MAX_IMAGE_BYTES + 1),
          },
        }),
    );
    expect(
      await fetchImageBytes("https://example.com/big.png", { fetchImpl: big }),
    ).toBeNull();
  });

  test("decodes inline data URIs without a network call", async () => {
    const bytes = await fetchImageBytes("data:image/png;base64,AQID", {
      fetchImpl: asFetch(async () => {
        throw new Error("should not fetch");
      }),
    });
    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3]);
  });
});
