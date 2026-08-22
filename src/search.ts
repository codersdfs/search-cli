/**
 * Search module — deep module that owns the full search pipeline:
 * query parsing → URL building → API fetch (via adapter) → normalize → cache → rank.
 *
 * The adapter seam (`SearchAdapter`) is the only point of contact with the
 * network. Two implementations justify the seam: GitHub in prod, in-memory in tests.
 */
import type {
  ParsedQuery,
  Qualifier,
  Repo,
  SearchOptions,
  SearchProvider,
  SearchResponse,
  SortStrategy,
  CacheEntry,
} from "./types";
import { NetworkError, RateLimitError, ParseError } from "./errors";

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

export interface SearchAdapter {
  search(query: ParsedQuery, options: SearchOptions): Promise<SearchResponse>;
}

export class MemoryCache<T> {
  private cache = new Map<string, CacheEntry<T>>();

  constructor(private defaultTtlMs: number = 300_000) {}

  static key(...parts: string[]): string {
    return parts.join("::").toLowerCase().replace(/\s+/g, " ");
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }

  set(key: string, data: T, ttlMs?: number): void {
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      data,
      cachedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

const MAX_CACHE_SIZE = 50;

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

export interface GitHubSearchEnvelope {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubApiItem[];
}

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

export function normalizeEnvelope(env: GitHubSearchEnvelope): Repo[] {
  return (env.items ?? []).map(normalizeRepo);
}

export const KNOWN_QUALIFIERS = [
  "language",
  "stars",
  "fork",
  "archived",
  "topic",
  "user",
  "org",
  "repo",
  "updated",
  "pushed",
  "visibility",
  "in",
  "size",
  "license",
  "created",
] as const;

export type KnownQualifier = (typeof KNOWN_QUALIFIERS)[number];

export const QUALIFIER_SUGGESTIONS: Record<string, string[]> = {
  l: ["language:"],
  s: ["stars:", "size:"],
  t: ["topic:"],
  u: ["user:"],
  o: ["org:"],
  r: ["repo:"],
  c: ["created:"],
  p: ["pushed:"],
  v: ["visibility:"],
  i: ["in:"],
  f: ["fork:"],
  a: ["archived:"],
};


export function suggestFor(input: string): string[] {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) return [];
  if (trimmed.length === 1 && QUALIFIER_SUGGESTIONS[trimmed]) {
    return QUALIFIER_SUGGESTIONS[trimmed];
  }
  const matches = KNOWN_QUALIFIERS.filter((k) => k.startsWith(trimmed));
  return matches.map((k) => k + ":");
}
  
export function tokenize(input: string): string[] {
  const tokens: string[] = [];  
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (/\s/.test(ch) && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) {
    if (current.startsWith('"') && current.endsWith('"') && current.length >= 2) {
      current = current.slice(1, -1);
    }
    tokens.push(current);
  }
  return tokens;
}
export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { keywords: [], qualifiers: [], raw };
  }

  const keywords: string[] = [];
  const qualifiers: Qualifier[] = [];

  for (const token of tokenize(trimmed)) {
    const qualifier = matchQualifier(token);
    if (qualifier) {
      qualifiers.push(qualifier);
    } else {
      keywords.push(token);
    }
  }

  return { keywords, qualifiers, raw: trimmed };
}

function matchQualifier(token: string): Qualifier | null {
  const negated = token.startsWith("-");
  const body = negated ? token.slice(1) : token;
  const idx = body.indexOf(":");
  if (idx <= 0) return null;
  const key = body.slice(0, idx).toLowerCase();
  let value = body.slice(idx + 1);
  if (value === "") return null;
  if (!/^[a-z]+$/i.test(key)) return null;
  if (value.startsWith("//")) return null;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1);
  }
  return { key, value, negated };
}

export interface FlagFilters {
  language?: string;
  stars?: string;
  org?: string;
  user?: string;
  topic?: string;
  archived?: boolean;
  fork?: boolean;
}

export function applyFlagFilters(query: ParsedQuery, flags: FlagFilters): ParsedQuery {
  const qualifiers = [...query.qualifiers];

  if (flags.language) qualifiers.push({ key: "language", value: flags.language, negated: false });
  if (flags.stars) qualifiers.push({ key: "stars", value: flags.stars, negated: false });
  if (flags.org) qualifiers.push({ key: "org", value: flags.org, negated: false });
  if (flags.user) qualifiers.push({ key: "user", value: flags.user, negated: false });
  if (flags.topic) qualifiers.push({ key: "topic", value: flags.topic, negated: false });
  if (flags.archived !== undefined)
    qualifiers.push({ key: "archived", value: flags.archived ? "true" : "false", negated: false });
  if (flags.fork !== undefined)
    qualifiers.push({ key: "fork", value: flags.fork ? "true" : "false", negated: false });

  return { ...query, qualifiers };
}

export function validateQuery(query: ParsedQuery): void {
  const has = (key: string) => query.qualifiers.some((q) => q.key === key && !q.negated);
  if (has("visibility") && has("private")) {
    throw new Error("Cannot combine `visibility:` and `private:` filters.");
  }
}

export function buildGitHubQuery(query: ParsedQuery): string {
  const parts: string[] = [];

  for (const kw of query.keywords) {
    const alreadyQuoted = kw.startsWith('"') && kw.endsWith('"');
    parts.push(kw.includes(" ") && !alreadyQuoted ? `"${kw}"` : kw);
  }

  for (const q of query.qualifiers) {
    const needsQuote = q.value.includes(" ") && !q.value.startsWith('"');
    const value = needsQuote ? `"${q.value}"` : q.value;
    parts.push(`${q.negated ? "-" : ""}${q.key}:${value}`);
  }

  return parts.join(" ");
}

export function githubSortParam(sort: SortStrategy): { sort?: string; order?: string } {
  switch (sort) {
    case "stars":
      return { sort: "stars", order: "desc" };
    case "forks":
      return { sort: "forks", order: "desc" };
    case "updated":
      return { sort: "updated", order: "desc" };
    case "best-match":
    default:
      return {};
  }
}

export function buildSearchUrl(query: ParsedQuery, options: SearchOptions): string {
  const q = buildGitHubQuery(query);
  const { sort, order } = githubSortParam(options.sort);
  const params = new URLSearchParams({ q: q || " " });
  if (sort) params.set("sort", sort);
  if (order) params.set("order", order);
  return `https://api.github.com/search/repositories?${params.toString()}`;
}

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
      break;
  }
  return copy;
}

function byKey(key: (r: Repo) => number): (a: Repo, b: Repo) => number {
  return (a, b) => key(b) - key(a) || b.stars - a.stars || a.id - b.id;
}

export function compositeScore(r: Repo): number {
  const starScore = Math.log10(r.stars + 1);
  const recencyMs = Date.now() - Date.parse(r.pushedAt);
  const recencyScore = Math.max(0, 1 - recencyMs / (1000 * 60 * 60 * 24 * 365));
  return starScore * 0.7 + recencyScore * 0.3;
}

export class GitHubSearchAdapter implements SearchAdapter {
  readonly name = "github";
  private readonly logger: Logger;
  private tokens: string[];
  private tokenIndex = 0;

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
    const url = buildSearchUrl(query, options);
    this.logger.debug(`[github] outgoing query: ${query.raw}`);
    this.logger.debug(`[github] request url: ${url}`);

    const all: Repo[] = [];
    let totalCount = 0;
    let rateLimited = false;
    let rateLimitRemaining: number | undefined;

    const perPage = Math.min(Math.max(options.limit, 1), 100);
    const startPage = options.page ?? 1;
    const maxPages = startPage > 1 ? startPage : Math.ceil(options.limit / perPage);

    for (let page = startPage > 1 ? startPage : 1; page <= maxPages; page++) {
      const pagedUrl = appendPage(url, page, perPage);
      let lastErr: Error | undefined;

      for (let attempt = 0; attempt <= this.tokens.length; attempt++) {
        const token = this.tokens.length > 0 ? this.nextToken() : options.token;
        try {
          const res = await fetch(pagedUrl, {
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "ghfind",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });

          const remainingStr = res.headers.get("x-ratelimit-remaining");
          rateLimitRemaining = remainingStr !== null ? Number(remainingStr) : undefined;

          if (res.status === 403) {
            if (remainingStr === "0" || remainingStr === null) {
              if (this.tokens.length > 0 && attempt < this.tokens.length) {
                continue;
              }
              this.logger.warn("[github] rate limit exceeded");
              rateLimited = true;
              throw new RateLimitError(!!token);
            }
            const body = await res.text().catch(() => "");
            this.logger.error(`[github] non-rate-limit 403: ${body.slice(0, 200)}`);
            throw new NetworkError();
          }
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            this.logger.error(`[github] API error ${res.status}: ${body.slice(0, 200)}`);
            throw new NetworkError();
          }

          const raw = await res.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            const snippet = raw.slice(0, 200);
            this.logger.error(`[github] invalid JSON response: ${snippet}`);
            throw new ParseError("GitHub API", snippet.includes("<!DOCTYPE")
              ? "GitHub returned an HTML page (maintenance or CAPTCHA?)"
              : "Invalid JSON response");
          }
          if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as any).items)) {
            this.logger.error(`[github] unexpected response shape: ${JSON.stringify(parsed).slice(0, 200)}`);
            throw new ParseError("GitHub API", "Unexpected response shape — missing items array");
          }
          const env = parsed as GitHubSearchEnvelope;
          totalCount = env.total_count;
          const repos = normalizeEnvelope(env);
          all.push(...repos);
          lastErr = undefined;
          break;
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
    return { totalCount, repos, rateLimited, rateLimitRemaining };
  }
}

function appendPage(url: string, page: number, perPage: number): string {
  const u = new URL(url);
  u.searchParams.set("page", String(page));
  u.searchParams.set("per_page", String(perPage));
  return u.toString();
}

// ─── Trending adapter ─────────────────────────────────────────────────

const TRENDING_URL = "https://github.com/trending";

interface RawTrendingRepo {
  rank: number;
  owner: string;
  name: string;
  stars: number;
  starsToday: number;
  language: string;
  description: string;
}

function parseTrendingHtml(html: string): RawTrendingRepo[] {
  const flat = html.replace(/>\s+</g, "><").replace(/\s+/g, " ");
  const repos: RawTrendingRepo[] = [];
  const articleRe = /<article class="Box-row">(.*?)<\/article>/gi;
  let match: RegExpExecArray | null;
  let rank = 0;
  while ((match = articleRe.exec(flat)) !== null) {
    rank++;
    const block = match[1];
    const repoMatch = block.match(/href="\/([^\/\"]+)\/([^\"?#]+)"[^>]*class="Link"/);
    if (!repoMatch) continue;
    const owner = repoMatch[1];
    const name = repoMatch[2];
    const starsMatch = block.match(/href="\/[^\/\"]+\/[^\/\"]+\/stargazers"[^>]*>.*?<\/svg>\s*(\d[\d,]*)/);
    const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, ""), 10) : 0;
    const growthMatch = block.match(/(\d[\d,]*)\s+stars\s+(today|this\s+\w+)/);
    const starsToday = growthMatch ? parseInt(growthMatch[1].replace(/,/g, ""), 10) : 0;
    const langMatch = block.match(/itemprop="programmingLanguage">([^<]+)</);
    const language = langMatch ? langMatch[1].trim() : "";
    const descMatch = block.match(/<p[^>]*class="[^"]*color-fg-muted[^"]*"[^>]*>([^<]+)</);
    const description = descMatch ? descMatch[1].trim() : "";
    repos.push({ rank, owner, name, stars, starsToday, language, description });
  }
  return repos;
}

function trendingRepoToRepo(r: RawTrendingRepo): Repo {
  return {
    id: 0,
    fullName: `${r.owner}/${r.name}`,
    name: r.name,
    owner: r.owner,
    description: r.description,
    url: `https://github.com/${r.owner}/${r.name}`,
    stars: r.stars,
    forks: 0,
    watchers: 0,
    language: r.language,
    topics: [],
    archived: false,
    isFork: false,
    private: false,
    createdAt: "",
    updatedAt: "",
    pushedAt: "",
    score: r.starsToday,
  };
}

/**
 * Trending adapter — scrapes github.com/trending HTML and returns SearchResponse.
 */
export class TrendingAdapter implements SearchAdapter {
  readonly name = "trending";
  private readonly logger: Logger;

  constructor(logger: Logger = noopLogger) {
    this.logger = logger;
  }

  async search(_query: ParsedQuery, options: SearchOptions): Promise<SearchResponse> {
    const since = options.trendingSince ?? "daily";
    const url = since === "daily" ? TRENDING_URL : `${TRENDING_URL}?since=${since}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": "ghfind" } });
    } catch {
      throw new NetworkError();
    }
    if (!res.ok) throw new NetworkError();
    const html = await res.text();
    const repos = parseTrendingHtml(html).map(trendingRepoToRepo);
    return { totalCount: repos.length, repos, rateLimited: false };
  }
}

// ─── In-memory adapter (for tests) ────────────────────────────────────

/**
 * In-memory adapter that returns canned responses.
 * Use in tests to avoid network calls.
 */
export class InMemoryAdapter implements SearchAdapter {
  readonly name = "in-memory";
  private responses: Map<string, SearchResponse> = new Map();
  private defaultResponse: SearchResponse = { totalCount: 0, repos: [], rateLimited: false };

  /** Set a canned response keyed by the raw query string. */
  setResponse(queryRaw: string, response: SearchResponse): void {
    this.responses.set(queryRaw.toLowerCase(), response);
  }

  /** Set the default response returned when no canned response matches. */
  setDefault(response: SearchResponse): void {
    this.defaultResponse = response;
  }

  async search(query: ParsedQuery, _options: SearchOptions): Promise<SearchResponse> {
    const key = query.raw.toLowerCase();
    return this.responses.get(key) ?? { ...this.defaultResponse };
  }

  clear(): void {
    this.responses.clear();
  }
}

// ─── Search module (orchestrator) ─────────────────────────────────────

/**
 * Deep Search module — owns the cache, delegates network I/O to an adapter,
 * and orchestrates the full pipeline: cache → adapter → rank.
 */
export class SearchModule implements SearchProvider {
  readonly name = "search";
  private readonly adapter: SearchAdapter;
  private readonly logger: Logger;
  /** Shared cache across instances. */
  static cache = new MemoryCache<SearchResponse>(300_000);

  constructor(adapter: SearchAdapter, logger: Logger = noopLogger) {
    this.adapter = adapter;
    this.logger = logger;
  }

  async search(query: ParsedQuery, options: SearchOptions): Promise<SearchResponse> {
    const cacheKey = MemoryCache.key(
      query.raw,
      options.sort,
      String(options.limit),
      String(options.page ?? 1),
      options.trendingSince ?? "none",
    );
    const cached = SearchModule.cache.get(cacheKey);
    if (cached) {
      this.logger.debug("[search] cache hit");
      return cached;
    }
    this.logger.debug("[search] cache miss");

    const response = await this.adapter.search(query, options);
    if (!response.rateLimited) {
      SearchModule.cache.set(cacheKey, response);
    }
    return response;
  }
}

// ─── Convenience: create a GitHub-backed SearchModule ──────────────────

/**
 * Create a SearchModule backed by the GitHub adapter.
 * This is the primary entry point for production code.
 */
export function createGitHubSearch(
  logger: Logger = noopLogger,
  tokens: string[] = [],
): SearchModule {
  return new SearchModule(new GitHubSearchAdapter(logger, tokens), logger);
}

/**
 * Create a SearchModule backed by the Trending adapter.
 */
export function createTrendingSearch(
  logger: Logger = noopLogger,
): SearchModule {
  return new SearchModule(new TrendingAdapter(logger), logger);
}

