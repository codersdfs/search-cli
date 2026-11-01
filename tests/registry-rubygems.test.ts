// RubyGems search.json answers with a bare array (no envelope, no total) and
// ignores every size parameter, returning at most 30 gems. The provider has to
// respect both, and must never invent a total it was not given.
import { describe, it, expect, afterEach } from "vitest";
import {
  normalizeGem,
  rubygemsProvider,
  rubygemsSearchUrl,
} from "../src/registries/rubygems.ts";
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

const GEM = {
  name: "thor",
  version: "1.4.0",
  info: "Parser, framework, and monolithic tools",
  downloads: 729093,
  authors: "Jakub Pastuszek",
  licenses: ["MIT"],
  project_uri: "https://rubygems.org/gems/thor",
  homepage_uri: "http://github.com/jpastuszek/thor",
};

describe("rubygemsSearchUrl", () => {
  it("sends the query as ?query= and adds no size parameter", () => {
    expect(rubygemsSearchUrl("pdf reader")).toBe(
      "https://rubygems.org/api/v1/search.json?query=pdf%20reader",
    );
  });
});

describe("normalizeGem", () => {
  it("maps a gem to Package with lifetime downloads", () => {
    expect(normalizeGem(GEM)).toMatchObject({
      name: "thor",
      version: "1.4.0",
      description: "Parser, framework, and monolithic tools",
      url: "https://rubygems.org/gems/thor",
      downloads: 729093,
      score: 0,
      publisher: "Jakub Pastuszek",
      keywords: [],
      registry: "rubygems",
    });
  });

  it("falls back to the canonical gem URL when project_uri is missing", () => {
    expect(normalizeGem({ name: "rails" }).url).toBe(
      "https://rubygems.org/gems/rails",
    );
  });

  it("does not confuse licenses with keywords", () => {
    expect(normalizeGem(GEM).keywords).toEqual([]);
  });
});

describe("rubygemsProvider.search", () => {
  it("is registered under the rubygems id", () => {
    expect(getProvider("rubygems")).toBe(rubygemsProvider);
  });

  it("reads the bare array and truncates to the server's 30-row cap", async () => {
    const rows = Array.from({ length: 35 }, (_, i) => ({ name: `gem-${i}` }));
    globalThis.fetch = (async () =>
      jsonResponse(rows)) as unknown as typeof fetch;
    const res = await rubygemsProvider.search("gem", 50);
    expect(res.packages).toHaveLength(30);
    // The API gives no total: report what we actually have, not a guess.
    expect(res.totalCount).toBe(30);
  });

  it("honours a smaller limit", async () => {
    const rows = Array.from({ length: 35 }, (_, i) => ({ name: `gem-${i}` }));
    globalThis.fetch = (async () =>
      jsonResponse(rows)) as unknown as typeof fetch;
    const res = await rubygemsProvider.search("gem", 5);
    expect(res.packages).toHaveLength(5);
    expect(res.totalCount).toBe(5);
  });

  it("tolerates a non-array payload", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "nope" })) as unknown as typeof fetch;
    const res = await rubygemsProvider.search("gem", 20);
    expect(res.packages).toEqual([]);
  });

  it("throws an error naming the registry on a failed request", async () => {
    globalThis.fetch = (async () =>
      new Response("boom", { status: 502 })) as unknown as typeof fetch;
    await expect(rubygemsProvider.search("gem", 20)).rejects.toThrow(
      "RubyGems search failed: HTTP 502",
    );
  });
});
