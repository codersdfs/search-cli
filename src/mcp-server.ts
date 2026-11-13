/**
 * mcp-server.ts — `ghfind mcp`: a Model Context Protocol (MCP) server that
 * exposes ghfind's search capabilities as tools any AI agent can call.
 *
 * Zero new dependencies: speaks JSON-RPC 2.0 over stdio per the MCP spec
 * (2025-06-18 lifecycle: initialize → notifications/initialized → operation)
 * and drives the existing domain modules through their seams:
 *
 *   tool                        module reused
 *   ──────────────────────────  ─────────────────────────────────
 *   ghfind_search_repos         search.ts (SearchProvider seam)
 *   ghfind_trending             search.ts (TrendingAdapter)
 *   ghfind_package_search       package.ts + registries/
 *   ghfind_npm_packages         package.ts (npm-pinned alias)
 *   ghfind_org_profile          org.ts
 *   ghfind_user_profile         user.ts
 *   ghfind_compare_repos        compare.ts + search.ts
 *   ghfind_deep_dive            deepdive.ts
 *   ghfind_similar_repos        similar.ts
 *   ghfind_bookmarked_releases  releases.ts + bookmarks.ts (read-only)
 *   ghfind_skill                agent-skill.ts
 *   ghfind_skill_search         skill-finder.ts (local scan | skills.sh HTTP)
 *
 * Only the tools capability is declared (no prompts/resources yet), so those
 * methods fall through to "Method not found".
 */
import type { Package, Repo, SearchResponse, SortStrategy } from "./types";
import { resolveTrendingLanguage } from "./search";
import {
  runRepoSearch,
  runTrendingSearch,
  zeroResultSuggestions,
} from "./run-search";
import {
  createPackageSearch,
  formatDownloads,
  formatScore,
  sortPackages,
  type PackageSortMode,
} from "./package";
import {
  REGISTRY_IDS,
  registryHelp,
  registryMeta,
  resolveRegistry,
  sortableModesFor,
} from "./registries/catalog";
import { fetchOrgProfile, formatOrgText } from "./org";
import { fetchUserProfile, formatUserText } from "./user";
import {
  fetchDeepDive,
  buildDeepDiveText,
  resolveRepoFromRef,
} from "./deepdive";
import { buildComparisonTable } from "./compare";
import {
  findSimilarRepos,
  formatSimilarText,
  SIMILAR_DEFAULT_LIMIT,
} from "./similar";
import { allCachedReleases } from "./releases";
import { getBookmarks } from "./bookmarks";
import { appendHistory } from "./history";
import { resolveToken as resolveClientToken } from "./github-client";
import { ensureBuiltinSkill, getSkill } from "./agent-skill";
import {
  formatSkillSearchText,
  searchSkills,
  type SkillSearchResult,
  type SkillSource,
} from "./skill-finder";
import { getVersion } from "./version";
import { RateLimitError, BadQueryError } from "./errors";

// ─── Protocol constants ────────────────────────────────────────────────

/** MCP protocol versions this server can speak, newest first. */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const JSONRPC_VERSION = "2.0";
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

// ─── Wire types ────────────────────────────────────────────────────────

type JsonRpcId = number | string | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

interface JSONSchemaProperty {
  type: string;
  description: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: { type: string };
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
  run(args: Record<string, unknown>, state: ServerState): Promise<ToolOutcome>;
}

interface ToolOutcome {
  /** LLM-facing text content block. */
  text: string;
  /** When present, also returned as `structuredContent` (spec: JSON object). */
  data?: Record<string, unknown>;
}

/** Per-connection state; one instance per stdio session. */
export interface ServerState {
  initialized: boolean;
  /** Optional token override from `ghfind mcp --token <t>`. */
  token?: string;
}

/**
 * A tool error — reported as a tool execution error (isError: true) per the
 * MCP spec, not a protocol error. Network failures, bad queries, unknown
 * repos, invalid args, etc.
 */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolError";
  }
}

// ─── Token resolution ──────────────────────────────────────────────────
// Shared with every other surface: arg > `ghfind mcp --token` > config
// (GITHUB_TOKEN is folded into config at load time).

function resolveToken(state: ServerState, arg: unknown): string | undefined {
  if (typeof arg === "string" && arg.trim()) return arg.trim();
  return resolveClientToken(state.token);
}

// ─── Arg coercion helpers ──────────────────────────────────────────────

function coerceInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function coerceEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

// ─── Formatting helpers ────────────────────────────────────────────────

const fmtInt = (n: number): string => n.toLocaleString("en-US");

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Slim, agent-friendly repo shape (drops fields only the TUI needs). */
function slimRepo(r: Repo): Record<string, unknown> {
  return {
    fullName: r.fullName,
    description: r.description,
    url: r.url,
    stars: r.stars,
    forks: r.forks,
    language: r.language,
    topics: r.topics,
    pushedAt: r.pushedAt,
    archived: r.archived,
  };
}

function formatRepoLines(repos: Repo[]): string {
  return repos
    .map((r, i) => {
      const desc = r.description ? ` — ${truncate(r.description, 100)}` : "";
      const lang = r.language ? ` [${r.language}]` : "";
      return `${i + 1}. ${r.fullName} ★ ${fmtInt(r.stars)}${lang}${desc}`;
    })
    .join("\n");
}

function formatPackageLines(pkgs: Package[]): string {
  return pkgs
    .map((p, i) => {
      const desc = p.description ? ` — ${truncate(p.description, 90)}` : "";
      const score = formatScore(p);
      const scorePart = score === "—" ? "" : ` · score ${score}`;
      return `${i + 1}. ${p.name}@${p.version}${desc} (↓ ${formatDownloads(p)}${scorePart})`;
    })
    .join("\n");
}

/** Wrap a domain error as McpToolError so its message surfaces verbatim. */
function asMcpToolError(err: unknown): McpToolError {
  return new McpToolError(err instanceof Error ? err.message : String(err));
}

// ─── Tool registry ─────────────────────────────────────────────────────

const REPO_SORTS = ["best-match", "stars", "updated", "forks"] as const;
/** Skill search sources: this machine, or the public skills.sh ecosystem. */
const SKILL_SOURCES = ["local", "registry"] as const;
const TRENDING_SINCE = ["daily", "weekly", "monthly"] as const;
const PKG_SORTS = ["best-match", "score", "downloads", "name"] as const;

const TOOLS: ToolDefinition[] = [
  {
    name: "ghfind_search_repos",
    title: "Search GitHub repositories",
    description:
      "Search GitHub repositories with the GitHub search syntax. Supports qualifiers like language:, stars:>1000, topic:, org:, user:, pushed:>2026-01-01, quoted phrases, and -negation. Returns fullNames, stars, languages, descriptions, and URLs.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'GitHub search query, e.g. "rust cli stars:>500" or "language:TypeScript topic:mcp".',
        },
        limit: {
          type: "number",
          description: "Max results, 1-100 (default 20).",
          minimum: 1,
          maximum: 100,
        },
        sort: {
          type: "string",
          description: "Sort strategy (default best-match).",
          enum: [...REPO_SORTS],
        },
        token: {
          type: "string",
          description:
            "Optional GitHub token (raises the rate limit from 60/hr to 5,000/hr).",
        },
      },
      required: ["query"],
    },
    async run(args, state) {
      const query = String(args.query ?? "").trim();
      if (!query) throw new McpToolError("query must be a non-empty string.");
      const limit = coerceInt(args.limit, 20, 1, 100);
      const sort = coerceEnum<SortStrategy>(
        args.sort,
        REPO_SORTS,
        "best-match",
      );
      const token = resolveToken(state, args.token);

      // One pipeline behind every surface (src/run-search.ts). BadQueryError
      // is thrown before any network I/O — for an agent, GitHub's opaque 422
      // reads as breakage, whereas the specific message names the bad token
      // and the fix.
      let response: SearchResponse;
      let repos: Repo[];
      try {
        const run = await runRepoSearch({ query, sort, limit, token });
        response = run.response;
        repos = run.repos;
      } catch (err) {
        if (err instanceof BadQueryError) {
          return {
            text: `Invalid query: ${err.detail}${err.hint ? ` Try: ${err.hint}` : ""}`,
            data: { totalCount: 0, repos: [], invalidQuery: true },
          };
        }
        // The adapter no longer swallows rate limits as empty results — it
        // throws RateLimitError. Convert it to the structured flag here so
        // agents still get backoff advice (a tool failure reads as breakage;
        // the flag reads as retry-later).
        if (err instanceof RateLimitError) {
          return {
            text: `GitHub API rate limit exceeded for "${query}". Set a token (GITHUB_TOKEN or the tool's token argument) to raise the limit from 60/hr to 5,000/hr.`,
            data: { totalCount: 0, repos: [], rateLimited: true },
          };
        }
        throw err;
      }

      // Make agent searches visible in the user's TUI history (best-effort).
      try {
        appendHistory({
          query,
          mode: "search",
          timestamp: Date.now(),
          resultCount: repos.length,
        });
      } catch {
        // non-critical
      }

      // Zero results usually means one qualifier over-constrained the query.
      // Offer the same ranked loosenings the TUI does, as text and as data.
      const suggestions =
        repos.length === 0 ? zeroResultSuggestions(query) : [];
      const text =
        repos.length === 0
          ? `No repositories found for "${query}" (total_count ${response.totalCount}).${
              suggestions.length
                ? `\n\nTry: ${suggestions.map((s) => `"${s}"`).join("\n     ")}`
                : ""
            }`
          : formatRepoLines(repos) +
            (response.totalCount > repos.length
              ? `\n\n(${fmtInt(response.totalCount)} total matches; showing ${repos.length}.)`
              : "");
      return {
        text,
        data: {
          totalCount: response.totalCount,
          repos: repos.map(slimRepo),
          ...(suggestions.length ? { suggestions } : {}),
          ...(response.rateLimited ? { rateLimited: true } : {}),
        },
      };
    },
  },
  {
    name: "ghfind_trending",
    title: "Trending GitHub repositories",
    description:
      "List repositories trending on GitHub today, this week, or this month, optionally filtered by language. Uses github.com/trending, so results carry stars-today momentum the Search API cannot provide.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "Trending period (default daily).",
          enum: [...TRENDING_SINCE],
        },
        language: {
          type: "string",
          description:
            'Optional language filter slug, e.g. "rust", "python", "typescript".',
        },
        limit: {
          type: "number",
          description: "Max results, 1-50 (default 25).",
          minimum: 1,
          maximum: 50,
        },
        // No token parameter: the trending feed is a github.com HTML scrape,
        // not the authenticated API, so a token could never help.
      },
    },
    async run(args) {
      const since = coerceEnum(args.since, TRENDING_SINCE, "daily");
      const limit = coerceInt(args.limit, 25, 1, 50);

      let language: string | undefined;
      try {
        language = resolveTrendingLanguage(
          typeof args.language === "string" ? args.language : undefined,
        );
      } catch (err) {
        throw asMcpToolError(err);
      }

      const { repos: trendingRepos } = await runTrendingSearch({
        sort: "stars",
        limit,
        since,
        ...(language ? { language } : {}),
      });
      const repos = trendingRepos.slice(0, limit);
      const text =
        repos.length === 0
          ? `No trending repositories returned (${since}${language ? `, ${language}` : ""}).`
          : formatRepoLines(repos);
      return {
        text,
        data: {
          since,
          ...(language ? { language } : {}),
          repos: repos.map(slimRepo),
        },
      };
    },
  },
  {
    name: "ghfind_npm_packages",
    title: "Search npm packages",
    description:
      "Search the npm registry (pinned alias of ghfind_package_search with registry=npm): name, version, monthly downloads, quality score, and description for each package.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Package search text, e.g. "terminal ui".',
        },
        limit: {
          type: "number",
          description: "Max results, 1-100 (default 20).",
          minimum: 1,
          maximum: 100,
        },
        sort: {
          type: "string",
          description: "Sort strategy (default best-match).",
          enum: [...PKG_SORTS],
        },
      },
      required: ["query"],
    },
    async run(args) {
      const query = String(args.query ?? "").trim();
      if (!query) throw new McpToolError("query must be a non-empty string.");
      const limit = coerceInt(args.limit, 20, 1, 100);
      const sort = coerceEnum<PackageSortMode>(
        args.sort,
        PKG_SORTS,
        "best-match",
      );

      const { totalCount, packages } =
        await createPackageSearch().searchPackage(query, limit);
      const sorted = sortPackages(packages, sort);
      const text =
        sorted.length === 0
          ? `No npm packages found for "${query}".`
          : formatPackageLines(sorted);
      return { text, data: { totalCount, packages: sorted } };
    },
  },
  {
    name: "ghfind_package_search",
    title: "Search package registries",
    description:
      "Search a package registry: npm (default), crates, rubygems, nuget, or maven. Returns name, version, downloads (with each registry's own window — npm monthly, crates.io 90 days, RubyGems/NuGet lifetime, Maven none), and description. Query text is passed through to the registry's native search unchanged, so npm's own qualifiers (scope:, keywords:, not:) work when registry is npm.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Package search text, e.g. "terminal ui".',
        },
        registry: {
          type: "string",
          description:
            "Registry to search (default npm). The enum is the contract.",
          enum: [...REGISTRY_IDS],
        },
        limit: {
          type: "number",
          description:
            "Max results, 1-100 (default 20). Clamped to the registry's own ceiling.",
          minimum: 1,
          maximum: 100,
        },
        sort: {
          type: "string",
          description:
            "Sort strategy. Only the modes the chosen registry supports are allowed: the subset is enforced at call time, so a value valid for npm but unknown to that registry raises a tool error rather than silently reordering by a number the registry never published.",
          enum: [...PKG_SORTS],
        },
      },
      required: ["query"],
    },
    async run(args) {
      const query = String(args.query ?? "").trim();
      if (!query) throw new McpToolError("query must be a non-empty string.");
      const rawRegistry = args.registry;
      if (
        rawRegistry !== undefined &&
        rawRegistry !== null &&
        !resolveRegistry(String(rawRegistry))
      ) {
        throw new McpToolError(
          `Unknown registry "${String(rawRegistry)}" (use ${registryHelp()}).`,
        );
      }
      const registry = resolveRegistry(String(rawRegistry ?? "npm")) ?? "npm";
      const limit = coerceInt(args.limit, 20, 1, 100);
      // Unlike the repo tools, an unsupported sort is an error rather than a
      // silent fallback: "score" on crates.io would order rows by a number
      // that does not exist, so the agent must be told the registry's modes.
      const allowedSorts = sortableModesFor(registry);
      const requestedSort =
        args.sort === undefined || args.sort === null ? "" : String(args.sort);
      if (
        requestedSort &&
        !allowedSorts.includes(requestedSort as PackageSortMode)
      ) {
        throw new McpToolError(
          `sort "${requestedSort}" is not supported by ${registry} (use ${allowedSorts.join("|")}).`,
        );
      }
      const sort = (requestedSort || "best-match") as PackageSortMode;

      const result = await createPackageSearch(registry).searchPackage(
        query,
        limit,
      );
      const { totalCount, packages } = result;
      const sorted = sortPackages(packages, sort);
      const meta = registryMeta(registry);
      const text =
        sorted.length === 0
          ? `No ${meta.label} packages found for "${query}".`
          : formatPackageLines(sorted);
      return {
        text,
        data: {
          registry,
          downloadsWindow: meta.downloadsWindow,
          totalCount,
          // RubyGems publishes no total, so its totalCount is a ceiling; agents
          // reading the payload must be able to tell the two apart.
          totalIsExact: result.totalIsExact !== false,
          packages: sorted,
        },
      };
    },
  },
  {
    name: "ghfind_org_profile",
    title: "GitHub org profile",
    description:
      "Aggregate profile for a GitHub organization: repo count, total stars/forks of fetched repos, top languages, top repos by stars, and recently active repos.",
    inputSchema: {
      type: "object",
      properties: {
        org: { type: "string", description: 'Org login, e.g. "vercel".' },
        limit: {
          type: "number",
          description: "How many repos to aggregate, 1-500 (default 100).",
          minimum: 1,
          maximum: 500,
        },
        token: { type: "string", description: "Optional GitHub token." },
      },
      required: ["org"],
    },
    async run(args, state) {
      const org = String(args.org ?? "").trim();
      if (!org) throw new McpToolError("org must be a non-empty string.");
      const limit = coerceInt(args.limit, 100, 1, 500);
      const profile = await fetchOrgProfile(org, {
        token: resolveToken(state, args.token),
        limit,
      });
      return { text: formatOrgText(profile), data: { ...profile } };
    },
  },
  {
    name: "ghfind_user_profile",
    title: "GitHub user profile",
    description:
      "Aggregate profile for a GitHub user: repo count, total stars/forks, followers, top languages, top repos, and recently active repos.",
    inputSchema: {
      type: "object",
      properties: {
        user: { type: "string", description: 'GitHub login, e.g. "torvalds".' },
        limit: {
          type: "number",
          description: "How many repos to aggregate, 1-500 (default 100).",
          minimum: 1,
          maximum: 500,
        },
        token: { type: "string", description: "Optional GitHub token." },
      },
      required: ["user"],
    },
    async run(args, state) {
      const user = String(args.user ?? "").trim();
      if (!user) throw new McpToolError("user must be a non-empty string.");
      const limit = coerceInt(args.limit, 100, 1, 500);
      const profile = await fetchUserProfile(user, {
        token: resolveToken(state, args.token),
        limit,
      });
      // Human-readable text like ghfind_org_profile (the structured data
      // still rides along in `data` for callers that want the raw numbers).
      return { text: formatUserText(profile), data: { ...profile } };
    },
  },
  {
    name: "ghfind_compare_repos",
    title: "Compare GitHub repositories",
    description:
      "Fetch 2-5 repositories and return a side-by-side comparison (stars, forks, language, age, topics, descriptions).",
    inputSchema: {
      type: "object",
      properties: {
        repos: {
          type: "array",
          description:
            'Repo fullNames to compare, e.g. ["oven-sh/bun", "nodejs/node"].',
          items: { type: "string" },
          minItems: 2,
          maxItems: 5,
        },
        token: { type: "string", description: "Optional GitHub token." },
      },
      required: ["repos"],
    },
    async run(args, state) {
      const names = Array.isArray(args.repos)
        ? args.repos.map((r) => String(r))
        : [];
      if (names.length < 2 || names.length > 5) {
        throw new McpToolError("repos must contain 2-5 repo fullNames.");
      }
      const token = resolveToken(state, args.token);
      const found: Repo[] = [];
      const missing: string[] = [];
      for (const fullName of names) {
        try {
          found.push(await resolveRepoFromRef(fullName, token));
        } catch {
          missing.push(fullName);
        }
      }
      if (found.length < 2) {
        throw new McpToolError(
          `Could not resolve enough repos to compare (found ${found.length}${missing.length ? `; not found: ${missing.join(", ")}` : ""}).`,
        );
      }
      const text =
        buildComparisonTable(found) +
        (missing.length ? `\n\nNot found: ${missing.join(", ")}` : "");
      return { text, data: { repos: found.map(slimRepo) } };
    },
  },
  {
    name: "ghfind_deep_dive",
    title: "GitHub repo deep-dive",
    description:
      "Rich detail for one repository: language breakdown (bytes), top contributors, a README excerpt, and a 4-dimension health score.",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: 'Repo fullName, e.g. "facebook/react".',
        },
        token: { type: "string", description: "Optional GitHub token." },
      },
      required: ["repo"],
    },
    async run(args, state) {
      const repo = String(args.repo ?? "").trim();
      if (!repo) throw new McpToolError("repo must be a non-empty string.");
      let stub: Repo;
      try {
        stub = await resolveRepoFromRef(repo, resolveToken(state, args.token));
      } catch (err) {
        throw asMcpToolError(err);
      }
      const data = await fetchDeepDive(stub, resolveToken(state, args.token));
      return { text: buildDeepDiveText(data), data: { ...data } };
    },
  },
  {
    name: "ghfind_similar_repos",
    title: "Find similar GitHub repositories",
    description:
      'Find repositories similar to a given repo using its topics and primary language, most-starred first. The source repo is always excluded. Best for "what else is like this?" discovery; use ghfind_search_repos when the user has explicit criteria instead.',
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: 'Source repo fullName, e.g. "facebook/react".',
        },
        limit: {
          type: "number",
          description: `Max similar repos, 1-100 (default ${SIMILAR_DEFAULT_LIMIT}).`,
          minimum: 1,
          maximum: 100,
        },
        token: { type: "string", description: "Optional GitHub token." },
      },
      required: ["repo"],
    },
    async run(args, state) {
      const repo = String(args.repo ?? "").trim();
      if (!repo) throw new McpToolError("repo must be a non-empty string.");
      const limit = coerceInt(args.limit, SIMILAR_DEFAULT_LIMIT, 1, 100);
      let result: Awaited<ReturnType<typeof findSimilarRepos>>;
      try {
        result = await findSimilarRepos(repo, {
          token: resolveToken(state, args.token),
          limit,
        });
      } catch (err) {
        throw asMcpToolError(err);
      }
      return {
        text: formatSimilarText(result),
        data: {
          repo: slimRepo(result.repo),
          count: result.repos.length,
          repos: result.repos.map(slimRepo),
          queries: result.queries,
        },
      };
    },
  },
  {
    name: "ghfind_bookmarked_releases",
    title: "Bookmarked repo releases",
    description:
      "The cached release feed for the user's ghfind bookmarks (read-only). Run `ghfind --releases` in a terminal first to refresh the cache.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const releases = allCachedReleases();
      const bookmarkCount = getBookmarks().length;
      const text =
        releases.length === 0
          ? bookmarkCount === 0
            ? "No bookmarks yet. Bookmark repos in the ghfind TUI (Space → Bookmark)."
            : `${bookmarkCount} bookmarks, no cached releases. Run \`ghfind --releases\` in a terminal to refresh.`
          : releases
              .map(
                (r) =>
                  `${r.fullName} ${r.tagName}${r.prerelease ? " [pre]" : ""} — ${r.publishedAt.slice(0, 10)}\n  ${r.url}`,
              )
              .join("\n");
      return {
        text,
        data: {
          bookmarkCount,
          releases: releases.map((r) => ({ ...r })),
        },
      };
    },
  },
  {
    name: "ghfind_skill",
    title: "ghfind CLI usage guide for agents",
    description:
      "Print a token-efficient guide to running ghfind directly in a shell (search syntax, flags, rate limits, token-efficiency tips). Prefer this over parsing --help output.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      ensureBuiltinSkill();
      const skill = getSkill("ghfind-cli");
      return {
        text: skill?.content ?? "ghfind skill unavailable.",
        data: { name: "ghfind-cli" },
      };
    },
  },
  {
    name: "ghfind_skill_search",
    title: "Search agent skills",
    description:
      "Search installed agent skills (SKILL.md files under the user's skill directories) or the public skills.sh ecosystem by keyword, and return matching skills with their descriptions. Read-only: it never installs anything - registry hits include the `npx skills add` command for the user to run deliberately. Use when the user asks to find a skill for a task, or asks what skills are available.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Keyword to match against skill names and descriptions, e.g. "changelog" or "testing" (2+ characters).',
        },
        source: {
          type: "string",
          description:
            "Where to search: 'local' for skills installed on this machine (default), 'registry' for the public skills.sh ecosystem.",
          enum: [...SKILL_SOURCES],
        },
        limit: {
          type: "number",
          description: "Max results, 1-100 (default 20).",
          minimum: 1,
          maximum: 100,
        },
      },
      required: ["query"],
    },
    async run(args) {
      const source = coerceEnum<SkillSource>(
        args.source,
        SKILL_SOURCES,
        "local",
      );
      const limit = coerceInt(args.limit, 20, 1, 100);
      const result: SkillSearchResult = await searchSkills(
        String(args.query ?? ""),
        { source, limit },
      );
      const where =
        result.source === "local"
          ? "installed skills on this machine"
          : "the public skills.sh ecosystem";
      const header = `${result.count} match(es) for "${result.query}" in ${where}:`;
      return {
        text: `${header}\n\n${formatSkillSearchText(result)}`,
        data: { ...result },
      };
    },
  },
];

/** Tools/list payload (name, title, description, inputSchema only). */
export function toolSummaries(): Array<Record<string, unknown>> {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

// ─── Response helpers ──────────────────────────────────────────────────

function respond(id: JsonRpcId, result: unknown): string {
  return JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, result });
}

function respondError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): string {
  return JSON.stringify({
    jsonrpc: JSONRPC_VERSION,
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
}

// ─── Tool dispatch ─────────────────────────────────────────────────────

function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}

/**
 * Run a tool by name. Throws McpToolError for unknown tools or failures;
 * callers turn that into a tool execution error (isError: true).
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  state: ServerState,
): Promise<ToolOutcome> {
  const tool = findTool(name);
  if (!tool) throw new McpToolError(`Unknown tool: ${name}`);
  try {
    return await tool.run(args, state);
  } catch (err) {
    if (err instanceof McpToolError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpToolError(`ghfind ${name} failed: ${msg}`);
  }
}

// ─── Request routing ───────────────────────────────────────────────────

interface ServerConfig {
  /** Emitted lines are written here (stdout in prod, capturable in tests). */
  write(line: string): void;
}

/**
 * Process one JSON-RPC line. Notifications (including parse garbage with no
 * id) produce no response; everything else writes exactly one response line.
 */
export async function processServerLine(
  line: string,
  state: ServerState,
  config: ServerConfig,
): Promise<void> {
  let msg: JsonRpcRequest;
  try {
    msg = JSON.parse(line) as JsonRpcRequest;
  } catch {
    config.write(respondError(null, PARSE_ERROR, "Parse error"));
    return;
  }
  if (
    typeof msg !== "object" ||
    msg === null ||
    typeof msg.method !== "string"
  ) {
    config.write(respondError(null, INVALID_REQUEST, "Invalid Request"));
    return;
  }

  // Extract the id into a const so TS narrows `undefined` out of it below
  // (aliased conditional narrowing doesn't apply through the `let msg` bind).
  const rawId = msg.id;
  const isNotification = rawId === undefined || rawId === null;
  const id: JsonRpcId = isNotification ? null : rawId;

  // Notifications never get responses.
  if (msg.method === "notifications/initialized") {
    state.initialized = true;
    return;
  }
  if (isNotification) return; // unknown notifications are ignored

  // Pre-initialization guard (spec: only initialize and ping may precede it).
  if (
    !state.initialized &&
    msg.method !== "initialize" &&
    msg.method !== "ping"
  ) {
    config.write(
      respondError(
        id,
        INVALID_REQUEST,
        `Server not initialized — send "initialize" first (method was "${msg.method}").`,
      ),
    );
    return;
  }

  switch (msg.method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? "");
      const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
      // The spec sends notifications/initialized next, but some clients skip
      // it; treat the initialize response as the capability gate.
      state.initialized = true;
      config.write(
        respond(id, {
          protocolVersion: negotiated,
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: "ghfind",
            title: "ghfind — GitHub search for agents",
            version: getVersion(),
          },
          instructions:
            "ghfind gives agents GitHub search: repositories, trending, package registries (npm, crates.io, RubyGems, NuGet, Maven Central), org/user profiles, repo comparison, deep-dives and similar-repo discovery. " +
            "ghfind_skill_search finds agent skills, either installed on this machine or in the public skills.sh ecosystem. " +
            "Call ghfind_skill for the full CLI guide. Unauthenticated requests are rate-limited to 60/hr; pass a token or set GITHUB_TOKEN for 5,000/hr.",
        }),
      );
      return;
    }

    case "ping": {
      config.write(respond(id, {}));
      return;
    }

    case "tools/list": {
      config.write(respond(id, { tools: toolSummaries() }));
      return;
    }

    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = findTool(name);
      if (!tool) {
        // Per the MCP spec's own example, unknown tools are -32602.
        config.write(respondError(id, INVALID_PARAMS, `Unknown tool: ${name}`));
        return;
      }
      const rawArgs = msg.params?.arguments;
      const args =
        typeof rawArgs === "object" && rawArgs !== null
          ? (rawArgs as Record<string, unknown>)
          : {};
      try {
        const outcome = await callTool(name, args, state);
        config.write(
          respond(id, {
            content: [{ type: "text", text: outcome.text }],
            ...(outcome.data ? { structuredContent: outcome.data } : {}),
            isError: false,
          }),
        );
      } catch (err) {
        const message =
          err instanceof McpToolError
            ? err.message
            : `ghfind tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`;
        config.write(
          respond(id, {
            content: [{ type: "text", text: message }],
            isError: true,
          }),
        );
      }
      return;
    }

    default: {
      config.write(
        respondError(id, METHOD_NOT_FOUND, `Method not found: ${msg.method}`),
      );
    }
  }
}

// ─── stdio transport ───────────────────────────────────────────────────

function writeStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Run the MCP server over stdio until stdin closes. In-flight tool calls are
 * drained before exit (with a grace timeout) so one-shot pipelines and fast
 * closing clients still receive their responses.
 */
export async function runMcpServer(
  options: { token?: string } = {},
): Promise<void> {
  const state: ServerState = {
    initialized: false,
    ...(options.token ? { token: options.token } : {}),
  };
  const config: ServerConfig = { write: writeStdout };

  let pending = 0;
  let stdinClosed = false;
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;

  const maybeExit = (): void => {
    if (!stdinClosed || pending > 0) return;
    process.exit(0);
  };

  process.stdin.setEncoding("utf8");
  let buffer = "";
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const idx = buffer.indexOf("\n");
      if (idx < 0) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      pending++;
      void processServerLine(line, state, config).finally(() => {
        pending--;
        if (shutdownTimer) {
          clearTimeout(shutdownTimer);
          shutdownTimer = undefined;
        }
        maybeExit();
      });
    }
  });
  const close = (): void => {
    stdinClosed = true;
    if (pending === 0) {
      process.exit(0);
      return;
    }
    // Grace period for in-flight requests; network calls have their own
    // timeouts, so 30s is a generous ceiling.
    shutdownTimer = setTimeout(() => process.exit(0), 30_000);
  };
  process.stdin.on("end", close);
  process.stdin.on("error", close);
  await new Promise<never>(() => {
    // park forever; the transport owns the lifetime
  });
}
