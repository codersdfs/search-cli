/**
 * Search provider: talks to the GitHub REST search API.
 *
 * This is the only layer that performs network I/O. It implements the
 * {@link SearchProvider} interface so alternative backends (a local index, a
 * different forge, or an AI-powered source) can be swapped in without touching
 * the CLI, query, ranking, or output layers.
 */
import type { ParsedQuery, SearchOptions, SearchProvider, SearchResponse } from "./types.ts";
import { buildSearchUrl } from "./query.ts";
import { normalizeEnvelope, type GitHubSearchEnvelope } from "./normalizer.ts";
import { NetworkError, RateLimitError, ParseError } from "./errors.ts";
import { MemoryCache } from "./cache.ts";

/** A minimal logger so the CLI can surface outgoing queries, errors, and
 *  rate-limit events without coupling to a specific logging framework. */
export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export class GitHubSearchProvider implements SearchProvider {
  readonly name = "github";
  private readonly logger: Logger;
  private tokens: string[];
  private tokenIndex = 0;
  /** Shared cache across instances. */
  static cache = new MemoryCache<SearchResponse>(300_000);

  constructor(logger: Logger = noopLogger, tokens: string[] = []) {
    this.logger = logger;
    this.tokens = tokens.filter(Boolean);
  }

  private nextToken(): string | undefined {
    if (this.tokens.length === 0) return undefined;
    const token = this.tokens[this.tokenIndex % this.tokens.length];
    this.tokenIndex++;
    return token;
  }

  async search(query: ParsedQuery, options: SearchOptions): Promise<SearchResponse> {
    // Check cache first
    const cacheKey = MemoryCache.key(query.raw, options.sort, String(options.limit), String(options.page ?? 1));
    const cached = GitHubSearchProvider.cache.get(cacheKey);
    if (cached) {
      this.logger.debug("[github] cache hit");
      return cached;
    }
    this.logger.debug("[github] cache miss");
    const url = buildSearchUrl(query, options);
    this.logger.debug(`[github] outgoing query: ${query.raw}`);
    this.logger.debug(`[github] request url: ${url}`);

    const all: SearchResponse["repos"] = [];
    let totalCount = 0;
    let rateLimited = false;
    let rateLimitRemaining: number | undefined;

    // Fetch one page (or multiple pages to reach limit if page=1)
    const perPage = Math.min(Math.max(options.limit, 1), 100);
    const startPage = options.page ?? 1;
    // ponytail: when page > 1, fetch only that specific page
    const maxPages = startPage > 1 ? startPage : Math.ceil(options.limit / perPage);

    for (let page = startPage > 1 ? startPage : 1; page <= maxPages; page++) {
      const pagedUrl = appendPage(url, page, perPage);
      let lastErr: Error | undefined;

      // Try with current token; if 403, retry with next token
      for (let attempt = 0; attempt <= this.tokens.length; attempt++) {
        const token = this.tokens.length > 0 ? this.nextToken() : options.token;
        try {
          const res = await fetch(pagedUrl, {
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "search-cli",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });

          const remainingStr = res.headers.get("x-ratelimit-remaining");
          rateLimitRemaining = remainingStr !== null ? Number(remainingStr) : undefined;
          if (res.status === 403) {
            if (remainingStr === "0" || remainingStr === null) {
              // Rate limited
              if (this.tokens.length > 0 && attempt < this.tokens.length) {
                continue;
              }
              this.logger.warn("[github] rate limit exceeded");
              rateLimited = true;
              throw new RateLimitError(!!token);
            }
            // Non-rate-limit 403 (e.g. private repo, permissions)
            const body = await res.text().catch(() => "");
            this.logger.error(`[github] non-rate-limit 403: ${body.slice(0, 200)}`);
            throw new NetworkError();
          }
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            this.logger.error(`[github] API error ${res.status}: ${body.slice(0, 200)}`);
            throw new NetworkError();
          }

          // Validate response is valid JSON before trusting the cast
          const raw = await res.text();
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            const snippet = raw.slice(0, 200);
            this.logger.error(`[github] invalid JSON response: ${snippet}`);
            throw new ParseError("GitHub API", snippet.includes("<!DOCTYPE")
              ? "GitHub returned an HTML page (maintenance or CAPTCHA?)"
              : "Invalid JSON response");
          }
          if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
            this.logger.error(`[github] unexpected response shape: ${JSON.stringify(parsed).slice(0, 200)}`);
            throw new ParseError("GitHub API", "Unexpected response shape — missing items array");
          }
          const env = parsed as GitHubSearchEnvelope;
          totalCount = env.total_count;
          const repos = normalizeEnvelope(env);
          all.push(...repos);
          lastErr = undefined;
          break; // success, exit token retry loop
        } catch (err) {
          lastErr = err as Error;
          if (rateLimited) break;
        }
      }

      if (lastErr && !rateLimited) throw lastErr;
      if (rateLimited) break;
      if (all.length >= options.limit) break;
    }

    const repos = all.slice(0, options.limit);
    if (repos.length === 0) {
      this.logger.debug("[github] empty results");
    }
    const response: SearchResponse = { totalCount, repos, rateLimited, rateLimitRemaining };
    if (!rateLimited) {
      GitHubSearchProvider.cache.set(cacheKey, response);
    }
    return response;
  }
}

function appendPage(url: string, page: number, perPage: number): string {
  const u = new URL(url);
  u.searchParams.set("page", String(page));
  u.searchParams.set("per_page", String(perPage));
  return u.toString();
}