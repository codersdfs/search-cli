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
 *   ghfind_npm_packages         package.ts
 *   ghfind_org_profile          org.ts
 *   ghfind_user_profile         user.ts
 *   ghfind_compare_repos        compare.ts + search.ts
 *   ghfind_deep_dive            deepdive.ts
 *   ghfind_bookmarked_releases  releases.ts + bookmarks.ts (read-only)
 *   ghfind_skill                agent-skill.ts
 *
 * Only the tools capability is declared (no prompts/resources yet), so those
 * methods fall through to "Method not found".
 */
import type { Repo, SearchOptions, SortStrategy } from "./types";
import {
  parseQuery,
  rankRepos,
  createGitHubSearch,
  createTrendingSearch,
  TRENDING_LANGUAGES,
  trendingLanguageSlug,
} from "./search";
import {
  createPackageSearch,
  sortPackages,
  type PackageSortMode,
} from "./package";
import { fetchOrgProfile, formatOrgText } from "./org";
import { fetchUserProfile, formatUserJson } from "./user";
import { fetchDeepDive, buildDeepDiveText } from "./deepdive";
import { buildComparisonTable } from "./compare";
import { allCachedReleases } from "./releases";
import { getBookmarks } from "./bookmarks";
import { appendHistory } from "./history";
import { loadConfig } from "./config";
import { ensureBuiltinSkill, getSkill } from "./agent-skill";
import { getVersion } from "./version";

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

function resolveToken(state: ServerState, arg: unknown): string | undefined {
  if (typeof arg === "string" && arg.trim()) return arg.trim();
  if (state.token) return state.token;
  return loadConfig().githubToken ?? process.env.GITHUB_TOKEN;
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

function formatPackageLines(
  pkgs: Array<{
    name: string;
    version: string;
    description: string | null;
    downloads: number;
  }>,
): string {
  return pkgs
    .map((p, i) => {
      const desc = p.description ? ` — ${truncate(p.description, 90)}` : "";
      return `${i + 1}. ${p.name}@${p.version}${desc} (↓ ${fmtInt(p.downloads)}/mo)`;
    })
    .join("\n");
}

const REPO_NAME_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function parseRepoName(input: string): { owner: string; name: string } {
  const fullName = input
    .trim()
    .replace(/\.git$/, "")
    .replace(/^@/, "");
  if (!REPO_NAME_RE.test(fullName)) {
    throw new McpToolError(
      `"${input}" is not a repo name — use owner/name, e.g. facebook/react.`,
    );
  }
  const [owner, name] = fullName.split("/");
  return { owner, name };
}

/** Minimal Repo for deep-dive (fetchDeepDive only reads owner/name). */
function stubRepo(fullName: string): Repo {
  const { owner, name } = parseRepoName(fullName);
  return {
    id: 0,
    fullName: `${owner}/${name}`,
    name,
    owner,
    description: null,
    url: `https://github.com/${owner}/${name}`,
    stars: 0,
    forks: 0,
    watchers: 0,
    language: null,
    topics: [],
    archived: false,
    isFork: false,
    private: false,
    createdAt: "",
    updatedAt: "",
    pushedAt: "",
    score: 0,
  };
}

const TRENDING_QUERY = { keywords: [], qualifiers: [], raw: "trending" };

// ─── Tool registry ─────────────────────────────────────────────────────

const REPO_SORTS = ["best-match", "stars", "updated", "forks"] as const;
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

      const provider = createGitHubSearch(undefined, token ? [token] : []);
      const parsed = parseQuery(query);
      const options: SearchOptions = {
        limit,
        sort,
        json: false,
        verbose: false,
        token,
      };
      const response = await provider.search(parsed, options);
      const repos = rankRepos(response.repos, sort);

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

      const text =
        repos.length === 0
          ? `No repositories found for "${query}" (total_count ${response.totalCount}).`
          : formatRepoLines(repos) +
            (response.totalCount > repos.length
              ? `\n\n(${fmtInt(response.totalCount)} total matches; showing ${repos.length}.)`
              : "");
      return {
        text,
        data: {
          totalCount: response.totalCount,
          repos: repos.map(slimRepo),
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
        token: { type: "string", description: "Optional GitHub token." },
      },
    },
    async run(args, state) {
      const since = coerceEnum(args.since, TRENDING_SINCE, "daily");
      const limit = coerceInt(args.limit, 25, 1, 50);
      const token = resolveToken(state, args.token);

      let language: string | undefined;
      const langArg =
        typeof args.language === "string" ? args.language.trim() : "";
      if (langArg) {
        const slug = trendingLanguageSlug(langArg);
        if (!TRENDING_LANGUAGES.has(slug)) {
          throw new McpToolError(
            `"${langArg}" is not a trending language filter. Try one of: rust, python, typescript, javascript, go, zig.`,
          );
        }
        language = slug;
      }

      const trending = createTrendingSearch();
      const options: SearchOptions = {
        limit,
        sort: "stars",
        json: false,
        verbose: false,
        trendingSince: since,
        ...(language ? { trendingLanguage: language } : {}),
        token,
      };
      const response = await trending.search(TRENDING_QUERY, options);
      const repos = response.repos.slice(0, limit);
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
      "Search the npm registry: name, version, monthly downloads, quality score, and description for each package.",
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
      return { text: formatUserJson(profile), data: { ...profile } };
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
      const provider = createGitHubSearch(undefined, token ? [token] : []);
      const found: Repo[] = [];
      const missing: string[] = [];
      for (const fullName of names) {
        const res = await provider.search(parseQuery(fullName), {
          limit: 1,
          sort: "stars",
          json: false,
          verbose: false,
          token,
        });
        if (res.repos.length > 0) found.push(res.repos[0]);
        else missing.push(fullName);
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
      "Rich detail for one repository: language breakdown (bytes), top contributors, and a README excerpt.",
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
      const stub = stubRepo(repo);
      const data = await fetchDeepDive(stub, resolveToken(state, args.token));
      return { text: buildDeepDiveText(data), data: { ...data } };
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

  const isNotification = msg.id === undefined || msg.id === null;
  const id = isNotification ? null : msg.id;

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
            "ghfind gives agents GitHub search: repositories, trending, npm packages, org/user profiles, repo comparison and deep-dives. " +
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
  process.stdout.write(line + "\n");
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
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
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
