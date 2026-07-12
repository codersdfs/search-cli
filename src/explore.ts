/**
 * Topic explorer — browse popular GitHub topics.
 * 
 * ponytail: fetch flat topic list via search API, no hierarchy.
 * Selecting a topic triggers a search.
 */
export interface TopicItem {
  name: string;
  description: string;
  repoCount: number;
}

/** Fetch popular topics from GitHub search API.
 *  Requires the `mercy-preview` media type for the /search/topics endpoint.
 */
export async function fetchTopics(): Promise<TopicItem[]> {
  const res = await fetch("https://api.github.com/search/topics?q=popular&per_page=30", {
    headers: {
      Accept: "application/vnd.github.mercy-preview+json",
      "User-Agent": "search-cli",
    },
  });
  if (!res.ok) throw new Error(`Topics API: HTTP ${res.status}`);
  const data = await res.json() as { items?: Array<{ name: string; description?: string; score?: number }> };
  return (data.items ?? []).map((item) => ({
    name: item.name,
    description: item.description || "",
    repoCount: item.score || 0,
  }));
}
