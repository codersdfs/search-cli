/**
 * Ranking layer: order normalized {@link Repo} results deterministically.
 *
 * All strategies are pure functions of the repo data plus a stable tie-breaker
 * (repo id) so that identical inputs always produce identical output. A future
 * AI reranker can be added as an additional strategy or as a post-step without
 * changing the rest of the pipeline.
 */
import type { Repo, SortStrategy } from "./types.ts";

/**
 * Rank repos according to the chosen strategy.
 * The sort is stable and deterministic: when two repos compare equal on the
 * primary key, we fall back to descending stars, then descending id.
 */
export function rankRepos(repos: Repo[], strategy: SortStrategy): Repo[] {
  const copy = [...repos];
  switch (strategy) {
    case "stars":
      copy.sort(byKey((r) => r.stars));
      break;
    case "forks":
      copy.sort(byKey((r) => r.forks));
      break;
    case "updated":
      copy.sort(byKey((r) => Date.parse(r.updatedAt)));
      break;
    case "best-match":
    default:
      // GitHub already returns best-match order; preserve it unchanged.
      // Re-sorting by score would be redundant for first-page results and
      // misleading for paginated (page 2 repos would intermix with page 1).
      // ponytail: if deterministic output is needed, sort by id:
      // copy.sort((a, b) => a.id - b.id);
      break;
  }
  return copy;
}

/** Comparator factory: descending by `key`, then descending stars, then
 *  ascending id (stable, deterministic tie-break). */
function byKey(key: (r: Repo) => number): (a: Repo, b: Repo) => number {
  return (a, b) => key(b) - key(a) || b.stars - a.stars || a.id - b.id;
}

/**
 * A simple, explainable composite score used for the (optional) "best" blend.
 * Not used by default but available for an AI/rerank layer later.
 * Range is roughly 0..1 after normalization by the caller.
 */
export function compositeScore(r: Repo): number {
  // Log-scaled stars + recency bonus. Deterministic and transparent.
  const starScore = Math.log10(r.stars + 1);
  const recencyMs = Date.now() - Date.parse(r.pushedAt);
  const recencyScore = Math.max(0, 1 - recencyMs / (1000 * 60 * 60 * 24 * 365));
  return starScore * 0.7 + recencyScore * 0.3;
}