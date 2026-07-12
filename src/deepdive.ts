/**
 * Repo deep-dive — fetch and format rich repo details.
 * 
 * ponytail: single fetch-all function, no section tab navigation.
 * Shows: summary, languages bar, top contributors, README excerpt.
 * Skip: releases (YAGNI), dependency graph (auth-gated).
 */
import type { Repo } from "./types.ts";
import { NetworkError } from "./errors.ts";

const USER_AGENT = "search-cli/1.0";

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

/** Fetch all deep-dive data for a repo. Returns formatted sections. */
export async function fetchDeepDive(repo: Repo, token?: string): Promise<DeepDiveData> {
  const auth = token ? { Authorization: `Bearer ${token}` } : {};
  const headers = { "User-Agent": USER_AGENT, ...auth };

  const [languagesRes, contributorsRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/languages`, { headers }),
    fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/contributors?per_page=5`, { headers }),
  ]);

  // README with branch fallback: main → master → README.rst
  let readmeText = "";
  for (const path of [`${repo.owner}/${repo.name}/main/README.md`, `${repo.owner}/${repo.name}/master/README.md`, `${repo.owner}/${repo.name}/main/README.rst`]) {
    const r = await fetch(`https://raw.githubusercontent.com/${path}`, { headers });
    if (r.ok) { readmeText = await r.text(); break; }
  }

  return {
    summary: formatSummary(repo),
    languages: formatLanguages(languagesRes.ok ? await languagesRes.json().catch(() => ({})) : {}),
    contributors: formatContributors(contributorsRes.ok ? await contributorsRes.json().catch(() => []) : []),
    readme: formatReadme(readmeText),
  };
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

function formatLanguages(langs: LanguageMap): string {
  const entries = Object.entries(langs);
  if (entries.length === 0) return "  (no language data)";
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const barW = 20;
  return entries
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([name, bytes]) => {
      const pct = ((bytes / total) * 100).toFixed(1);
      const filled = Math.round((bytes / total) * barW);
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
  if (stripped.length > 30) lines.push("... (more lines, open in browser to read full)");
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
