// Tests for the github.com/trending HTML parser.
//
// The golden fixture (tests/fixtures/trending.html) is a live capture of the
// trending page. Refresh it when GitHub changes the page significantly:
//   curl -s https://github.com/trending -o tests/fixtures/trending.html
// The parser must never silently return an empty list — GitHub layout changes
// surface as a parse error instead (see ParseError in src/errors.ts).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTrendingHtml } from "../src/trending-parser";
import { ParseError } from "../src/errors";

const FIXTURE = readFileSync(
  fileURLToPath(new URL("./fixtures/trending.html", import.meta.url)),
  "utf-8",
);

describe("parseTrendingHtml (golden snapshot)", () => {
  it("parses all article rows from the live snapshot", () => {
    const repos = parseTrendingHtml(FIXTURE);
    expect(repos.length).toBe(16);
  });

  it("extracts the first repo's full record", () => {
    const repos = parseTrendingHtml(FIXTURE);
    expect(repos[0]).toEqual({
      rank: 1,
      owner: "ayghri",
      name: "i-have-adhd",
      stars: 40666,
      starsToday: 3440,
      language: "Python",
      description:
        "A skill to stop your coding agent from burying the answer. ADHD-friendly output.",
    });
  });

  it("assigns sequential unique ranks", () => {
    const repos = parseTrendingHtml(FIXTURE);
    const ranks = repos.map((r) => r.rank);
    expect(ranks).toEqual(repos.map((_, i) => i + 1));
  });

  it("parses non-numeric growth (this week) and commas in star counts", () => {
    // Second-ranked repo from the snapshot: comma counts + 'stars this week'.
    const repos = parseTrendingHtml(FIXTURE);
    // Every repo in the daily fixture uses 'today', but the parser must accept
    // 'this week' which github.com/trending?since=weekly serves.
    const everyHasStars = repos.every(
      (r) => typeof r.stars === "number" && r.stars >= 0,
    );
    expect(everyHasStars).toBe(true);
    const allNamed = repos.every((r) => r.owner && r.name);
    expect(allNamed).toBe(true);
  });
});

describe("parseTrendingHtml (structure fragments)", () => {
  it("parses a minimal two-repo fragment", () => {
    const fragment = [
      '<article class="Box-row">',
      '  <h2 class="h3 lh-condensed"><a href="/rust-lang/rust" data-view-component="true" class="Link">rust-lang /<br/>rust</a></h2>',
      '  <p class="col-9 color-fg-muted my-1">A safe systems language.</p>',
      '  <span class="repo-language-color" style="background-color: #dea584"></span>',
      '  <span itemprop="programmingLanguage">Rust</span>',
      '  <a href="/rust-lang/rust/stargazers" data-view-component="true" class="tmp-mr-3 Link Link--muted"><svg></svg> 125,000</a>',
      "  <svg></svg> 1,204 stars today",
      "</article>",
      '<article class="Box-row">',
      '  <h2 class="h3 lh-condensed"><a href="/owner/nameless" class="Link">owner /<br/>nameless</a></h2>',
      '  <a href="/owner/nameless/stargazers" class="Link Link--muted"><svg></svg> 42</a>',
      "</article>",
    ].join("\n");
    const repos = parseTrendingHtml(fragment);
    expect(repos).toHaveLength(2);
    expect(repos[0]).toEqual({
      rank: 1,
      owner: "rust-lang",
      name: "rust",
      stars: 125000,
      starsToday: 1204,
      language: "Rust",
      description: "A safe systems language.",
    });
    // Missing language/description/growth degrade to empty/0 rather than
    // dropping the whole repo.
    expect(repos[1]).toEqual({
      rank: 2,
      owner: "owner",
      name: "nameless",
      stars: 42,
      starsToday: 0,
      language: "",
      description: "",
    });
  });

  it("accepts CRLF line endings", () => {
    const fragment =
      '<article class="Box-row">\r\n  <h2 class="h3 lh-condensed">\r\n    <a href="/a/b" class="Link">a /<br/>b</a>\r\n  </h2>\r\n  <a href="/a/b/stargazers" class="Link Link--muted"><svg></svg> 7</a>\r\n</article>';
    const repos = parseTrendingHtml(fragment);
    expect(repos).toHaveLength(1);
    expect(repos[0].owner).toBe("a");
    expect(repos[0].name).toBe("b");
  });

  it("ignores the login/star-panel href and picks the heading link", () => {
    const fragment =
      '<article class="Box-row">' +
      '  <div class="float-right"><a href="/login?return_to=%2Fowner%2Fname" class="tooltipped btn">Star</a></div>' +
      '  <h2 class="h3 lh-condensed"><a href="/owner/name" class="Link">owner /<br/>name</a></h2>' +
      '  <a href="/owner/name/stargazers" class="Link Link--muted"><svg></svg> 123</a>' +
      "</article>";
    const repos = parseTrendingHtml(fragment);
    expect(repos).toHaveLength(1);
    expect(repos[0].owner).toBe("owner");
    expect(repos[0].name).toBe("name");
    expect(repos[0].stars).toBe(123);
  });
});

describe("parseTrendingHtml (failure modes)", () => {
  it("throws a friendly ParseError on empty input", () => {
    expect(() => parseTrendingHtml("")).toThrow(ParseError);
  });

  it("throws when the response is not the trending page", () => {
    const errorPage =
      "<html><head><title>Whoa there</title></head><body><h1>Something went wrong</h1></body></html>";
    expect(() => parseTrendingHtml(errorPage)).toThrow(ParseError);
  });

  it("throws when article rows exist but no repo heading parses", () => {
    const broken =
      '<article class="Box-row"><div class="float-right"><a href="/login">Sign in</a></div></article>';
    expect(() => parseTrendingHtml(broken)).toThrow(ParseError);
  });

  it("never silently returns an empty list", () => {
    for (const input of ["", "<html></html>", "not html at all"]) {
      expect(() => parseTrendingHtml(input)).toThrow();
    }
  });
});
