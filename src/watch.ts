/**
 * Watch mode — periodically re-run a search and show changes.
 * 
 */
import type { ParsedQuery, SearchOptions, Repo } from "./types";
import { parseQuery, applyFlagFilters, rankRepos, createGitHubSearch } from "./search";
import { fetchTrendingRepos, trendingRepoToRepo } from "./trending";

export interface WatchOptions {
  query: string;
  sort: SearchOptions["sort"];
  limit: number;
  token?: string;
  intervalMs: number;
  trending?: boolean;
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

  const tick = async () => {
    try {
      let repos: Repo[];
      if (opts.trending) {
        const since = opts.query === "weekly" ? "weekly" : opts.query === "monthly" ? "monthly" : "daily";
        const trending = await fetchTrendingRepos(since);
        repos = trending.map(trendingRepoToRepo);
      } else {
        const parsed = applyFlagFilters(parseQuery(opts.query), {});
        const provider = createGitHubSearch(undefined, opts.token ? [opts.token] : []);
        const options: SearchOptions = {
          limit: opts.limit,
          sort: opts.sort,
          json: false,
          verbose: false,
          token: opts.token,
        };
        const response = await provider.search(parsed, options);
        repos = rankRepos(response.repos, options.sort);
      }

      failCount = 0; // reset on success
      const delta = previous.length > 0 ? repos.length - previous.length : 0;
      previous = repos;
      onChange(repos, delta);
    } catch (err) {
      failCount++;
      onError(err instanceof Error ? err : new Error(String(err)));
      if (failCount >= MAX_FAILS) {
        onError(new Error(`Watch stopped after ${MAX_FAILS} consecutive failures`));
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
