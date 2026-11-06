/**
 * run-search.ts — the one repo-search pipeline behind every surface
 * (CLI, MCP, TUI, watch).
 *
 * Pipeline: parse → filter → validate → provider → rank. `BadQueryError` is
 * thrown before any network I/O, so no surface ever burns an API call on a
 * malformed query. Surfaces own only what differs: disposition (exit 1 vs
 * structured tool error vs TUI overlay) and rendering.
 *
 * Zero-result loosenings are computed here once and offered on every surface.
 */
import type {
  Repo,
  SearchOptions,
  SearchResponse,
  SortStrategy,
} from "./types";
import {
  applyFlagFilters,
  createGitHubSearch,
  createTrendingSearch,
  parseQuery,
  rankRepos,
  suggestRelaxations,
  trendingQuery,
  validateQuery,
  type Logger,
} from "./search";
import { resolveToken, resolveTokens } from "./github-client";

export interface RepoSearchRequest {
  query: string;
  sort: SortStrategy;
  limit: number;
  /** Explicit flag/arg token; config + env rotation applies regardless. */
  token?: string;
  page?: number;
  /** Surface log sink; the CLI and MCP pass none and get a no-op. */
  logger?: Logger;
}

export interface TrendingSearchRequest {
  sort: SortStrategy;
  limit: number;
  since?: "daily" | "weekly" | "monthly";
  language?: string;
}

export interface SearchRunResult {
  response: SearchResponse;
  repos: Repo[];
}

/** Parse, filter, validate, search, rank. Throws BadQueryError pre-network. */
export async function runRepoSearch(
  req: RepoSearchRequest,
): Promise<SearchRunResult> {
  const parsed = applyFlagFilters(parseQuery(req.query), {});
  validateQuery(parsed);
  const provider = createGitHubSearch(req.logger, resolveTokens(req.token));
  const options: SearchOptions = {
    limit: req.limit,
    sort: req.sort,
    json: false,
    verbose: false,
    token: resolveToken(req.token),
    ...(req.page !== undefined ? { page: req.page } : {}),
  };
  const response = await provider.search(parsed, options);
  return { response, repos: rankRepos(response.repos, req.sort) };
}

export async function runTrendingSearch(
  req: TrendingSearchRequest,
): Promise<SearchRunResult> {
  const provider = createTrendingSearch();
  const response = await provider.search(trendingQuery(), {
    limit: req.limit,
    sort: req.sort,
    json: false,
    verbose: false,
    trendingSince: req.since ?? "daily",
    ...(req.language ? { trendingLanguage: req.language } : {}),
  });
  return { response, repos: response.repos };
}

/**
 * Ranked loosenings for a zero-result query, most promising first. Every
 * surface offers these instead of generic advice; empty array = nothing
 * sensible can be loosened.
 */
export function zeroResultSuggestions(query: string, limit = 3): string[] {
  try {
    return suggestRelaxations(parseQuery(query), limit).map(
      (r) => r.suggestion,
    );
  } catch {
    return [];
  }
}
