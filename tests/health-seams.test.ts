import { describe, it, expect, afterEach } from "vitest";
import {
  fetchHealthSignals,
  fetchHealth,
  computeHealth,
} from "../src/health.ts";
import type { Repo } from "../src/types.ts";

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

const makeRepo = (over: Partial<Repo> = {}): Repo => ({
  id: 0,
  fullName: "owner/repo",
  name: "repo",
  owner: "owner",
  description: null,
  url: "https://github.com/owner/repo",
  stars: 100,
  forks: 5,
  watchers: 0,
  language: "TypeScript",
  topics: [],
  archived: false,
  isFork: false,
  private: false,
  createdAt: daysAgo(1200),
  updatedAt: daysAgo(2),
  pushedAt: daysAgo(10),
  score: 0,
  ...over,
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Route a fake fetch by endpoint substring. */
function mockFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url);
    for (const [needle, respond] of Object.entries(routes)) {
      if (u.includes(needle)) return respond();
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("fetchHealthSignals", () => {
  it("maps every endpoint to its signal", async () => {
    globalThis.fetch = mockFetch({
      "/commits?": () => jsonResponse(new Array(45).fill({})),
      "/issues?state=open": () =>
        jsonResponse([
          ...new Array(12).fill({}),
          { pull_request: {} },
          { pull_request: {} },
        ]),
      "/issues?state=closed": () => jsonResponse(new Array(45).fill({})),
      "/releases?": () => jsonResponse([{ published_at: daysAgo(20) }]),
      "/contributors?": () => jsonResponse(new Array(21).fill({})),
    }) as unknown as typeof fetch;

    const signals = await fetchHealthSignals(makeRepo());
    expect(signals.daysSincePush).toBe(10);
    expect(signals.commitsLast90Days).toBe(45);
    // PRs are filtered out client-side.
    expect(signals.issues).toEqual({ open: 12, closedLast90Days: 45 });
    expect(signals.releases).toEqual({
      hasReleases: true,
      daysSinceRelease: 20,
    });
    expect(signals.contributors).toBe(21);
    expect(signals.repoAgeDays).toBe(1200);
    expect(signals.archived).toBe(false);
  });

  it("treats an empty releases list as no releases, not a failure", async () => {
    globalThis.fetch = mockFetch({
      "/commits?": () => jsonResponse([]),
      "/issues?state=open": () => jsonResponse([]),
      "/issues?state=closed": () => jsonResponse([]),
      "/releases?": () => jsonResponse([]),
      "/contributors?": () => jsonResponse([{}]),
    }) as unknown as typeof fetch;

    const signals = await fetchHealthSignals(makeRepo());
    expect(signals.releases).toEqual({
      hasReleases: false,
      daysSinceRelease: null,
    });
    const score = computeHealth(signals, "owner/repo");
    const releases = score.dimensions.find((d) => d.key === "releases");
    expect(releases?.score).toBe(0);
    expect(releases?.reason).toBe("no releases published");
  });

  it("degrades the issues dimension when the search API fails", async () => {
    globalThis.fetch = mockFetch({
      "/commits?": () => jsonResponse([{}]),
      "/issues?state=open": () => jsonResponse({}, 500),
      "/issues?state=closed": () => jsonResponse([{}]),
      "/releases?": () => jsonResponse([{}]),
      "/contributors?": () => jsonResponse(new Array(10).fill({})),
    }) as unknown as typeof fetch;

    const signals = await fetchHealthSignals(makeRepo());
    expect(signals.issues).toBeNull();
    const score = computeHealth(signals, "owner/repo");
    expect(score.dimensions.find((d) => d.key === "issues")?.score).toBeNull();
    expect(score.total).not.toBeNull();
  });

  it("yields a null total when every endpoint fails", async () => {
    // Every endpoint must fail hard (5xx) for a fully unavailable score.
    globalThis.fetch = mockFetch({
      "/releases?": () => jsonResponse({}, 500),
    }) as unknown as typeof fetch;

    const score = await fetchHealth(makeRepo({ pushedAt: "", createdAt: "" }));
    expect(score.total).toBeNull();
    expect(score.grade).toBe("—");
  });

  it("counts a full commit page as 100+ for scoring", async () => {
    globalThis.fetch = mockFetch({
      "/commits?": () => jsonResponse(new Array(100).fill({})),
      "/issues?state=open": () => jsonResponse([]),
      "/issues?state=closed": () => jsonResponse([]),
      "/releases?": () => jsonResponse([{ published_at: daysAgo(5) }]),
      "/contributors?": () => jsonResponse(new Array(100).fill({})),
    }) as unknown as typeof fetch;

    const signals = await fetchHealthSignals(makeRepo());
    expect(signals.commitsLast90Days).toBe(100);
    const score = computeHealth(signals, "owner/repo");
    const maintenance = score.dimensions.find((d) => d.key === "maintenance");
    expect(maintenance?.reason).toContain("100+ commits");
    // push recency 80 (10d) * 0.6 + activity 100 * 0.4 = 88
    expect(maintenance?.score).toBe(88);
    expect(score.dimensions.find((d) => d.key === "community")?.reason).toBe(
      "100+ contributors",
    );
  });

  it("keeps fetchHealth's repo name on the score", async () => {
    globalThis.fetch = mockFetch({
      "/commits?": () => jsonResponse([]),
      "/issues?state=open": () => jsonResponse([]),
      "/issues?state=closed": () => jsonResponse([]),
      "/releases?": () => jsonResponse([{ published_at: daysAgo(5) }]),
      "/contributors?": () => jsonResponse([{}, {}]),
    }) as unknown as typeof fetch;

    const score = await fetchHealth(makeRepo({ fullName: "a/b" }));
    expect(score.repo).toBe("a/b");
  });

  it("skips the contributors request when a count is supplied", async () => {
    let contributorsCalls = 0;
    globalThis.fetch = mockFetch({
      "/commits?": () => jsonResponse([]),
      "/issues?state=open": () => jsonResponse([]),
      "/issues?state=closed": () => jsonResponse([]),
      "/releases?": () => jsonResponse([{ published_at: daysAgo(5) }]),
      "/contributors?": () => {
        contributorsCalls += 1;
        return jsonResponse([{}]);
      },
    }) as unknown as typeof fetch;

    const signals = await fetchHealthSignals(makeRepo(), undefined, {
      contributorsCount: 7,
    });
    expect(signals.contributors).toBe(7);
    expect(contributorsCalls).toBe(0);
  });
});
