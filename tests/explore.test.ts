import { describe, it, expect, afterEach } from "vitest";
import type { TopicItem } from "../src/explore.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("explore", () => {
  it("TopicItem type has expected fields", () => {
    const topic: TopicItem = {
      name: "rust",
      description: "A systems language",
      repoCount: 150000,
    };
    expect(topic.name).toBe("rust");
    expect(topic.description).toBe("A systems language");
    expect(topic.repoCount).toBe(150000);
  });

  it("fetchTopics maps the API payload to TopicItem[]", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          items: [
            { name: "rust", description: "systems", score: 150000 },
            { name: "go" },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const { fetchTopics } = await import("../src/explore.ts");
    const topics = await fetchTopics();

    expect(Array.isArray(topics)).toBe(true);
    expect(topics).toEqual([
      { name: "rust", description: "systems", repoCount: 150000 },
      { name: "go", description: "", repoCount: 0 },
    ]);
  });

  it("fetchTopics returns an empty array when items is missing", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), {
        status: 200,
      })) as unknown as typeof fetch;

    const { fetchTopics } = await import("../src/explore.ts");
    expect(await fetchTopics()).toEqual([]);
  });

  it("fetchTopics throws on a non-ok response", async () => {
    globalThis.fetch = (async () =>
      new Response("rate limited", { status: 403 })) as unknown as typeof fetch;

    const { fetchTopics } = await import("../src/explore.ts");
    await expect(fetchTopics()).rejects.toThrow("Topics API: HTTP 403");
  });
});
