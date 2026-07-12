/**
 * Core domain types shared across the CLI.
 *
 * The architecture is intentionally split into layers:
 *   CLI -> QueryBuilder -> SearchProvider -> Normalizer -> Ranking -> Output
 * Each layer depends only on the types defined here, so an AI layer can be
 * slotted in later (e.g. a query rewriter before QueryBuilder, or a reranker
 * after Ranking) without touching the rest of the code.
 */

/** A single parsed search qualifier (e.g. `language:Rust`). */
export interface Qualifier {
  /** The qualifier key, e.g. "language", "stars", "topic". */
  key: string;
  /** The qualifier value, e.g. "Rust", ">100". */
  value: string;
  /** True when the qualifier was negated (e.g. `-language:Rust`). */
  negated: boolean;
}

/** The fully parsed, normalized representation of a user's search request. */
export interface ParsedQuery {
  /** Free-text keywords (everything that is not a qualifier). */
  keywords: string[];
  /** Structured qualifiers extracted from the query string. */
  qualifiers: Qualifier[];
  /** The original, untouched query string (preserved for debugging/display). */
  raw: string;
}

/** A repository as returned by a search provider, normalized to a stable shape. */
export interface Repo {
  id: number;
  fullName: string; // owner/name
  name: string;
  owner: string;
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  watchers: number;
  language: string | null;
  topics: string[];
  archived: boolean;
  isFork: boolean;
  private: boolean;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  pushedAt: string; // ISO timestamp
  score: number; // relevance score returned by GitHub
}

/** Ranking strategies supported by the ranking layer. */
export type SortStrategy = "best-match" | "stars" | "updated" | "forks";

/** Options that control how a search is executed and presented. */
export interface SearchOptions {
  /** Maximum number of results to return (pagination stops at this limit). */
  limit: number;
  /** Ranking strategy. */
  sort: SortStrategy;
  /** Emit machine-readable JSON instead of human-readable text. */
  json: boolean;
  /** GitHub API token (optional, raises rate limits). */
  token?: string;
  /** Page number for pagination (1-based, default 1). */
  page?: number;
  /** Verbose logging (outgoing query, errors, rate limits). */
  verbose: boolean;
}

/** A paginated response from a search provider. */
export interface SearchResponse {
  totalCount: number;
  repos: Repo[];
  /** True when the provider hit a rate limit. */
  rateLimited: boolean;
  /** Remaining requests in the current rate-limit window, if known. */
  rateLimitRemaining?: number;
}

// ─── P1: Memory types ───────────────────────────────────────────────

/** A single history entry (append-only log). */
export interface HistoryEntry {
  query: string;
  mode: "search" | "trending";
  tab?: string;
  timestamp: number;
  resultCount: number;
}

/** A saved bookmark entry. */
export interface Bookmark {
  repo: Repo;
  savedAt: number;
  tags: string[];
  notes?: string;
}

/** A named, saved search. */
export interface SavedSearch {
  name: string;
  query: string;
  mode: "search" | "trending";
  tab?: string;
  sort: SortStrategy;
  limit: number;
  createdAt: number;
  lastRunAt?: number;
}

/** Session state restored on startup. */
export interface SessionState {
  mode: "search" | "trending";
  query: string;
  sort: SortStrategy;
  limit: number;
  trendingTab: string;
}

/** Cache entry with TTL. */
export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttlMs: number;
}

/** Application config, persisted to ~/.config/search-cli/config.json. */
export interface Config {
  githubToken?: string;
  githubTokens?: string[];
  defaultSort: SortStrategy;
  defaultLimit: number;
  language?: string;
  theme: string;
  cacheTtlSeconds: number;
  defaultTab: "search" | "trending";
  historySize?: number;
  bookmarkFile?: string;
}

/** Abstract search provider. New sources (GitLab, local index, AI, ...) can
 *  implement this interface without changing any other layer. */
export interface SearchProvider {
  readonly name: string;
  search(query: ParsedQuery, options: SearchOptions): Promise<SearchResponse>;
}