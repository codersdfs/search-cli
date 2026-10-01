import { describe, it, expect, afterEach } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseQuery, GitHubSearchAdapter } from "../src/search.ts";
import { ForbiddenError, RateLimitError } from "../src/errors.ts";

function loggerTo(file: string) {
  const w = (lvl: string) => (m: string) =>
    appendFileSync(file, `[${lvl}] ${m}\n`);
  return {
    debug: w("debug"),
    info: w("info"),
    warn: w("warn"),
    error: w("error"),
  };
}
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function mock(headers: Record<string, string>, body: string, status: number) {
  globalThis.fetch = (async () =>
    new Response(body, { status, headers })) as never;
}

describe("403 logging (ForbiddenError diagnostics)", () => {
  it("logs the headers and body that identify the real cause", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghfind-"));
    const log = join(dir, "t.log");
    mock(
      {
        "x-ratelimit-remaining": "42",
        "retry-after": "60",
        "x-ratelimit-reset": "1790859999",
      },
      JSON.stringify({ message: "Resource not accessible by integration" }),
      403,
    );
    let err: any;
    try {
      await new GitHubSearchAdapter(loggerTo(log)).search(parseQuery("cli"), {
        limit: 5,
        sort: "best-match",
        json: false,
        verbose: true,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ForbiddenError);
    const out = readFileSync(log, "utf-8");
    expect(out).toContain("remaining=42");
    expect(out).toContain("retry-after=60");
    expect(out).toContain("authed=no");
    expect(out).toContain("Resource not accessible by integration");
    // the real reason must reach the user, not a guessed one
    expect(err.userMessage).toContain("Resource not accessible by integration");
    expect(err.userMessage).not.toMatch(
      /enforces SSO, authorize the token; \[t\]/,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("routes remaining=0 to RateLimitError, not Forbidden", async () => {
    mock({ "x-ratelimit-remaining": "0" }, "{}", 403);
    let err: any;
    try {
      await new GitHubSearchAdapter().search(parseQuery("cli"), {
        limit: 5,
        sort: "best-match",
        json: false,
        verbose: false,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RateLimitError);
  });
});
