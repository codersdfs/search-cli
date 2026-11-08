/**
 * similar.ts — "repos like this one".
 *
 * Similarity is derived only from public signals GitHub already indexes:
 * the repo's topics and its primary language. Topics are the tightest signal,
 * so a topic+language query is tried first; each later candidate widens the
 * net one step at a time, and results are merged until the limit is met.
 *
 * The source repo is always filtered out client-side, so a caller can never
 * be told a repo is similar to itself.
 */
import type { Repo } from "./types";
import { resolveRepoFromRef } from "./deepdive";
import { runRepoSearch } from "./run-search";

export interface SimilarOptions {
  token?: string;
  /** Maximum number of similar repos to return (default 10, clamped to 1-100). */
  limit?: number;
}

export interface SimilarResult {
  /** The repo the results are similar to. */
  repo: Repo;
  /** Similar repos, most-starred first (each candidate query sorts by stars). */
  repos: Repo[];
  /** The queries that were actually sent, in order. Empty when there was nothing to match on. */
  queries: string[];
}

/** Default result count — similarity lists get noisy past ten rows. */
export const SIMILAR_DEFAULT_LIMIT = 10;

/** GitHub topic names are lowercase words joined by `-`, `.` or `_`. */
const TOPIC_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Star floor for comparable popularity: a twentieth of the source repo's
 * stars, never below 1. A 2,000-star repo is matched against 100+ star repos,
 * not against every repo under the same topic.
 */
export function similarStarFloor(stars: number): number {
  if (!Number.isFinite(stars) || stars <= 0) return 0;
  return Math.max(1, Math.floor(stars / 20));
}

/**
 * Candidate search queries, tightest first. Exported for tests — the shape
 * here is what makes "similar" mean something rather than "popular in this
 * language".
 *
 * A repo with no usable topics and no language yields no queries: there is
 * nothing honest to match on, and a bare stars filter would just return the
 * most popular repos on GitHub.
 */
export function similarQueries(repo: Repo): string[] {
  const language = repo.language?.trim();
  // Multi-word language names ("Jupyter Notebook", "Visual Basic .NET") must
  // be quoted: the query is re-parsed as a string, so an unquoted value would
  // split into `language:Jupyter` plus a stray keyword.
  const languageFilter = language
    ? `language:${/\s/.test(language) ? `"${language}"` : language}`
    : "";
  const topics = (repo.topics ?? [])
    .map((topic) => topic.trim())
    .filter((topic) => TOPIC_RE.test(topic))
    .slice(0, 2);

  if (topics.length === 0 && !language) return [];

  const floor = similarStarFloor(repo.stars);
  const filters = ["fork:false", "archived:false"];
  if (floor > 0) filters.push(`stars:>=${floor}`);
  const filtersText = filters.join(" ");

  const queries: string[] = [];
  for (const topic of topics) {
    queries.push(
      [`topic:${topic}`, languageFilter, filtersText].filter(Boolean).join(" "),
    );
  }
  // With two topics, topic+language was already tried for each; the primary
  // topic alone catches repos in the same space under another language.
  if (topics.length > 1 && language) {
    queries.push([`topic:${topics[0]}`, filtersText].join(" "));
  }
  if (languageFilter) {
    queries.push([languageFilter, filtersText].join(" "));
  }

  return [...new Set(queries)];
}

/**
 * Resolve `ref`, plan candidate queries, and collect similar repos until
 * `limit` is reached or the candidates run out. A query that returns nothing
 * costs one API call and falls through to the next; results from several
 * queries are merged and de-duplicated.
 */
export async function findSimilarRepos(
  ref: string,
  options: SimilarOptions = {},
): Promise<SimilarResult> {
  const repo = await resolveRepoFromRef(ref, options.token);
  const limit = Math.min(
    100,
    Math.max(1, Math.floor(options.limit ?? SIMILAR_DEFAULT_LIMIT)),
  );

  const queries = similarQueries(repo);
  const seen = new Set([repo.fullName.toLowerCase()]);
  const repos: Repo[] = [];
  const tried: string[] = [];

  for (const query of queries) {
    tried.push(query);
    const { repos: batch } = await runRepoSearch({
      query,
      sort: "stars",
      limit,
      token: options.token,
    });
    for (const candidate of batch) {
      const key = candidate.fullName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      repos.push(candidate);
      if (repos.length >= limit) return { repo, repos, queries: tried };
    }
  }

  return { repo, repos, queries: tried };
}

/** Plain-text rendering for the CLI's default output. */
export function formatSimilarText(result: SimilarResult): string {
  if (result.repos.length === 0) {
    if (result.queries.length === 0) {
      return [
        `No repos found similar to ${result.repo.fullName}.`,
        "  Similarity comes from topics and language — this repo has neither, so there is nothing to match on.",
        '  Try a manual search instead: ghfind "topic:<topic>"',
      ].join("\n");
    }
    return [
      `No repos found similar to ${result.repo.fullName}.`,
      "  Its topics and language did not turn up any comparable repos.",
      '  Try a manual search instead: ghfind "topic:<topic>"',
    ].join("\n");
  }

  const count = result.repos.length;
  const lines = [
    `Similar to ${result.repo.fullName} — ${count} repo${count === 1 ? "" : "s"}`,
  ];
  for (const r of result.repos) {
    const description = r.description ? `  ${truncate(r.description, 80)}` : "";
    lines.push(
      `  ${r.fullName}  ★ ${r.stars.toLocaleString("en-US")}  ${r.language ?? "n/a"}${description}`,
    );
  }
  return lines.join("\n");
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, width - 1).trimEnd()}…`;
}
