// Tests for buildTrendingUrl + TRENDING_LANGUAGES (MCP trending tool support)
import { describe, expect, test } from "vitest";
import {
  buildTrendingUrl,
  TRENDING_LANGUAGES,
  resolveTrendingLanguage,
  trendingLanguageSlug,
} from "../src/search.ts";

describe("buildTrendingUrl", () => {
  test("daily with no language is the bare trending URL", () => {
    expect(buildTrendingUrl("daily")).toBe("https://github.com/trending");
  });

  test("daily omits the since param (the page default)", () => {
    const url = buildTrendingUrl("daily", "rust");
    expect(url).toBe("https://github.com/trending?language=rust");
  });

  test("weekly/monthly append since", () => {
    expect(buildTrendingUrl("weekly")).toBe(
      "https://github.com/trending?since=weekly",
    );
    expect(buildTrendingUrl("monthly", "python")).toBe(
      "https://github.com/trending?since=monthly&language=python",
    );
  });

  test("language is lowercased (slug form)", () => {
    expect(buildTrendingUrl("daily", "TypeScript")).toBe(
      "https://github.com/trending?language=typescript",
    );
  });

  test("unknown languages are dropped, not sent to GitHub", () => {
    expect(buildTrendingUrl("weekly", "notalang")).toBe(
      "https://github.com/trending?since=weekly",
    );
  });

  test("multi-word languages map to their slug (c#, c++, jupyter)", () => {
    expect(buildTrendingUrl("daily", "C#")).toBe(
      "https://github.com/trending?language=c%23",
    );
    expect(buildTrendingUrl("daily", "C++")).toBe(
      "https://github.com/trending?language=c%2B%2B",
    );
    expect(buildTrendingUrl("daily", "Jupyter Notebook")).toBe(
      "https://github.com/trending?language=jupyter-notebook",
    );
  });
});

describe("resolveTrendingLanguage", () => {
  test("empty/missing input returns undefined (no filter)", () => {
    expect(resolveTrendingLanguage(undefined)).toBeUndefined();
    expect(resolveTrendingLanguage(null)).toBeUndefined();
    expect(resolveTrendingLanguage("")).toBeUndefined();
    expect(resolveTrendingLanguage("   ")).toBeUndefined();
  });

  test("valid languages return their slug", () => {
    expect(resolveTrendingLanguage("rust")).toBe("rust");
    expect(resolveTrendingLanguage("TypeScript")).toBe("typescript");
    expect(resolveTrendingLanguage("C#")).toBe("c#");
    expect(resolveTrendingLanguage("Jupyter Notebook")).toBe(
      "jupyter-notebook",
    );
  });

  test("unknown languages throw with a suggestion list", () => {
    expect(() => resolveTrendingLanguage("klingon")).toThrow(
      /not a trending language filter/,
    );
    expect(() => resolveTrendingLanguage("klingon")).toThrow(/rust, python/);
  });
});

describe("TRENDING_LANGUAGES", () => {
  test("contains common language slugs", () => {
    for (const slug of ["rust", "python", "typescript", "go", "zig"]) {
      expect(TRENDING_LANGUAGES.has(slug), slug).toBe(true);
    }
  });

  test("every slug is lowercase (slug form)", () => {
    for (const slug of TRENDING_LANGUAGES) {
      expect(slug).toBe(slug.toLowerCase());
    }
  });
});
