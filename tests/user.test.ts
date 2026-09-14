// Tests for the user profile module (ghfind user <name>)
import { describe, it, expect, afterEach } from "vitest";
import {
  fetchUserProfile,
  normalizeUser,
  normalizeUserRepo,
  formatUserText,
  formatUserJson,
  formatUserCsv,
  formatUserMarkdown,
  userKind,
} from "../src/user";
import type { UserProfile } from "../src/user";

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

const USER_PAYLOAD = {
  login: "torvalds",
  name: "Linus Torvalds",
  type: "User",
  site_admin: false,
  bio: "Software anarchist",
  html_url: "https://github.com/torvalds",
  blog: "https://torvalds.family",
  location: "Portland, OR",
  twitter_username: "null",
  company: "Linux Foundation",
  created_at: "2011-09-03T00:00:00Z",
  followers: 200000,
  following: 0,
  public_repos: 8,
};

const REPO_PAYLOADS = [
  {
    full_name: "torvalds/linux",
    html_url: "https://github.com/torvalds/linux",
    description: "Linux kernel source tree",
    language: "C",
    stargazers_count: 180000,
    forks_count: 50000,
    pushed_at: "2026-09-10T12:00:00Z",
  },
  {
    full_name: "torvalds/subsurface-for-dirkdirk",
    html_url: "https://github.com/torvalds/subsurface-for-dirkdirk",
    description: "Dive log",
    language: "C",
    stargazers_count: 2500,
    forks_count: 900,
    pushed_at: "2026-09-12T09:00:00Z",
  },
];

describe("userKind", () => {
  it("maps known GitHub types to readable kinds", () => {
    expect(userKind("User")).toBe("User");
    expect(userKind("Organization")).toBe("Organization");
    expect(userKind("Bot")).toBe("Bot");
  });

  it("falls back to the raw type or Unknown", () => {
    expect(userKind("Mannequin")).toBe("Mannequin");
    expect(userKind("")).toBe("Unknown");
  });
});

describe("normalizeUserRepo", () => {
  it("maps the API payload to UserRepo shape", () => {
    const out = normalizeUserRepo(REPO_PAYLOADS[0]);
    expect(out).toEqual({
      fullName: "torvalds/linux",
      url: "https://github.com/torvalds/linux",
      description: "Linux kernel source tree",
      language: "C",
      stars: 180000,
      forks: 50000,
      pushedAt: "2026-09-10T12:00:00Z",
    });
  });

  it("fills null/zero defaults for missing fields", () => {
    const out = normalizeUserRepo({
      full_name: "torvalds/empty",
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

describe("normalizeUser", () => {
  it("aggregates stars, forks, followers, and language counts", () => {
    const p = normalizeUser(USER_PAYLOAD, REPO_PAYLOADS);
    expect(p.login).toBe("torvalds");
    expect(p.name).toBe("Linus Torvalds");
    expect(p.kind).toBe("User");
    expect(p.siteAdmin).toBe(false);
    expect(p.followers).toBe(200000);
    expect(p.publicRepoCount).toBe(8);
    expect(p.fetchedRepoCount).toBe(2);
    expect(p.totalStars).toBe(182500);
    expect(p.totalForks).toBe(50900);
    expect(p.topLanguages).toEqual([{ language: "C", repos: 2 }]);
    expect(p.topRepos[0]?.fullName).toBe("torvalds/linux");
  });

  it("marks Organization-type accounts and staff badges", () => {
    const org = normalizeUser(
      { ...USER_PAYLOAD, type: "Organization", site_admin: true },
      REPO_PAYLOADS,
    );
    expect(org.kind).toBe("Organization");
    expect(org.siteAdmin).toBe(true);
  });

  it("nulls out empty-string profile fields", () => {
    const p = normalizeUser(
      {
        ...USER_PAYLOAD,
        blog: "",
        location: "",
        twitter_username: "",
        company: "",
      },
      [],
    );
    expect(p.blog).toBeNull();
    expect(p.location).toBeNull();
    expect(p.twitter).toBeNull();
    expect(p.company).toBeNull();
  });

  it("ranks languages by repo count then alphabetically", () => {
    const p = normalizeUser(USER_PAYLOAD, [
      { ...REPO_PAYLOADS[0], language: "Zig" },
      { ...REPO_PAYLOADS[1], language: "Zig" },
      {
        ...REPO_PAYLOADS[0],
        full_name: "torvalds/third",
        language: "Rust",
      },
    ]);
    expect(p.topLanguages[0]).toEqual({ language: "Zig", repos: 2 });
    expect(p.topLanguages[1]).toEqual({ language: "Rust", repos: 1 });
  });

  it("excludes null-language repos from topLanguages and sorts active repos by pushedAt desc", () => {
    const p = normalizeUser(USER_PAYLOAD, [
      REPO_PAYLOADS[0],
      REPO_PAYLOADS[1],
      {
        ...REPO_PAYLOADS[0],
        full_name: "torvalds/no-lang",
        language: null,
        pushed_at: "2026-09-13T00:00:00Z",
      },
    ]);
    expect(p.topLanguages).toHaveLength(1);
    expect(p.activeRepos[0]?.fullName).toBe("torvalds/no-lang");
  });

  it("handles zero repos and zero public_repos", () => {
    const p = normalizeUser(USER_PAYLOAD, []);
    expect(p.fetchedRepoCount).toBe(0);
    expect(p.totalStars).toBe(0);
    expect(p.topRepos).toEqual([]);
    expect(p.topLanguages).toEqual([]);
  });

  it("never mutates the input repo array", () => {
    const input = [...REPO_PAYLOADS];
    normalizeUser(USER_PAYLOAD, input);
    expect(input).toHaveLength(2);
  });
});

describe("fetchUserProfile", () => {
  it("strips a leading @ and fetches user + repos", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      if (String(url).includes("/users/@")) {
        throw new Error("should not send @ to the API");
      }
      if (String(url).endsWith("/users/torvalds")) {
        return jsonResponse(USER_PAYLOAD);
      }
      return jsonResponse(REPO_PAYLOADS);
    }) as unknown as typeof fetch;

    const p = await fetchUserProfile("@torvalds");
    expect(calls.some((c) => c.endsWith("/users/torvalds"))).toBe(true);
    expect(calls.some((c) => c.includes("/repos?per_page=100"))).toBe(true);
    expect(p.totalStars).toBe(182500);
  });

  it("throws a friendly error for a 404 user", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ message: "Not Found" }, 404)) as unknown as typeof fetch;
    await expect(fetchUserProfile("nope-user-xyz")).rejects.toThrow(
      'User "nope-user-xyz" not found.',
    );
  });

  it("wraps network failures in an error naming the user", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(fetchUserProfile("torvalds")).rejects.toThrow(
      'Failed to fetch user "torvalds": ECONNREFUSED',
    );
  });

  it("throws on empty user name", async () => {
    await expect(fetchUserProfile("  ")).rejects.toThrow(
      "Usage: ghfind user <username>",
    );
  });

  it("skips the repos request when public_repos is 0", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return jsonResponse({ ...USER_PAYLOAD, public_repos: 0 });
    }) as unknown as typeof fetch;
    const p = await fetchUserProfile("torvalds");
    expect(calls).toHaveLength(1);
    expect(p.fetchedRepoCount).toBe(0);
    expect(p.publicRepoCount).toBe(0);
  });

  it("degrades gracefully when the repos request fails (user metadata still returned)", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).endsWith("/users/torvalds"))
        return jsonResponse(USER_PAYLOAD);
      return jsonResponse({ message: "boom" }, 500);
    }) as unknown as typeof fetch;
    const p = await fetchUserProfile("torvalds");
    expect(p.login).toBe("torvalds");
    expect(p.fetchedRepoCount).toBe(0);
  });

  it("does not send an Authorization header when no token is given", async () => {
    let sawAuth: string | undefined;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      sawAuth = (init?.headers as Record<string, string>)?.Authorization;
      if (String(url).endsWith("/users/torvalds"))
        return jsonResponse(USER_PAYLOAD);
      return jsonResponse([]);
    }) as unknown as typeof fetch;
    await fetchUserProfile("torvalds");
    expect(sawAuth).toBeUndefined();
  });

  it("sends the bearer token when one is provided", async () => {
    let sawAuth: string | undefined;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      sawAuth = (init?.headers as Record<string, string>)?.Authorization;
      if (String(url).endsWith("/users/torvalds"))
        return jsonResponse(USER_PAYLOAD);
      return jsonResponse([]);
    }) as unknown as typeof fetch;
    await fetchUserProfile("torvalds", { token: "ghp_test123" });
    expect(sawAuth).toBe("Bearer ghp_test123");
  });

  it("ignores a non-array repos response instead of crashing", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).endsWith("/users/torvalds"))
        return jsonResponse(USER_PAYLOAD);
      return jsonResponse({ message: "unexpected shape" });
    }) as unknown as typeof fetch;
    const p = await fetchUserProfile("torvalds");
    expect(p.login).toBe("torvalds");
    expect(p.fetchedRepoCount).toBe(0);
  });
});

describe("formatters", () => {
  const profile: UserProfile = normalizeUser(USER_PAYLOAD, REPO_PAYLOADS);

  it("text includes headline numbers, followers, languages, and top repos", () => {
    const text = formatUserText(profile);
    expect(text).toContain("torvalds — Linus Torvalds");
    expect(text).toContain("Stars     182,500");
    expect(text).toContain("Followers 200,000");
    expect(text).toContain("C (2)");
    expect(text).toContain("torvalds/linux  ★ 180,000");
    expect(text).toContain("Recently active:");
  });

  it("text shows an [org] badge for Organization-type accounts", () => {
    const org = normalizeUser({ ...USER_PAYLOAD, type: "Organization" }, []);
    expect(formatUserText(org)).toContain("[org]");
  });

  it("text shows a [staff] badge for site admins", () => {
    const staff = normalizeUser({ ...USER_PAYLOAD, site_admin: true }, []);
    expect(formatUserText(staff)).toContain("[staff]");
  });

  it("json round-trips the profile", () => {
    const p2 = JSON.parse(formatUserJson(profile)) as UserProfile;
    expect(p2).toEqual(profile);
  });

  it("csv emits a header row and aggregates numbers", () => {
    const csv = formatUserCsv(profile);
    const lines = csv.split("\n");
    expect(lines[0]).toContain(
      "login,name,type,url,public_repos,total_stars,total_forks,followers",
    );
    expect(lines[1]).toContain("torvalds,8,182500,50900,200000");
  });

  it("csv escapes values containing commas", () => {
    const csv = formatUserCsv({ ...profile, name: 'Torvalds, "Inc."' });
    expect(csv).toContain('"Torvalds, ""Inc."""');
  });

  it("markdown renders metric and top-repo tables", () => {
    const md = formatUserMarkdown(profile);
    expect(md).toContain("# torvalds — Linus Torvalds");
    expect(md).toContain("| Total stars (aggregated) | 182,500 |");
    expect(md).toContain("[torvalds/linux](https://github.com/torvalds/linux)");
  });
});
