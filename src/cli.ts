// Prevent tui.ts auto-launch when imported from cli.ts
process.env.GHFIND_CLI_RUN = "1";
import {
  parseQuery,
  applyFlagFilters,
  rankRepos,
  createGitHubSearch,
  createTrendingSearch,
} from "./search";
import {
  createPackageSearch,
  formatPackagesJson,
  formatPackagesCsv,
  formatPackagesMarkdown,
  formatPackagesUrls,
  formatPackagesNames,
  sortPackages,
  type PackageSortMode,
} from "./package";
import { launchPackageBrowser } from "./package-browser";
import { runDoctor } from "./doctor";
import { reportError } from "./error-report";
import {
  format as formatOutput,
  exportToFile,
  pipeExec,
  type Format,
  type ExportFormat,
  type FormatLine,
} from "./output";
import { runWatch } from "./watch";
import {
  fetchOrgProfile,
  formatOrgJson,
  formatOrgCsv,
  formatOrgMarkdown,
  formatOrgText,
} from "./org";
import {
  fetchUserProfile,
  formatUserCsv,
  formatUserJson,
  formatUserMarkdown,
  formatUserText,
} from "./user";
import { checkAndNotify, allCachedReleases } from "./releases";
import { runInitWizard } from "./init";
import { runLoginWizard } from "./login";
import {
  buildComparisonTable,
  comparisonJson,
  comparisonCsv,
  comparisonMarkdown,
} from "./compare";
import {
  fetchDeepDiveRaw,
  buildDeepDiveData,
  buildDeepDiveJson,
  buildDeepDiveText,
  resolveRepoFromRef,
} from "./deepdive";
import { resolveTrendingLanguage } from "./search";
import type { Repo } from "./types";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { launchBrowser } from "./tui";
import { getVersion } from "./version";
import { runMcpServer } from "./mcp-server";
import {
  ensureBuiltinSkill,
  formatSkillCatalog,
  getSkill,
  listSkills,
} from "./agent-skill";
import type { SearchOptions } from "./types";
import { SearchCliError } from "./errors";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");

interface CLIFlags {
  query: string;
  json: boolean;
  csv: boolean;
  markdown: boolean;
  count: boolean;
  limit: number;
  sort: SearchOptions["sort"];
  token?: string;
  trending: boolean;
  since: string;
  pipe?: string;
  format?: string;
  watch: boolean;
  releases: boolean;
  interval: number;
  completion?: string;
  init: boolean;
  login: boolean;
  version: boolean;
  help: boolean;
  pkg: boolean;
  theme?: string;
  registry: string;
  compare: string[]; // repo fullNames to compare
  doctor: boolean;
  org?: string; // org profile lookup (ghfind org <name>)
  user?: string; // user profile lookup (ghfind user <name>)
  mcp: boolean; // run the MCP server (ghfind mcp)
  skill?: string; // agent skill guide (ghfind skill [name])
  deepDive?: string; // repo deep-dive (ghfind deep-dive <owner/repo>)
  language?: string; // trending language filter (--trending rust / ghfind trending rust)
}

function parseArgs(args: string[]): CLIFlags {
  const flags: CLIFlags = {
    query: "",
    json: false,
    csv: false,
    markdown: false,
    count: false,
    limit: 50,
    sort: "best-match",
    token: process.env.GITHUB_TOKEN,
    trending: false,
    since: "daily",
    watch: false,
    releases: false,
    interval: 300,
    init: false,
    login: false,
    version: false,
    help: false,
    pkg: false,
    registry: "npm",
    compare: [],
    doctor: false,
    mcp: false,
  };

  let queryParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--json":
        flags.json = true;
        break;
      case "--csv":
        flags.csv = true;
        break;
      case "--markdown":
        flags.markdown = true;
        break;
      case "--count":
        flags.count = true;
        break;
      case "--trending":
        flags.trending = true;
        // `ghfind --trending rust` — first bare word is the language filter
        break;
      case "trending": {
        // `ghfind trending rust` — subcommand form of --trending (README has
        // claimed this works; now it does).
        flags.trending = true;
        if (
          flags.query === "" &&
          i + 1 < args.length &&
          !args[i + 1].startsWith("-")
        ) {
          flags.language = args[++i];
        }
        break;
      }
      case "--language":
        flags.language = args[++i];
        break;
      case "--watch":
        flags.watch = true;
        break;
      case "--releases":
        flags.releases = true;
        break;
      case "--version":
      case "-v":
        flags.version = true;
        break;
      case "--doctor":
      case "doctor":
        flags.doctor = true;
        break;
      case "--help":
      case "-h":
        flags.help = true;
        break;
      case "init":
        flags.init = true;
        break;
      case "login":
        flags.login = true;
        break;
      case "--limit": {
        const parsed = parseInt(args[++i]);
        if (isNaN(parsed) || parsed < 1 || parsed > 100) {
          console.error(`Invalid limit: must be 1-100. Using default 50.`);
          flags.limit = 50;
        } else {
          flags.limit = parsed;
        }
        break;
      }
      case "--sort":
        flags.sort = args[++i] as SearchOptions["sort"];
        break;
      case "--token":
        flags.token = args[++i];
        break;
      case "--since":
        flags.since = args[++i];
        break;
      case "--pipe":
        flags.pipe = args[++i];
        break;
      case "--format":
        flags.format = args[++i];
        break;
      case "--registry":
        flags.registry = args[++i] ?? "npm";
        break;
      case "--theme":
        flags.theme = args[++i] ?? "tokyo-night";
        break;
      case "--completion":
        flags.completion = args[++i];
        break;
      case "mcp":
        flags.mcp = true;
        break;
      case "deep-dive": {
        // Single repo ref (owner/name); a following flag means none.
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          flags.deepDive = next;
          i++;
        }
        break;
      }
      case "skill": {
        // Optional skill id (ids contain no spaces); a following flag means none.
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          flags.skill = next;
          i++;
        } else {
          flags.skill = "";
        }
        break;
      }
      case "org": {
        // Collect org name until next flag (single token — GitHub org logins
        // contain no spaces; a quoted multi-word name is an error)
        const parts: string[] = [];
        while (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          parts.push(args[++i]);
        }
        flags.org = parts.join(" ");
        break;
      }
      case "user": {
        // Collect user name until next flag (single token, same as org)
        const userParts: string[] = [];
        while (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          userParts.push(args[++i]);
        }
        flags.user = userParts.join(" ");
        break;
      }
      case "--compare": {
        // Collect repo names until next flag
        const repos: string[] = [];
        while (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          repos.push(args[++i]);
        }
        flags.compare = repos;
        break;
      }
      default:
        if (!arg.startsWith("-")) queryParts.push(arg);
    }
  }
  if (queryParts[0] === "pkg") {
    flags.pkg = true;
    queryParts.shift();
  }
  flags.query = queryParts.join(" ");
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  // Version
  if (flags.version) {
    console.log(`ghfind v${getVersion()}`);
    return;
  }

  // Doctor — environment diagnostics
  if (flags.doctor) {
    await runDoctor();
    return;
  }

  // Help
  if (flags.help) {
    console.log(`
ghfind — Interactive GitHub repository browser

Usage:
  ghfind                           Launch interactive TUI
  ghfind <query> --json            Search, output JSON
  ghfind <query> --csv             Search, output CSV
  ghfind <query> --markdown        Search, output Markdown table
  ghfind <query> --count           Just the result count
  ghfind <query> --format <fmt>    Format lines (urls|names|ssh-urls|clone-commands|ids)
  ghfind <query> --pipe <target>   Pipe to clone/open
  ghfind --trending --json         Trending repos as JSON
  ghfind trending <lang>           Trending repos, optionally by language
  ghfind --releases                Check bookmarks for new releases
  ghfind --compare <r1> <r2>       Compare two+ repos side-by-side
  ghfind --compare a/b c/d --json  Compare as JSON|CSV|Markdown
  ghfind deep-dive <owner/repo>    Deep-dive: languages, contributors, README
  ghfind deep-dive a/b --json      Deep-dive as JSON
  ghfind org <name> --json         Org profile: repos, stars, top languages
  ghfind user <name> --json        User profile: repos, stars, top languages
  ghfind pkg <query> --json        Search npm packages, output JSON
  ghfind pkg <query>               Search npm packages, text list
  ghfind mcp                       Run the MCP server for AI agents (stdio)
  ghfind skill [name]              Print the agent skill guide (or catalog)
  ghfind --watch <query>           Watch mode (poll every Ns)
  ghfind init                      Run setup wizard
  ghfind login                     Import the gh CLI token or paste one
  ghfind --completion <shell>      Print completion script (bash|zsh|fish)
  ghfind --version                 Print version
  ghfind --doctor                  Run environment diagnostics (troubleshooting)
  ghfind --help                    Print this help

Options:
  --json, --csv, --markdown, --count   Output format
  --limit <n>                          Max results (default: 50)
  --sort <strategy>                    Sort: best-match|stars|updated|forks
  --theme <name>                     Theme: tokyo-night|premium-dark (default: tokyo-night)
  --trending                           Trending mode
  --language <lang>                    Trending language filter (e.g. rust)
  --since <period>                     Trending period: daily|weekly|monthly
  --pipe <target>                      Pipe target: clone|open
  --format <fmt>                       Line format: urls|names|ssh-urls|...
  --registry <name>                  Registry for pkg: npm (default) | others TBD

  --watch                              Watch mode (re-run periodically)
  --releases                           New-release feed for bookmarks
  --interval <s>                       Watch interval in seconds (default: 300)
  --completion <shell>                 Generate completions
`);
    return;
  }

  // Shell completions
  if (flags.completion) {
    const shell = flags.completion;
    try {
      const content = readFileSync(
        join(PKG_DIR, "completions", `ghfind.${shell}`),
        "utf-8",
      );
      console.log(content);
    } catch {
      console.error(`Completions not available for shell: ${shell}`);
      process.exit(1);
    }
    return;
  }

  // Init wizard
  if (flags.init) {
    await runInitWizard();
    return;
  }

  // Login — store a GitHub token for higher rate limits
  if (flags.login) {
    await runLoginWizard();
    return;
  }

  // MCP server — expose ghfind as tools to AI agents over stdio
  if (flags.mcp) {
    await runMcpServer({ token: flags.token });
    return;
  }

  // Agent skill guide — token-efficient usage doc for coding agents
  if (flags.skill !== undefined) {
    printAgentSkill(flags.skill);
    return;
  }
  // Package search (prototype, ticket 002-008)
  if (flags.pkg) {
    const interactive =
      !flags.query &&
      !flags.json &&
      !flags.csv &&
      !flags.markdown &&
      !flags.count &&
      !flags.format;
    if (interactive) {
      await launchPackageBrowser();
    } else {
      await runPackageSearch(flags);
    }
    return;
  }

  // Determine output format
  const outputFormat: ExportFormat | undefined = flags.json
    ? "json"
    : flags.csv
      ? "csv"
      : flags.markdown
        ? "markdown"
        : undefined;

  // Repo deep-dive — parity with the MCP ghfind_deep_dive tool
  if (flags.deepDive !== undefined) {
    await runDeepDive(flags, outputFormat);
    return;
  }

  // Org profile mode — independent of repo search handlers
  // (checks presence, not truthiness, so `ghfind org` with no name errors helpfully)
  if (flags.org !== undefined) {
    await runOrgProfile(flags, outputFormat);
    return;
  }

  // User profile mode — same shape as org profile
  if (flags.user !== undefined) {
    await runUserProfile(flags, outputFormat);
    return;
  }

  const isNonInteractive =
    outputFormat ||
    flags.count ||
    flags.format ||
    flags.pipe ||
    flags.watch ||
    flags.releases ||
    // `ghfind trending rust` / `ghfind --trending rust` print a list —
    // a language filter implies non-interactive output
    (flags.trending && (!!flags.language || !!flags.query));

  // Non-interactive mode
  if (isNonInteractive) {
    if (flags.releases) {
      await runReleases(flags, outputFormat);
      return;
    }
    await runNonInteractive(flags, outputFormat);
    return;
  }

  await launchBrowser(flags.theme);
}

interface SearchContext {
  query: string;
  parsed: ReturnType<typeof parseQuery> & { raw: string };
  provider: ReturnType<typeof createGitHubSearch>;
}

function buildSearchContext(flags: CLIFlags): SearchContext {
  const parsed = applyFlagFilters(parseQuery(flags.query), {});
  return {
    query: flags.query,
    parsed,
    provider: createGitHubSearch(undefined, flags.token ? [flags.token] : []),
  };
}

/** `ghfind skill [name]` — print the agent skill catalog or one skill's content. */
function printAgentSkill(name: string): void {
  ensureBuiltinSkill();
  if (!name) {
    console.log(formatSkillCatalog());
    return;
  }
  const skill = getSkill(name);
  if (!skill) {
    console.error(
      `Unknown skill: ${name}. Available: ${listSkills()
        .map((s) => s.name)
        .join(", ")}`,
    );
    process.exit(1);
  }
  console.log(skill.content);
}

/** `ghfind user <name>` — aggregate user profile: metadata, stars, top languages, top repos. */
async function runUserProfile(
  flags: CLIFlags,
  outputFormat?: ExportFormat,
): Promise<void> {
  try {
    const profile = await fetchUserProfile(flags.user!, {
      token: flags.token,
      limit: flags.limit,
    });
    if (outputFormat === "json") {
      console.log(formatUserJson(profile));
    } else if (outputFormat === "csv") {
      console.log(formatUserCsv(profile));
    } else if (outputFormat === "markdown") {
      console.log(formatUserMarkdown(profile));
    } else if (flags.count) {
      console.log(profile.publicRepoCount);
    } else {
      console.log(formatUserText(profile));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/** `ghfind org <name>` — aggregate org profile: metadata, stars, top languages, top repos. */
async function runOrgProfile(
  flags: CLIFlags,
  outputFormat?: ExportFormat,
): Promise<void> {
  try {
    const profile = await fetchOrgProfile(flags.org!, {
      token: flags.token,
      limit: flags.limit,
    });
    if (outputFormat === "json") {
      console.log(formatOrgJson(profile));
    } else if (outputFormat === "csv") {
      console.log(formatOrgCsv(profile));
    } else if (outputFormat === "markdown") {
      console.log(formatOrgMarkdown(profile));
    } else if (flags.count) {
      console.log(profile.publicRepoCount);
    } else {
      console.log(formatOrgText(profile));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/** `ghfind deep-dive <owner/repo>` — rich repo detail: languages, contributors, README. */
async function runDeepDive(
  flags: CLIFlags,
  outputFormat?: ExportFormat,
): Promise<void> {
  const ref = flags.deepDive!;
  if (!ref) {
    console.error(
      "Usage: ghfind deep-dive <owner/repo> [--json] [--token <t>]",
    );
    process.exit(1);
  }
  try {
    const repo = await resolveRepoFromRef(ref, flags.token); // validates + real metadata
    const raw = await fetchDeepDiveRaw(repo, flags.token);
    if (outputFormat === "json") {
      console.log(buildDeepDiveJson(raw));
    } else {
      console.log(buildDeepDiveText(buildDeepDiveData(repo, raw)));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/** `ghfind pkg "<query>"` — npm package search. Pass-through query to the registry. */
async function runPackageSearch(flags: CLIFlags): Promise<void> {
  if (flags.registry !== "npm") {
    console.error(`Registry "${flags.registry}" not yet supported (only npm).`);
    process.exit(1);
  }
  const PKG_SORTS: PackageSortMode[] = [
    "best-match",
    "score",
    "downloads",
    "name",
  ];
  const pkgSort = flags.sort as PackageSortMode;
  if (!PKG_SORTS.includes(pkgSort)) {
    console.error(
      `Invalid sort for pkg: "${flags.sort}" (use best-match|score|downloads|name).`,
    );
    process.exit(1);
  }
  const search = createPackageSearch();
  const query = flags.query.trim();
  if (!query) {
    console.error(
      "Usage: ghfind pkg <query> [--json|--csv|--markdown|--count|--format urls|names] [--limit <n>]",
    );
    process.exit(1);
  }
  try {
    const { totalCount, packages } = await search.searchPackage(
      query,
      flags.limit,
    );
    const sorted = sortPackages(packages, pkgSort);
    if (flags.count) {
      console.log(totalCount);
    } else if (flags.json) {
      console.log(formatPackagesJson(sorted));
    } else if (flags.csv) {
      console.log(formatPackagesCsv(sorted));
    } else if (flags.markdown) {
      console.log(formatPackagesMarkdown(sorted));
    } else if (flags.format === "urls") {
      console.log(formatPackagesUrls(sorted));
    } else if (flags.format === "names") {
      console.log(formatPackagesNames(sorted));
    } else {
      for (const p of sorted) {
        console.log(
          `${p.name}@${p.version}  ↓ ${p.downloads.toLocaleString()}  ${p.score.toFixed(2)}  ${p.description ?? ""}`,
        );
      }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/** `ghfind --releases` — check bookmarks for new releases; print the cached feed, then mark all seen. */
async function runReleases(
  flags: CLIFlags,
  outputFormat?: ExportFormat,
): Promise<void> {
  const results = await checkAndNotify({ token: flags.token });
  const releases = allCachedReleases();
  if (outputFormat === "json") {
    console.log(
      JSON.stringify(
        releases.map((r) => ({
          fullName: r.fullName,
          tag: r.tagName,
          name: r.name,
          url: r.url,
          publishedAt: r.publishedAt,
          prerelease: r.prerelease,
        })),
        null,
        2,
      ),
    );
    return;
  }
  const unseen = results.reduce((n, r) => n + r.newReleases.length, 0);
  const errors = results.filter((r) => r.error).length;
  console.log(
    `Checked ${results.length} bookmarked repos — ${unseen} new release${unseen === 1 ? "" : "s"}${errors ? `, ${errors} error${errors === 1 ? "" : "s"}` : ""}.`,
  );
  for (const r of releases) {
    console.log(
      `${r.fullName}  ${r.prerelease ? "[pre] " : ""}${r.tagName}  ${r.publishedAt.slice(0, 10)}\n  ${r.url}`,
    );
  }
}

async function runNonInteractive(flags: CLIFlags, outputFormat?: ExportFormat) {
  // Dispatch table: each handler receives shared context + flags, returns void.
  const handlers: Record<string, (ctx: SearchContext) => Promise<void>> = {
    trending: async (ctx) => {
      const since =
        flags.since === "weekly"
          ? "weekly"
          : flags.since === "monthly"
            ? "monthly"
            : "daily";
      const trendingSearch = createTrendingSearch();
      // Language filter: validated against github.com/trending's accepted
      // set (same validation as the MCP ghfind_trending tool).
      let language: string | undefined;
      try {
        // `ghfind trending rust` puts the language in flags.language;
        // `ghfind --trending rust` leaves it as the query's first word.
        language = resolveTrendingLanguage(
          flags.language ??
            (flags.query ? flags.query.split(/\s+/)[0] : undefined),
        );
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
      const response = await trendingSearch.search(
        { keywords: [], qualifiers: [], raw: "trending" },
        {
          limit: 25,
          sort: "stars",
          json: false,
          verbose: false,
          trendingSince: since,
          ...(language ? { trendingLanguage: language } : {}),
        },
      );
      if (outputFormat) {
        console.log(formatOutput(response.repos, outputFormat));
      } else if (flags.count) {
        console.log(response.totalCount);
      } else {
        for (const r of response.repos) {
          console.log(
            r.fullName +
              "  ★ " +
              r.stars +
              "  ▲ +" +
              r.score +
              " " +
              since +
              "  ● " +
              (r.language ?? ""),
          );
        }
      }
    },
    watch: async (ctx) => {
      let tick = 0;
      await runWatch(
        {
          query: ctx.query,
          sort: flags.sort,
          limit: flags.limit,
          token: flags.token,
          intervalMs: flags.interval * 1000,
          trending: flags.trending,
        },
        (repos, delta) => {
          tick++;
          if (outputFormat) {
            console.log(
              `[Watch #${tick}] ${repos.length} results (${delta >= 0 ? "+" : ""}${delta} since last check)`,
            );
            console.log(formatOutput(repos, outputFormat));
          } else {
            console.log(
              `[Watch #${tick}] ${repos.length} results — ${delta >= 0 ? "+" : ""}${delta} since last check`,
            );
          }
        },
        (err) => console.error(`[Watch error] ${err.message}`),
      );
    },
    pipe: async (ctx) => {
      const response = await ctx.provider.search(ctx.parsed, {
        limit: flags.limit,
        sort: flags.sort,
        json: false,
        verbose: false,
        token: flags.token,
      });
      const repos = rankRepos(response.repos, flags.sort);
      await pipeExec(repos, flags.pipe!);
    },
    format: async (ctx) => {
      const response = await ctx.provider.search(ctx.parsed, {
        limit: flags.limit,
        sort: flags.sort,
        json: false,
        verbose: false,
        token: flags.token,
      });
      const repos = rankRepos(response.repos, flags.sort);
      console.log(formatOutput(repos, flags.format as Format));
    },
    search: async (ctx) => {
      const response = await ctx.provider.search(ctx.parsed, {
        limit: flags.limit,
        sort: flags.sort,
        json: false,
        verbose: false,
        token: flags.token,
      });
      const repos = rankRepos(response.repos, flags.sort);
      if (flags.count) {
        console.log(response.totalCount);
        return;
      }
      if (outputFormat) {
        console.log(formatOutput(repos, outputFormat));
      }
    },
    compare: async (_ctx) => {
      const search = createGitHubSearch(undefined, [flags.token ?? ""]);
      const repos: Repo[] = [];
      const missing: string[] = [];
      for (const fullName of flags.compare) {
        const res = await search.search(
          { keywords: [fullName], qualifiers: [], raw: fullName },
          {
            limit: 1,
            sort: "stars",
            json: false,
            verbose: false,
            token: flags.token,
          },
        );
        if (res.repos.length > 0) repos.push(...res.repos);
        else missing.push(fullName);
      }
      if (repos.length < 2) {
        console.error(
          `Could not resolve enough repos to compare (found ${repos.length}${missing.length ? `; not found: ${missing.join(", ")}` : ""}).`,
        );
        process.exit(1);
      }
      const notFound = missing.length
        ? `\n\nNot found: ${missing.join(", ")}`
        : "";
      if (outputFormat === "json") {
        console.log(comparisonJson(repos));
      } else if (outputFormat === "csv") {
        console.log(comparisonCsv(repos));
      } else if (outputFormat === "markdown") {
        console.log(comparisonMarkdown(repos));
      } else {
        console.log(buildComparisonTable(repos) + notFound);
      }
    },
  };

  // Determine which handler to run
  const key =
    flags.compare.length > 0
      ? "compare"
      : flags.trending && !flags.watch
        ? "trending"
        : flags.watch
          ? "watch"
          : flags.pipe
            ? "pipe"
            : flags.format
              ? "format"
              : "search";

  const ctx = buildSearchContext(flags);
  await handlers[key](ctx);
}

main().catch((err) => {
  if (err instanceof Error && err.name === "SearchCliError") {
    // ponytail: known user-facing errors already carry a friendly message; skip the report prompt
    console.error(
      err instanceof SearchCliError ? err.userMessage : err.message,
    );
  } else {
    console.error(err instanceof Error ? err.message : String(err));
    reportError(err);
  }
  process.exit(1);
});
