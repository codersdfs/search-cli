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
<tr><td><b>Bookmarks</b></td><td>Space → Bookmark / Bookmarks panel — save repos, tag them</td></tr>
<tr><td><b>Deep-dive</b></td><td>Space → Deep-dive — languages, contributors, README, activity chart</td></tr>
<tr><td><b>Compare</b></td><td>Space → Compare select / Compare view — side-by-side, select 2+ repos</td></tr>
<tr><td><b>Explore</b></td><td>Space → Topics — browse popular GitHub topics</td></tr>
<tr><td><b>History</b></td><td>Space → History — recall past searches</td></tr>
<tr><td><b>Saved</b></td><td>Space → Saved searches — load or save queries</td></tr>
<tr><td><b>Export</b></td><td>Space → Export — JSON, CSV, Markdown to file</td></tr>
<tr><td><b>Share</b></td><td>Space → Share repo — copy repo link to clipboard</td></tr>
<tr><td><b>Org profile</b></td><td>Space → Org profile — org summary: repos, stars, top languages (<code>ghfind org <name></code> in CLI)</td></tr>
<tr><td><b>User profile</b></td><td>User summary like org profile — repos, stars, followers, top languages (<code>ghfind user <name></code>)</td></tr>
<tr><td><b>Notifications</b></td><td>Space → Notifications — view & dismiss alerts</td></tr>
<tr><td><b>Releases</b></td><td><code>--releases</code> — new-release feed for bookmarked repos</td></tr>
<tr><td><b>Graph</b></td><td>Space → Activity graph — commit chart, fullscreen toggle</td></tr>
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
| `Space`               | Open leader menu (contextual actions)          |
| `Tab`                 | Auto-complete search qualifier                 |
| `?` or `Ctrl+H`       | Help overlay                                   |
| `1`–`5`               | Switch trending tabs (Today → All)             |
| `←` / `→` — `h` / `l` | Switch trending tabs (left/right)              |
| `PageUp`              | Jump to top of results                         |
| `PageDown`            | Load next page of results                      |
| `Esc`                 | Close current overlay                          |
| `q`                   | Quit ghfind                                    |

**Leader menu** — press `Space`, navigate with `↑`/`↓`, press `Enter` to dispatch

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

> Most actions are accessed via the **leader menu** (`Space`). This keeps the keymap minimal while providing a full command palette. The leader menu filters actions contextually — items that don't apply (e.g., Bookmark with no repo selected) are hidden.

</details>

---

## Search syntax

```
language:Rust stars:>1000 topic:cli
"machine learning" language:Python stars:>5000
topic:cli -language:JavaScript
org:rust-lang language:Rust
```

Prefix with `-` to exclude. Supported: `language`, `stars`, `fork`, `archived`, `topic`, `user`, `org`, `repo`, `updated`, `pushed`, `visibility`, `license`, `created`, `size`, `in`.

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

Env: `GITHUB_TOKEN`, `GHFIND_CONFIG`, `GHFIND_SKILL_ROOTS` (path-separator separated skill directories for `ghfind skill search`), `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `NO_COLOR` (disables colored `--doctor` output, per [no-color.org](https://no-color.org/))

---

## From source

```bash
git clone https://github.com/codersdfs/search-cli.git
cd ghfind

# With Bun (recommended for TUI)
bun install
bun start        # TUI
bun test         # 414 tests
bun run check    # format check + tests — the green gate
bun run build    # build dist/

# Or with npm
npm install
npm start        # TUI (requires Node 20+)
npm test         # 414 tests
npm run build    # build dist/

> Want to contribute? See [CONTRIBUTING.md](CONTRIBUTING.md) for commands,
> conventions, and the two tracked quality gates (`typecheck`, `lint`).
```

---

## Known limitations

**README image rendering is currently incomplete.** Images that do render look
right, but several common cases silently show nothing:

- **An image wrapped in a link does not render at all.** This is the common
  badge-and-screenshot style: `[![alt](shot.png)](https://example.com)`.
  The whole block is treated as prose and the image is dropped.
- **An image smaller than 100px is skipped**, judged by the `width`/`height`
  the README declares in its `<img>` tag. A README that understates an
  image's size hides that image.
- **SVG is not rendered** — the rasteriser cannot draw it.
- Markdown `![](url)` images have no declared size, so they are downloaded
  before the size check can reject them. A README full of them is slow to open.

A README using none of the above — plain `![]()` images and a few large
banners — renders fine and fast. See
[.issues/tickets/readme-image-rendering.md](.issues/tickets/readme-image-rendering.md)
for the measurements and the remaining work.

---

## Changelog

Recent releases (full history in [CHANGELOG.md](CHANGELOG.md)):

### v9.8.1

- **`ghfind skill search <query>`** finds agent skills by keyword and prints why
  each one matched; `--remote` searches the public [skills.sh](https://skills.sh)
  ecosystem instead, and `GHFIND_SKILL_ROOTS` overrides the scanned directories
- **MCP tool `ghfind_skill_search`** — agents search installed skills or the
  skills.sh registry as soon as they connect; read-only
- **Read-only CLI views of local state** — `ghfind bookmarks`, `ghfind history`,
  `ghfind saved`, `ghfind topics`, plus `ghfind readme <owner/repo>` and
  `ghfind share <owner/repo>`, each with `--json` for agents
- **Shell completions** (bash, zsh, fish) cover every new subcommand and flag
- **README image rendering is incomplete** — see
  [Known limitations](#known-limitations); the v9.8.0 notes wrongly described it
  as working

### v9.8.0

- **README viewer renders real markdown** — headings, emphasis, links, lists, blockquotes, boxed tables, and fenced code now come from OpenTUI's markdown renderable with a theme-derived syntax style instead of a box-drawing text approximation
- **Images render inline — see [Known limitations](#known-limitations)** — relative and `/`-rooted paths resolve against the README's branch, `github.com/.../blob/...` links are rewritten to raw content, downloads are cached and size-capped, SVG and badge-service images are skipped, and anything unloadable falls back to an `🖼 alt` caption; press `i` in the viewer to toggle images
- **No new dependencies** — the PNG decoder, image-to-cells rasteriser, and fetch cache are plain TypeScript, and images draw with truecolor half blocks, so they work on any truecolor terminal without image-protocol support

### v9.7.1

- **In-app update actually works now** — it used to `bun install -g` into `~/.bun` while your running copy lives in an npm prefix, reporting success while nothing changed; it now detects which package manager owns the running install and updates it in place
- **New `ghfind --doctor` check** — flags stale/PATH-shadowing global installs (multiple `ghfind` copies with different versions) and prints the exact uninstall command
- **Windows URL fix** — links with query params were truncated at the first `&` by `cmd /c start`; every pre-filled crash-report/issue link now opens complete
- Fixed `open-url` crashing under Node; CI now enforces lint + typecheck gates (first green Biome baseline)

## License

MIT
