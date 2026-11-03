/**
 * release-cmd tests.
 *
 * `runReleaseWorkflow` only talks to the GitHub Actions dispatch endpoint, so
 * the network call is injected. These tests pin the tag gate, the endpoint shape
 * and both outcomes (dry-run short-circuits, non-2xx becomes a failure result)
 * without touching the network.
 */
import { describe, test, expect } from "vitest";
import {
  isReleaseTag,
  releaseDispatchUrl,
  runReleaseWorkflow,
} from "../src/release-cmd";

function fakeFetch(
  responder: (url: string, init?: RequestInit) => Promise<Response>,
): {
  impl: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;
  return { impl, calls };
}

describe("isReleaseTag", () => {
  test("accepts a v-prefixed semver tag", () => {
    expect(isReleaseTag("v9.12.0")).toBe(true);
  });

  test("accepts a v-prefixed prerelease tag", () => {
    expect(isReleaseTag("v9.12.0-beta.1")).toBe(true);
  });

  test("rejects a bare semver without the v prefix", () => {
    expect(isReleaseTag("9.12.0")).toBe(false);
  });

  test("rejects a tag missing the minor/patch triple", () => {
    expect(isReleaseTag("v9.12")).toBe(false);
  });
});

describe("releaseDispatchUrl", () => {
  test("points at the Release workflow dispatch endpoint for this repo", () => {
    expect(releaseDispatchUrl()).toBe(
      "https://api.github.com/repos/codersdfs/search-cli/actions/workflows/release.yml/dispatches",
    );
  });
});

describe("runReleaseWorkflow", () => {
  test("dry-run resolves ok without calling the API", async () => {
    const { impl, calls } = fakeFetch(
      async () => new Response(null, { status: 204 }),
    );
    const result = await runReleaseWorkflow({
      tag: "v9.12.0",
      dryRun: true,
      fetch: impl,
    });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("dispatches a POST whose body names the tag as the ref", async () => {
    const { impl, calls } = fakeFetch(
      async () => new Response(null, { status: 204 }),
    );
    const result = await runReleaseWorkflow({ tag: "v9.12.0", fetch: impl });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api.github.com/repos/codersdfs/search-cli/actions/workflows/release.yml/dispatches",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      ref: "v9.12.0",
    });
  });

  test("reads the dispatched run URL from the Location header", async () => {
    const { impl } = fakeFetch(
      async () =>
        new Response(null, {
          status: 204,
          headers: {
            Location:
              "https://api.github.com/repos/codersdfs/search-cli/actions/runs/123",
          },
        }),
    );
    const result = await runReleaseWorkflow({ tag: "v9.12.0", fetch: impl });
    expect(result.ok).toBe(true);
    expect(result.runUrl).toBe(
      "https://api.github.com/repos/codersdfs/search-cli/actions/runs/123",
    );
  });

  test("a non-2xx becomes a failed result instead of throwing", async () => {
    const { impl } = fakeFetch(
      async () =>
        new Response(JSON.stringify({ message: "Workflow not found" }), {
          status: 404,
        }),
    );
    const result = await runReleaseWorkflow({ tag: "v9.12.0", fetch: impl });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Workflow not found");
  });
});
