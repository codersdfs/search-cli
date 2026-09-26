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
  pipeExec,
  type Format,
  type ExportFormat,
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
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
import { getBookmarks, searchBookmarks } from "./bookmarks";
import { readHistory } from "./history";
import { getSavedSearches } from "./saved-searches";
import { fetchTopics } from "./explore";
import { fetchReadme } from "./readme";
import { copyToClipboard, formatShare, type ShareFormat } from "./share";
import { repoFromRef } from "./deepdive";
import {
  formatSkillSearchJson,
  formatSkillSearchNames,
  formatSkillSearchText,
  searchSkills,
  type SkillSource,
} from "./skill-finder";

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
  // ?? Read-only local/skill surface (see README "Non-interactive") ??
  bookmarks: boolean; // list bookmarks (ghfind bookmarks)
  history: boolean; // list past searches (ghfind history)
  topics: boolean; // browse popular GitHub topics (ghfind topics)
  saved: boolean; // list saved searches (ghfind saved)
  readme?: string; // print a repo README (ghfind readme <owner/repo>)
  share?: string; // print a share snippet (ghfind share <owner/repo>)
  skillSearch?: string; // skill search query (ghfind skill search <query>)
  sharedAs?: string; // --as <format> for share
  remote: boolean; // skill search: hit skills.sh instead of this machine
  local: boolean; // skill search: force the local scan (the default)
  copy: boolean; // share: also write the snippet to the clipboard
  raw: boolean; // readme: print the raw markdown with no header
  /** True when --limit was passed (history uses a smaller default than search). */
  limitExplicit: boolean;
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
    bookmarks: false,
    history: false,
    topics: false,
    saved: false,
    remote: false,
    local: false,
    copy: false,
    raw: false,
    limitExplicit: false,
  };

  const queryParts: string[] = [];
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
        const parsed = parseInt(args[++i], 10);
        flags.limitExplicit = true;
        if (Number.isNaN(parsed) || parsed < 1 || parsed > 100) {
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
      case "--remote":
        flags.remote = true;
        break;
      case "--local":
        flags.local = true;
        break;
      case "--copy":
        flags.copy = true;
        break;
      case "--raw":
        flags.raw = true;
        break;
      case "--as":
        flags.sharedAs = args[++i];
        break;
      case "mcp":
        flags.mcp = true;
        break;
      case "bookmarks":
        flags.bookmarks = true;
        break;
      case "history":
        flags.history = true;
        break;
      case "topics":
        flags.topics = true;
        break;
      case "saved":
        flags.saved = true;
        break;
      case "readme": {
        // Single repo ref; a following flag means none was given.
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          flags.readme = next;
          i++;
        } else {
          flags.readme = "";
        }
        break;
      }
      case "share": {
        // Single repo ref; a following flag means none was given.
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          flags.share = next;
          i++;
        } else {
          flags.share = "";
        }
        break;
      }
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
        // `skill search <query>` searches the skill registry; plain `skill`
        // lists the catalog and `skill <name>` prints one skill's guide.
        const next = args[i + 1];
        if (next === "search") {
          i++;
          const query = args[i + 1];
          if (query && !query.startsWith("-")) {
            flags.skillSearch = query;
            i++;
          } else {
            flags.skillSearch = "";
          }
          break;
        }
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
  ghfind bookmarks [query]         Saved repos, newest first
  ghfind history [query]           Past searches, newest first
  ghfind topics                    Browse popular GitHub topics
  ghfind saved                     Named searches saved in the TUI
  ghfind readme <owner/repo>       Print a repository README
  ghfind share a/b --as gh-cli     Share snippet (--copy to clipboard)
  ghfind skill search <query>      Find skills locally, or --remote
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
  --remote                             skill search: query skills.sh instead of this machine
  --local                              skill search: force the local scan (default)
  --as <fmt>                           share format: markdown|plain|gh-cli|short
  --copy                               share: also copy the snippet to the clipboard
  --raw                                readme: print the raw markdown with no header
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

  // Skill search — find skills on this machine or in the skills.sh ecosystem
  if (flags.skillSearch !== undefined) {
    await runSkillSearch(flags);
    return;
  }
  // Agent skill guide — token-efficient usage doc for coding agents
  if (flags.skill !== undefined) {
    printAgentSkill(flags.skill);
    return;
  }
  // Read-only local state: bookmarks / history / saved searches
  if (flags.bookmarks) {
    runBookmarks(flags);
    return;
  }
  if (flags.history) {
    runHistory(flags);
    return;
  }
  if (flags.saved) {
    runSavedSearches(flags);
    return;
  }
  // Popular GitHub topics
  if (flags.topics) {
    await runTopics(flags);
    return;
  }
  // README and share-snippet views (parity with the TUI `r` / `y` actions)
  if (flags.readme !== undefined) {
    await runReadme(flags);
    return;
  }
  if (flags.share !== undefined) {
    await runShare(flags);
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
    const user = flags.user ?? "";
    if (!user) {
      console.error("Usage: ghfind user <name> [--json] [--token <t>]");
      process.exit(1);
    }
    const profile = await fetchUserProfile(user, {
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
    const org = flags.org ?? "";
    if (!org) {
      console.error("Usage: ghfind org <name> [--json] [--token <t>]");
      process.exit(1);
    }
    const profile = await fetchOrgProfile(org, {
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
  const ref = flags.deepDive;
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

/** `ghfind skill search <query>` — find skills locally, or in skills.sh with --remote. */
async function runSkillSearch(flags: CLIFlags): Promise<void> {
  const query = flags.skillSearch ?? "";
  if (!query.trim()) {
    console.error(
      "Usage: ghfind skill search <query> [--remote] [--limit <n>] [--json]",
    );
    process.exit(1);
  }
  if (flags.remote && flags.local) {
    console.error(
      "Contradictory flags: pass either --remote or --local, not both.",
    );
    process.exit(1);
  }
  const source: SkillSource = flags.remote ? "registry" : "local";
  try {
    const result = await searchSkills(query, {
      source,
      limit: flags.limit,
    });
    if (flags.json) {
      console.log(formatSkillSearchJson(result));
    } else if (flags.format === "names") {
      console.log(formatSkillSearchNames(result));
    } else {
      console.log(formatSkillSearchText(result));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/** `ghfind bookmarks [query]` — the saved repos, newest first. */
function runBookmarks(flags: CLIFlags): void {
  const query = flags.query.trim();
  const bookmarks = query ? searchBookmarks(query) : getBookmarks();
  if (flags.json) {
    console.log(JSON.stringify(bookmarks, null, 2));
    return;
  }
  if (bookmarks.length === 0) {
    console.log(
      query
        ? `No bookmarks match "${query}".`
        : "No bookmarks yet. Press Space → Bookmark in the TUI to save one.",
    );
    return;
  }
  if (flags.csv || flags.markdown) {
    const header = ["full_name", "stars", "language", "tags", "saved_at"];
    const rows = bookmarks.map((b) => [
      b.repo.fullName,
      String(b.repo.stars),
      b.repo.language ?? "",
      b.tags.join(" "),
      new Date(b.savedAt).toISOString().slice(0, 10),
    ]);
    console.log(
      flags.csv ? rowsToCsv(header, rows) : rowsToMarkdown(header, rows),
    );
    return;
  }
  for (const b of bookmarks) {
    const tags = b.tags.length > 0 ? `  [${b.tags.join(", ")}]` : "";
    console.log(
      `${b.repo.fullName}  — ${b.repo.stars.toLocaleString()}  ${b.repo.language ?? "n/a"}${tags}`,
    );
  }
}

/** `ghfind history [query]` — past searches, newest first. */
function runHistory(flags: CLIFlags): void {
  // History entries are short; 20 is plenty unless the caller says otherwise.
  const limit = flags.limitExplicit ? flags.limit : 20;
  const query = flags.query.trim().toLowerCase();
  const entries = readHistory()
    .filter((e) => !query || e.query.toLowerCase().includes(query))
    .slice(0, limit);
  if (flags.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log(
      query ? `No history matches "${query}".` : "No search history yet.",
    );
    return;
  }
  if (flags.csv || flags.markdown) {
    const header = ["query", "mode", "results", "when"];
    const rows = entries.map((e) => [
      e.query,
      e.mode,
      String(e.resultCount),
      new Date(e.timestamp).toISOString(),
    ]);
    console.log(
      flags.csv ? rowsToCsv(header, rows) : rowsToMarkdown(header, rows),
    );
    return;
  }
  for (const e of entries) {
    const when = new Date(e.timestamp).toISOString().slice(0, 10);
    console.log(
      `${e.query}  — ${e.mode}  — ${e.resultCount} results  — ${when}`,
    );
  }
}

/** `ghfind saved` — named searches saved in the TUI. */
function runSavedSearches(flags: CLIFlags): void {
  const saved = getSavedSearches();
  if (flags.json) {
    console.log(JSON.stringify(saved, null, 2));
    return;
  }
  if (saved.length === 0) {
    console.log("No saved searches yet. Save one from the TUI command menu.");
    return;
  }
  if (flags.csv || flags.markdown) {
    const header = ["name", "query", "mode", "limit"];
    const rows = saved.map((s) => [s.name, s.query, s.mode, String(s.limit)]);
    console.log(
      flags.csv ? rowsToCsv(header, rows) : rowsToMarkdown(header, rows),
    );
    return;
  }
  for (const s of saved) {
    console.log(`${s.name}  — ${s.query}  — ${s.mode}  — limit ${s.limit}`);
  }
}

/** CSV for the small local-state tables (repos use output.ts's richer schema). */
function rowsToCsv(header: string[], rows: string[][]): string {
  const quote = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [header, ...rows].map((row) => row.map(quote).join(",")).join("\n");
}

/** Markdown table for the same small local-state tables. */
function rowsToMarkdown(header: string[], rows: string[][]): string {
  return [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

/** Clip a string to `width` characters, ending on an ellipsis when cut. */
function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, width - 1).trimEnd()}\u2026`;
}

/** GitHub topic blurbs are HTML; flatten them to one plain text line. */
function plainText(html: string): string {
  return html
    .replace(/<\/p>|<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `ghfind topics` — popular GitHub topics. */
async function runTopics(flags: CLIFlags): Promise<void> {
  try {
    const topics = (await fetchTopics()).slice(0, flags.limit);
    if (flags.json) {
      console.log(JSON.stringify(topics, null, 2));
      return;
    }
    if (topics.length === 0) {
      console.log("No topics returned.");
      return;
    }
    for (const t of topics) {
      // Blurbs run to paragraphs; text output stays readable by clipping.
      const description = truncate(plainText(t.description), 140);
      console.log(description ? `${t.name}  ${description}` : t.name);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/** `ghfind readme <owner/repo>` — print a repository README. */
async function runReadme(flags: CLIFlags): Promise<void> {
  const ref = flags.readme ?? "";
  if (!ref) {
    console.error(
      "Usage: ghfind readme <owner/repo> [--json] [--raw] [--token <t>]",
    );
    process.exit(1);
  }
  try {
    const { owner, name } = repoFromRef(ref); // validates the ref
    const readme = await fetchReadme(owner, name, { token: flags.token });
    if (!readme) {
      console.error(`No README found for ${owner}/${name}.`);
      process.exit(1);
    }
    if (flags.json) {
      console.log(
        JSON.stringify(
          { owner, name, sourceUrl: readme.sourceUrl, text: readme.text },
          null,
          2,
        ),
      );
      return;
    }
    if (!flags.raw) {
      console.log(`# ${owner}/${name} README (${readme.sourceUrl})`);
      console.log("");
    }
    console.log(readme.text);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/** `ghfind share <owner/repo> [--as markdown|plain|gh-cli|short] [--copy]` */
async function runShare(flags: CLIFlags): Promise<void> {
  const ref = flags.share ?? "";
  if (!ref) {
    console.error(
      "Usage: ghfind share <owner/repo> [--as markdown|plain|gh-cli|short] [--copy]",
    );
    process.exit(1);
  }
  const SHARE_FORMATS: ShareFormat[] = ["markdown", "plain", "gh-cli", "short"];
  const as = (flags.sharedAs ?? "markdown") as ShareFormat;
  if (!SHARE_FORMATS.includes(as)) {
    console.error(
      `Invalid --as value: "${flags.sharedAs}" (use markdown|plain|gh-cli|short).`,
    );
    process.exit(1);
  }
  try {
    repoFromRef(ref); // validate before the network round-trip
    const repo = await resolveRepoFromRef(ref, flags.token);
    const text = formatShare(repo, as);
    console.log(text);
    if (flags.copy) {
      const copied = await copyToClipboard(text);
      console.error(
        copied
          ? "Copied to clipboard."
          : "Could not copy to the clipboard on this platform.",
      );
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
    trending: async (_ctx) => {
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
      if (flags.pipe) await pipeExec(repos, flags.pipe);
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
