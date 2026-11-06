// github-client is the one seam every GitHub HTTP call crosses: token
// precedence and status classification. These tests pin both.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  resolveToken,
  resolveTokens,
  githubFetch,
  githubHeaders,
  isRateLimit403,
} from "../src/github-client.ts";
import {
  AuthError,
  ForbiddenError,
  NetworkError,
  RateLimitError,
} from "../src/errors.ts";

describe("github-client", () => {
  const origEnv = { ...process.env };
  const realFetch = globalThis.fetch;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ghfind-client-test-"));
    process.env.GHFIND_CONFIG = join(tmpDir, "config.json");
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    globalThis.fetch = realFetch;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(cfg: unknown): void {
    writeFileSync(process.env.GHFIND_CONFIG as string, JSON.stringify(cfg));
  }

  describe("resolveToken", () => {
    it("prefers the explicit flag over state and config", () => {
      writeConfig({ githubToken: "file-token" });
      expect(resolveToken("flag-token", "state-token")).toBe("flag-token");
    });

    it("prefers surface state over config", () => {
      writeConfig({ githubToken: "file-token" });
      expect(resolveToken(undefined, "state-token")).toBe("state-token");
    });

    it("falls back to the saved config token", () => {
      writeConfig({ githubToken: "file-token" });
      expect(resolveToken()).toBe("file-token");
    });

    it("lets GITHUB_TOKEN beat the saved config token", () => {
      writeConfig({ githubToken: "file-token" });
      process.env.GITHUB_TOKEN = "env-token";
      expect(resolveToken()).toBe("env-token");
    });

    it("returns undefined when nothing is configured", () => {
      expect(resolveToken()).toBeUndefined();
    });
  });

  describe("resolveTokens", () => {
    it("expands the config githubTokens list after the singles", () => {
      writeConfig({
        githubToken: "file-token",
        githubTokens: ["second", "third"],
      });
      expect(resolveTokens("flag-token")).toEqual([
        "flag-token",
        "file-token",
        "second",
        "third",
      ]);
    });

    it("dedupes, trims and drops empties", () => {
      writeConfig({
        githubToken: "one",
        githubTokens: ["one", "  two  ", "", "two"],
      });
      expect(resolveTokens()).toEqual(["one", "two"]);
    });

    it("returns an empty array when nothing is configured", () => {
      expect(resolveTokens()).toEqual([]);
    });
  });

  describe("githubHeaders", () => {
    it("sends the canonical API headers and no auth when tokenless", () => {
      const h = githubHeaders();
      expect(h).toMatchObject({
        Accept: "application/vnd.github+json",
        "User-Agent": "ghfind",
      });
      expect(h.Authorization).toBeUndefined();
    });

    it("attaches a bearer token and merges extras", () => {
      const h = githubHeaders("tok", { "If-None-Match": "abc" });
      expect(h.Authorization).toBe("Bearer tok");
      expect(h["If-None-Match"]).toBe("abc");
    });
  });

  describe("isRateLimit403", () => {
    const res = (remaining: string | null) =>
      new Response("", {
        status: 403,
        headers:
          remaining === null ? {} : { "x-ratelimit-remaining": remaining },
      });

    it("is true when remaining is 0 or absent", () => {
      expect(isRateLimit403(res("0"))).toBe(true);
      expect(isRateLimit403(res(null))).toBe(true);
    });

    it("is false when remaining is positive", () => {
      expect(isRateLimit403(res("12"))).toBe(false);
    });
  });

  describe("githubFetch classification", () => {
    function stubFetch(
      status: number,
      opts: {
        body?: string;
        remaining?: string | null;
        retryAfter?: string;
      } = {},
    ) {
      globalThis.fetch = (async () =>
        new Response(opts.body ?? "{}", {
          status,
          headers: {
            ...(opts.remaining != null
              ? { "x-ratelimit-remaining": opts.remaining }
              : {}),
            ...(opts.retryAfter ? { "retry-after": opts.retryAfter } : {}),
          },
        })) as unknown as typeof fetch;
    }

    it("returns the response on success", async () => {
      stubFetch(200, { body: '{"ok":true}' });
      const res = await githubFetch("https://api.github.com/x");
      expect(res.status).toBe(200);
    });

    it("throws AuthError on 401", async () => {
      stubFetch(401);
      await expect(githubFetch("https://api.github.com/x")).rejects.toThrow(
        AuthError,
      );
    });

    it("throws RateLimitError on 403 with remaining=0", async () => {
      stubFetch(403, { remaining: "0" });
      await expect(githubFetch("https://api.github.com/x")).rejects.toThrow(
        RateLimitError,
      );
    });

    it("throws ForbiddenError carrying GitHub's message otherwise", async () => {
      stubFetch(403, {
        remaining: "42",
        body: JSON.stringify({ message: "Resource not accessible" }),
      });
      const err = await githubFetch("https://api.github.com/x").catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.detail).toBe("Resource not accessible");
    });

    it("throws NetworkError on other failures", async () => {
      stubFetch(500, { body: "boom" });
      await expect(githubFetch("https://api.github.com/x")).rejects.toThrow(
        NetworkError,
      );
    });

    it("returns passthrough statuses without classifying", async () => {
      stubFetch(404);
      const res = await githubFetch("https://api.github.com/x", {
        passthroughStatuses: [404],
      });
      expect(res.status).toBe(404);
    });
  });
});
