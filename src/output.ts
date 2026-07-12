/**
 * Output layer: render ranked results either as machine-readable JSON or as a
 * concise, human-readable list. This layer owns all presentation concerns so
 * the search/ranking logic stays presentation-free.
 */
import type { Repo, SearchResponse } from "./types.ts";

/** Format a number compactly (e.g. 1234 -> "1.2k"). */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Format an ISO date as YYYY-MM-DD. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}

/** Emit stable, parseable JSON. */
export function renderJson(response: SearchResponse, rawQuery: string): string {
  return JSON.stringify(
    {
      query: rawQuery,
      totalCount: response.totalCount,
      count: response.repos.length,
      rateLimited: response.rateLimited,
      results: response.repos,
    },
    null,
    2,
  );
}

/** Emit a concise, readable list for terminals. */
export function renderHuman(response: SearchResponse, rawQuery: string): string {
  const lines: string[] = [];
  lines.push(`Query: ${rawQuery}`);
  lines.push(`Matches: ${response.repos.length} (total available: ${response.totalCount})`);
  if (response.rateLimited) {
    lines.push("⚠ Rate limit hit — results may be incomplete. Set GITHUB_TOKEN to raise limits.");
  }
  lines.push("");

  if (response.repos.length === 0) {
    lines.push("No repositories found.");
    return lines.join("\n");
  }

  response.repos.forEach((repo, i) => {
    lines.push(renderRepo(i + 1, repo));
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

function renderRepo(index: number, repo: Repo): string {
  const lang = repo.language ?? "—";
  const stars = formatCount(repo.stars);
  const updated = formatDate(repo.updatedAt);
  const tags: string[] = [];
  if (repo.archived) tags.push("archived");
  if (repo.isFork) tags.push("fork");
  const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";

  const header = `${index}. ${repo.fullName}${tagStr}`;
  const meta = `   ★ ${stars}  •  ${lang}  •  updated ${updated}`;
  const desc = repo.description ? `   ${repo.description}` : "   (no description)";
  const url = `   ${repo.url}`;
  return [header, meta, desc, url].join("\n");
}