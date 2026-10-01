// HTTP status → error mapping in GitHubSearchAdapter.
// 401 → AuthError, non-rate-limit 403 → ForbiddenError, exhausted 403 →
// RateLimitError, other failures → NetworkError. Guards against these
// regressing back into the generic "Network error" umbrella.
import { describe, it, expect, afterEach } from "vitest";
import { GitHubSearchAdapter, parseQuery } from "../src/search.ts";
import {
  NetworkError,
  RateLimitError,
  AuthError,
  ForbiddenError,
} from "../src/errors.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Mock fetch returning a canned status with optional headers. */
function status(
  code: number,
  headers: Record<string, string> = {},
): typeof fetch {
  return (async () =>
    new Response("body", { status: code, headers })) as unknown as typeof fetch;
}

const query = parseQuery("rust");

const baseOptions = {
  limit: 10,
  sort: "best-match",
  json: false,
  verbose: false,
} as const;

describe("GitHubSearchAdapter HTTP error mapping", () => {
  it("maps 401 to AuthError (bad/revoked token), not NetworkError", async () => {
    globalThis.fetch = status(401);
    const adapter = new GitHubSearchAdapter(noopLogger, ["tok"]);
    await expect(adapter.search(query, baseOptions)).rejects.toThrow(AuthError);
  });

  it("maps a non-rate-limit 403 to ForbiddenError", async () => {
    // x-ratelimit-remaining has budget left, so this is not a rate limit —
    // e.g. SAML enforcement or resource restrictions.
    globalThis.fetch = status(403, { "x-ratelimit-remaining": "42" });
    const adapter = new GitHubSearchAdapter(noopLogger);
    await expect(adapter.search(query, baseOptions)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("maps an exhausted 403 to RateLimitError when a token is set", async () => {
    globalThis.fetch = status(403, { "x-ratelimit-remaining": "0" });
    const adapter = new GitHubSearchAdapter(noopLogger, ["tok"]);
    await expect(adapter.search(query, baseOptions)).rejects.toThrow(
      RateLimitError,
    );
  });

  it("maps 5xx to NetworkError (server-side failure)", async () => {
    globalThis.fetch = status(500);
    const adapter = new GitHubSearchAdapter(noopLogger);
    await expect(adapter.search(query, baseOptions)).rejects.toThrow(
      NetworkError,
    );
  });

  it("AuthError is not a NetworkError subclass", () => {
    expect(new AuthError()).not.toBeInstanceOf(NetworkError);
    expect(new ForbiddenError()).not.toBeInstanceOf(NetworkError);
  });
});
