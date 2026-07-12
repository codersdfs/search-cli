/**
 * Watch mode — periodically re-run a search and show changes.
 * 
 * ponytail: simple poll + diff. No notifications (P4 cross-ref).
 */
import type { ParsedQuery, SearchOptions, Repo } from "./types.ts";
import { GitHubSearchProvider } from "./provider.ts";
import { parseQuery, applyFlagFilters } from "./query.ts";
import { rankRepos } from "./ranking.ts";

export interface WatchOptions {
  query: string;
  sort: SearchOptions["sort"];
  limit: number;
  token?: string;
  intervalMs: number;
  trending?: boolean;
}

/** Run watch mode. Calls onChange with each tick's results. */
export async function runWatch(
  opts: WatchOptions,
  onChange: (repos: Repo[], delta: number) => void,
  onError: (err: Error) => void,
): Promise<void> {
  let previous: Repo[] = [];

  const tick = async () => {
    try {
      const parsed = applyFlagFilters(parseQuery(opts.query), {});
      const provider = new GitHubSearchProvider(undefined, opts.token ? [opts.token] : []);
      const options: SearchOptions = {
        limit: opts.limit,
        sort: opts.sort,
        json: false,
        verbose: false,
        token: opts.token,
      };
      const response = await provider.search(parsed, options);
      const repos = rankRepos(response.repos, options.sort);

      const delta = previous.length > 0 ? repos.length - previous.length : 0;
      previous = repos;
      onChange(repos, delta);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  // Immediate first tick, then interval
  await tick();
  setInterval(tick, opts.intervalMs);
}
