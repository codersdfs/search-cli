/** Repo deep-dive — fetch and format rich repo details. */
import type { Repo } from "./types";
import { NetworkError } from "./errors";

const USER_AGENT = "ghfind/1.0";

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// ─── Repo ref parsing (shared by the CLI deep-dive and the MCP server) ─

const REPO_REF_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * Parse a repo reference ("owner/name") into its parts. Tolerates a trailing
 * `.git` and a leading `@`. Throws with a user-facing message for anything else.
 */
export function parseRepoRef(input: string): { owner: string; name: string } {
  const fullName = input
    .trim()
    .replace(/\.git$/, "")
    .replace(/^@/, "");
  if (!REPO_REF_RE.test(fullName)) {
    throw new Error(
      `"${input}" is not a repo name — use owner/name, e.g. facebook/react.`,
    );
  }
  const [owner, name] = fullName.split("/");
  return { owner, name };
}

/** Minimal Repo for deep-dive (the fetchers only read owner/name). */
export function repoFromRef(fullName: string): Repo {
  const { owner, name } = parseRepoRef(fullName);
  return {
    id: 0,
    fullName: `${owner}/${name}`,
    name,
    owner,
    description: null,
    url: `https://github.com/${owner}/${name}`,
    stars: 0,
    forks: 0,
    watchers: 0,
    language: null,
    topics: [],
    archived: false,
    isFork: false,
    private: false,
    createdAt: "",
    updatedAt: "",
    pushedAt: "",
    score: 0,
  };
}

/**
 * Resolve a repo ref to a real Repo by fetching canonical metadata from the
 * GitHub API. Returns a stub via repoFromRef when the metadata fetch fails
 * (offline, rate limit) — the ref is still validated first. Deep-dive
 * sub-fetches tolerate missing data either way.
 */
export async function resolveRepoFromRef(
  fullName: string,
  token?: string,
): Promise<Repo> {
  const ref = parseRepoRef(fullName); // throws for malformed refs
  const canonical = `${ref.owner}/${ref.name}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${canonical}`, {
      headers: buildHeaders(token),
    });
    if (res.status === 404) {
      throw new Error(`Repo not found: ${canonical}`);
    }
    if (res.ok) {
      const api = (await res.json()) as {
        description: string | null;
        html_url: string;
        stargazers_count: number;
        forks_count: number;
        subscribers_count?: number;
        language: string | null;
        topics?: string[];
        archived: boolean;
        fork: boolean;
        created_at: string;
        updated_at: string;
        pushed_at: string;
      };
      return {
        id: 0,
        fullName: canonical,
        name: ref.name,
        owner: ref.owner,
        description: api.description,
        url: api.html_url,
        stars: api.stargazers_count ?? 0,
        forks: api.forks_count ?? 0,
        watchers: api.subscribers_count ?? 0,
        language: api.language,
        topics: api.topics ?? [],
        archived: api.archived ?? false,
        isFork: api.fork ?? false,
        private: false,
        createdAt: api.created_at ?? "",
        updatedAt: api.updated_at ?? "",
        pushedAt: api.pushed_at ?? "",
        score: 0,
      };
    }
  } catch (err) {
    // Let the not-found error propagate; only network/parse failures degrade
    // to the stub below.
    if (err instanceof Error && err.message.startsWith("Repo not found")) {
      throw err;
    }
    // Fall through to the stub.
  }
  return repoFromRef(canonical);
}

/** Language breakdown: { [lang]: bytes } */
type LanguageMap = Record<string, number>;

/** Contributor summary */
interface Contributor {
  login: string;
  contributions: number;
}

/** All deep-dive data for one repo. */
export interface DeepDiveData {
  summary: string;
  languages: string;
  contributors: string;
  readme: string;
}

/** Structured deep-dive payload — JSON-ready (for `ghfind deep-dive --json`). */
export interface DeepDiveJson {
  repo: {
    fullName: string;
    url: string;
    description: string | null;
    stars: number;
    forks: number;
    language: string | null;
    topics: string[];
  };
  /** Language breakdown sorted by bytes, descending. */
  languages: { name: string; bytes: number; percent: number }[];
  contributors: { login: string; contributions: number }[];
  /** Raw README markdown (capped at README_MAX_CHARS). */
  readme: string;
}

const README_MAX_CHARS = 5_000;

/** Fetch deep-dive data as structured JSON: language percents, contributors, raw README. */
export async function fetchDeepDiveRaw(
  repo: Repo,
  token?: string,
): Promise<DeepDiveJson> {
  const headers = buildHeaders(token);

  const [languagesRes, contributorsRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/languages`, {
      headers,
    }),
    fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/contributors?per_page=5`,
      { headers },
    ),
  ]);

  // README with branch fallback: main → master → README.rst
  let readmeText = "";
  for (const path of [
    `${repo.owner}/${repo.name}/main/README.md`,
    `${repo.owner}/${repo.name}/master/README.md`,
    `${repo.owner}/${repo.name}/main/README.rst`,
  ]) {
    const r = await fetch(`https://raw.githubusercontent.com/${path}`, {
      headers,
    });
    if (r.ok) {
      readmeText = await r.text();
      break;
    }
  }

  const langEntries: [string, number][] = languagesRes.ok
    ? Object.entries(
        (await languagesRes.json().catch(() => ({}))) as LanguageMap,
      )
    : [];
  const totalBytes = langEntries.reduce((s, [, v]) => s + v, 0);
  const contributors: Contributor[] = contributorsRes.ok
    ? ((await contributorsRes.json().catch(() => [])) as Contributor[])
    : [];

  return {
    repo: {
      fullName: repo.fullName,
      url: repo.url,
      description: repo.description,
      stars: repo.stars,
      forks: repo.forks,
      language: repo.language,
      topics: repo.topics,
    },
    languages: langEntries
      .sort(([, a], [, b]) => b - a)
      .map(([name, bytes]) => ({
        name,
        bytes,
        percent: totalBytes > 0 ? (bytes / totalBytes) * 100 : 0,
      })),
    contributors: contributors.map((c) => ({
      login: c.login,
      contributions: c.contributions,
    })),
    readme: readmeText.slice(0, README_MAX_CHARS),
  };
}

/** JSON string for `ghfind deep-dive --json`. */
export function buildDeepDiveJson(data: DeepDiveJson): string {
  return JSON.stringify(data, null, 2);
}

/** Format structured deep-dive data into display sections. */
export function buildDeepDiveData(repo: Repo, raw: DeepDiveJson): DeepDiveData {
  return {
    summary: formatSummary(repo),
    languages: formatLanguages(raw.languages),
    contributors: formatContributors(raw.contributors),
    readme: formatReadme(raw.readme),
  };
}

/** Fetch all deep-dive data for a repo. Returns formatted sections. */
export async function fetchDeepDive(
  repo: Repo,
  token?: string,
): Promise<DeepDiveData> {
  return buildDeepDiveData(repo, await fetchDeepDiveRaw(repo, token));
}

function formatSummary(repo: Repo): string {
  const lines = [
    ` ${repo.fullName}`,
    ` ★ ${repo.stars.toLocaleString()}  ◆ ${repo.forks.toLocaleString()}  ${repo.language ?? "—"}`,
    repo.description ? ` ${repo.description}` : "",
    repo.topics.length ? ` topics: ${repo.topics.slice(0, 8).join(", ")}` : "",
    ` ${repo.url}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function formatLanguages(langs: DeepDiveJson["languages"]): string {
  if (langs.length === 0) return "  (no language data)";
  const barW = 20;
  return langs
    .slice(0, 8)
    .map(({ name, percent }) => {
      const pct = percent.toFixed(1);
      const filled = Math.round((percent / 100) * barW);
      const bar = "█".repeat(filled) + "░".repeat(barW - filled);
      return `  ${name.padEnd(16)} ${bar} ${pct}%`;
    })
    .join("\n");
}

function formatContributors(contributors: Contributor[]): string {
  if (contributors.length === 0) return "  (no contributor data)";
  return contributors
    .slice(0, 5)
    .map((c) => `  ▲ ${c.login.padEnd(20)} ${c.contributions} commits`)
    .join("\n");
}

function formatReadme(readme: string): string {
  if (!readme) return "  (no README)";
  // Strip markdown formatting for terminal display
  const stripped = readme
    .replace(/```[\s\S]*?```/g, "[code block]")
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const lines = stripped.slice(0, 30);
  if (stripped.length > 30)
    lines.push("... (more lines, open in browser to read full)");
  return lines.map((l) => `  ${l}`).join("\n");
}

/** Build the full deep-dive display text from data. */
export function buildDeepDiveText(data: DeepDiveData): string {
  return [
    "── Summary ──────────────────────────────────────",
    data.summary,
    "",
    "── Languages ────────────────────────────────────",
    data.languages,
    "",
    "── Top Contributors ─────────────────────────────",
    data.contributors,
    "",
    "── README ───────────────────────────────────────",
    data.readme,
  ].join("\n");
}
