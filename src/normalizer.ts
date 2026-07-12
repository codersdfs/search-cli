/**
 * Result normalizer: convert a raw GitHub API item into our stable {@link Repo}
 * shape. Keeping this isolated means a different provider (or a cached/offline
 * source) only needs to produce the same `Repo` struct for the rest of the
 * pipeline to work unchanged.
 */
import type { Repo } from "./types.ts";

/** The subset of the GitHub "search repositories" item we care about. */
export interface GitHubApiItem {
  id: number;
  name: string;
  full_name: string;
  owner?: { login?: string };
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  language: string | null;
  topics?: string[];
  archived: boolean;
  fork: boolean;
  private: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  score: number;
}

/** Raw GitHub search response envelope. */
export interface GitHubSearchEnvelope {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubApiItem[];
}

/** Convert a single GitHub API item into a {@link Repo}. */
export function normalizeRepo(item: GitHubApiItem): Repo {
  const owner = item.owner?.login ?? item.full_name?.split("/")[0] ?? "";
  return {
    id: item.id ?? 0,
    fullName: item.full_name ?? "",
    name: item.name ?? "",
    owner,
    description: item.description ?? null,
    url: item.html_url ?? "",
    stars: item.stargazers_count ?? 0,
    forks: item.forks_count ?? 0,
    watchers: item.watchers_count ?? 0,
    language: item.language ?? null,
    topics: item.topics ?? [],
    archived: item.archived ?? false,
    isFork: item.fork ?? false,
    private: item.private ?? false,
    createdAt: item.created_at ?? "",
    updatedAt: item.updated_at ?? "",
    pushedAt: item.pushed_at ?? "",
    score: item.score ?? 0,
  };
}

/** Normalize a full GitHub search envelope into {@link Repo} list. */
export function normalizeEnvelope(env: GitHubSearchEnvelope): Repo[] {
  return (env.items ?? []).map(normalizeRepo);
}