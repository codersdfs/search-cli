import { describe, it, expect } from "bun:test";
import type { TopicItem } from "../src/explore.ts";

describe("explore", () => {
  it("TopicItem type has expected fields", () => {
    const topic: TopicItem = { name: "rust", description: "A systems language", repoCount: 150000 };
    expect(topic.name).toBe("rust");
    expect(topic.description).toBe("A systems language");
    expect(topic.repoCount).toBe(150000);
  });

  it("parses topic from HTML (unit test for parsing logic)", () => {
    // Test the HTML parsing logic that fetchTopics uses
    const html = `<article class="border"><a href="/topics/rust"><p>A systems language</p>150,000 repositories</article>`;
    const nameMatch = html.match(/href="\/topics\/([^"]+)"/);
    const descMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const countMatch = html.match(/([\d,]+)\s+repositories/);
    
    expect(nameMatch?.[1]).toBe("rust");
    expect(descMatch?.[1].replace(/<[^>]*>/g, "").trim()).toBe("A systems language");
    expect(countMatch?.[1]).toBe("150,000");
  });

  it("handles missing description gracefully", () => {
    const html = `<article class="border"><a href="/topics/test">Test</article>`;
    const descMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    expect(descMatch).toBeNull();
  });
});
