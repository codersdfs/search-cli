import { describe, expect, test } from "bun:test";
import { fetchReadme } from "../src/readme";

const asFetch = (
  shim: (input: string, init?: RequestInit) => Promise<Response>,
) => shim as unknown as typeof fetch;

const ok = (body: string) =>
  new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });

const missing = () => new Response("nope", { status: 404 });

describe("fetchReadme", () => {
  test("returns the main README when it exists", async () => {
    const fetchImpl = asFetch(async (input) => {
      if (String(input).includes("/main/README.md")) return ok("# hello");
      return missing();
    });

    const got = await fetchReadme("octo", "demo", { fetchImpl });
    expect(got?.text).toBe("# hello");
    expect(got?.sourceUrl).toBe(
      "https://raw.githubusercontent.com/octo/demo/main/README.md",
    );
  });

  test("falls back to master when main is missing", async () => {
    const fetchImpl = asFetch(async (input) =>
      String(input).includes("/master/README.md") ? ok("# master") : missing(),
    );

    const got = await fetchReadme("octo", "demo", { fetchImpl });
    expect(got?.text).toBe("# master");
    expect(got?.sourceUrl).toBe(
      "https://raw.githubusercontent.com/octo/demo/master/README.md",
    );
  });

  test("falls back to README.rst when no markdown README exists", async () => {
    const fetchImpl = asFetch(async (input) =>
      String(input).endsWith("README.rst") ? ok("hello rst") : missing(),
    );

    const got = await fetchReadme("octo", "demo", { fetchImpl });
    expect(got?.text).toBe("hello rst");
  });

  test("returns null when no candidate exists", async () => {
    const fetchImpl = asFetch(async () => missing());
    expect(await fetchReadme("octo", "demo", { fetchImpl })).toBeNull();
  });

  test("prefers main over master when both resolve", async () => {
    const fetchImpl = asFetch(async (input) =>
      String(input).includes("/main/") ? ok("# main") : ok("# master"),
    );

    const got = await fetchReadme("octo", "demo", { fetchImpl });
    expect(got?.text).toBe("# main");
  });

  test("sends the token only to GitHub hosts", async () => {
    const seen: Array<[string, string | undefined]> = [];
    const fetchImpl = asFetch(async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push([String(input), headers.Authorization]);
      return String(input).includes("/main/") ? ok("# x") : missing();
    });

    await fetchReadme("octo", "demo", { token: "secret", fetchImpl });
    for (const [url, auth] of seen) {
      expect(url).toStartWith("https://raw.githubusercontent.com/");
      expect(auth).toBe("Bearer secret");
    }
  });
});
