import { describe, it, expect } from "vitest";
import {
  parseQuery,
  buildGitHubQuery,
  validateQuery,
  validateQualifierValue,
  normalizeQualifierValue,
  resolveQualifierKey,
  suggestFor,
  suggestRelaxations,
  parseCount,
  isValidISODate,
} from "../src/search.ts";
import { BadQueryError, NoResultsError } from "../src/errors.ts";

/** Assert that validating `raw` throws a BadQueryError, and return it. */
function badQuery(raw: string): BadQueryError {
  try {
    validateQuery(parseQuery(raw));
  } catch (err) {
    expect(err).toBeInstanceOf(BadQueryError);
    return err as BadQueryError;
  }
  throw new Error(`expected "${raw}" to be rejected, but it validated`);
}

/** Assert `raw` validates without throwing. */
function accepts(raw: string): void {
  expect(() => validateQuery(parseQuery(raw))).not.toThrow();
}

describe("parseCount", () => {
  it("parses plain integers", () => {
    expect(parseCount("100")).toBe(100);
    expect(parseCount("0")).toBe(0);
  });

  it("parses k/m magnitude suffixes", () => {
    expect(parseCount("10k")).toBe(10_000);
    expect(parseCount("2m")).toBe(2_000_000);
    expect(parseCount("1.5m")).toBe(1_500_000);
    expect(parseCount("5K")).toBe(5_000);
  });

  it("ignores underscore separators", () => {
    expect(parseCount("2_000")).toBe(2000);
  });

  it("rejects non-numbers", () => {
    expect(parseCount("abc")).toBeNull();
    expect(parseCount("")).toBeNull();
    expect(parseCount("-5")).toBeNull();
    // A bare fraction is a typo, not a quantity — GitHub counts are integers.
    expect(parseCount("1.5")).toBeNull();
  });
});

describe("isValidISODate", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(isValidISODate("2024-01-01")).toBe(true);
  });

  it("accepts full ISO8601 with time and offset", () => {
    expect(isValidISODate("2024-01-01T12:30:45+00:00")).toBe(true);
    expect(isValidISODate("2024-01-01T00:00:00Z")).toBe(true);
  });

  it("rejects malformed and calendar-invalid dates", () => {
    expect(isValidISODate("not-a-date")).toBe(false);
    expect(isValidISODate("2024-13-01")).toBe(false);
    expect(isValidISODate("2024-02-31")).toBe(false);
    // 2023 was not a leap year.
    expect(isValidISODate("2023-02-29")).toBe(false);
    expect(isValidISODate("2024-02-29")).toBe(true);
  });
});

describe("normalizeQualifierValue", () => {
  it("expands magnitude sugar to a >= bound", () => {
    expect(normalizeQualifierValue("stars", "10k")).toBe(">=10000");
    expect(normalizeQualifierValue("stars", "2m")).toBe(">=2000000");
  });

  it("expands both ends of a range", () => {
    expect(normalizeQualifierValue("stars", "1k..10k")).toBe("1000..10000");
  });

  it("leaves an explicit operator or plain count alone", () => {
    expect(normalizeQualifierValue("stars", ">=100")).toBe(">=100");
    expect(normalizeQualifierValue("stars", "<=50")).toBe("<=50");
    // GitHub reads a bare count as exact-match; rewriting it to >= would
    // silently change the question.
    expect(normalizeQualifierValue("stars", "100")).toBe("100");
  });

  it("normalizes sugar that already carries an operator", () => {
    expect(normalizeQualifierValue("stars", ">=10k")).toBe(">=10000");
    expect(normalizeQualifierValue("stars", "<1m")).toBe("<1000000");
  });

  it("keeps the operator on a sugared range", () => {
    expect(normalizeQualifierValue("stars", ">=1k..10k")).toBe(">=1000..10000");
  });

  it("does not touch non-numeric qualifiers", () => {
    expect(normalizeQualifierValue("language", "Rust")).toBe("Rust");
    expect(normalizeQualifierValue("topic", "10k")).toBe("10k");
  });

  it("leaves unparseable values for validation to reject", () => {
    expect(normalizeQualifierValue("stars", "abc")).toBe("abc");
  });
});

describe("resolveQualifierKey", () => {
  it("passes known keys through unchanged", () => {
    for (const k of ["language", "stars", "topic", "pushed", "fork"]) {
      expect(resolveQualifierKey(k)).toBe(k);
    }
  });

  it("corrects known misspellings", () => {
    expect(resolveQualifierKey("langauge")).toBe("language");
    expect(resolveQualifierKey("lang")).toBe("language");
    expect(resolveQualifierKey("star")).toBe("stars");
    expect(resolveQualifierKey("push")).toBe("pushed");
    expect(resolveQualifierKey("licence")).toBe("license");
  });

  it("corrects near-misses by edit distance", () => {
    expect(resolveQualifierKey("starss")).toBe("stars");
    expect(resolveQualifierKey("languag")).toBe("language");
  });

  it("is case-insensitive", () => {
    expect(resolveQualifierKey("Language")).toBe("language");
    expect(resolveQualifierKey("LANGAUGE")).toBe("language");
  });

  it("never rewrites short keys into a known qualifier", () => {
    // `is:public` is a valid GitHub qualifier sitting one edit from `in`.
    // Rewriting it would break a working query.
    expect(resolveQualifierKey("is")).toBe("is");
    expect(resolveQualifierKey("has")).toBe("has");
  });

  it("leaves unknown keys untouched", () => {
    expect(resolveQualifierKey("props.environment")).toBe("props.environment");
    expect(resolveQualifierKey("followers")).toBe("followers");
    expect(resolveQualifierKey("totallyunknown")).toBe("totallyunknown");
  });

  it("prefers an exact key over a near-miss", () => {
    // `fork` and `forks` are both real GitHub qualifiers with different value
    // rules; collapsing one into the other would break `forks:100`.
    expect(resolveQualifierKey("forks")).toBe("forks");
    expect(resolveQualifierKey("fork")).toBe("fork");
  });
});

describe("parseQuery normalization", () => {
  it("rewrites a misspelled qualifier key in place", () => {
    const q = parseQuery("cli langauge:Rust");
    expect(q.qualifiers).toContainEqual({
      key: "language",
      value: "Rust",
      negated: false,
    });
  });

  it("records each correction for the warning path", () => {
    const q = parseQuery("cli langauge:Rust stars:10k");
    expect(q.corrections).toEqual([
      { from: "langauge:Rust", to: "language:Rust" },
      { from: "stars:10k", to: "stars:>=10000" },
    ]);
  });

  it("reports no corrections for an already-canonical query", () => {
    expect(parseQuery("cli language:Rust stars:100").corrections).toEqual([]);
  });

  it("preserves keyword order and raw text verbatim", () => {
    const q = parseQuery("rust cli github search");
    expect(q.keywords).toEqual(["rust", "cli", "github", "search"]);
    expect(q.raw).toBe("rust cli github search");
  });

  it("does not reorder keywords when correcting a qualifier", () => {
    // Re-parsing a corrected copy of the query string would risk changing
    // this order; the in-place rewrite must not.
    const q = parseQuery("rust cli langauge:zig");
    expect(q.keywords).toEqual(["rust", "cli"]);
    expect(buildGitHubQuery(q)).toBe("rust cli language:zig");
  });

  it("keeps raw untouched while normalizing qualifiers", () => {
    const q = parseQuery("cli langauge:Rust stars:10k");
    expect(q.raw).toBe("cli langauge:Rust stars:10k");
    expect(buildGitHubQuery(q)).toBe("cli language:Rust stars:>=10000");
  });

  it("corrects a negated misspelled qualifier", () => {
    const q = parseQuery("-langauge:JavaScript");
    expect(q.qualifiers).toContainEqual({
      key: "language",
      value: "JavaScript",
      negated: true,
    });
  });

  it("leaves an unknown-but-valid qualifier in place", () => {
    const q = parseQuery("cli props.environment:production");
    expect(q.qualifiers).toContainEqual({
      key: "props.environment",
      value: "production",
      negated: false,
    });
    expect(q.corrections).toEqual([]);
  });

  it("keeps a valid is: qualifier rather than rewriting it to in:", () => {
    const q = parseQuery("pages is:public");
    expect(buildGitHubQuery(q)).toBe("pages is:public");
  });
});

describe("validateQualifierValue — numeric qualifiers", () => {
  it("accepts counts, operators, ranges, and k/m sugar", () => {
    for (const v of [
      "100",
      ">100",
      ">=100",
      "<100",
      "<=100",
      "100..500",
      "10k",
      "1m",
      "1k..10k",
    ]) {
      expect(validateQualifierValue("stars", v)).toBeNull();
    }
  });

  it("rejects a non-numeric count with a concrete example", () => {
    const problem = validateQualifierValue("stars", "abc");
    expect(problem).toMatch(/not a number/);
    expect(problem).toContain("stars:>=100");
  });

  it("rejects a reversed range", () => {
    expect(validateQualifierValue("stars", "500..100")).toMatch(/reversed/);
  });

  it("rejects an empty value", () => {
    expect(validateQualifierValue("stars", "")).toMatch(/needs a value/);
  });

  it("applies the same rules to forks and size", () => {
    expect(validateQualifierValue("forks", "abc")).toMatch(/not a number/);
    expect(validateQualifierValue("size", "abc")).toMatch(/not a number/);
    expect(validateQualifierValue("size", ">=30000")).toBeNull();
  });
});

describe("validateQualifierValue — boolean qualifiers", () => {
  it("accepts true/false for fork and archived", () => {
    expect(validateQualifierValue("fork", "true")).toBeNull();
    expect(validateQualifierValue("fork", "false")).toBeNull();
    expect(validateQualifierValue("archived", "true")).toBeNull();
  });

  it("accepts the documented fork:only form", () => {
    expect(validateQualifierValue("fork", "only")).toBeNull();
  });

  it("rejects other fork values", () => {
    expect(validateQualifierValue("fork", "yes")).toMatch(/fork:true/);
  });

  it("rejects a non-boolean archived value", () => {
    expect(validateQualifierValue("archived", "maybe")).toMatch(
      /archived:true/,
    );
  });

  it("is case-insensitive", () => {
    expect(validateQualifierValue("archived", "TRUE")).toBeNull();
  });
});

describe("validateQualifierValue — date qualifiers", () => {
  it("accepts ISO8601 dates with operators and ranges", () => {
    for (const v of [
      "2024-01-01",
      ">2024-01-01",
      ">=2013-02-01",
      "<2011-01-01",
      "2020-01-01..2024-01-01",
      "2024-01-01T12:00:00+00:00",
    ]) {
      expect(validateQualifierValue("pushed", v)).toBeNull();
    }
  });

  it("rejects a non-date value", () => {
    expect(validateQualifierValue("pushed", "yesterday")).toMatch(
      /not a valid date/,
    );
  });

  it("rejects a calendar-invalid date", () => {
    expect(validateQualifierValue("created", "2024-13-45")).toMatch(
      /not a valid date/,
    );
  });

  it("validates created and updated too", () => {
    expect(validateQualifierValue("created", "nope")).toMatch(
      /not a valid date/,
    );
    expect(validateQualifierValue("updated", "nope")).toMatch(
      /not a valid date/,
    );
  });
});

describe("validateQualifierValue — other keys", () => {
  it("validates visibility against its enum", () => {
    expect(validateQualifierValue("visibility", "public")).toBeNull();
    expect(validateQualifierValue("visibility", "internal")).toBeNull();
    expect(validateQualifierValue("visibility", "secret")).toMatch(
      /visibility:public/,
    );
  });

  it("accepts the documented comma-list form of in:", () => {
    expect(validateQualifierValue("in", "name")).toBeNull();
    expect(validateQualifierValue("in", "name,description")).toBeNull();
    expect(validateQualifierValue("in", "readme")).toBeNull();
  });

  it("rejects an unknown in: field", () => {
    expect(validateQualifierValue("in", "commits")).toMatch(
      /not a searchable field/,
    );
  });

  it("does not check opaque identifier values", () => {
    expect(validateQualifierValue("user", "octocat")).toBeNull();
    expect(validateQualifierValue("org", "github")).toBeNull();
    expect(validateQualifierValue("topic", "machine-learning")).toBeNull();
    expect(validateQualifierValue("license", "apache-2.0")).toBeNull();
  });

  it("does not check unknown qualifier keys at all", () => {
    // ghfind does not own GitHub's full qualifier set, so anything it does
    // not recognize must pass through untouched — including keys that look
    // like they ought to be validated.
    expect(validateQualifierValue("mirror", "yes")).toBeNull();
    expect(validateQualifierValue("props.environment", "whatever")).toBeNull();
    expect(validateQualifierValue("has", "funding-file")).toBeNull();
    expect(validateQualifierValue("is", "public")).toBeNull();
  });

  it("validates followers as a count", () => {
    expect(validateQualifierValue("followers", ">=10000")).toBeNull();
    expect(validateQualifierValue("followers", "notanumber")).toMatch(
      /not a number/,
    );
  });

  it("distinguishes forks (count) from fork (boolean)", () => {
    expect(validateQualifierValue("forks", "100")).toBeNull();
    expect(validateQualifierValue("forks", "abc")).toMatch(/not a number/);
    expect(validateQualifierValue("fork", "only")).toBeNull();
  });
});

describe("validateQuery", () => {
  it("accepts valid queries", () => {
    accepts("cli language:Rust");
    accepts("rust cli stars:10k");
    accepts("machine learning topic:ai -topic:ml");
  });

  it("allows fork + archived (valid GitHub combination)", () => {
    accepts("cli fork:true archived:true");
  });

  it("allows user + org", () => {
    accepts("cli user:a org:b");
  });

  it("rejects visibility combined with private", () => {
    const err = badQuery("cli visibility:public private:true");
    expect(err.detail).toMatch(/visibility/);
    // The hint must be a runnable query that drops the conflicting filter.
    expect(err.hint).toBe("cli visibility:public");
  });

  it("throws BadQueryError, not a bare Error", () => {
    const err = badQuery("cli stars:abc");
    expect(err).toBeInstanceOf(BadQueryError);
    expect(err.name).toBe("BadQueryError");
  });

  it("surfaces a specific detail plus a retry hint", () => {
    const err = badQuery("cli framework stars:abc");
    expect(err.detail).toContain('"stars:abc"');
    expect(err.hint).toBe("cli framework");
  });

  it("validates a corrected query, not the raw one", () => {
    // `langauge` normalizes to `language`, and the corrected value is what
    // gets checked.
    accepts("cli langauge:Rust");
    badQuery("cli langauge:Rust stars:abc");
  });

  it("rejects a negated bad value too", () => {
    badQuery("cli -stars:abc");
  });

  it("rejects an empty qualifier value", () => {
    // `stars:` stays a qualifier (rather than degrading to the keyword
    // "stars:") so validation can name the missing value.
    expect(parseQuery("cli stars:").qualifiers[0].value).toBe("");
    badQuery("cli framework stars:");
  });

  it("does not reject a bare colon URL keyword", () => {
    accepts("http://example.com");
  });

  it("reports the first invalid qualifier", () => {
    const err = badQuery("cli stars:abc forks:xyz");
    expect(err.detail).toContain("stars:abc");
  });
});

describe("suggestFor", () => {
  it("keeps single-letter shortcuts", () => {
    expect(suggestFor("l")).toEqual(["language:"]);
  });

  it("prefix-matches as before", () => {
    expect(suggestFor("la")).toEqual(["language:"]);
    expect(suggestFor("to")).toEqual(["topic:", "topics:"]);
  });

  it("leads with the corrected form for a misspelling", () => {
    expect(suggestFor("langauge")[0]).toBe("language:");
    expect(suggestFor("langauge")).toContain("language:");
  });

  it("suggests the fix for a near-miss", () => {
    expect(suggestFor("starss")[0]).toBe("stars:");
  });

  it("never duplicates the corrected key", () => {
    const out = suggestFor("langauge");
    expect(out.filter((s) => s === "language:")).toHaveLength(1);
  });

  it("returns nothing for empty input", () => {
    expect(suggestFor("")).toEqual([]);
    expect(suggestFor("   ")).toEqual([]);
  });

  it("still offers prefix matches for an unknown word", () => {
    expect(suggestFor("to")).toEqual(["topic:", "topics:"]);
  });
});

describe("suggestRelaxations", () => {
  it("loosens an over-tight stars threshold first", () => {
    const out = suggestRelaxations(parseQuery("rust stars:>=50000"));
    expect(out[0].suggestion).toBe("rust stars:>=5000");
    expect(out[0].qualifier).toBe("stars");
  });

  it("ranks size above language", () => {
    const out = suggestRelaxations(parseQuery("cli size:<50 language:Rust"));
    expect(out[0].qualifier).toBe("size");
  });

  it("widens a pushed date window backwards", () => {
    const out = suggestRelaxations(parseQuery("cli pushed:>2024-01-01"));
    expect(out[0].suggestion).toBe("cli pushed:>2022-01-01");
  });

  it("drops a language filter as a last resort", () => {
    const out = suggestRelaxations(parseQuery("cli language:Rust"));
    expect(out[0].suggestion).toBe("cli");
  });

  it("never proposes removing a negated filter", () => {
    // A negated filter widens a search, so it cannot be the cause.
    const out = suggestRelaxations(parseQuery("cli -topic:ml"));
    expect(out).toEqual([]);
  });

  it("returns nothing for a keyword-only query", () => {
    expect(suggestRelaxations(parseQuery("rust cli"))).toEqual([]);
  });

  it("offers a numeric relaxation even for a lone qualifier", () => {
    const out = suggestRelaxations(parseQuery("stars:>=1000000000"));
    expect(out[0].suggestion).toBe("stars:>=100000000");
  });

  it("caps the number of suggestions", () => {
    const q = parseQuery("cli stars:>=1 forks:>=1 size:<1 language:Rust org:x");
    expect(suggestRelaxations(q, 2)).toHaveLength(2);
  });

  it("deduplicates identical suggestions", () => {
    const out = suggestRelaxations(parseQuery("cli stars:>=50000"));
    expect(new Set(out.map((r) => r.suggestion)).size).toBe(out.length);
  });

  it("keeps remaining qualifiers in the suggestion", () => {
    const out = suggestRelaxations(
      parseQuery("rust language:Rust stars:>=9000"),
    );
    const starHint = out.find((r) => r.qualifier === "stars");
    expect(starHint?.suggestion).toContain("language:Rust");
  });
});

describe("NoResultsError with relaxations", () => {
  it("lists concrete retries when given relaxations", () => {
    const err = new NoResultsError("rust stars:>=50000", ["rust stars:>=5000"]);
    expect(err.userMessage).toContain("Try: rust stars:>=5000");
    expect(err.userMessage).not.toContain("check spelling");
  });

  it("falls back to generic tips with no relaxations", () => {
    const err = new NoResultsError("rust");
    expect(err.userMessage).toContain("check spelling");
  });

  it("keeps the two-argument call site working", () => {
    expect(new NoResultsError("rust")).toBeInstanceOf(Error);
  });
});
