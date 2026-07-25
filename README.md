# ghfind

> Search GitHub repos from your terminal. No browser needed.

<p align="center">
  <img src="https://raw.githubusercontent.com/codersdfs/search-cli/main/demo.svg" alt="ghfind demo" width="100%">
</p>

---

## Install

```bash
npm install -g github-search-cli
```

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
<tr><td><b>Bookmarks</b></td><td><code>b</code> / <code>B</code> — save repos, tag them</td></tr>
<tr><td><b>Deep-dive</b></td><td><code>d</code> — languages, contributors, README, activity chart</td></tr>
<tr><td><b>Compare</b></td><td><code>c</code> / <code>C</code> — side-by-side, select 2+ repos</td></tr>
<tr><td><b>Explore</b></td><td><code>E</code> — browse popular topics</td></tr>
<tr><td><b>History</b></td><td><code>Ctrl+R</code> — recall past searches</td></tr>
<tr><td><b>Export</b></td><td><code>Ctrl+E</code> — JSON, CSV, Markdown to file</td></tr>
<tr><td><b>Share</b></td><td><code>Ctrl+P</code> — copy to clipboard (markdown, plain, gh-cli)</td></tr>
<tr><td><b>Watch</b></td><td><code>--watch</code> — poll for new results</td></tr>
</table>

<details>
<summary>Keybindings</summary>

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `Enter` | Search / open repo |
| `↑`/`↓` / `j`/`k` | Navigate |
| `t` | Toggle search / trending |
| `s` | Cycle sort |
| `l` | Cycle limit |
| `r` | Refresh |
| `d` | Deep-dive |
| `o` | Open in browser |
| `b` / `B` | Bookmark / bookmarks panel |
| `c` / `C` | Compare select / view |
| `E` | Topic explorer |
| `Tab` | Auto-complete qualifier |
| `?` / `Ctrl+H` | Help |
| `Ctrl+R` | History |
| `Ctrl+S` / `Ctrl+O` | Save / open searches |
| `Ctrl+E` | Export |
| `Ctrl+N` | Notifications |
| `Ctrl+P` | Share |
| `Esc` | Close overlay |
| `q` | Quit |

Trending tabs: `1`–`5` (Today → All) or `←`/`→` / `h`/`l`
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
npm install
npm start    # TUI
npm test     # 100+ tests
npm run build
```

---

## License

MIT