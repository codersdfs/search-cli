import { describe, it, expect } from "bun:test";
import type { TopicItem } from "../src/explore.ts";

describe("explore", () => {
  it("TopicItem type has expected fields", () => {
    const topic: TopicItem = { name: "rust", description: "A systems language", repoCount: 150000 };
    expect(topic.name).toBe("rust");
    expect(topic.description).toBe("A systems language");
    expect(topic.repoCount).toBe(150000);
  });

  it("fetchTopics returns an array", async () => {
    const { fetchTopics } = await import("../src/explore.ts");
    const topics = await fetchTopics();
    expect(Array.isArray(topics)).toBe(true);
  });
});
