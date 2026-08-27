# ghfind

> Search GitHub repos from your terminal. No browser needed.

<p align="center">
  <a href="https://x.com/frankli23709971">
    <img src="https://img.shields.io/badge/made%20by-%40frankli23709971-000000?logo=x&labelColor=000000&color=000000&link=https://x.com/frankli23709971" alt="Made by @frankli23709971">
  </a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/codersdfs/search-cli/main/demo.svg" alt="ghfind demo" width="100%">
</p>

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Install

```bash
npm install -g github-search-cli
```

> **No separate runtime needed!** Only requires Node.js 20+. The TUI needs Bun,
> which is downloaded automatically at install time. Non-interactive modes work
> with just Node.js.
>
> | Platform              | TUI              | CLI modes |
> | --------------------- | ---------------- | --------- |
> | Node 20+              | ⚠ Bun required  | ✅        |
> | Bun                   | ✅               | ✅        |
> | Downloaded Bun        | ✅ auto-installed| ✅        |

## Use

```bash
# TUI
ghfind

# pipe
ghfind "language:Rust stars:>1000" --json | jq '.[].fullName'
ghfind "language:Zig" --count
ghfind --trending --json --since weekly
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
ghfind --watch "query"       # poll every 300s
```

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
<tr><td><b>Bookmarks</b></td><td>Space → Bookmark / Bookmarks panel — save repos, tag them</td></tr>
<tr><td><b>Deep-dive</b></td><td>Space → Deep-dive — languages, contributors, README, activity chart</td></tr>
<tr><td><b>Compare</b></td><td>Space → Compare select / Compare view — side-by-side, select 2+ repos</td></tr>
<tr><td><b>Explore</b></td><td>Space → Topics — browse popular GitHub topics</td></tr>
<tr><td><b>History</b></td><td>Space → History — recall past searches</td></tr>
<tr><td><b>Saved</b></td><td>Space → Saved searches — load or save queries</td></tr>
<tr><td><b>Export</b></td><td>Space → Export — JSON, CSV, Markdown to file</td></tr>
<tr><td><b>Share</b></td><td>Space → Share repo — copy repo link to clipboard</td></tr>
<tr><td><b>Notifications</b></td><td>Space → Notifications — view & dismiss alerts</td></tr>
<tr><td><b>Graph</b></td><td>Space → Activity graph — commit chart, fullscreen toggle</td></tr>
<tr><td><b>Help</b></td><td><code>?</code> / <code>Ctrl+H</code> — keybindings reference</td></tr>
<tr><td><b>Watch</b></td><td><code>--watch</code> — poll for new results</td></tr>
</table>

<details>
<summary>Keybindings</summary>

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
| Readme          | Full README viewer                                      |
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
| Notifications   | View and dismiss alerts                                 |
| Topics          | Browse popular GitHub topics                            |
| Bookmarks panel | Browse saved bookmarks                                  |
| Help            | Keybindings reference                                   |

**Overlay-specific shortcuts**

| Key             | Context                                              | Action                                      |
| --------------- | ---------------------------------------------------- | ------------------------------------------- |
| `Esc` / `q`     | Any overlay                                          | Close overlay                               |
| `Enter`         | Leader / History / Saved / Export / Topics / Share   | Confirm selection                           |
| `d`             | History / Bookmarks / Saved searches / Notifications | Delete current entry                        |
| `Ctrl+X`        | History                                              | Clear all history                           |
| `Ctrl+C`        | Notifications                                        | Dismiss all notifications                   |
| `Y` / `N` / `L` | Update modal                                         | Yes (install) / No (skip) / Later (dismiss) |

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

`~/.config/ghfind/config.json` (auto-created, or run `ghfind init`):

```json
{
  "defaultSort": "stars",
  "defaultLimit": 50,
  "theme": "tokyo-night",
  "githubToken": "ghp_..."
}
```

Env: `GITHUB_TOKEN`, `GHFIND_CONFIG`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`

---

## From source

```bash
git clone https://github.com/codersdfs/search-cli.git
cd ghfind

# With Bun (recommended for TUI)
bun install
bun start        # TUI
bun test         # 179 tests
bun run build    # build dist/

# Or with npm
npm install
npm start        # TUI (requires Node 20+)
npm test         # 179 tests
npm run build    # build dist/
```

---

## Changelog

Recent releases (full history in [CHANGELOG.md](CHANGELOG.md)):

### v9.3.0
- Fixed `c` keybinding in TUI not adding repos to comparison — a missing closing brace in the space-key handler broke every later key handler (`c`, `t`, `?`)
- README viewer renders full markdown (headings, code blocks, lists, tables, blockquotes, rules) instead of stripping formatting
- Widened compare table columns (min 35 chars), added Description + URL rows, and raised the topic cap to 5 per repo

### v9.2.1
- npm package search (beta) and a new landing screen
- Removed the bundled Bun binary — downloaded at install time instead; package size 39.5 MB → 100 KB
- Postinstall failures no longer break `npm install`; `bun` dropped from engines
- Fixed TUI layout on small terminals, trending visibility from the landing screen, and independent trending-tab fetches

### v9.1.1
- Bundle `vendor/` and `dist/` for offline install
- Postinstall exits non-zero on Bun download failure; bundled Bun 1.3.12 → 1.3.14

### v9.1.0
- Automatic update checking against the npm registry, with a Y/N/L modal
- Leader menu (Space) consolidating all contextual actions
- Topic explorer, notifications panel, saved searches, activity graph, README viewer
- Tab qualifier auto-complete, PageUp/PageDown, `Ctrl+X` clear history, `Ctrl+C` clear notifications
- TUI runs on Node.js 20+ via the downloaded Bun binary

---

## License

MIT
