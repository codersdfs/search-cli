// Tests for the org profile module (ghfind org <name>)
import { describe, it, expect, afterEach } from "vitest";
import {
  fetchOrgProfile,
  normalizeOrg,
  normalizeOrgRepo,
  formatOrgText,
  formatOrgJson,
  formatOrgCsv,
  formatOrgMarkdown,
} from "../src/org";
import type { OrgProfile } from "../src/org";

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

const ORG_PAYLOAD = {
  login: "vercel",
  name: "Vercel",
  description: "Develop. Preview. Ship.",
  html_url: "https://github.com/vercel",
  blog: "https://vercel.com",
  location: "San Francisco, CA",
  created_at: "2015-01-01T00:00:00Z",
  public_repos: 2,
};

const REPO_PAYLOADS = [
  {
    full_name: "vercel/next.js",
    html_url: "https://github.com/vercel/next.js",
    description: "The React Framework",
    language: "JavaScript",
    stargazers_count: 120000,
    forks_count: 25000,
    pushed_at: "2026-09-01T12:00:00Z",
  },
  {
    full_name: "vercel/turborepo",
    html_url: "https://github.com/vercel/turborepo",
    description: "Build system optimized for JS",
    language: "TypeScript",
    stargazers_count: 25000,
    forks_count: 1500,
    pushed_at: "2026-09-08T09:00:00Z",
  },
];

describe("normalizeOrgRepo", () => {
  it("maps the API payload to OrgRepo shape", () => {
    const out = normalizeOrgRepo(REPO_PAYLOADS[0]);
    expect(out).toEqual({
      fullName: "vercel/next.js",
      url: "https://github.com/vercel/next.js",
      description: "The React Framework",
      language: "JavaScript",
      stars: 120000,
      forks: 25000,
      pushedAt: "2026-09-01T12:00:00Z",
    });
  });

  it("fills null/zero defaults for missing fields", () => {
    const out = normalizeOrgRepo({
      full_name: "vercel/empty",
      html_url: "",
      description: null,
      language: null,
      stargazers_count: 0,
      forks_count: 0,
      pushed_at: "",
    } as never);
    expect(out.description).toBeNull();
    expect(out.language).toBeNull();
    expect(out.stars).toBe(0);
  });
});

describe("normalizeOrg", () => {
  it("aggregates stars, forks, and language counts", () => {
    const p = normalizeOrg(ORG_PAYLOAD, REPO_PAYLOADS);
    expect(p.login).toBe("vercel");
    expect(p.name).toBe("Vercel");
    expect(p.publicRepoCount).toBe(2);
    expect(p.fetchedRepoCount).toBe(2);
    expect(p.totalStars).toBe(145000);
    expect(p.totalForks).toBe(26500);
    expect(p.topLanguages).toEqual([
      { language: "JavaScript", repos: 1 },
      { language: "TypeScript", repos: 1 },
    ]);
    expect(p.topRepos[0]?.fullName).toBe("vercel/next.js");
  });

  it("ranks languages by repo count then alphabetically", () => {
    const p = normalizeOrg(ORG_PAYLOAD, [
      { ...REPO_PAYLOADS[0], language: "Zig" },
      { ...REPO_PAYLOADS[1], language: "Zig" },
    ]);
    expect(p.topLanguages[0]).toEqual({ language: "Zig", repos: 2 });
  });

  it("excludes null-language repos from topLanguages and sorts active repos by pushedAt desc", () => {
    const p = normalizeOrg(ORG_PAYLOAD, [
      REPO_PAYLOADS[0],
      REPO_PAYLOADS[1],
      {
        ...REPO_PAYLOADS[0],
        full_name: "vercel/no-lang",
        language: null,
        pushed_at: "2026-09-09T00:00:00Z",
      },
    ]);
    expect(p.topLanguages).toHaveLength(2);
    expect(p.activeRepos[0]?.fullName).toBe("vercel/no-lang");
  });

  it("handles zero repos and zero public_repos", () => {
    const p = normalizeOrg(ORG_PAYLOAD, []);
    expect(p.fetchedRepoCount).toBe(0);
    expect(p.totalStars).toBe(0);
    expect(p.topRepos).toEqual([]);
    expect(p.topLanguages).toEqual([]);
  });

  it("never mutates the input repo array", () => {
    const input = [...REPO_PAYLOADS];
    normalizeOrg(ORG_PAYLOAD, input);
    expect(input).toHaveLength(2);
  });
});

describe("fetchOrgProfile", () => {
  it("strips a leading @ and fetches org + repos", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      if (String(url).includes("/orgs/@")) {
        throw new Error("should not send @ to the API");
      }
      if (String(url).endsWith("/orgs/vercel")) {
        return jsonResponse(ORG_PAYLOAD);
      }
      return jsonResponse(REPO_PAYLOADS);
    }) as typeof fetch;

    const p = await fetchOrgProfile("@vercel");
    expect(calls.some((c) => c.endsWith("/orgs/vercel"))).toBe(true);
    expect(calls.some((c) => c.includes("/repos?per_page=100"))).toBe(true);
    expect(p.totalStars).toBe(145000);
  });

  it("throws a friendly error for a 404 org", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ message: "Not Found" }, 404)) as typeof fetch;
    await expect(fetchOrgProfile("nope-org-xyz")).rejects.toThrow(
      'Organization "nope-org-xyz" not found.',
    );
  });

  it("wraps network failures in an error naming the org", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    await expect(fetchOrgProfile("vercel")).rejects.toThrow(
      'Failed to fetch org "vercel": ECONNREFUSED',
    );
  });

  it("throws on empty org name", async () => {
    await expect(fetchOrgProfile("  ")).rejects.toThrow(
      "Usage: ghfind org <org-name>",
    );
  });

  it("skips the repos request when public_repos is 0", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return jsonResponse({ ...ORG_PAYLOAD, public_repos: 0 });
    }) as typeof fetch;
    const p = await fetchOrgProfile("vercel");
    expect(calls).toHaveLength(1);
    expect(p.fetchedRepoCount).toBe(0);
    expect(p.publicRepoCount).toBe(0);
  });

  it("degrades gracefully when the repos request fails (org metadata still returned)", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).endsWith("/orgs/vercel"))
        return jsonResponse(ORG_PAYLOAD);
      return jsonResponse({ message: "boom" }, 500);
    }) as typeof fetch;
    const p = await fetchOrgProfile("vercel");
    expect(p.login).toBe("vercel");
    expect(p.fetchedRepoCount).toBe(0);
  });

  it("does not send an Authorization header when no token is given", async () => {
    let sawAuth: string | undefined;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      sawAuth = (init?.headers as Record<string, string>)?.Authorization;
      if (String(url).endsWith("/orgs/vercel"))
        return jsonResponse(ORG_PAYLOAD);
      return jsonResponse([]);
    }) as typeof fetch;
    await fetchOrgProfile("vercel");
    expect(sawAuth).toBeUndefined();
  });

  it("ignores a non-array repos response instead of crashing", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).endsWith("/orgs/vercel"))
        return jsonResponse(ORG_PAYLOAD);
      return jsonResponse({ message: "unexpected shape" });
    }) as typeof fetch;
    const p = await fetchOrgProfile("vercel");
    expect(p.login).toBe("vercel");
    expect(p.fetchedRepoCount).toBe(0);
  });
});

describe("formatters", () => {
  const profile: OrgProfile = normalizeOrg(ORG_PAYLOAD, REPO_PAYLOADS);

  it("text includes headline numbers, languages, and top repos", () => {
    const text = formatOrgText(profile);
    expect(text).toContain("vercel — Vercel");
    expect(text).toContain("Stars     145,000");
    expect(text).toContain("JavaScript (1)");
    expect(text).toContain("vercel/next.js  ★ 120,000");
    expect(text).toContain("Recently active:");
  });

  it("json round-trips the profile", () => {
    const p2 = JSON.parse(formatOrgJson(profile)) as OrgProfile;
    expect(p2).toEqual(profile);
  });

  it("csv emits a header row and aggregates numbers", () => {
    const csv = formatOrgCsv(profile);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("login,name,url,public_repos,total_stars");
    expect(lines[1]).toContain("vercel,2,145000,26500");
  });

  it("csv escapes values containing commas", () => {
    const csv = formatOrgCsv({ ...profile, name: 'Vercel, "Inc."' });
    expect(csv).toContain('"Vercel, ""Inc."""');
  });

  it("markdown renders metric and top-repo tables", () => {
    const md = formatOrgMarkdown(profile);
    expect(md).toContain("# vercel — Vercel");
    expect(md).toContain("| Total stars (aggregated) | 145,000 |");
    expect(md).toContain("[vercel/next.js](https://github.com/vercel/next.js)");
  });
});
