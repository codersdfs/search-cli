/**
 * agent-skill.ts — `ghfind skill`: a compact, token-efficient usage guide for
 * AI coding agents, and the module that owns the skill registry.
 *
 * Coding agents (Claude Code, Cursor, Codex, ...) burn tokens reading
 * `--help` output, most of which explains the interactive TUI they cannot
 * drive. `ghfind skill` prints a distilled, agent-shaped guide covering only
 * the non-interactive surface, so an agent gets everything it needs in ~2 KB.
 *
 * The registry is deliberately generic: the built-in ghfind skill is the
 * seed, and third parties can register their own skills alongside it
 * (`registerSkill`) — the foundation of ghfind-as-an-agent-ecosystem.
 */
import { getVersion } from "./version";

/** One invocable skill in the registry. */
export interface Skill {
  /** Unique id, e.g. "ghfind-cli". Also the `ghfind skill <id>` selector. */
  name: string;
  /** Human-readable display name. */
  title: string;
  /** When the agent should reach for this skill. */
  description: string;
  /** The full skill body, printed to stdout by `ghfind skill <name>`. */
  content: string;
  /** Registrations that are not the built-in ghfind skill. */
  builtin?: boolean;
}

/** Build the built-in ghfind CLI skill. A function so the version is read lazily. */
function buildGhfindSkill(): Skill {
  return {
    name: "ghfind-cli",
    title: "ghfind CLI for agents",
    description:
      "Search GitHub (repos, trending, npm packages, org/user profiles) from the terminal via the `ghfind` command. Use when the user asks to find, compare, or track GitHub repositories or npm packages.",
    builtin: true,
    content: `# ghfind — GitHub search for agents

ghfind searches GitHub from the terminal: repositories, trending, npm
packages, org/user profiles. This guide covers the non-interactive surface
only — ignore anything about a TUI in other docs; agents cannot drive it.

## Search GitHub repositories

    ghfind "QUERY" --json [--limit N] [--sort best-match|stars|updated|forks]

Query language (GitHub search qualifiers):
  language:Rust stars:>1000 topic:cli org:vercel user:torvalds
  repo:facebook/react pushed:>2026-01-01 license:mit archived:false
  "exact phrase" -language:JavaScript        # quotes, negation

Formats: --json | --csv | --markdown | --count | --format urls|names|ssh-urls|clone-commands|ids

## Trending repositories

    ghfind --trending --json [--since daily|weekly|monthly] [--language rust]
    ghfind trending rust --json      # subcommand form of the same thing

## npm packages

    ghfind pkg "QUERY" --json [--limit N] [--sort best-match|score|downloads|name]

## Org & user profiles

    ghfind org vercel --json
    ghfind user torvalds --json

## Compare repositories

    ghfind --compare owner/a owner/b [--json|--csv|--markdown]
Errors if fewer than 2 of the requested repos resolve; unresolved names are
reported in text output and via the error message.

## Deep-dive a repo (languages, contributors, README)

    ghfind deep-dive owner/repo --json
Text output (no flag) prints the same sections formatted for the terminal.

## Finding skills
    ghfind skill search QUERY            # skills installed on this machine
    ghfind skill search QUERY --remote   # the public skills.sh ecosystem
Results carry path+description (local) or install command (registry, read-only --
nothing is installed). The MCP server exposes the same search as
ghfind_skill_search.
## Rate limits

60 req/hr unauthenticated, 5,000 with GITHUB_TOKEN (env var or \`ghfind login\`).
Responses are cached ~5 min, so repeated identical queries are cheap.

## Bookmarking & release tracking

Bookmarks live in ghfind's local state, not GitHub. An agent can read the
release feed with:
    ghfind --releases --json
Marking releases seen and editing bookmarks is a TUI action; skip it.
## Local state (read-only)
    ghfind bookmarks [QUERY] --json    # saved repos, newest first
    ghfind history [QUERY] --json      # past searches
    ghfind saved --json                # named searches
    ghfind topics --json               # popular GitHub topics
    ghfind readme owner/repo           # print a repo README
    ghfind share owner/repo --as gh-cli|markdown|plain|short
These never write local state; skip them when nothing needs reading.

## Token efficiency

Prefer --count when only the number of results matters, --format names when
you only need fullNames, and --limit to cap payload size (default 50, max 100).
`,
  };
}

// ─── Registry ───────────────────────────────────────────────────────────

const registry = new Map<string, Skill>();

/** Register a skill. Overwrites an existing skill with the same name. */
export function registerSkill(skill: Skill): void {
  registry.set(skill.name, skill);
}

/** Get a skill by name, or undefined. */
export function getSkill(name: string): Skill | undefined {
  return registry.get(name);
}

/** All registered skills, built-ins first, then alphabetical. */
export function listSkills(): Skill[] {
  return [...registry.values()].sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Load the built-in ghfind skill into the registry (idempotent). */
export function ensureBuiltinSkill(): void {
  if (!registry.has("ghfind-cli")) {
    registerSkill(buildGhfindSkill());
  }
}

/** Print the skill catalog (one line per skill) for `ghfind skill` with no id. */
export function formatSkillCatalog(): string {
  ensureBuiltinSkill();
  const lines = listSkills().map(
    (s) => `  ${s.name.padEnd(16)} ${s.description}`,
  );
  return [
    "Available agent skills:",
    ...lines,
    "",
    `Run \`ghfind skill <name>\` to print one (ghfind v${getVersion()}).`,
  ].join("\n");
}
