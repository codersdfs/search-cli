// NuGet's V3 search lives on the azuresearch host only (api.nuget.org/v3/search
// is a 404) and answers with { totalHits, data: [...] }. The download figure is
// a lifetime tally, which the catalog labels; nothing here may present it as
// monthly.
import { describe, it, expect, afterEach } from "vitest";
import {
  normalizeNugetPackage,
  nugetProvider,
  nugetSearchUrl,
} from "../src/registries/nuget.ts";
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

const PKG = {
  id: "Serilog",
  version: "4.4.0",
  title: "Serilog",
  description: "Simple .NET logging",
  summary: "",
  authors: ["Serilog Contributors"],
  tags: ["serilog", "logging", "semantic"],
  totalDownloads: 3519132032,
  projectUrl: "https://serilog.net/",
  verified: true,
};

describe("nugetSearchUrl", () => {
  it("targets the azuresearch host with take/skip", () => {
    expect(nugetSearchUrl("logging framework", 25)).toBe(
      "https://azuresearch-usnc.nuget.org/query?q=logging%20framework&take=25&skip=0",
    );
  });

  it("requests at most NuGet's ceiling", () => {
    expect(nugetSearchUrl("cli", 250)).toContain("take=250");
  });
});

describe("normalizeNugetPackage", () => {
  it("maps a NuGet row to Package with lifetime downloads", () => {
    expect(normalizeNugetPackage(PKG)).toMatchObject({
      name: "Serilog",
      version: "4.4.0",
      description: "Simple .NET logging",
      url: "https://serilog.net/",
      downloads: 3519132032,
      score: 0,
      publisher: "Serilog Contributors",
      keywords: ["serilog", "logging", "semantic"],
      registry: "nuget",
    });
  });

  it("falls back to description then title when summary is empty", () => {
    expect(
      normalizeNugetPackage({
        id: "x",
        description: null,
        title: "Fallback Title",
      }).description,
    ).toBe("Fallback Title");
  });

  it("builds a package page URL when projectUrl is missing", () => {
    expect(normalizeNugetPackage({ id: "Serilog" }).url).toBe(
      "https://www.nuget.org/packages/Serilog",
    );
  });

  it("joins multi-element authors, which arrive as arrays", () => {
    expect(
      normalizeNugetPackage({ id: "x", authors: ["A", "B"] }).publisher,
    ).toBe("A, B");
  });
});

describe("nugetProvider.search", () => {
  it("is registered under the nuget id", () => {
    expect(getProvider("nuget")).toBe(nugetProvider);
  });

  it("reads totalHits and data", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        totalHits: 2381,
        data: [PKG],
      })) as unknown as typeof fetch;
    const res = await nugetProvider.search("serilog", 20);
    expect(res.totalCount).toBe(2381);
    expect(res.packages[0].name).toBe("Serilog");
  });

  it("tolerates a payload with no data array", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({})) as unknown as typeof fetch;
    const res = await nugetProvider.search("nothing", 20);
    expect(res.packages).toEqual([]);
    expect(res.totalCount).toBe(0);
  });

  it("clamps a too-large limit to 250 before fetching", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse({ totalHits: 0, data: [] });
    }) as unknown as typeof fetch;
    await nugetProvider.search("cli", 900);
    expect(seenUrl).toContain("take=250");
  });

  it("throws an error naming the registry on a failed request", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 429 })) as unknown as typeof fetch;
    await expect(nugetProvider.search("serilog", 20)).rejects.toThrow(
      "NuGet search failed: HTTP 429",
    );
  });
});
