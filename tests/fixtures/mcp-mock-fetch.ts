/**
 * Test-only preload for the MCP stdio end-to-end test.
 *
 *   bun --preload tests/fixtures/mcp-mock-fetch.ts src/cli.ts mcp
 *
 * Runs before the CLI entrypoint and stubs global fetch with the two GitHub
 * endpoints similar-repo discovery touches, so the spawned server stays
 * offline while the rest of the process is the real thing.
 */

const SOURCE_REPO = {
  description: "Incredibly fast JavaScript runtime",
  html_url: "https://github.com/oven-sh/bun",
  stargazers_count: 70000,
  forks_count: 2000,
  subscribers_count: 70000,
  language: "Zig",
  topics: ["runtime"],
  archived: false,
  fork: false,
  private: false,
  created_at: "2021-01-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  pushed_at: "2026-09-10T00:00:00Z",
};

const SOURCE_SEARCH_ITEM = {
  id: 1,
  name: "bun",
  full_name: "oven-sh/bun",
  owner: { login: "oven-sh" },
  description: SOURCE_REPO.description,
  html_url: SOURCE_REPO.html_url,
  stargazers_count: SOURCE_REPO.stargazers_count,
  forks_count: SOURCE_REPO.forks_count,
  watchers_count: SOURCE_REPO.stargazers_count,
  language: SOURCE_REPO.language,
  topics: SOURCE_REPO.topics,
  archived: false,
  fork: false,
  private: false,
  created_at: SOURCE_REPO.created_at,
  updated_at: SOURCE_REPO.updated_at,
  pushed_at: SOURCE_REPO.pushed_at,
  score: 1,
};

const CANDIDATE = {
  id: 2,
  name: "node",
  full_name: "nodejs/node",
  owner: { login: "nodejs" },
  description: "Node.js JavaScript runtime",
  html_url: "https://github.com/nodejs/node",
  stargazers_count: 100000,
  forks_count: 25000,
  watchers_count: 100000,
  language: "JavaScript",
  topics: ["runtime"],
  archived: false,
  fork: false,
  private: false,
  created_at: "2014-01-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  pushed_at: "2026-09-15T00:00:00Z",
  score: 0.9,
};

// Includes the source repo so the tool's client-side exclusion is exercised.
const SEARCH_ENVELOPE = {
  total_count: 2,
  incomplete_results: false,
  items: [SOURCE_SEARCH_ITEM, CANDIDATE],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes("/search/repositories")) return json(SEARCH_ENVELOPE);
  if (url.includes("/repos/oven-sh/bun")) return json(SOURCE_REPO);
  return json({ message: `unexpected request: ${url}` }, 500);
}) as unknown as typeof fetch;
