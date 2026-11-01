// The npm provider is the reference implementation of the PackageProvider seam:
// pass-through query, per-registry ceiling, one fetch, normalized Package rows.
import { describe, it, expect, afterEach } from "vitest";
import { npmProvider, npmSearchUrl } from "../src/registries/npm.ts";
import { getProvider } from "../src/registries/index.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PAYLOAD = {
  total: 447322,
  objects: [
    {
      package: {
        name: "cli",
        version: "1.0.1",
        description: "A tool for rapidly building command line apps",
        keywords: ["cli", "command line"],
        links: { npm: "https://www.npmjs.com/package/cli" },
        publisher: { username: "cohara87" },
      },
      downloads: { monthly: 3854909 },
      score: { final: 1666.63 },
    },
  ],
};

describe("npmSearchUrl", () => {
  it("forwards the query verbatim, url-encoded", () => {
    expect(npmSearchUrl("terminal ui", 50)).toBe(
      "https://registry.npmjs.org/-/v1/search?text=terminal%20ui&size=50",
    );
  });

  it("passes registry-native qualifiers through untouched", () => {
    expect(npmSearchUrl("scope:express not:unstable", 10)).toContain(
      "text=scope%3Aexpress%20not%3Aunstable",
    );
  });
});

describe("npmProvider.search", () => {
  it("is registered under the npm id", () => {
    expect(getProvider("npm")).toBe(npmProvider);
    expect(npmProvider.id).toBe("npm");
  });

  it("normalizes objects and reports the registry total", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse(PAYLOAD);
    }) as unknown as typeof fetch;
    const res = await npmProvider.search("cli", 50);
    expect(seenUrl).toContain("text=cli");
    expect(res.totalCount).toBe(447322);
    expect(res.packages[0]).toMatchObject({
      name: "cli",
      version: "1.0.1",
      downloads: 3854909,
      score: 1666.63,
      publisher: "cohara87",
      registry: "npm",
    });
  });

  it("clamps size to npm's 250 ceiling", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse(PAYLOAD);
    }) as unknown as typeof fetch;
    await npmProvider.search("cli", 900);
    expect(seenUrl).toContain("size=250");
  });

  it("sends a User-Agent and accepts JSON", async () => {
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      seenInit = init;
      return jsonResponse(PAYLOAD);
    }) as unknown as typeof fetch;
    await npmProvider.search("cli", 20);
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("ghfind");
    expect(headers.Accept).toBe("application/json");
  });

  it("throws an error naming the registry and status on a failed request", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({}, 503)) as unknown as typeof fetch;
    await expect(npmProvider.search("cli", 20)).rejects.toThrow(
      "npm search failed: HTTP 503",
    );
  });

  it("tolerates a payload with no objects array", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ total: 0 })) as unknown as typeof fetch;
    const res = await npmProvider.search("nothing", 20);
    expect(res.packages).toEqual([]);
    expect(res.totalCount).toBe(0);
  });
});
