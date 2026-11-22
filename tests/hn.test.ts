// Tests for the Hacker News module (ghfind hn).
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  HN_FEEDS,
  domainOf,
  fetchHnStories,
  formatHnCsv,
  formatHnJson,
  formatHnMarkdown,
  formatHnText,
  hnItemUrl,
  normalizeHnItem,
  relativeTime,
  resolveHnFeed,
} from "../src/hn";
import type { HnFeed, HnItemPayload, HnStory } from "../src/hn";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const POSTED = Math.floor(Date.parse("2026-11-21T10:00:00Z") / 1000);

const ITEMS: Record<number, HnItemPayload | null> = {
  1: {
    id: 1,
    type: "story",
    by: "alice",
    time: POSTED,
    title: "Hello, HN",
    url: "https://www.example.com/post?x=1",
    score: 321,
    descendants: 45,
  },
  2: {
    id: 2,
    type: "ask",
    by: "bob",
    time: POSTED,
    title: "Ask HN: What are you building?",
    score: 12,
    descendants: 7,
    text: "<p>Tell us.</p>",
  },
  3: null,
  4: {
    id: 4,
    deleted: true,
    type: "story",
    title: "gone",
    time: POSTED,
  },
  5: {
    id: 5,
    type: "job",
    by: "acme",
    time: POSTED,
    title: "Acme is hiring",
    score: 0,
    descendants: 0,
  },
};

function feedFetch(opts: {
  ids?: number[];
  failIds?: Set<number>;
  listStatus?: number;
  listBody?: unknown;
}): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const ids = opts.ids ?? [1, 2, 3, 4, 5];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("stories.json")) {
      if (opts.listStatus && opts.listStatus !== 200) {
        return new Response("unavailable", { status: opts.listStatus });
      }
      return jsonResponse(opts.listBody ?? ids);
    }
    const id = Number(url.match(/item\/(\d+)\.json$/)?.[1]);
    if (opts.failIds?.has(id)) {
      return new Response("boom", { status: 500 });
    }
    return jsonResponse(ITEMS[id] ?? null);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("resolveHnFeed", () => {
  it("accepts every canonical feed", () => {
    for (const feed of HN_FEEDS) {
      expect(resolveHnFeed(feed)).toBe(feed);
    }
  });

  it("accepts API endpoint spellings and 'jobs'", () => {
    expect(resolveHnFeed("topstories")).toBe("top");
    expect(resolveHnFeed("newstories")).toBe("new");
    expect(resolveHnFeed("beststories")).toBe("best");
    expect(resolveHnFeed("askstories")).toBe("ask");
    expect(resolveHnFeed("showstories")).toBe("show");
    expect(resolveHnFeed("jobstories")).toBe("job");
    expect(resolveHnFeed(" JOBS ")).toBe("job");
  });

  it("returns null for unknown or empty input", () => {
    expect(resolveHnFeed("front")).toBeNull();
    expect(resolveHnFeed("")).toBeNull();
  });
});

describe("domainOf / hnItemUrl", () => {
  it("strips www and returns null for unparseable URLs", () => {
    expect(domainOf("https://www.example.com/post")).toBe("example.com");
    expect(domainOf("https://news.ycombinator.com/item?id=1")).toBe(
      "news.ycombinator.com",
    );
    expect(domainOf(null)).toBeNull();
    expect(domainOf("not a url")).toBeNull();
  });

  it("builds the canonical discussion URL", () => {
    expect(hnItemUrl(42)).toBe("https://news.ycombinator.com/item?id=42");
  });
});

describe("normalizeHnItem", () => {
  it("maps API fields to the story shape", () => {
    expect(normalizeHnItem(ITEMS[1])).toEqual({
      id: 1,
      title: "Hello, HN",
      url: "https://www.example.com/post?x=1",
      hnUrl: "https://news.ycombinator.com/item?id=1",
      author: "alice",
      score: 321,
      comments: 45,
      createdAt: "2026-11-21T10:00:00.000Z",
      type: "story",
      domain: "example.com",
      text: null,
    });
  });

  it("keeps text posts with no external URL", () => {
    const story = normalizeHnItem(ITEMS[2]);
    expect(story?.url).toBeNull();
    expect(story?.domain).toBeNull();
    expect(story?.text).toBe("<p>Tell us.</p>");
    expect(story?.type).toBe("ask");
  });

  it("drops deleted, dead, and title-less items", () => {
    expect(normalizeHnItem(ITEMS[4])).toBeNull();
    expect(normalizeHnItem({ ...ITEMS[1], dead: true })).toBeNull();
    expect(normalizeHnItem({ ...ITEMS[1], title: undefined })).toBeNull();
    expect(normalizeHnItem(null)).toBeNull();
  });

  it("defaults missing score/comments/author and type", () => {
    const story = normalizeHnItem({ id: 9, title: "bare" });
    expect(story?.score).toBe(0);
    expect(story?.comments).toBe(0);
    expect(story?.author).toBeNull();
    expect(story?.type).toBe("story");
    expect(story?.createdAt).toBe("");
  });
});

describe("fetchHnStories", () => {
  it("fetches the feed, then its items in order, skipping dead items", async () => {
    const { fetchImpl, calls } = feedFetch({});
    const stories = await fetchHnStories("top", { limit: 5, fetchImpl });
    expect(stories.map((s) => s.id)).toEqual([1, 2, 5]);
    expect(calls[0]).toBe(
      "https://hacker-news.firebaseio.com/v0/topstories.json",
    );
    expect(calls).toHaveLength(6);
  });

  it("honours the limit before fetching items", async () => {
    const { fetchImpl, calls } = feedFetch({});
    const stories = await fetchHnStories("new", { limit: 2, fetchImpl });
    expect(stories.map((s) => s.id)).toEqual([1, 2]);
    expect(calls).toHaveLength(3); // one feed request + two item requests
  });

  it("clamps the limit to 1–100", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    const { fetchImpl, calls } = feedFetch({ ids });
    await fetchHnStories("best", { limit: 1000, fetchImpl });
    expect(calls).toHaveLength(101);
  });

  it("skips a failing item instead of losing the feed", async () => {
    const { fetchImpl } = feedFetch({ failIds: new Set([2]) });
    const stories = await fetchHnStories("top", { limit: 5, fetchImpl });
    expect(stories.map((s) => s.id)).toEqual([1, 5]);
  });

  it("reports a failing feed request with its status", async () => {
    const { fetchImpl } = feedFetch({ listStatus: 503 });
    await expect(fetchHnStories("top", { fetchImpl })).rejects.toThrow(
      "Failed to fetch Hacker News top stories (HTTP 503).",
    );
  });

  it("wraps an unreachable API instead of hanging", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(fetchHnStories("top", { fetchImpl })).rejects.toThrow(
      "Failed to reach Hacker News: ECONNREFUSED",
    );
  });

  it("rejects a non-array feed payload", async () => {
    const { fetchImpl } = feedFetch({ listBody: { nope: true } });
    await expect(fetchHnStories("ask", { fetchImpl })).rejects.toThrow(
      "Hacker News returned an unexpected ask feed.",
    );
  });

  it("returns an empty list for an empty feed", async () => {
    const { fetchImpl, calls } = feedFetch({ ids: [] });
    expect(await fetchHnStories("show", { fetchImpl })).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("rejects an unknown feed at runtime", async () => {
    await expect(
      fetchHnStories("front" as HnFeed, { fetchImpl: fetch }),
    ).rejects.toThrow("Unknown Hacker News feed: front.");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("renders each bucket", () => {
    expect(relativeTime(ago(30_000), now)).toBe("just now");
    expect(relativeTime(ago(5 * 60_000), now)).toBe("5m ago");
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe("3h ago");
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe("2d ago");
    expect(relativeTime(ago(45 * 86_400_000), now)).toBe("1mo ago");
    expect(relativeTime(ago(400 * 86_400_000), now)).toBe("1y ago");
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(relativeTime("", now)).toBe("");
  });
});

describe("formatters", () => {
  const stories = [ITEMS[1], ITEMS[2], ITEMS[5]]
    .map((item) => normalizeHnItem(item))
    .filter((s): s is HnStory => s !== null);
  const now = Date.parse("2026-11-21T12:00:00Z");

  it("text has a heading, rank, score, comments, and URL", () => {
    const text = formatHnText(stories, "top", now);
    expect(text).toContain("Hacker News — Top");
    expect(text).toContain(" 1. Hello, HN (example.com)");
    expect(text).toContain("321 pts · by alice · 2h ago · 45 comments");
    expect(text).toContain("https://www.example.com/post?x=1");
    // Ask HN has no external URL, so its discussion link is printed.
    expect(text).toContain("https://news.ycombinator.com/item?id=2");
  });

  it("text reports an empty feed instead of printing a bare heading", () => {
    expect(formatHnText([], "job")).toContain("No jobs stories right now.");
  });

  it("json round-trips the stories", () => {
    expect(JSON.parse(formatHnJson(stories))).toEqual(stories);
  });

  it("csv has the documented header and escapes commas/quotes", () => {
    const csv = formatHnCsv(stories);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "rank,id,title,url,hn_url,author,score,comments,created_at,type,domain",
    );
    expect(lines[1]).toContain("Hello, HN");
    expect(lines[1]).toContain("321,45");
    const escaped = formatHnCsv([
      { ...stories[0], title: 'A, "quoted" title' },
    ]);
    expect(escaped).toContain('"A, ""quoted"" title"');
  });

  it("markdown links the story (or its HN page for text posts)", () => {
    const md = formatHnMarkdown(stories, "top", now);
    expect(md).toContain("# Hacker News — Top");
    expect(md).toContain(
      "[Hello, HN](https://www.example.com/post?x=1) | 321 | 45 | 2h ago",
    );
    expect(md).toContain(
      "[Ask HN: What are you building?](https://news.ycombinator.com/item?id=2)",
    );
  });

  it("markdown escapes a pipe in a title", () => {
    const md = formatHnMarkdown(
      [{ ...stories[0], title: "Rust | Zig" }],
      "top",
      now,
    );
    expect(md).toContain("[Rust \\| Zig]");
  });
});

describe("cli wiring", () => {
  const CLI = join(process.cwd(), "src/cli.ts");
  const BUN = process.execPath.includes("bun") ? process.execPath : "bun";

  function runCli(...args: string[]) {
    const res = spawnSync(BUN, [CLI, ...args], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env },
    });
    return {
      code: res.status,
      out: res.stdout ?? "",
      err: res.stderr ?? "",
    };
  }

  it("rejects an unknown feed before any network request", () => {
    const { code, err } = runCli("hn", "front");
    expect(code).toBe(1);
    expect(err).toContain('Invalid feed: "front"');
    expect(err).toContain("top|new|best|ask|show|job");
    expect(err).not.toContain("Failed to fetch");
  });

  it("documents the hn command and feeds in --help", () => {
    const { code, out } = runCli("--help");
    expect(code).toBe(0);
    expect(out).toContain("ghfind hn [feed]");
    expect(out).toContain("top|new|best|ask|show|job");
  });
});
