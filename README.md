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
bun test         # 657 tests
bun run check    # format check + tests — the green gate
bun run build    # build dist/

# Or with npm
npm install
npm start        # TUI (requires Node 20+)
npm test         # 657 tests
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

- **The TUI is now fully clickable** — the mouse was already enabled (OpenTUI emitted and hit-tested every event) but nothing consumed them, so they were silently discarded; click selects, double-click opens, the wheel scrolls, and clicking outside an overlay closes it
- **Clicks reuse the keyboard's own code paths** — a click calls `setSelectedIndex`, which emits the same `selectionChanged` event `↑`/`↓` does, so the detail pane, graph and packages view work identically with no parallel mouse branch to drift
- **Every surface responds** — results, landing mode cards, trending tabs, the update dialog's buttons, and all seven overlay lists (history, bookmarks, saved searches, topics, export, share, command menu), with hover highlighting and a pointer cursor
- **A <kbd>☰ menu</kbd> button in the bottom-right corner** opens the command menu; it floats above the layout and hides while an overlay is open
- **The scroll wheel no longer scrolls the wrong pane** — a pre-existing bug: scroll events that hit nothing fell through to the focused renderable, so scrolling in the README viewer moved the _result selection_ instead of the README
- **Clicks over read-only text now register** — every `TextRenderable` defaults to OpenTUI's text-selection mode, which consumed left-presses as a selection drag before ghfind's handlers ran, so the detail pane and comparison table ignored clicks entirely
- **`Space` now always types a space, and `Esc` opens the command menu** — `Space` opened the menu only while the query input was unfocused, and the only thing that unfocused it was clicking a result row, so `Space` worked only after a mouse click; `Esc` already closed every overlay, so it gains a meaning rather than losing one
- **A hover highlight no longer painted lists magenta** — OpenTUI's colour parser accepts only hex and CSS names, so an `rgba()` tint fell through to its magenta fallback

### v9.9.0

- **Queries are understood before they are sent** — every surface (TUI, CLI, MCP, `--watch`) parses and checks a query first, so a typo or bad value fails with a specific message and a fix instead of an opaque GitHub 422 or a misleading "network error"; previously only the TUI ran validation at all
- **Qualifier typos are corrected** — `langauge:Rust` → `language:Rust`, `star:1000` → `stars:1000`, `push:>` → `pushed:>`; correction is limited to the qualifiers ghfind knows, so `is:`, `has:` and `props.*` are never mangled
- **Counts accept `k`/`m`** — `stars:10k` → `stars:>=10000`, `size:1m`, `stars:1k..10k`; a bare count keeps GitHub's exact-match meaning, so `stars:100` is still exactly 100
- **Values are validated per qualifier** — numeric counts, `fork:true|false|only`, `archived:true|false`, calendar-checked ISO8601 dates for `created`/`pushed`/`updated`, the `visibility:` enum, and `in:` fields; documented comma-lists like `in:name,description` still work
- **Zero results suggest how to loosen the query** — `No results for "rust stars:>=5000000"` now offers `Try: rust stars:>=500000`, ranked by how sharply each qualifier narrows results
- **`GHFIND_LOG=<path>` writes TUI diagnostics to a file** — the TUI's logger was a silent no-op, making API failures undiagnosable; token values are redacted from logged URLs
- **A 403 no longer claims SSO is the cause** — SSO enforcement, secondary rate limits and org restrictions all produce it, and the message asserted the first one unconditionally; it now reports GitHub's own reason
- **The post-upgrade panel no longer reappears on every launch** — it was triggered by a version inequality nothing ever cleared, so it showed after every single launch _including_ after "later" or "never"; it now acknowledges itself once shown
- **A prerelease is no longer offered as an upgrade** — the version comparison used by Node and the compiled binaries reported `9.9.0-beta.1` as newer than `9.9.0`, i.e. a downgrade; it now follows npm ordering and ignores build metadata
- **A new [how-to guide](docs/HOW-TO.md)** — token setup, writing queries, reading results, recovering from errors, and copy-paste recipes

### v9.8.3

- **401/403 say what actually happened** — a rejected token and an authenticated-but-forbidden request (e.g. SAML/SSO enforcement) both used to report "Network error", naming a connectivity problem you didn't have; only genuine connectivity and server failures keep that message now
- **A rate-limited search no longer looks like an empty one** — the adapter used to swallow the error and render a silent, successful "no repositories found"; the real message reaches the status bar, and the `ghfind_search_repos` MCP tool returns `rateLimited: true` with backoff advice instead of a tool failure
- **Recover from errors without leaving the TUI** — while the matching error is in the status bar, `t` opens an inline token prompt (saves it and re-runs the failed query), `u` clears the token and retries unauthenticated, `c` swaps in a different token, `r` retries
- **A corrupted session no longer hijacks startup** — a `session.json` holding an MCP handshake blob used to skip the landing menu and auto-run that garbage as a search on every launch; the menu always comes first now, and both save and restore sanitize the session
- **Images wrapped in a link render now** — the badge-and-screenshot shape `[![alt](shot.png)](url)` rendered nothing at all, which cost `sst/opencode` its only image and `withastro/astro` 23 of its 25; the image cells carry an OSC 8 hyperlink, so clicking it opens the target
- **A README full of small images no longer floods the screen** — images the README declares under 100px on any edge are skipped before a request is made, and undeclared `![]()` images are measured from the image header before any pixel decode; on `openclaw/openclaw` (648 sponsor avatars) that is 649 fetches / 28.3s → 1 fetch / ~0.5s

### v9.8.2

- **Security: tokens no longer leak into crash reports** — an uncaught error auto-built a GitHub issue URL from raw `process.argv`, so a `--token` value ended up in a public URL; every field is redacted now, and ghfind prints the URL to copy instead of opening a browser when it finds a credential
- **Security: your token is never sent to `raw.githubusercontent.com`** when fetching a README, only to `api.github.com` and only for a private repo
- **Security: untrusted skill sources are validated** before reaching a shell command or URL, so a hostile skills.sh entry cannot inject into `npx skills add`
- **Recoverable errors no longer open a bug-report tab** — rate limits, network blips and layout changes print a short message and exit
- **`--compare` resolves repositories exactly** in both the CLI and the `ghfind_compare_repos` MCP tool; it used a free-text search that could silently compare the wrong repo
- **State files are written atomically** — a crash mid-write used to leave truncated JSON that was silently replaced with defaults, losing bookmarks and history
- Fixed notification IDs restarting after "dismiss all", `history --delete` removing every duplicate, an invalid `--sort` degrading silently, a failed "load more" clearing the TUI's results, `--markdown` not escaping `|`, and a not-quite-LRU memory cache

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

## License

MIT
