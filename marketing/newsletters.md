# Newsletter pitches

Submit these AFTER the repo metadata + demo GIF blockers are done —
editors click the repo link and judge in 10 seconds.

All three follow one format: what it is, why it's interesting, one
concrete command. Editors cut and paste; give them paste-able text.

---

## 1. Console.dev

Submit via https://console.dev/submit/ (free; they review tools with a
working OSS repo and a demo/asset).

**Pitch:**

> **ghfind** — search GitHub from the terminal
>
> ghfind is an open-source CLI for searching GitHub repositories without
> opening a browser: full qualifier search (`language:rust stars:>1000`),
> trending repos by day/week/month/year (scraped, since GitHub has no
> API), a keyboard-driven TUI with bookmarks, release tracking for
> bookmarked repos, deep-dive views, and side-by-side comparison. Works
> tokenless for search; `ghfind login` raises rate limits. npm:
> `npm install -g github-search-cli`, static binaries on GitHub
> Releases, MIT.
>
> Demo: https://github.com/codersdfs/search-cli#readme

---

## 2. Terminal Trove

Submit via https://terminaltrove.com/submit/ (accepts new CLI/TUI tools;
a screenshot/asciinema strongly increases acceptance — have the demo GIF
ready).

**Pitch (they favor terse + visual):**

> ghfind — GitHub repo search, trending and release tracking in the
> terminal. Keyboard-driven TUI with bookmarks, tags, deep-dive, compare
> and pipeable JSON/CSV/Markdown output. No login required.
>
> `npm i -g github-search-cli` · static binaries for Linux/macOS/Windows

---

## 3. Console Newsletter (console.substack.com) / UI Dev & CLI roundups

Pitch by email with the subject line format they use:
`Tool submission: ghfind — GitHub search in the terminal`

> **ghfind** is a terminal client for GitHub repo discovery: qualifier
> search, trending windows GitHub doesn't expose via API (day/week/
> month/year, language-filtered), bookmarks with a release tracker using
> ETag conditional requests, deep-dive views, and side-by-side compare.
> Node 20+ for scripting modes, Bun-backed TUI, or standalone static
> binaries. MIT, 335 tests, CI on three OSes.
>
> Repo: https://github.com/codersdfs/search-cli
> One-liner: `ghfind "language:rust stars:>1000" --json | jq`

---

## Standing tip

Every pitch names the npm package **exactly** (`github-search-cli`) and
links Releases for binaries. Editors will not fix a wrong install
command; readers will just conclude the tool is broken.
