/**
 * Topic explorer — browse popular GitHub topics.
 * 
 * ponytail: fetch flat topic list, no hierarchy. Selecting a topic
 * triggers a search. Hierarchy adds ~60 lines for marginal benefit.
 */
import { ParseError } from "./errors.ts";

export interface TopicItem {
  name: string;
  description: string;
  repoCount: number;
}

/** Fetch popular topics from github.com/topics. */
export async function fetchTopics(): Promise<TopicItem[]> {
  const res = await fetch("https://github.com/topics", {
    headers: { "User-Agent": "search-cli/1.0" },
  });
  if (!res.ok) throw new ParseError("GitHub topics", `HTTP ${res.status}`);
  const html = await res.text();

  const topics: TopicItem[] = [];
  // Parse topic cards from the HTML
  const cards = html.split('<article class="border');
  for (let i = 1; i < cards.length; i++) {
    const block = cards[i];

    const nameMatch = block.match(/href="\/topics\/([^"]+)"/);
    if (!nameMatch) continue;
    const name = decodeURIComponent(nameMatch[1]);

    const descMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
      : "";

    const countMatch = block.match(/([\d,]+)\s+repositories/);
    const repoCount = countMatch ? parseInt(countMatch[1].replace(/,/g, "")) : 0;

    topics.push({ name, description, repoCount });
  }

  return topics.slice(0, 30);
}
