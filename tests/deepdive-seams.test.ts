import { describe, it, expect, afterEach } from "vitest";
import {
  parseRepoRef,
  repoFromRef,
  resolveRepoFromRef,
  fetchDeepDiveRaw,
  buildDeepDiveData,
  buildDeepDiveJson,
} from "../src/deepdive.ts";
import type { Repo } from "../src/types.ts";

const makeRepo = (over: Partial<Repo> = {}): Repo => ({
  id: 0,
  fullName: "owner/repo",
  name: "repo",
  owner: "owner",
  description: "A test repo",
  url: "https://github.com/owner/repo",
  stars: 1200,
  forks: 40,
  watchers: 0,
  language: "TypeScript",
  topics: ["cli"],
  archived: false,
  isFork: false,
  private: false,
  createdAt: "2023-01-01T00:00:00Z",
  updatedAt: "2024-06-15T00:00:00Z",
  pushedAt: "2024-06-15T00:00:00Z",
  score: 0,
  ...over,
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseRepoRef", () => {
  it("parses owner/name", () => {
    expect(parseRepoRef("facebook/react")).toEqual({
      owner: "facebook",
      name: "react",
    });
  });

  it("strips a trailing .git and leading @", () => {
    expect(parseRepoRef("facebook/react.git")).toEqual({
      owner: "facebook",
      name: "react",
    });
    expect(parseRepoRef("@facebook/react")).toEqual({
      owner: "facebook",
      name: "react",
    });
  });

  it("rejects anything that is not owner/name", () => {
    expect(() => parseRepoRef("not-a-repo")).toThrow(/owner\/name/);
    expect(() => parseRepoRef("a/b/c")).toThrow(/owner\/name/);
    expect(() => parseRepoRef("")).toThrow(/owner\/name/);
  });
});

describe("repoFromRef", () => {
  it("builds a minimal repo stub", () => {
    const stub = repoFromRef("oven-sh/bun");
    expect(stub.owner).toBe("oven-sh");
    expect(stub.name).toBe("bun");
    expect(stub.fullName).toBe("oven-sh/bun");
    expect(stub.url).toBe("https://github.com/oven-sh/bun");
  });

  it("rejects invalid refs", () => {
    expect(() => repoFromRef("nope")).toThrow(/owner\/name/);
  });
});

describe("resolveRepoFromRef", () => {
  it("fetches real repo metadata", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      expect(String(url)).toBe("https://api.github.com/repos/oven-sh/bun");
      return jsonResponse({
        description: "Incredibly fast JavaScript runtime",
        html_url: "https://github.com/oven-sh/bun",
        stargazers_count: 70000,
        forks_count: 2000,
        subscribers_count: 500,
        language: "Zig",
        topics: ["runtime"],
        archived: false,
        fork: false,
        created_at: "2019-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        pushed_at: "2026-01-01T00:00:00Z",
      });
    }) as unknown as typeof fetch;

    const repo = await resolveRepoFromRef("oven-sh/bun");
    expect(repo.fullName).toBe("oven-sh/bun");
    expect(repo.stars).toBe(70000);
    expect(repo.language).toBe("Zig");
    expect(repo.description).toContain("JavaScript");
  });

  it("falls back to a stub when the fetch throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const repo = await resolveRepoFromRef("a/b");
    expect(repo.fullName).toBe("a/b");
    expect(repo.stars).toBe(0);
  });

  it("throws a clean error on a 404", async () => {
    globalThis.fetch = (async () =>
      new Response("{}", { status: 404 })) as unknown as typeof fetch;
    await expect(resolveRepoFromRef("ghost/ghost-repo")).rejects.toThrow(
      /Repo not found/,
    );
  });

  it("rejects malformed refs without fetching", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse({});
    }) as unknown as typeof fetch;
    await expect(resolveRepoFromRef("not-a-repo")).rejects.toThrow(
      /owner\/name/,
    );
    expect(calls).toBe(0);
  });
});

describe("fetchDeepDiveRaw", () => {
  it("returns structured language percents, contributors, and raw README", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/languages"))
        return jsonResponse({ TypeScript: 7500, Rust: 2500 });
      if (u.includes("/contributors"))
        return jsonResponse([
          { login: "alice", contributions: 100 },
          { login: "bob", contributions: 50 },
        ]);
      return new Response("# Title\n\nBody text", { status: 200 });
    }) as unknown as typeof fetch;

    const raw = await fetchDeepDiveRaw(makeRepo());
    expect(raw.repo.fullName).toBe("owner/repo");
    expect(raw.repo.stars).toBe(1200);
    expect(raw.languages).toEqual([
      { name: "TypeScript", bytes: 7500, percent: 75 },
      { name: "Rust", bytes: 2500, percent: 25 },
    ]);
    expect(raw.contributors).toEqual([
      { login: "alice", contributions: 100 },
      { login: "bob", contributions: 50 },
    ]);
    expect(raw.readme).toBe("# Title\n\nBody text");
  });

  it("tolerates failed language/contributor/README fetches", async () => {
    globalThis.fetch = (async () =>
      new Response("", { status: 404 })) as unknown as typeof fetch;

    const raw = await fetchDeepDiveRaw(makeRepo());
    expect(raw.languages).toEqual([]);
    expect(raw.contributors).toEqual([]);
    expect(raw.readme).toBe("");
  });
});

describe("buildDeepDiveData / buildDeepDiveJson", () => {
  it("formats sections from raw data", () => {
    const repo = makeRepo();
    const data = buildDeepDiveData(repo, {
      repo: {
        fullName: repo.fullName,
        url: repo.url,
        description: repo.description,
        stars: repo.stars,
        forks: repo.forks,
        language: repo.language,
        topics: repo.topics,
      },
      languages: [{ name: "TypeScript", bytes: 100, percent: 100 }],
      contributors: [{ login: "alice", contributions: 9 }],
      readme: "# Hi",
    });
    expect(data.summary).toContain("owner/repo");
    expect(data.languages).toContain("TypeScript");
    expect(data.contributors).toContain("alice");
    expect(data.readme).toContain("Hi");
  });

  it("buildDeepDiveJson returns parseable JSON of the raw payload", () => {
    const raw = {
      repo: {
        fullName: "a/b",
        url: "https://github.com/a/b",
        description: null as string | null,
        stars: 1,
        forks: 2,
        language: null as string | null,
        topics: [] as string[],
      },
      languages: [] as { name: string; bytes: number; percent: number }[],
      contributors: [] as { login: string; contributions: number }[],
      readme: "",
    };
    const parsed = JSON.parse(buildDeepDiveJson(raw));
    expect(parsed.repo.fullName).toBe("a/b");
  });
});
