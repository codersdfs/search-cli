import { describe, it, expect } from "bun:test";
import {
  parseQuery,
  tokenize,
  applyFlagFilters,
  validateQuery,
  buildGitHubQuery,
  githubSortParam,
} from "../src/query.ts";

describe("tokenize", () => {
  it("splits on spaces but keeps quoted phrases together", () => {
    expect(tokenize(`rust cli "github search"`)).toEqual(["rust", "cli", "github search"]);
  });
  it("handles empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("parseQuery", () => {
  it("extracts free-text keywords", () => {
    const q = parseQuery("rust cli github search");
    expect(q.keywords).toEqual(["rust", "cli", "github", "search"]);
    expect(q.qualifiers).toEqual([]);
    expect(q.raw).toBe("rust cli github search");
  });

  it("extracts qualifiers", () => {
    const q = parseQuery("llm topic:ai org:my-org");
    expect(q.keywords).toEqual(["llm"]);
    expect(q.qualifiers).toContainEqual({ key: "topic", value: "ai", negated: false });
    expect(q.qualifiers).toContainEqual({ key: "org", value: "my-org", negated: false });
  });

  it("preserves quoted qualifier values", () => {
    const q = parseQuery('repo:"my cool repo"');
    expect(q.qualifiers).toContainEqual({ key: "repo", value: "my cool repo", negated: false });
  });

  it("detects negated qualifiers", () => {
    const q = parseQuery("-language:JavaScript");
    expect(q.qualifiers).toContainEqual({ key: "language", value: "JavaScript", negated: true });
  });

  it("treats a lone colon value as keyword", () => {
    const q = parseQuery("http://example.com");
    expect(q.keywords).toContain("http://example.com");
  });

  it("returns empty for blank input", () => {
    const q = parseQuery("   ");
    expect(q.keywords).toEqual([]);
    expect(q.qualifiers).toEqual([]);
  });
});

describe("applyFlagFilters", () => {
  it("appends flag filters as qualifiers", () => {
    const base = parseQuery("cli");
    const merged = applyFlagFilters(base, { language: "Rust", stars: ">100", org: "octocat" });
    expect(merged.qualifiers).toContainEqual({ key: "language", value: "Rust", negated: false });
    expect(merged.qualifiers).toContainEqual({ key: "stars", value: ">100", negated: false });
    expect(merged.qualifiers).toContainEqual({ key: "org", value: "octocat", negated: false });
    // original keyword preserved
    expect(merged.keywords).toEqual(["cli"]);
  });

  it("maps boolean flags", () => {
    const merged = applyFlagFilters(parseQuery("x"), { archived: true, fork: false });
    expect(merged.qualifiers).toContainEqual({ key: "archived", value: "true", negated: false });
    expect(merged.qualifiers).toContainEqual({ key: "fork", value: "false", negated: false });
  });
});

describe("validateQuery", () => {
  it("passes valid queries", () => {
    expect(() => validateQuery(parseQuery("cli language:Rust"))).not.toThrow();
  });
  it("allows fork + archived (valid GitHub combination)", () => {
    expect(() => validateQuery(parseQuery("cli fork:true archived:true"))).not.toThrow();
  });
  it("allows user + org (user: acts as author, not owner)", () => {
    expect(() => validateQuery(parseQuery("cli user:a org:b"))).not.toThrow();
  });
});

describe("buildGitHubQuery", () => {
  it("joins keywords and qualifiers", () => {
    const q = parseQuery("llm toolkit language:Rust");
    expect(buildGitHubQuery(q)).toBe("llm toolkit language:Rust");
  });
  it("quotes multi-word keyword values", () => {
    const q = parseQuery('"machine learning"');
    expect(buildGitHubQuery(q)).toBe('"machine learning"');
  });
  it("emits negated qualifiers with minus", () => {
    const q = parseQuery("-language:JS");
    expect(buildGitHubQuery(q)).toBe("-language:JS");
  });
});

describe("githubSortParam", () => {
  it("maps stars", () => {
    expect(githubSortParam("stars")).toEqual({ sort: "stars", order: "desc" });
  });
  it("maps best-match to empty (GitHub default)", () => {
    expect(githubSortParam("best-match")).toEqual({});
  });
});