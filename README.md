# ghfind

> Search GitHub repos from your terminal. No browser needed.

<p align="center">
  <a href="https://x.com/frankli23709971">
    <img src="https://img.shields.io/badge/made%20by-%40frankli23709971-000000?logo=x&labelColor=000000&color=000000&link=https://x.com/frankli23709971" alt="Made by @frankli23709971">
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/github-search-cli"><img src="https://img.shields.io/npm/v/github-search-cli.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/github-search-cli"><img src="https://img.shields.io/npm/dw/github-search-cli.svg" alt="npm weekly downloads"></a>
  <a href="https://github.com/codersdfs/search-cli/actions/workflows/release.yml"><img src="https://github.com/codersdfs/search-cli/actions/workflows/release.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript strict">
  <a href="https://github.com/codersdfs/search-cli/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/github-search-cli.svg" alt="License"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/codersdfs/search-cli/main/demo.svg" alt="ghfind demo" width="100%">
</p>

## Install

```bash
npm install -g github-search-cli
```

Or via the **curl installer** (Linux/macOS — downloads the standalone
binary, verifies its SHA256 against the release checksums, no Node
needed):

```bash
curl -fsSL https://raw.githubusercontent.com/codersdfs/search-cli/main/scripts/install.sh | sh
```

Or grab a **standalone binary** (no Node.js needed) from [GitHub Releases](https://github.com/codersdfs/search-cli/releases) — `ghfind-<os>-<arch>` executables for Linux, macOS, and Windows.

## Why ghfind?

|                                             | `ghfind` | `gh search` (GitHub CLI) | `hub` |
| ------------------------------------------- | -------- | ------------------------ | ----- |
| Repo search + qualifiers                    | ✅       | ✅                       | ❌    |
| Trending repos (day/week/month/year)        | ✅       | ❌                       | ❌    |
| Full-screen TUI, keyboard-driven            | ✅       | ❌                       | ❌    |
| Bookmarks, tags & release tracking          | ✅       | ❌                       | ❌    |
| Side-by-side repo compare (JSON/CSV/MD)     | ✅       | ❌                       | ❌    |
| Deep-dive (languages, contributors, README) | ✅       | ❌                       | ❌    |
| npm package search                          | ✅       | ❌                       | ❌    |
| Org profile                                 | ✅       | ✅                       | ❌    |
| User profile                                | ✅       | ❌                       | ❌    |
| Pipeable JSON / CSV / Markdown export       | ✅       | JSON only                | ❌    |
| No login required                           | ✅       | ❌                       | ❌    |

> **No separate runtime needed!** Only requires Node.js 20+. The TUI needs Bun,
> which is downloaded automatically at install time. Non-interactive modes work
> with just Node.js.
>
> | Platform       | TUI               | CLI modes |
> | -------------- | ----------------- | --------- |
> | Node 20+       | ⚠ Bun required    | ✅        |
> | Bun            | ✅                | ✅        |
> | Downloaded Bun | ✅ auto-installed | ✅        |

## Use

```bash
# TUI
ghfind

# pipe
ghfind "language:Rust stars:>1000" --json | jq '.[].fullName'
ghfind "language:Zig" --count
ghfind --trending --json --since weekly
ghfind login                    # import the gh CLI token or paste one
ghfind org vercel               # org profile: repos, stars, top languages
ghfind user torvalds            # user profile: repos, stars, followers
```

### Non-interactive

```bash
ghfind "query" --json        # JSON
ghfind "query" --csv         # CSV
ghfind "query" --markdown    # Markdown
ghfind "query" --count       # count only
ghfind "query" --format urls # one URL per line
ghfind "query" --pipe open   # open in browser
ghfind "query" --pipe clone  # clone commands
ghfind clone facebook/react # clone the repo into ./react (--dir, --ssh)
ghfind --trending --json     # trending as JSON
ghfind trending rust --json  # trending, filtered by language
ghfind --watch "query"       # poll every 300s
ghfind --releases            # new releases for bookmarked repos
ghfind --compare a/b c/d     # side-by-side comparison
ghfind --compare a/b c/d --json # comparison as JSON|CSV|Markdown
ghfind deep-dive a/b --json  # deep-dive: languages, contributors, README
ghfind pkg "query" --json    # npm package search as JSON
# Read-only local state
ghfind bookmarks             # saved repos, newest first
ghfind history --limit 20    # past searches
ghfind saved                 # named searches saved in the TUI
ghfind topics                # popular GitHub topics
ghfind readme a/b            # print a repo README (--raw for no header)
ghfind share a/b --as gh-cli # share snippet (--copy also copies it)
# Agent skills
ghfind skill search testing      # skills installed on this machine
ghfind skill search testing --remote --json  # the skills.sh ecosystem
```

`bookmarks`, `history`, `saved`, `topics`, `readme` and `share` are read-only:
they print what the TUI has stored but never modify local state.

## Use with AI agents

ghfind speaks the [Model Context Protocol](https://modelcontextprotocol.io) —
any MCP client (Claude Code, Cursor, Codex, …) can call its GitHub search
as tools:

```bash
claude mcp add ghfind -- ghfind mcp
```

or in your MCP client config:

```json
{
  "mcpServers": {
    "ghfind": { "command": "ghfind", "args": ["mcp"] }
  }
}
```

Exposed tools: `ghfind_search_repos`, `ghfind_trending`,
`ghfind_npm_packages`, `ghfind_org_profile`, `ghfind_user_profile`,
`ghfind_compare_repos`, `ghfind_deep_dive`, `ghfind_bookmarked_releases`,
`ghfind_skill` (a token-efficient CLI usage guide for agents), and
`ghfind_skill_search` (find agent skills, either installed on this machine or
in the public skills.sh ecosystem ? read-only, it never installs anything).
Unauthenticated requests are rate-limited to 60/hr — set `GITHUB_TOKEN`
in the environment for 5,000/hr.

CLI-first agents can skip MCP entirely:

```bash
ghfind skill                      # list agent skills
ghfind skill ghfind-cli           # print the token-efficient CLI guide
ghfind skill search testing       # search installed skills (local scan)
ghfind skill search testing --remote --limit 10 --json  # search skills.sh
```

`ghfind skill search` matches skill names first, then descriptions, and reads
the `SKILL.md` files under `~/.codex/skills`, `~/.agents/skills`,
`<project>/.codex/skills` and `<project>/.github/skills` (in that priority
order, de-duplicated by name). `--remote` queries the public
[skills.sh](https://skills.sh) ecosystem instead and returns the
`npx skills add` command for each hit, without installing anything. Set
`GHFIND_SKILL_ROOTS` to override which directories are scanned.

### Completions

```bash
source <(ghfind --completion bash)
source <(ghfind --completion zsh)
ghfind --completion fish | source
```

---

## Features

<table>
<tr><td><b>Search</b></td><td>Free-text + qualifiers (<code>language:</code>, <code>stars:</code>, <code>topic:</code>), sort by stars/updated/forks</td></tr>
<tr><td><b>Trending</b></td><td>Today, week, month, year — filter by language</td></tr>
<tr><td><b>Packages</b></td><td>npm registry search (beta) — <code>ghfind pkg "query"</code></td></tr>
<tr><td><b>Bookmarks</b></td><td>Menu → Bookmark / Bookmarks panel — save repos, tag them</td></tr>
<tr><td><b>Deep-dive</b></td><td>Menu → Deep-dive — languages, contributors, README, activity chart</td></tr>
<tr><td><b>Compare</b></td><td>Menu → Compare select / Compare view — side-by-side, select 2+ repos</td></tr>
<tr><td><b>Explore</b></td><td>Menu → Topics — browse popular GitHub topics</td></tr>
<tr><td><b>History</b></td><td>Menu → History — recall past searches</td></tr>
<tr><td><b>Saved</b></td><td>Menu → Saved searches — load or save queries</td></tr>
<tr><td><b>Export</b></td><td>Menu → Export — JSON, CSV, Markdown to file</td></tr>
<tr><td><b>Share</b></td><td>Menu → Share repo — copy repo link to clipboard</td></tr>
<tr><td><b>Org profile</b></td><td>Menu → Org profile — org summary: repos, stars, top languages (<code>ghfind org <name></code> in CLI)</td></tr>
<tr><td><b>User profile</b></td><td>User summary like org profile — repos, stars, followers, top languages (<code>ghfind user <name></code>)</td></tr>
<tr><td><b>Notifications</b></td><td>Menu → Notifications — view & dismiss alerts</td></tr>
<tr><td><b>Releases</b></td><td><code>--releases</code> — new-release feed for bookmarked repos</td></tr>
<tr><td><b>Graph</b></td><td>Menu → Activity graph — commit chart, fullscreen toggle</td></tr>
<tr><td><b>Help</b></td><td><code>?</code> / <code>Ctrl+H</code> — keybindings reference</td></tr>
<tr><td><b>Watch</b></td><td><code>--watch</code> — poll for new results</td></tr>
<tr><td><b>MCP server</b></td><td><code>ghfind mcp</code> — GitHub search as tools for AI agents (Claude Code, Cursor, …)</td></tr>
<tr><td><b>Agent skill</b></td><td><code>ghfind skill</code> — token-efficient CLI usage guide for coding agents</td></tr>
<tr><td><b>Skill search</b></td><td><code>ghfind skill search &lt;query&gt;</code> — find installed skills, or <code>--remote</code> for the skills.sh ecosystem (also <code>ghfind_skill_search</code> over MCP)</td></tr>
<tr><td><b>Read-only state</b></td><td><code>ghfind bookmarks|history|saved|topics</code> — print local state and popular topics without modifying anything</td></tr>
<tr><td><b>README &amp; share</b></td><td><code>ghfind readme a/b</code> and <code>ghfind share a/b --as gh-cli</code> — the TUI's <code>r</code> / <code>y</code> actions from the shell</td></tr>
</table>

<details>
<summary>Keybindings</summary>

**Landing screen** (the mode menu shown on launch)

| Key                   | Action                       |
| --------------------- | ---------------------------- |
| `↑` / `↓` — `j` / `k` | Navigate mode cards          |
| `Enter`               | Select mode / open Bookmarks |
| `b`                   | Jump straight to Bookmarks   |
| `?` or `h`            | Help overlay                 |
| `q`                   | Quit ghfind                  |

**Global shortcuts** (main view, no overlay active)

| Key                   | Action                                         |
| --------------------- | ---------------------------------------------- |
| `/`                   | Focus search input                             |
| `Enter`               | Execute search / open selected repo in browser |
| `↑` / `↓` — `j` / `k` | Navigate results & menus                       |
| `Esc`                 | Open / close leader menu (contextual actions)  |
| `Tab`                 | Auto-complete search qualifier                 |
| `Ctrl+E`              | Export results (JSON / CSV / Markdown / text)  |
| `?` or `Ctrl+H`       | Help overlay                                   |
| `1`–`5`               | Switch trending tabs (Today → All)             |
| `←` / `→` — `h` / `l` | Switch trending tabs (left/right)              |
| `PageUp`              | Jump to top of results                         |
| `PageDown`            | Load next page of results                      |
| `q`                   | Quit ghfind                                    |

**Mouse** — every list is clickable, and the keyboard and mouse are interchangeable

| Input                                   | Action                                    |
| --------------------------------------- | ----------------------------------------- |
| Click                                   | Select a row / card / trending tab        |
| Double-click                            | Open the repo, or run the action          |
| Scroll wheel                            | Move the selection, or scroll a long pane |
| Click outside an overlay                | Dismiss it (same as `Esc`)                |
| Click the query box                     | Focus the search input                    |
| Click <kbd>☰ menu</kbd> (bottom-right) | Open the leader menu                      |

**Error recovery** — active only while the matching error is in the status bar

| Key | Action                                        |
| --- | --------------------------------------------- |
| `r` | Retry the failed search / trending load       |
| `t` | Fix the GitHub token (401 bad token, 403 SSO) |
| `u` | Search without a token (401)                  |
| `c` | Change token (rate limit)                     |

**Leader menu** — press `Esc` (or click <kbd>☰ menu</kbd>), navigate with `↑`/`↓`, press `Enter` to dispatch

Actions shown depend on current mode (search vs trending) and selection:

| Menu item       | Description                                             |
| --------------- | ------------------------------------------------------- |
| Sort            | Cycle sort strategy (best-match, stars, updated, forks) |
| Limit           | Cycle result limit (10, 25, 50, 100)                    |
| Refresh         | Re-run current search (or reload trending)              |
| Toggle trending | Switch between search and trending views                |
| Deep-dive       | Show languages, contributors, README excerpt            |
| Readme          | Full markdown README viewer (inline images included)    |
| Activity graph  | Toggle commit chart fullscreen                          |
| Bookmark        | Save / unsave selected repo                             |
| Compare         | Add/remove repo to comparison set                       |
| Compare view    | Show side-by-side comparison table                      |
| Open in browser | Open selected repo URL                                  |
| Clone           | Clone the repo to disk (into the cwd)                   |
| History         | Recall past searches                                    |
| Saved searches  | Load a saved search                                     |
| Save search     | Save current query                                      |
| Export          | Export results to JSON / CSV / Markdown                 |
| Share repo      | Copy repo link to clipboard                             |
| Org profile     | Org summary — repos, total stars, top languages         |
| Notifications   | View and dismiss alerts                                 |
| Topics          | Browse popular GitHub topics                            |
| Bookmarks panel | Browse saved bookmarks                                  |
| Help            | Keybindings reference                                   |

**Overlay-specific shortcuts**

| Key                              | Context                                              | Action                                      |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `Esc` / `q`                      | Any overlay                                          | Close overlay                               |
| `Enter`                          | Leader / History / Saved / Export / Topics / Share   | Confirm selection                           |
| `d`                              | History / Bookmarks / Saved searches / Notifications | Delete current entry                        |
| `Ctrl+X`                         | History                                              | Clear all history                           |
| `Ctrl+C`                         | Notifications                                        | Dismiss all notifications                   |
| `i`                              | README viewer                                        | Toggle inline images on/off                 |
| `Y` / `N` / `L`                  | Update modal                                         | Yes (install) / No (skip) / Later (dismiss) |
| `↑` / `↓` — `j` / `k`            | Update modal                                         | Scroll release notes                        |
| `PgUp` / `PgDn` / `Home` / `End` | Update modal                                         | Jump through release notes                  |

Trending tabs: `1`–`5` (Today → All) or `←`/`→` — `h`/`l`

> Most actions are accessed via the **leader menu** (`Esc`, or the <kbd>☰ menu</kbd> button in the bottom-right corner). This keeps the keymap minimal while providing a full command palette. The leader menu filters actions contextually — items that don't apply (e.g., Bookmark with no repo selected) are hidden.

</details>

---

## Search syntax

```
language:Rust stars:>1000 topic:cli
"machine learning" language:Python stars:>5000
topic:cli -language:JavaScript
org:rust-lang language:Rust
```

Prefix with `-` to exclude. Supported: `language`, `stars`, `forks`, `topics`, `followers`, `size`, `fork`, `archived`, `topic`, `user`, `org`, `repo`, `updated`, `pushed`, `visibility`, `license`, `created`, `in`.

Queries are parsed and checked before the request is sent:

- **Qualifier typos are corrected** — `langauge:Rust` → `language:Rust`,
  `star:1000` → `stars:1000`. Correction is limited to the qualifiers listed
  above, so `is:`, `has:` and `props.*` pass through untouched.
- **Counts accept `k`/`m`** — `stars:10k` means 10,000 or more. A bare count
  keeps GitHub's exact-match meaning, so use `stars:>=100` or `stars:10k`
  rather than `stars:100`.
- **An invalid value is rejected with the fix**, not sent to GitHub:
  `⚠ Invalid query: "stars:abc" is not a number — use stars:100, stars:>=100, or stars:1k..10k`
- **An empty result suggests how to loosen the query** — qualifiers are ranked
  by how sharply they narrow results, and the message offers a concrete retry.

See [docs/HOW-TO.md](docs/HOW-TO.md) for a task-oriented walkthrough.

---

## Config

`~/.config/ghfind/config.json` (auto-created, or run `ghfind init`; `ghfind login` will set your GitHub token):

```json
{
  "defaultSort": "stars",
  "defaultLimit": 50,
  "theme": "tokyo-night",
  "githubToken": "ghp_..."
}
```

Env: `GITHUB_TOKEN`, `GHFIND_CONFIG`, `GHFIND_LOG` (path — write TUI diagnostics there; unset by default), `GHFIND_SKILL_ROOTS` (path-separator separated skill directories for `ghfind skill search`), `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `NO_COLOR` (disables colored `--doctor` output, per [no-color.org](https://no-color.org/))

---

## From source

```bash
git clone https://github.com/codersdfs/search-cli.git
cd ghfind

# With Bun (recommended for TUI)
bun install
bun start        # TUI
bun test         # 705 tests
bun run check    # format check + tests — the green gate
bun run build    # build dist/

# Or with npm
npm install
npm start        # TUI (requires Node 20+)
npm test         # 705 tests
npm run build    # build dist/

> Want to contribute? See [CONTRIBUTING.md](CONTRIBUTING.md) for commands,
> conventions, and the two tracked quality gates (`typecheck`, `lint`).
```

---

## Known limitations

README image rendering has one deliberate blind spot and one hard one:

- **Images smaller than 100 px on any edge are skipped.** For `<img>` tags the
  declared `width`/`height` is trusted, so an image that understates its size
  is hidden (a README that _overstates_ nothing is never affected). Markdown
  `![]()` images declare no size, so they are measured from the image header
  instead — still before any pixels are decoded.
- **SVG is not rendered** — the rasteriser cannot draw it, so SVGs (and
  badge-service images, which are tiny SVGs with text baked in) show an
  `🖼 alt` caption instead.

An image wrapped in a link — `[![alt](shot.png)](url)`, the badge-and-screenshot
style — renders fine and keeps its link: the image cells carry an OSC 8
hyperlink, so clicking it opens the target in your browser. See
[.issues/tickets/readme-image-rendering.md](.issues/tickets/readme-image-rendering.md)
for the architecture, measurements, and remaining work.

---

## Changelog

Recent releases (full history in [CHANGELOG.md](CHANGELOG.md)):

### v9.10.3

- **The help overlay lists `Ctrl+E`** — the utility-keys section documented `t`, `Ctrl+X` and `Ctrl+C` but not the export shortcut the startup tip and the README already advertised

### v9.10.2

- **`Ctrl+E` opens the export chooser** — the startup tip advertised "Press Ctrl+E to export results as CSV or Markdown", but nothing bound the chord: it was ignored on the results screen and, while the query input had focus, its emacs binding read it as "move to line end"; it now opens the export overlay (JSON / CSV / Markdown / plain text), or reports that there is nothing to export yet

### v9.10.1

- **`--interval` is parsed again** — it was documented in `--help`, the README, the how-to guide and all three shell completions, but `parseArgs` had no case for it, so `ghfind --watch --interval 60` searched for the literal string `--interval 60` and polled at the default 300s anyway
- **A flag typo no longer opens a GitHub issue tab** — `--format jsonn` threw mid-run and routed into the crash-report flow (printing "ghfind encountered an unexpected error" and opening a prefilled issue page); `--pipe clonee` silently did nothing and exited 0; both now validate up front, list the valid values, and exit 1
- **An empty query fails fast instead of faking a network error** — `ghfind --count` with no query sent `q=" "`, got a 422 back, and looped on `⚠ Network error — check your connection. Retrying in 5s...`; the search/format/pipe/watch handlers now print a usage hint instead
- **Bare `ghfind --trending` opens the trending view** instead of falling through to the landing menu, as documented
- **`--since` validates `daily|weekly|monthly`** instead of silently accepting anything and falling back to daily — the same treatment `--sort` already had
- **`--watch --trending --since weekly` polls weekly** — the trending period used to be derived from the query string, so `--since` was ignored in watch mode
- **The MCP `ghfind_user_profile` tool returns formatted text**, matching `ghfind_org_profile` and the CLI's default `ghfind user` output; the raw JSON still rides along in `data`
- **Quit paths release the terminal** — the main TUI, the trending view and the package browser call `renderer.destroy()` before exiting, and the trending footer's `/` hint now matches the scroll-to-top key it actually binds

## License

MIT
