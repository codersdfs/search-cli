import { describe, it, expect } from "bun:test";
import {
  SearchCliError, NetworkError, RateLimitError,
  BadQueryError, NoResultsError, ParseError,
} from "../src/errors.ts";

describe("SearchCliError", () => {
  it("stores userMessage and recoverable flag", () => {
    const err = new SearchCliError("internal", "user msg", true);
    expect(err.message).toBe("internal");
    expect(err.userMessage).toBe("user msg");
    expect(err.recoverable).toBe(true);
  });
});

describe("NetworkError", () => {
  it("has user-facing message about connectivity", () => {
    const err = new NetworkError();
    expect(err.userMessage).toContain("Network error");
    expect(err.userMessage).toContain("[r]etry");
  });
});

describe("RateLimitError", () => {
  it("suggests setting token when unauthenticated", () => {
    const err = new RateLimitError(false);
    expect(err.userMessage).toContain("Set GITHUB_TOKEN");
    expect(err.hasToken).toBe(false);
  });

  it("shows reset time when authenticated", () => {
    const err = new RateLimitError(true, 192);
    expect(err.userMessage).toContain("rate limit");
    expect(err.userMessage).toContain("192s");
    expect(err.hasToken).toBe(true);
  });
});

describe("BadQueryError", () => {
  it("includes the detail in both message and userMessage", () => {
    const err = new BadQueryError("stars:abc is not a number");
    expect(err.userMessage).toContain("stars:abc");
  });
});

describe("NoResultsError", () => {
  it("suggests alternatives", () => {
    const err = new NoResultsError("rust cli");
    expect(err.userMessage).toContain("No results");
    expect(err.userMessage).toContain("rust cli");
    expect(err.userMessage).toContain("trending");
  });
});

describe("ParseError", () => {
  it("names the source that failed to parse", () => {
    const err = new ParseError("Trending page", "expected article tag");
    expect(err.userMessage).toContain("Trending page");
    expect(err.userMessage).toContain("[r]etry");
  });
});
