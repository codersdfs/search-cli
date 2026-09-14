/**
 * User profile module — `ghfind user <name>`.
 *
 * Fetches a GitHub user's metadata and public repos from the GitHub REST API,
 * aggregates them into a single UserProfile summary (repo count, total stars,
 * top languages, most-starred repos), and renders it as text/JSON/CSV/Markdown.
 *
 * Shape mirrors the org-profile module: a pure aggregate function +
 * normalize function that tests can drive with fixtures, and thin formatters.
 */

export interface UserProfile {
  login: string;
  name: string | null;
  type: string;
  /** Site-admin flag; shown as a badge in text output. */
  siteAdmin: boolean;
  /** Human-readable profile kind: "User", "Organization", "Bot". */
  kind: string;
  bio: string | null;
  url: string;
  blog: string | null;
  location: string | null;
  twitter: string | null;
  company: string | null;
  createdAt: string;
  followers: number;
  following: number;
  /** public_repos as reported by the user payload (all public repos, not just fetched). */
  publicRepoCount: number;
  /** Number of repos actually fetched and aggregated (bounded by the fetch limit). */
  fetchedRepoCount: number;
  totalStars: number;
  totalForks: number;
  /** Top languages by repo count, most-used first. */
  topLanguages: { language: string; repos: number }[];
  /** Most-starred fetched repos, best first. */
  topRepos: UserRepo[];
  /** Recently pushed fetched repos, most recent first. */
  activeRepos: UserRepo[];
}

export interface UserRepo {
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  pushedAt: string;
}

/** Raw shapes from the GitHub REST API (only the fields we read). */
interface GitHubUserPayload {
  login: string;
  name?: string | null;
  type: string;
  site_admin: boolean;
  bio?: string | null;
  html_url: string;
  blog?: string | null;
  location?: string | null;
  twitter_username?: string | null;
  company?: string | null;
  created_at: string;
  followers: number;
  following: number;
  public_repos: number;
}

interface GitHubRepoPayload {
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
}

export interface FetchUserOptions {
  token?: string;
  /** How many repos to fetch & aggregate (default 100 — one request). */
  limit?: number;
}

function apiHeaders(token?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ghfind",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Map a GitHub user `type` to a human-readable profile kind. */
export function userKind(type: string): string {
  switch (type) {
    case "Bot":
      return "Bot";
    case "Organization":
      return "Organization";
    case "User":
      return "User";
    default:
      return type || "Unknown";
  }
}

export function normalizeUserRepo(item: GitHubRepoPayload): UserRepo {
  return {
    fullName: item.full_name ?? "",
    url: item.html_url ?? "",
    description: item.description ?? null,
    language: item.language ?? null,
    stars: item.stargazers_count ?? 0,
    forks: item.forks_count ?? 0,
    pushedAt: item.pushed_at ?? "",
  };
}

export function normalizeUser(
  payload: GitHubUserPayload,
  repos: GitHubRepoPayload[],
): UserProfile {
  const userRepos = (repos ?? []).map(normalizeUserRepo);

  const langCounts = new Map<string, number>();
  for (const r of userRepos) {
    if (!r.language) continue;
    langCounts.set(r.language, (langCounts.get(r.language) ?? 0) + 1);
  }
  const topLanguages = [...langCounts.entries()]
    .map(([language, count]) => ({ language, repos: count }))
    .sort((a, b) => b.repos - a.repos || a.language.localeCompare(b.language))
    .slice(0, 5);

  const byStars = [...userRepos].sort(
    (a, b) => b.stars - a.stars || a.fullName.localeCompare(b.fullName),
  );
  const byPushed = [...userRepos]
    .filter((r) => r.pushedAt)
    .sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt));

  const type = payload.type || "";
  return {
    login: payload.login ?? "",
    name: payload.name ?? null,
    type,
    siteAdmin: payload.site_admin ?? false,
    kind: userKind(type),
    bio: payload.bio ?? null,
    url: payload.html_url ?? "",
    blog: nullIfEmpty(payload.blog),
    location: nullIfEmpty(payload.location),
    twitter: nullIfEmpty(payload.twitter_username),
    company: nullIfEmpty(payload.company),
    createdAt: payload.created_at ?? "",
    followers: payload.followers ?? 0,
    following: payload.following ?? 0,
    publicRepoCount: payload.public_repos ?? 0,
    fetchedRepoCount: userRepos.length,
    totalStars: userRepos.reduce((sum, r) => sum + r.stars, 0),
    totalForks: userRepos.reduce((sum, r) => sum + r.forks, 0),
    topLanguages,
    topRepos: byStars.slice(0, 5),
    activeRepos: byPushed.slice(0, 5),
  };
}

function nullIfEmpty(v: string | null | undefined): string | null {
  return v == null || v === "" ? null : v;
}

/** Fetch a user's profile: metadata + up to `limit` public repos, aggregated. */
export async function fetchUserProfile(
  user: string,
  options: FetchUserOptions = {},
): Promise<UserProfile> {
  const name = user.trim().replace(/^@/, "");
  if (!name) throw new Error("Usage: ghfind user <username>");

  const token = options.token;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

  let userPayload: GitHubUserPayload;
  try {
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(name)}`,
      {
        headers: apiHeaders(token),
      },
    );
    if (res.status === 404) {
      throw new Error(`User "${name}" not found.`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub API error ${res.status}: ${body.slice(0, 200)}`);
    }
    userPayload = (await res.json()) as GitHubUserPayload;
  } catch (err) {
    if (err instanceof Error && err.message.includes(`User "${name}"`))
      throw err;
    throw new Error(
      `Failed to fetch user "${name}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Users with no public repos don't need the repos request.
  const repos: GitHubRepoPayload[] = [];
  if (userPayload.public_repos > 0) {
    const perPage = Math.min(limit, 100);
    const maxPages = Math.ceil(limit / perPage);
    for (let page = 1; page <= maxPages; page++) {
      const url =
        `https://api.github.com/users/${encodeURIComponent(name)}/repos` +
        `?per_page=${perPage}&sort=pushed&page=${page}`;
      const res = await fetch(url, { headers: apiHeaders(token) });
      if (!res.ok) {
        // User metadata succeeded; degraded summary beats a hard failure.
        break;
      }
      const items = (await res.json()) as GitHubRepoPayload[];
      if (!Array.isArray(items)) break; // unexpected shape — degrade gracefully
      repos.push(...items);
      if (repos.length >= limit || items.length < perPage) break;
    }
  }

  return normalizeUser(userPayload, repos.slice(0, limit));
}

// ─── Formatters ────────────────────────────────────────────────────────

export function formatUserText(p: UserProfile): string {
  const lines: string[] = [];
  const badges: string[] = [];
  if (p.kind === "Organization") badges.push("org");
  if (p.kind === "Bot") badges.push("bot");
  if (p.siteAdmin) badges.push("staff");
  const badge = badges.length > 0 ? ` [${badges.join(", ")}]` : "";
  const title = p.name
    ? `${p.login} — ${p.name}${badge}`
    : `${p.login}${badge}`;
  lines.push(title);
  if (p.bio) lines.push(p.bio);

  const meta: string[] = [];
  if (p.company) meta.push(`Company   ${p.company}`);
  if (p.location) meta.push(`Location  ${p.location}`);
  if (p.blog) meta.push(`Web       ${p.blog}`);
  if (p.twitter) meta.push(`Twitter   @${p.twitter}`);
  if (p.createdAt) meta.push(`Joined    ${p.createdAt.slice(0, 10)}`);
  if (meta.length > 0) lines.push(meta.join("\n"));

  lines.push(
    `Repos     ${p.publicRepoCount.toLocaleString()} public${p.fetchedRepoCount < p.publicRepoCount ? ` (aggregated ${p.fetchedRepoCount})` : ""}`,
  );
  lines.push(
    `Stars     ${p.totalStars.toLocaleString()} (sum of aggregated repos)`,
  );
  lines.push(
    `Forks     ${p.totalForks.toLocaleString()} (sum of aggregated repos)`,
  );
  lines.push(
    `Followers ${p.followers.toLocaleString()} · following ${p.following.toLocaleString()}`,
  );
  lines.push(`URL       ${p.url}`);

  if (p.topLanguages.length > 0) {
    const langs = p.topLanguages
      .map((l) => `${l.language} (${l.repos})`)
      .join(", ");
    lines.push(`Languages ${langs}`);
  }

  if (p.topRepos.length > 0) {
    lines.push("");
    lines.push("Top repos by stars:");
    for (const r of p.topRepos) {
      lines.push(
        `  ${r.fullName}  ★ ${r.stars.toLocaleString()}  ${r.language ?? ""}`,
      );
    }
  }
  if (p.activeRepos.length > 0) {
    lines.push("");
    lines.push("Recently active:");
    for (const r of p.activeRepos) {
      lines.push(`  ${r.fullName}  pushed ${r.pushedAt.slice(0, 10)}`);
    }
  }
  return lines.join("\n");
}

export function formatUserJson(p: UserProfile): string {
  return JSON.stringify(p, null, 2);
}

export function formatUserCsv(p: UserProfile): string {
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const row = [
    p.login,
    p.name ?? "",
    p.type,
    p.url,
    String(p.publicRepoCount),
    String(p.totalStars),
    String(p.totalForks),
    String(p.followers),
    p.topLanguages.map((l) => l.language).join(";"),
    p.createdAt,
  ].map(esc);
  return [
    "login,name,type,url,public_repos,total_stars,total_forks,followers,top_languages,created_at",
    row.join(","),
  ].join("\n");
}

export function formatUserMarkdown(p: UserProfile): string {
  const lines: string[] = [];
  lines.push(`# ${p.login}${p.name ? ` — ${p.name}` : ""}`);
  if (p.bio) lines.push("", p.bio);
  lines.push(
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Type | ${p.kind}${p.siteAdmin ? " · staff" : ""} |`,
    `| Public repos | ${p.publicRepoCount} |`,
    `| Total stars (aggregated) | ${p.totalStars.toLocaleString()} |`,
    `| Total forks (aggregated) | ${p.totalForks.toLocaleString()} |`,
    `| Followers | ${p.followers.toLocaleString()} |`,
  );
  if (p.topLanguages.length > 0) {
    lines.push(
      `| Top languages | ${p.topLanguages.map((l) => `${l.language} (${l.repos})`).join(", ")} |`,
    );
  }
  if (p.topRepos.length > 0) {
    lines.push(
      "",
      "## Top repos by stars",
      "",
      "| Repo | Stars | Language |",
      "| --- | --- | --- |",
    );
    for (const r of p.topRepos) {
      lines.push(
        `| [${r.fullName}](${r.url}) | ${r.stars.toLocaleString()} | ${r.language ?? "—"} |`,
      );
    }
  }
  return lines.join("\n");
}
