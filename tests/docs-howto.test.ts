import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseQuery,
  validateQuery,
  resolveQualifierKey,
  buildGitHubQuery,
  suggestRelaxations,
} from "../src/search.ts";

// Resolve the doc relative to this file, so the test works from any checkout
// path and on any platform (a hardcoded /mnt/c path breaks on Windows).
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = readFileSync(join(repoRoot, "docs", "HOW-TO.md"), "utf-8");

describe("docs/HOW-TO.md claims stay true", () => {
  it("every qualifier in the table is a real, accepted qualifier", () => {
    // Scope to the qualifier-reference table only (between its heading and the
    // next one), so the TUI key table's `r`/`t`/`u`/`c` rows don't leak in.
    const section = doc
      .split("## Qualifier reference")[1]
      .split("## Read the results")[0];
    const rows = section
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.includes("Qualifier"));
    const keys = new Set<string>();
    for (const r of rows) {
      const m = r.match(/^\|\s*`([a-z]+):?`/);
      if (m) keys.add(m[1]);
    }
    // Use a realistic value per key: `fork:1` is genuinely invalid.
    const sample: Record<string, string> = {
      language: "Rust",
      stars: "10k",
      forks: ">100",
      topics: ">3",
      followers: ">=10",
      size: "<1000",
      fork: "only",
      archived: "false",
      topic: "cli",
      user: "torvalds",
      org: "rust-lang",
      repo: "facebook/react",
      in: "name,description",
      pushed: ">2024-01-01",
      created: ">2020-01-01",
      updated: ">2024-06-01",
      license: "apache-2.0",
      visibility: "public",
    };
    for (const k of keys) {
      const v = sample[k];
      expect(v, `no sample value for documented key ${k}`).toBeTruthy();
      expect(
        () => validateQuery(parseQuery(`x ${k}:${v}`)),
        `${k}:${v}`,
      ).not.toThrow();
    }
  });
  it("claims: typos are corrected", () => {
    expect(resolveQualifierKey("langauge")).toBe("language");
    expect(resolveQualifierKey("star")).toBe("stars");
    expect(resolveQualifierKey("push")).toBe("pushed");
  });
  it("claims: stars:10k normalizes, bare 100 stays exact", () => {
    expect(buildGitHubQuery(parseQuery("cli stars:10k"))).toBe(
      "cli stars:>=10000",
    );
    expect(buildGitHubQuery(parseQuery("cli stars:100"))).toBe("cli stars:100");
    expect(buildGitHubQuery(parseQuery("cli stars:>=10000"))).toBe(
      "cli stars:>=10000",
    );
    expect(buildGitHubQuery(parseQuery("cli stars:1k..10k"))).toBe(
      "cli stars:1000..10000",
    );
  });
  it("claims: fork:only valid, forks is a count", () => {
    expect(() => validateQuery(parseQuery("x fork:only"))).not.toThrow();
    expect(() => validateQuery(parseQuery("x forks:100"))).not.toThrow();
    expect(() => validateQuery(parseQuery("x forks:abc"))).toThrow();
  });
  it("claims: quoted phrase stays a phrase", () => {
    expect(
      buildGitHubQuery(parseQuery('"machine learning" language:Python')),
    ).toBe('"machine learning" language:Python');
  });
  it("claims: in:name,description is valid", () => {
    expect(() =>
      validateQuery(parseQuery("x in:name,description")),
    ).not.toThrow();
  });
  it("claims: date qualifiers accept >YYYY-MM-DD", () => {
    for (const k of ["pushed", "created", "updated"]) {
      expect(() =>
        validateQuery(parseQuery(`x ${k}:>2024-01-01`)),
      ).not.toThrow();
    }
  });
  it("claims: visibility enum", () => {
    for (const v of ["public", "private", "internal"]) {
      expect(() =>
        validateQuery(parseQuery(`x visibility:${v}`)),
      ).not.toThrow();
    }
    expect(() => validateQuery(parseQuery("x visibility:secret"))).toThrow();
  });
  it("claims: negation works on any qualifier", () => {
    expect(
      buildGitHubQuery(parseQuery("cli topic:cli -language:JavaScript")),
    ).toBe("cli topic:cli -language:JavaScript");
  });
  it("claims: relaxation suggestion shape matches the doc example", () => {
    const r = suggestRelaxations(parseQuery("rust stars:>=5000000"));
    expect(r[0].suggestion).toBe("rust stars:>=500000");
  });
  it("claims: rate limits are 60/hr vs 5000/hr (text)", () => {
    expect(doc).toContain("60 requests/hour");
    expect(doc).toContain("5,000/hour");
  });
});
