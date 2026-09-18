# Show HN draft

## Title (choose one — do not use both)

```
Show HN: Ghfind – Search GitHub repos from your terminal, no login required
```

Alternate if you want the differentiator in the title:

```
Show HN: Ghfind – a keyboard-driven TUI for searching GitHub and tracking releases
```

Rules: title states the function, nothing else. No version numbers, no
"open source", no exclamation points — HN strips them and the community
punishes them.

## Submission URL

`https://github.com/codersdfs/search-cli`

(Not npm. GitHub is where HN judges read code and issues; the README
links npm anyway.)

## First comment (post immediately after submitting, from the same account)

HN punishes bare "Show HN" submissions with no context. Paste this:

---

Hi HN — I built ghfind because I kept doing the same loop a dozen times a
day: open a browser tab, search GitHub, sort by stars, click into a repo,
read the README, repeat. ghfind does that loop in the terminal.

What it does:

- Full GitHub repo search with qualifiers (`language:rust stars:>1000
topic:cli`), sorted your way, no login required (unauthenticated = 10
  req/min, `ghfind login` raises it to 5,000 req/hr)
- Trending repos per day/week/month/year, filterable by language —
  something the GitHub API doesn't expose, so it scrapes
  github.com/trending and has a golden-test harness pinned to a live
  capture so layout changes fail loudly instead of silently returning
  nothing
- A keyboard-driven TUI: bookmarks with tags, deep-dive per repo
  (languages, contributors, README rendered in-terminal, activity
  chart), side-by-side compare of 2+ repos
- `ghfind --releases` — a release feed for repos you've bookmarked,
  with ETag conditional requests so it barely touches your rate limit
- Everything pipeable: `ghfind "query" --json | jq`, plus CSV, Markdown,
  count, one-URL-per-line, `--pipe clone`

Technical notes, since they're the interesting part:

- The TUI is built on @opentui (Bun); non-interactive modes run on
  plain Node 20+. The npm package downloads a Bun binary at install
  time only if you want the TUI, and falls back gracefully if that
  download fails.
- There are also standalone static binaries (`ghfind-linux-x64` etc.)
  on the Releases page — no Node, no Bun, single file.
- 335 tests, CI on Linux/macOS/Windows, releases are tag-gated and
  npm publishes with provenance.

Honest limitations: the trending scraper breaks if GitHub changes their
trending page layout (the parser will tell you instead of showing an
empty list, but still); npm package search is marked beta; and I have
two known quality-gate gaps (typecheck against @opentui's drifting
types, and a lint baseline) that are tracked in issues.

Ask me anything — especially about the scraping approach, the
two-runtime (Node/Bun) install story, or what I'd do differently in the
TUI framework choice.

## Comment-response crib sheet

| Likely question                              | Answer                                                                                                                                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Why not just `gh search`?"                  | gh CLI requires login and has no trending, bookmarks, deep-dive, compare, or release tracking. ghfind works tokenless for search. Link the README comparison table, don't retype it.                                                     |
| "Why scrape trending instead of an API?"     | GitHub has no trending API. Be blunt: scraping is fragile, that's why the parser has golden tests pinned to a live fixture and fails with a friendly error.                                                                              |
| "Why Bun for the TUI?"                       | @opentui runs on Bun; Node support for the TUI isn't there yet. Non-TUI modes are pure Node 20+.                                                                                                                                         |
| "postinstall downloads a binary??"           | Yes — acknowledge that people are right to be wary. It's the official Bun release zip, pinned version, extracted in ~150 lines of readable script (scripts/postinstall.js), skip with `GHFIND_SKIP_BUN=1`, and the CLI works without it. |
| "SaaS/lockup/privacy?"                       | None. No telemetry, no accounts, config is a local JSON file.                                                                                                                                                                            |
| "name collision / why not on npm as ghfind?" | The npm package is `github-search-cli`; the binary is `ghfind`. A `ghfind` pointer package is planned.                                                                                                                                   |

## Timing

Tuesday–Thursday, 08:00–10:00 US Eastern. Never Monday (weekend thread
pile-up) or Friday. Have 2–3 uninterrupted hours after posting; the
first 60 minutes decide the thread.
