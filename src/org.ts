/**
 * Org profile module — `ghfind org <name>`.
 *
 * Fetches an organization's metadata and public repos from the GitHub REST API,
 * aggregates them into a single OrgProfile summary (repo count, total stars,
 * top languages, most-starred repos), and renders it as text/JSON/CSV/Markdown.
 *
 * Shape mirrors the package-search module: a pure aggregate function +
 * normalize function that tests can drive with fixtures, and thin formatters.
 */

export interface OrgProfile {
  login: string;
  name: string | null;
  description: string | null;
  url: string;
  blog: string | null;
  location: string | null;
  createdAt: string;
  /** public_repos as reported by the org payload (all public repos, not just fetched). */
  publicRepoCount: number;
  /** Number of repos actually fetched and aggregated (bounded by the fetch limit). */
  fetchedRepoCount: number;
  totalStars: number;
  totalForks: number;
  /** Top languages by repo count, most-used first. */
  topLanguages: { language: string; repos: number }[];
  /** Most-starred fetched repos, best first. */
  topRepos: OrgRepo[];
  /** Recently pushed fetched repos, most recent first. */
  activeRepos: OrgRepo[];
}

export interface OrgRepo {
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  pushedAt: string;
}

/** Raw shapes from the GitHub REST API (only the fields we read). */
interface GitHubOrgPayload {
  login: string;
  name?: string | null;
  description?: string | null;
  html_url: string;
  blog?: string | null;
  location?: string | null;
  created_at: string;
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

export interface FetchOrgOptions {
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

export function normalizeOrgRepo(item: GitHubRepoPayload): OrgRepo {
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

export function normalizeOrg(
  payload: GitHubOrgPayload,
  repos: GitHubRepoPayload[],
): OrgProfile {
  const orgRepos = (repos ?? []).map(normalizeOrgRepo);

  const langCounts = new Map<string, number>();
  for (const r of orgRepos) {
    if (!r.language) continue;
    langCounts.set(r.language, (langCounts.get(r.language) ?? 0) + 1);
  }
  const topLanguages = [...langCounts.entries()]
    .map(([language, count]) => ({ language, repos: count }))
    .sort((a, b) => b.repos - a.repos || a.language.localeCompare(b.language))
    .slice(0, 5);

  const byStars = [...orgRepos].sort(
    (a, b) => b.stars - a.stars || a.fullName.localeCompare(b.fullName),
  );
  const byPushed = [...orgRepos]
    .filter((r) => r.pushedAt)
    .sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt));

  return {
    login: payload.login ?? "",
    name: payload.name ?? null,
    description: payload.description ?? null,
    url: payload.html_url ?? "",
    blog: payload.blog ?? null,
    location: payload.location ?? null,
    createdAt: payload.created_at ?? "",
    publicRepoCount: payload.public_repos ?? 0,
    fetchedRepoCount: orgRepos.length,
    totalStars: orgRepos.reduce((sum, r) => sum + r.stars, 0),
    totalForks: orgRepos.reduce((sum, r) => sum + r.forks, 0),
    topLanguages,
    topRepos: byStars.slice(0, 5),
    activeRepos: byPushed.slice(0, 5),
  };
}

/** Fetch an org's profile: metadata + up to `limit` public repos, aggregated. */
export async function fetchOrgProfile(
  org: string,
  options: FetchOrgOptions = {},
): Promise<OrgProfile> {
  const name = org.trim().replace(/^@/, "");
  if (!name) throw new Error("Usage: ghfind org <org-name>");

  const token = options.token;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

  let orgPayload: GitHubOrgPayload;
  try {
    const res = await fetch(`https://api.github.com/orgs/${encodeURIComponent(name)}`, {
      headers: apiHeaders(token),
    });
    if (res.status === 404) {
      throw new Error(`Organization "${name}" not found.`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub API error ${res.status}: ${body.slice(0, 200)}`);
    }
    orgPayload = await res.json() as GitHubOrgPayload;
  } catch (err) {
    if (err instanceof Error && err.message.includes(`Organization "${name}"`)) throw err;
    throw new Error(`Failed to fetch org "${name}": ${err instanceof Error ? err.message : String(err)}`);
  }

  // Orgs with no public repos don't need the repos request.
  const repos: GitHubRepoPayload[] = [];
  if (orgPayload.public_repos > 0) {
    const perPage = Math.min(limit, 100);
    const maxPages = Math.ceil(limit / perPage);
    for (let page = 1; page <= maxPages; page++) {
      const url =
        `https://api.github.com/orgs/${encodeURIComponent(name)}/repos` +
        `?per_page=${perPage}&sort=pushed&page=${page}`;
      const res = await fetch(url, { headers: apiHeaders(token) });
      if (!res.ok) {
        // Org metadata succeeded; degraded summary beats a hard failure.
        break;
      }
      const items = (await res.json()) as GitHubRepoPayload[];
      if (!Array.isArray(items)) break; // unexpected shape — degrade gracefully
      repos.push(...items);
      if (repos.length >= limit || items.length < perPage) break;
    }
  }

  return normalizeOrg(orgPayload, repos.slice(0, limit));
}

// ─── Formatters ────────────────────────────────────────────────────────

export function formatOrgText(p: OrgProfile): string {
  const lines: string[] = [];
  const title = p.name ? `${p.login} — ${p.name}` : p.login;
  lines.push(title);
  if (p.description) lines.push(p.description);

  const meta: string[] = [];
  if (p.location) meta.push(`Location  ${p.location}`);
  if (p.blog) meta.push(`Web       ${p.blog}`);
  if (p.createdAt) meta.push(`Created   ${p.createdAt.slice(0, 10)}`);
  if (meta.length > 0) lines.push(meta.join("\n"));

  lines.push(`Repos     ${p.publicRepoCount.toLocaleString()} public${p.fetchedRepoCount < p.publicRepoCount ? ` (aggregated ${p.fetchedRepoCount})` : ""}`);
  lines.push(`Stars     ${p.totalStars.toLocaleString()} (sum of aggregated repos)`);
  lines.push(`Forks     ${p.totalForks.toLocaleString()} (sum of aggregated repos)`);
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
      lines.push(`  ${r.fullName}  ★ ${r.stars.toLocaleString()}  ${r.language ?? ""}`);
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

export function formatOrgJson(p: OrgProfile): string {
  return JSON.stringify(p, null, 2);
}

export function formatOrgCsv(p: OrgProfile): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const row = [
    p.login,
    p.name ?? "",
    p.url,
    String(p.publicRepoCount),
    String(p.totalStars),
    String(p.totalForks),
    p.topLanguages.map((l) => l.language).join(";"),
    p.createdAt,
  ].map(esc);
  return ["login,name,url,public_repos,total_stars,total_forks,top_languages,created_at", row.join(",")].join("\n");
}

export function formatOrgMarkdown(p: OrgProfile): string {
  const lines: string[] = [];
  lines.push(`# ${p.login}${p.name ? ` — ${p.name}` : ""}`);
  if (p.description) lines.push("", p.description);
  lines.push(
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Public repos | ${p.publicRepoCount} |`,
    `| Total stars (aggregated) | ${p.totalStars.toLocaleString()} |`,
    `| Total forks (aggregated) | ${p.totalForks.toLocaleString()} |`,
  );
  if (p.topLanguages.length > 0) {
    lines.push(`| Top languages | ${p.topLanguages.map((l) => `${l.language} (${l.repos})`).join(", ")} |`);
  }
  if (p.topRepos.length > 0) {
    lines.push("", "## Top repos by stars", "", "| Repo | Stars | Language |", "| --- | --- | --- |");
    for (const r of p.topRepos) {
      lines.push(`| [${r.fullName}](${r.url}) | ${r.stars.toLocaleString()} | ${r.language ?? "—"} |`);
    }
  }
  return lines.join("\n");
}
