# dev.to article draft

Front matter:

```yaml
---
title: "I built a GitHub search client for the terminal — here's the engineering behind it"
published: true
tags: cli, typescript, github, terminal
cover_image: <URL of demo GIF frame or social preview, 1000x420>
---
```

Cross-post to Medium/Hashnode +2 days. Canonical URL on every cross-post
points at dev.to.

---

## I built a GitHub search client for the terminal — here's the engineering behind it

I kept doing the same loop a dozen times a day: open a browser tab,
search GitHub, sort by stars, open the repo, skim the README, repeat.
So I built `ghfind` — a terminal client for repo search, trending,
bookmarks, and release tracking. This post is about the three decisions
that shaped the codebase. Repo: [codersdfs/search-cli](https://github.com/codersdfs/search-cli).

### 1. The two-runtime problem (Node 20+ AND Bun)

The TUI runs on [@opentui](https://github.com/nicobailon/opentui), which
runs on Bun. But I didn't want to force every user to install Bun just
to grep GitHub from a script. So the npm package ships a launcher
(`bin/ghfind.js`) with two strategies:

1. **Bun runs the TypeScript source directly.** The launcher prefers a
   bundled Bun binary (downloaded by `scripts/postinstall.js` at install
   time), then falls back to a system `bun` on PATH. Both are probed with
   a real `--version` spawn, because a wrong-libc binary on Linux "exists"
   but fails to launch with ENOENT.
2. **Node runs the bundled `dist/cli.js`** for every non-interactive mode
   (`--json`, `--csv`, `--count`, `--watch`…). Those modes are pure Node
   20+ and never touch Bun.

And for people who don't want either runtime at install time: the
release workflow compiles single-file static binaries with
`bun build --compile` — `ghfind-linux-x64`, `ghfind-darwin-arm64`,
`ghfind-win32-x64.exe` — attached to GitHub Releases.

The part I'm most proud of is how boring the postinstall is: ~150 lines
of readable Node that downloads the official Bun release zip for your
platform (including the glibc/musl choice on Linux), finds the binary in
the zip's central directory, and **exits 0 with a warning** if anything
fails. A failed Bun download must never break `npm install -g` — the CLI
still works without it.

### 2. Trending has no API, so scraping has to fail loudly

GitHub exposes no trending endpoint. Most scrapers respond to layout
changes by silently returning an empty list, which is the worst possible
failure: the user can't tell "no results" from "my tool is broken."

`src/trending-parser.ts` takes the opposite bet:

- The parser is its own module with **zero TUI dependencies**, so it
  tests without booting a terminal UI.
- `tests/fixtures/trending.html` is a **live capture** of the real page.
  Eleven golden tests pin behavior to it — including negative tests, like
  ignoring `/owner/name/stargazers` links and `/login?return_to=…` hrefs
  that look like repo paths if your selector is lazy.
- If the structure drifts, the parser throws a typed `ParseError` that
  the TUI renders as _"GitHub may have changed the layout. [r]etry"_ —
  an actionable failure, not a silent one.

It will still break someday. The difference is it will announce it.

### 3. Version numbers can't read package.json (if you're a compiled binary)

The first compiled build shipped with a fun bug: `ghfind --version`
crashed. In a `bun build --compile` executable there is no package.json
next to your code, and four modules were reading the version from disk.

Fix: a single `src/version.ts` where the version is injected at build
time (`tsup` `define` → `__GHFIND_VERSION__`, and `bun --define` for
compiled binaries) with a filesystem fallback for source/dist trees.
Duplicated logic in four places collapsed into one seam, and the compile
path stopped lying about the filesystem.

### What's in the box

- Repo search with GitHub's qualifier syntax, sort + limit control
- Trending: today/week/month/year, per language
- Bookmarks with tags, plus a release tracker (`ghfind --releases`)
  that uses ETag conditional requests to conserve rate limit
- Deep-dive per repo: languages, contributors, rendered README, activity
- Side-by-side compare, npm package search (beta), export to
  JSON/CSV/Markdown, org and user profiles
- 335 tests, CI on Linux/macOS/Windows, tag-gated releases, npm
  provenance

### Try it

```bash
npm install -g github-search-cli
ghfind "language:rust stars:>1000"
ghfind --trending --since weekly
ghfind            # the TUI
```

or grab a static binary from
[Releases](https://github.com/codersdfs/search-cli/releases).

What would make you actually switch from `gh search` to something like
this? Comments and GitHub issues both reach me.
