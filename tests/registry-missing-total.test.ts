// When a registry publishes no total, the pipeline must mark the count a
// bound — never report packages.length as an exact tally. Four of the five
// registries used to substitute the page length silently; only RubyGems was
// honest. This suite pins the shared policy for every provider.
import { describe, it, expect, afterEach } from "vitest";
import { npmProvider } from "../src/registries/npm.ts";
import { cratesProvider } from "../src/registries/crates.ts";
import { rubygemsProvider } from "../src/registries/rubygems.ts";
import { nugetProvider } from "../src/registries/nuget.ts";
import { mavenProvider } from "../src/registries/maven.ts";
import { formatTotalCount } from "../src/package.ts";
import type { PackageProvider } from "../src/registries/types.ts";

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

/** Payloads with no total field, in each registry's envelope. */
const NO_TOTAL_FIXTURES: Array<{
  name: string;
  provider: PackageProvider;
  body: unknown;
  rowCount: number;
}> = [
  {
    name: "npm",
    provider: npmProvider,
    body: { objects: [{ package: { name: "a" } }, { package: { name: "b" } }] },
    rowCount: 2,
  },
  {
    name: "crates",
    provider: cratesProvider,
    body: { crates: [{ name: "a" }, { name: "b" }] },
    rowCount: 2,
  },
  {
    name: "rubygems",
    provider: rubygemsProvider,
    body: [{ name: "a" }, { name: "b" }],
    rowCount: 2,
  },
  {
    name: "nuget",
    provider: nugetProvider,
    body: { data: [{ id: "A" }, { id: "B" }] },
    rowCount: 2,
  },
  {
    name: "maven",
    provider: mavenProvider,
    body: {
      response: {
        docs: [
          { g: "x", a: "y" },
          { g: "x", a: "z" },
        ],
      },
    },
    rowCount: 2,
  },
];

describe("missing registry totals are reported as bounds", () => {
  for (const { name, provider, body, rowCount } of NO_TOTAL_FIXTURES) {
    it(`${name} sets totalIsExact: false and totalCount = rows`, async () => {
      globalThis.fetch = (async () =>
        jsonResponse(body)) as unknown as typeof fetch;
      const res = await provider.search("query", 10);
      expect(res.packages).toHaveLength(rowCount);
      expect(res.totalCount).toBe(rowCount);
      expect(res.totalIsExact).toBe(false);
    });
  }

  it("leaves totalIsExact absent when the registry reports one", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ total: 42, objects: [] })) as unknown as typeof fetch;
    const res = await npmProvider.search("query", 10);
    expect(res.totalCount).toBe(42);
    expect(res.totalIsExact).toBeUndefined();
  });
});

describe("formatTotalCount", () => {
  it("prints a grouped number for exact totals", () => {
    expect(formatTotalCount({ totalCount: 447322 })).toBe("447,322");
  });

  it("suffixes a bound with +", () => {
    expect(formatTotalCount({ totalCount: 30, totalIsExact: false })).toBe(
      "30+",
    );
  });

  it("treats absent as exact", () => {
    expect(formatTotalCount({ totalCount: 7, totalIsExact: true })).toBe("7");
  });
});
