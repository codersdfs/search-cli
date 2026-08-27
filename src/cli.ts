// Prevent tui.ts auto-launch when imported from cli.ts
process.env.GHFIND_CLI_RUN = "1";
import { parseQuery, applyFlagFilters, rankRepos, createGitHubSearch, createTrendingSearch } from "./search";
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
import { format as formatOutput, exportToFile, pipeExec, type Format, type ExportFormat, type FormatLine } from "./output";
import { runWatch } from "./watch";
import { checkAndNotify, allCachedReleases } from "./releases";
import { runInitWizard } from "./init";
import { buildComparisonTable } from "./compare";
import type { Repo } from "./types";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { launchBrowser } from "./tui";
import type { SearchOptions } from "./types";

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
  version: boolean;
  help: boolean;
  pkg: boolean;
  theme?: string;
  registry: string;
  compare: string[];  // repo fullNames to compare
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
    version: false,
    help: false,
    pkg: false,
    registry: "npm",
    compare: [],
  };

  let queryParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--json": flags.json = true; break;
      case "--csv": flags.csv = true; break;
      case "--markdown": flags.markdown = true; break;
      case "--count": flags.count = true; break;
      case "--trending": flags.trending = true; break;
      case "--watch": flags.watch = true; break;
      case "--releases": flags.releases = true; break;
      case "--version": case "-v": flags.version = true; break;
      case "--help": case "-h": flags.help = true; break;
      case "init": flags.init = true; break;
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
      case "--sort": flags.sort = args[++i] as SearchOptions["sort"]; break;
      case "--token": flags.token = args[++i]; break;
      case "--since": flags.since = args[++i]; break;
      case "--pipe": flags.pipe = args[++i]; break;
      case "--format": flags.format = args[++i]; break;
      case "--registry": flags.registry = args[++i] ?? "npm"; break;
      case "--theme": flags.theme = args[++i] ?? "tokyo-night"; break;
      case "--completion": flags.completion = args[++i]; break;
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
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf-8"));
    console.log(`ghfind v${pkg.version}`);
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
  ghfind --releases                Check bookmarks for new releases
  ghfind --compare <repo1> <repo2> Compare two+ repos side-by-side
  ghfind pkg <query> --json         Search npm packages, output JSON
  ghfind pkg <query>                Search npm packages, text list
  ghfind --watch <query>           Watch mode (poll every Ns)
  ghfind init                      Run setup wizard
  ghfind --completion <shell>      Print completion script (bash|zsh|fish)
  ghfind --version                 Print version
  ghfind --help                    Print this help

Options:
  --json, --csv, --markdown, --count   Output format
  --limit <n>                          Max results (default: 50)
  --sort <strategy>                    Sort: best-match|stars|updated|forks
  --theme <name>                     Theme: tokyo-night|premium-dark (default: tokyo-night)
  --trending                           Trending mode
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
      const content = readFileSync(join(PKG_DIR, "completions", `ghfind.${shell}`), "utf-8");
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
  // Package search (prototype, ticket 002-008)
  if (flags.pkg) {
    const interactive =
      !flags.query && !flags.json && !flags.csv && !flags.markdown && !flags.count && !flags.format;
    if (interactive) {
      await launchPackageBrowser();
    } else {
      await runPackageSearch(flags);
    }
    return;
  }

  // Determine output format
  const outputFormat: ExportFormat | undefined =
    flags.json ? "json" : flags.csv ? "csv" : flags.markdown ? "markdown" : undefined;
  const isNonInteractive = outputFormat || flags.count || flags.format || flags.pipe || flags.watch || flags.releases;

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

/** `ghfind pkg "<query>"` — npm package search. Pass-through query to the registry. */
async function runPackageSearch(flags: CLIFlags): Promise<void> {
  if (flags.registry !== "npm") {
    console.error(`Registry "${flags.registry}" not yet supported (only npm).`);
    process.exit(1);
  }
  const PKG_SORTS: PackageSortMode[] = ["best-match", "score", "downloads", "name"];
  const pkgSort = flags.sort as PackageSortMode;
  if (!PKG_SORTS.includes(pkgSort)) {
    console.error(`Invalid sort for pkg: "${flags.sort}" (use best-match|score|downloads|name).`);
    process.exit(1);
  }
  const search = createPackageSearch();
  const query = flags.query.trim();
  if (!query) {
    console.error("Usage: ghfind pkg <query> [--json|--csv|--markdown|--count|--format urls|names] [--limit <n>]");
    process.exit(1);
  }
  try {
    const { totalCount, packages } = await search.searchPackage(query, flags.limit);
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
        console.log(`${p.name}@${p.version}  ↓ ${p.downloads.toLocaleString()}  ${p.score.toFixed(2)}  ${p.description ?? ""}`);
      }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/** `ghfind --releases` — check bookmarks for new releases; print the cached feed, then mark all seen. */
async function runReleases(flags: CLIFlags, outputFormat?: ExportFormat): Promise<void> {
  const results = await checkAndNotify({ token: flags.token });
  const releases = allCachedReleases();
  if (outputFormat === "json") {
    console.log(JSON.stringify(releases.map((r) => ({
      fullName: r.fullName, tag: r.tagName, name: r.name,
      url: r.url, publishedAt: r.publishedAt, prerelease: r.prerelease,
    })), null, 2));
    return;
  }
  const unseen = results.reduce((n, r) => n + r.newReleases.length, 0);
  const errors = results.filter((r) => r.error).length;
  console.log(`Checked ${results.length} bookmarked repos — ${unseen} new release${unseen === 1 ? "" : "s"}${errors ? `, ${errors} error${errors === 1 ? "" : "s"}` : ""}.`);
  for (const r of releases) {
    console.log(`${r.fullName}  ${r.prerelease ? "[pre] " : ""}${r.tagName}  ${r.publishedAt.slice(0, 10)}\n  ${r.url}`);
  }
}

async function runNonInteractive(flags: CLIFlags, outputFormat?: ExportFormat) {
  // Dispatch table: each handler receives shared context + flags, returns void.
  const handlers: Record<string, (ctx: SearchContext) => Promise<void>> = {
    trending: async (ctx) => {
      const since = flags.since === "weekly" ? "weekly" : flags.since === "monthly" ? "monthly" : "daily";
      const trendingSearch = createTrendingSearch();
      const response = await trendingSearch.search(
        { keywords: [], qualifiers: [], raw: "trending" },
        { limit: 25, sort: "stars", json: false, verbose: false, trendingSince: since },
      );
      if (outputFormat) {
        console.log(formatOutput(response.repos, outputFormat));
      } else if (flags.count) {
        console.log(response.totalCount);
      } else {
        for (const r of response.repos) {
          console.log(r.fullName + "  ★ " + r.stars + "  ▲ +" + r.score + " " + since + "  ● " + (r.language ?? ""));
        }
      }
    },
    watch: async (ctx) => {
      let tick = 0;
      await runWatch(
        { query: ctx.query, sort: flags.sort, limit: flags.limit, token: flags.token, intervalMs: flags.interval * 1000, trending: flags.trending },
        (repos, delta) => {
          tick++;
          if (outputFormat) {
            console.log(`[Watch #${tick}] ${repos.length} results (${delta >= 0 ? "+" : ""}${delta} since last check)`);
            console.log(formatOutput(repos, outputFormat));
          } else {
            console.log(`[Watch #${tick}] ${repos.length} results — ${delta >= 0 ? "+" : ""}${delta} since last check`);
          }
        },
        (err) => console.error(`[Watch error] ${err.message}`),
      );
    },
    pipe: async (ctx) => {
      const response = await ctx.provider.search(ctx.parsed, {
        limit: flags.limit, sort: flags.sort, json: false, verbose: false, token: flags.token,
      });
      const repos = rankRepos(response.repos, flags.sort);
      await pipeExec(repos, flags.pipe!);
    },
    format: async (ctx) => {
      const response = await ctx.provider.search(ctx.parsed, {
        limit: flags.limit, sort: flags.sort, json: false, verbose: false, token: flags.token,
      });
      const repos = rankRepos(response.repos, flags.sort);
      console.log(formatOutput(repos, flags.format as Format));
    },
    search: async (ctx) => {
      const response = await ctx.provider.search(ctx.parsed, {
        limit: flags.limit, sort: flags.sort, json: false, verbose: false, token: flags.token,
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
      for (const fullName of flags.compare) {
        const res = await search.search(
          { keywords: [fullName], qualifiers: [], raw: fullName },
          { limit: 1, sort: "stars", json: false, verbose: false, token: flags.token },
        );
        repos.push(...res.repos);
      }
      console.log(buildComparisonTable(repos));
    },
  };

  // Determine which handler to run
  const key = flags.compare.length > 0 ? "compare"
    : flags.trending && !flags.watch ? "trending"
    : flags.watch ? "watch"
    : flags.pipe ? "pipe"
    : flags.format ? "format"
    : "search";

  const ctx = buildSearchContext(flags);
  await handlers[key](ctx);
}



main().catch((err) => {
  console.error('DEBUG: uncaught error:', err.message || err);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
