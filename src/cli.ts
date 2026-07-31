#!/usr/bin/env node
/** CLI entry point — routes between TUI browser and non-interactive modes. */
import { parseQuery, applyFlagFilters, rankRepos, createGitHubSearch, createTrendingSearch } from "./search";
import { format as formatOutput, exportToFile, pipeExec, type Format, type ExportFormat, type FormatLine } from "./output";
import { runWatch } from "./watch";
import { runInitWizard } from "./init";
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
  interval: number;
  completion?: string;
  init: boolean;
  version: boolean;
  help: boolean;
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
    interval: 300,
    init: false,
    version: false,
    help: false,
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
      case "--interval": flags.interval = parseInt(args[++i]) || 300; break;
      case "--completion": flags.completion = args[++i]; break;
      default:
        if (!arg.startsWith("-")) queryParts.push(arg);
    }
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
  ghfind --watch <query>           Watch mode (poll every Ns)
  ghfind init                      Run setup wizard
  ghfind --completion <shell>      Print completion script (bash|zsh|fish)
  ghfind --version                 Print version
  ghfind --help                    Print this help

Options:
  --json, --csv, --markdown, --count   Output format
  --limit <n>                          Max results (default: 50)
  --sort <strategy>                    Sort: best-match|stars|updated|forks
  --token <token>                      GitHub API token
  --trending                           Trending mode
  --since <period>                     Trending period: daily|weekly|monthly
  --pipe <target>                      Pipe target: clone|open
  --format <fmt>                       Line format: urls|names|ssh-urls|...
  --watch                              Watch mode (re-run periodically)
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

  // Determine output format
  const outputFormat: ExportFormat | undefined =
    flags.json ? "json" : flags.csv ? "csv" : flags.markdown ? "markdown" : undefined;
  const isNonInteractive = outputFormat || flags.count || flags.format || flags.pipe || flags.watch;

  // Non-interactive mode
  if (isNonInteractive) {
    await runNonInteractive(flags, outputFormat);
    return;
  }

  // Default: launch interactive TUI
  await launchBrowser();
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
  };

  // Determine which handler to run
  const key = flags.trending && !flags.watch ? "trending"
    : flags.watch ? "watch"
    : flags.pipe ? "pipe"
    : flags.format ? "format"
    : "search";

  const ctx = buildSearchContext(flags);
  await handlers[key](ctx);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
