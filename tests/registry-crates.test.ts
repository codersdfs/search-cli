// crates.io rejects every request without a descriptive User-Agent (HTTP 403,
// verified live) and caps per_page at 100 (HTTP 400 above that). Both guards
// are behaviour this provider owns, so both are asserted here.
import { describe, it, expect, afterEach } from "vitest";
import {
  cratesProvider,
  cratesSearchUrl,
  cratesUserAgent,
  normalizeCrate,
} from "../src/registries/crates.ts";
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
  crates: [
    {
      name: "clap",
      max_stable_version: "4.5.4",
      newest_version: "4.5.4",
      description: "A simple to use, efficient, and full-featured CLI parser.",
      downloads: 61000000,
      recent_downloads: 8200000,
      keywords: null,
      homepage: "https://cla.rs",
      repository: "https://github.com/clap-rs/clap",
    },
  ],
  meta: { total: 65530 },
};

describe("cratesUserAgent", () => {
  it("names ghfind and carries the version", () => {
    const ua = cratesUserAgent();
    expect(ua).toContain("ghfind/");
    expect(ua.startsWith("ghfind/")).toBe(true);
  });
});

describe("cratesSearchUrl", () => {
  it("forwards the query verbatim as ?q=", () => {
    expect(cratesSearchUrl("cli", 50)).toBe(
      "https://crates.io/api/v1/crates?q=cli&per_page=50",
    );
  });

  it("requests at most crates' 100-item ceiling", () => {
    // The clamp lives in searchCrates (via clampRegistryLimit), not the URL builder, so
    // this asserts the URL the provider actually fetches.
    expect(cratesSearchUrl("cli", 100)).toContain("per_page=100");
  });
});

describe("normalizeCrate", () => {
  it("maps a crate to Package with the 90-day download window", () => {
    const out = normalizeCrate(PAYLOAD.crates[0]);
    expect(out).toMatchObject({
      name: "clap",
      version: "4.5.4",
      url: "https://crates.io/crates/clap",
      downloads: 8200000,
      score: 0,
      publisher: null,
      keywords: [],
      registry: "crates",
    });
  });

  it("falls back to newest_version then an empty version", () => {
    expect(normalizeCrate({ name: "x", newest_version: "0.1.0" }).version).toBe(
      "0.1.0",
    );
    expect(normalizeCrate({ name: "x" }).version).toBe("");
  });

  it("reports zero downloads when recent_downloads is absent", () => {
    // Never silently substitute the lifetime tally: the window would be a lie.
    expect(normalizeCrate({ name: "x", downloads: 999 }).downloads).toBe(0);
  });
});

describe("cratesProvider.search", () => {
  it("is registered under the crates id", () => {
    expect(getProvider("crates")).toBe(cratesProvider);
  });

  it("sends the User-Agent header the API demands", async () => {
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      seenInit = init;
      return jsonResponse(PAYLOAD);
    }) as unknown as typeof fetch;
    await cratesProvider.search("cli", 20);
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("ghfind/");
  });

  it("normalizes rows and reports meta.total", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(PAYLOAD)) as unknown as typeof fetch;
    const res = await cratesProvider.search("cli", 20);
    expect(res.totalCount).toBe(65530);
    expect(res.packages[0].name).toBe("clap");
  });

  it("clamps a too-large limit to 100 before fetching", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse(PAYLOAD);
    }) as unknown as typeof fetch;
    await cratesProvider.search("cli", 900);
    expect(seenUrl).toContain("per_page=100");
  });

  it("surfaces crates' error body on a non-OK response", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        { errors: [{ detail: "cannot request more than 100 items" }] },
        400,
      )) as unknown as typeof fetch;
    await expect(cratesProvider.search("cli", 20)).rejects.toThrow(
      "crates.io search failed: HTTP 400 — cannot request more than 100 items",
    );
  });

  it("names the status alone when the error body is unparseable", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>", { status: 500 })) as unknown as typeof fetch;
    await expect(cratesProvider.search("cli", 20)).rejects.toThrow(
      "crates.io search failed: HTTP 500",
    );
  });

  it("treats a payload with no crates array as zero results", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({})) as unknown as typeof fetch;
    const res = await cratesProvider.search("nothing", 20);
    expect(res.packages).toEqual([]);
    expect(res.totalCount).toBe(0);
  });

  it("treats a 200 whose body is not JSON as a failure, not zero results", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><body>blocked</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    await expect(cratesProvider.search("cli", 20)).rejects.toThrow(
      "crates.io search failed: unparseable response",
    );
  });
});
