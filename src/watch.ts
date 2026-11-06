/**
 * Watch mode — periodically re-run a search and show changes.
 *
 */
import type { Repo, SearchOptions } from "./types";
import { applyFlagFilters, parseQuery, validateQuery } from "./search";
import { runRepoSearch, runTrendingSearch } from "./run-search";

export interface WatchOptions {
  query: string;
  sort: SearchOptions["sort"];
  limit: number;
  token?: string;
  intervalMs: number;
  trending?: boolean;
  /** Trending period (`--since`); falls back to the query-string convention. */
  since?: string;
}

/**
 * Resolve the trending period for a watch tick. `--since` wins when it names a
 * real period; otherwise fall back to the legacy `ghfind --watch weekly`
 * convention where the query string itself carried the period.
 */
export function resolveTrendingSince(
  opts: Pick<WatchOptions, "query" | "since">,
): "daily" | "weekly" | "monthly" {
  if (opts.since === "weekly" || opts.since === "monthly") return opts.since;
  if (opts.since === "daily") return "daily";
  if (opts.query === "weekly") return "weekly";
  if (opts.query === "monthly") return "monthly";
  return "daily";
}

const MAX_FAILS = 5;

/** Run watch mode. Calls onChange with each tick's results. */
export async function runWatch(
  opts: WatchOptions,
  onChange: (repos: Repo[], delta: number) => void,
  onError: (err: Error) => void,
): Promise<void> {
  let previous: Repo[] = [];
  let failCount = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  // Validate once, before the poll loop starts. A malformed query is not
  // transient, so letting it reach the tick would burn the retry budget and
  // report the same error five times instead of failing fast.
  if (!opts.trending) {
    validateQuery(applyFlagFilters(parseQuery(opts.query), {}));
  }

  const tick = async () => {
    try {
      let repos: Repo[];
      if (opts.trending) {
        const since = resolveTrendingSince(opts);
        const { repos: trendingRepos } = await runTrendingSearch({
          sort: opts.sort,
          limit: opts.limit,
          since,
        });
        repos = trendingRepos;
      } else {
        const run = await runRepoSearch({
          query: opts.query,
          sort: opts.sort,
          limit: opts.limit,
          token: opts.token,
        });
        repos = run.repos;
      }

      failCount = 0; // reset on success
      const delta = previous.length > 0 ? repos.length - previous.length : 0;
      previous = repos;
      onChange(repos, delta);
    } catch (err) {
      failCount++;
      onError(err instanceof Error ? err : new Error(String(err)));
      if (failCount >= MAX_FAILS) {
        onError(
          new Error(`Watch stopped after ${MAX_FAILS} consecutive failures`),
        );
        if (intervalId) clearInterval(intervalId);
      }
    }
  };

  // Immediate first tick, then interval
  await tick();
  if (failCount < MAX_FAILS) {
    intervalId = setInterval(tick, opts.intervalMs);
  }
}
