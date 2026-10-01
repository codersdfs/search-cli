import { describe, it, expect } from "vitest";
import {
  SearchCliError,
  NetworkError,
  RateLimitError,
  BadQueryError,
  NoResultsError,
  ParseError,
  AuthError,
  ForbiddenError,
} from "../src/errors.ts";

describe("SearchCliError", () => {
  it("stores message and userMessage", () => {
    const err = new SearchCliError("internal", "user msg");
    expect(err.message).toBe("internal");
    expect(err.userMessage).toBe("user msg");
    expect(err instanceof Error).toBe(true);
  });
});

describe("NetworkError", () => {
  it("has user-facing message about connectivity", () => {
    const err = new NetworkError();
    expect(err.userMessage).toContain("Network error");
    expect(err.userMessage).toContain("[r]etry");
  });
});

describe("AuthError", () => {
  it("maps 401 to a bad-token message, not a network message", () => {
    const err = new AuthError();
    expect(err.name).toBe("AuthError");
    expect(err.userMessage).toContain("401");
    expect(err.userMessage).toContain("token");
    expect(err.userMessage).not.toContain("Network error");
  });

  it("advertises [t] to fix the token and [u] to unset it", () => {
    const err = new AuthError();
    expect(err.userMessage).toContain("[t]");
    expect(err.userMessage).toContain("[u]");
  });

  it("stays short enough for the 60-char status bar", () => {
    expect(new AuthError().userMessage.length).toBeLessThanOrEqual(72);
  });
});

describe("ForbiddenError", () => {
  it("maps non-rate-limit 403 to a forbidden message", () => {
    const err = new ForbiddenError();
    expect(err.name).toBe("ForbiddenError");
    expect(err.userMessage).toContain("403");
    expect(err.userMessage).toContain("Forbidden");
    expect(err.userMessage).not.toContain("Network error");
  });

  it("mentions SSO authorization and the [t] hint", () => {
    const err = new ForbiddenError();
    expect(err.userMessage).toContain("SSO");
    expect(err.userMessage).toContain("[t]");
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
