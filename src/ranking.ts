/** Ranking layer: order normalized Repo results deterministically. */
import type { Repo, SortStrategy } from "./types.ts";

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

function byKey(key: (r: Repo) => number): (a: Repo, b: Repo) => number {
  return (a, b) => key(b) - key(a) || b.stars - a.stars || a.id - b.id;
}

export function compositeScore(r: Repo): number {
  // Log-scaled stars + recency bonus. Deterministic and transparent.
  const starScore = Math.log10(r.stars + 1);
  const recencyMs = Date.now() - Date.parse(r.pushedAt);
  const recencyScore = Math.max(0, 1 - recencyMs / (1000 * 60 * 60 * 24 * 365));
  return starScore * 0.7 + recencyScore * 0.3;
}