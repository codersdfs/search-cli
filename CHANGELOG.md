# Changelog

All notable changes to `github-search-cli` (published as the `ghfind` binary).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Published versions and dates mirror [npm](https://www.npmjs.com/package/github-search-cli?activeTab=versions).

---

## [9.8.1] — unreleased

### Added

- **`ghfind skill search <query>`** finds agent skills by keyword and prints
  why each one matched. The default scan reads `SKILL.md` files under
  `~/.codex/skills`, `~/.agents/skills`, `<project>/.codex/skills` and
  `<project>/.github/skills`, in that priority order and de-duplicated by name
  (the user-level roots overlap heavily on real machines). `--remote` queries
  the public [skills.sh](https://skills.sh) ecosystem instead and returns each
  hit's install count and `npx skills add` command. `GHFIND_SKILL_ROOTS`
  overrides which directories are scanned.
- **MCP tool `ghfind_skill_search`.** Agents can search skills the moment they
  connect: `source: "local"` (the default) searches installed skills,
  `source: "registry"` searches skills.sh. Read-only — it returns install
  commands rather than running them, and never writes to disk.
- **Read-only CLI views of local state:** `ghfind bookmarks [query]`,
  `ghfind history [query]`, `ghfind saved` and `ghfind topics`, each with
  `--json` for agents. They print what the TUI has stored and never modify it.
- **`ghfind readme <owner/repo>`** prints a repository's README (`--raw` skips
  the header, `--json` returns `{ owner, name, sourceUrl, text }`), bringing the
  TUI's README viewer to scripts and agents.
- **`ghfind share <owner/repo>`** prints a share snippet
  (`--as markdown|plain|gh-cli|short`), with `--copy` to also put it on the
  clipboard.
- Shell completions (bash, zsh, fish) cover every new subcommand and flag.

### Changed

- The bundled `ghfind-cli` agent skill documents the skill search and the new
  read-only commands, so CLI-first agents discover them without reading
  `--help`.

### Fixed

- **README image rendering does not work on real repositories.** The v9.8.0
  notes described inline images as working; that was wrong. An image wrapped
  in a link (`[![alt](shot.png)](url)`) renders nothing, and a README with
  many small images — `openclaw/openclaw` has 648 48x48 avatars — becomes
  15,552 rows tall. Images declaring an edge under 100px are skipped, and
  SVG is not rendered at all. Plain `![]()` images and large banners do
  render correctly. Root causes and remaining work:
  `.issues/tickets/readme-image-rendering.md`.

---

## [9.8.0] — 2026-09-22 (released)

### Added

- **README viewer now renders full markdown, including inline images.** The
  viewer used to approximate markdown with box-drawing text; it now drives
  OpenTUI's `MarkdownRenderable` with a theme-derived syntax style, so
  headings, emphasis, links, lists, blockquotes, boxed tables, and fenced
  code blocks render as markdown rather than as decorated plain text.
- **Images in READMEs render in the terminal.** Relative and root-relative
  paths resolve against the branch the README was loaded from,
  `github.com/.../blob/...` links are rewritten to raw content, and downloads
  are cached and capped by size. SVG and badge-service images are skipped
  (they carry text that survives rasterising poorly), and anything that fails
  to load falls back to an `🖼 alt text` caption. Images are drawn with
  truecolor half blocks, so they work on any truecolor terminal with no image
  protocol support; press `i` in the viewer to toggle them off. The pipeline
  lives in `src/png.ts` (PNG decoder), `src/image-render.ts`
  (image → cells), `src/image-loader.ts` (URL resolution + fetch cache),
  `src/markdown-images.ts` (token helpers) and `src/markdown-view.ts` (the
  renderable), and degrades to captions on runtimes without `Bun.Image`.

### Changed

- **The update modal's release notes render as markdown too.** The in-app
  update panel reused the same text approximation as the README viewer; it
  now shares `MarkdownRenderable` via the new view, so release notes show
  real headings, lists, inline code, and boxed tables. Inline images stay
  off there (the panel is narrow and notes are prose).
- With both surfaces migrated, the plain-text markdown renderer
  (`src/markdown-render.ts`) is no longer used and has been removed.

---

## [9.7.1] — 2026-09-20 (released)

### Fixed

- **In-app update installed to the wrong location when running under Bun** —
  `performUpdate()` ran `bun install -g github-search-cli`, which targets
  Bun's own global dir (`~/.bun`), not the npm prefix the running copy and
  its `ghfind` shim live in. The command exited 0 while the running install
  never changed. The updater now detects which package manager owns the
  running tree (`detectInstallLocation`: npm global vs `~/.bun` global) and
  shells out to `npm install -g --prefix <prefix>` for npm-owned installs,
  so the update lands exactly where the running install is.
- **Node fallback could not launch npm on Windows** — `child_process.spawn`
  without a shell cannot execute `npm.cmd` (and recent Node rejects it with
  `EINVAL`). The update spawn now goes through `node:child_process` on every
  runtime with `shell: true` on win32 and properly quoted arguments, so the
  Node fallback path actually works on Windows.
- **Compiled binaries / dev checkouts no longer fake an update** — when the
  running install has no `node_modules` ancestor, self-update is refused
  with a debug hint instead of npm-installing a copy the user isn't running.
- **Windows: URLs with query params were truncated at the first `&`** when opened via `cmd /c start` (every pre-filled crash-report/issue link lost its body and labels). Both openers now use `explorer.exe` on Windows, which receives the URL as a single argument.
- **`open-url.ts` crashed under Node** (`Bun.spawn` unconditional); now runtime-agnostic with a detached `child_process.spawn` fallback.
- **`--doctor` now detects stale/PATH-shadowing global installs** — multiple `ghfind` copies resolving to different versions are flagged with their prefixes and the exact uninstall command. This is the "updater said OK but nothing changed" trap.
- Lint gate was permanently broken: `package.json` pinned `biome@2.5.13` (package never existed on npm); now uses `@biomejs/biome` ^2.5.14 with a migrated `biome.json`.
- First clean lint baseline: 198 diagnostics triaged (auto-fixes + hand-fixes, incl. a dead `|| true` gate in `tui.ts` startup tips and an unsafe-autofix regression in `TrendingAdapter`); `tests/**` lint overrides for mocks/assertions; `tests/fixtures/**` excluded. CI now runs lint + typecheck on every push/PR (previously excluded as known-broken).
- `mcp-server.ts`: assignment-in-expression violations; `trending-parser.ts`: stateful `RegExp.exec` loop replaced with `matchAll` (lastIndex reuse hazard); `themes.ts`: documented ANSI control-char regex.

---

## [9.7.0] — 2026-09-19 (released)

### Added

- **CLI parity with the MCP tools** — the three MCP-only capabilities are now
  first-class CLI commands:
  - `ghfind deep-dive <owner/repo> [--json]` — language breakdown, top
    contributors, and a README excerpt (previously MCP-only; the agent skill
    doc told agents to `curl` instead).
  - `ghfind --compare` accepts `--json|--csv|--markdown` (previously
    text-only) and reports repos that failed to resolve; it exits non-zero
    when fewer than 2 repos resolve.
  - Trending language filter on the CLI: `ghfind trending <lang>` (the form
    the README already advertised), `ghfind --trending <lang>`, and
    `ghfind --trending --language <lang>` — validated against the same
    accepted-language list as the MCP tool.
- `ghfind deep-dive --json` exposes a structured payload (language percents,
  contributor counts, raw README) suitable for agents and scripting.

### Changed

- The MCP server now shares its repo-ref parsing, trending-language
  validation, and deep-dive data pipeline with the CLI via new seams in
  `deepdive.ts` and `search.ts` (no protocol behavior change).

### Fixed

- **`ghfind mcp` failed to typecheck** — `processServerLine` declared `msg`
  as a `let` binding, so TypeScript's aliased-conditional narrowing did not
  apply and every `respond`/`respondError` call site errored on
  `JsonRpcId | undefined`. HEAD did not compile. The id is now extracted
  into a `const` before the notification check; runtime behavior is
  unchanged (all 31 MCP tests pass against the previous behavior).
- **Deep-dive ran on a zeroed repo stub** — `ghfind deep-dive a/b --json`
  reported `stars: 0`, `description: null`, and no timestamps because the
  repo ref was never resolved. Both the CLI and the `ghfind_deep_dive` MCP
  tool now fetch real repo metadata first (a 404 exits with
  `Repo not found: owner/name`; network failures still degrade gracefully
  to the stub).

---

## [9.6.0] — 2026-09-18 (released)

### Added

- **MCP server (beta)** (`ghfind mcp`) — ghfind now speaks the
  [Model Context Protocol](https://modelcontextprotocol.io): any MCP client
  (Claude Code, Cursor, Codex, …) can call GitHub search as tools over stdio.
  Zero new dependencies — the server is a small JSON-RPC 2.0 layer over the
  existing modules. Nine tools: `ghfind_search_repos`, `ghfind_trending`,
  `ghfind_npm_packages`, `ghfind_org_profile`, `ghfind_user_profile`,
  `ghfind_compare_repos`, `ghfind_deep_dive`, `ghfind_bookmarked_releases`,
  and `ghfind_skill`. Implements the 2025-06-18 lifecycle (initialize →
  initialized notification → operation), speaks 2025-06-18 / 2025-03-26 /
  2024-11-05, reports tool failures as `isError` results per spec, and logs
  agent searches into the TUI history. `ghfind mcp --token <t>` pins a token;
  otherwise config/`GITHUB_TOKEN` applies.
- **Agent skill (beta)** (`ghfind skill [name]`) — a token-efficient CLI usage guide
  for coding agents (search syntax, flags, rate limits, token-efficiency
  tips) so they stop parsing `--help`. Bare `ghfind skill` lists the catalog;
  the registry (`src/agent-skill.ts`) is generic, so third parties can
  register their own skills alongside the built-in `ghfind-cli` one.
- **Trending language filter** — `SearchOptions.trendingLanguage` and the
  `ghfind_trending` MCP tool accept a github.com/trending language slug
  (`rust`, `python`, …); `buildTrendingUrl` validates against the known
  language list and drops unknown slugs instead of scraping an error page.
- **`NO_COLOR` support** — `ghfind --doctor` no longer emits ANSI color
  codes when `NO_COLOR` is set (any value, per
  [no-color.org](https://no-color.org/)) or when stdout is not a TTY.
- **curl installer** (`scripts/install.sh`) — downloads the standalone
  binary for the detected platform from GitHub Releases, verifies it
  against the release's `SHA256SUMS.txt`, installs to `~/.local/bin` or
  `/usr/local/bin` (overridable with `GHFIND_INSTALL_DIR`, never needs
  sudo), and prints a PATH hint when needed.
- **`SHA256SUMS.txt` on every release** — new `checksums` job in the
  release workflow merges all platform binaries' checksums into one
  file attached to the GitHub Release; the curl installer and package
  maintainers verify against it.
- **Community health files** — `SECURITY.md` (private vulnerability
  reporting), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), and
  `SUPPORT.md` (routes users to `--doctor`, issues, and discussions).

### Fixed

- **`scripts/brew.rb` formula was stale and broken** — pointed at the
  wrong repo (`frank/search-cli`), version 0.1.0, and `search-cli-*`
  asset names that never matched the release artifacts. Now targets
  `codersdfs/search-cli` releases with the correct `ghfind-*` asset
  names (plus linux-arm64), a livecheck block, and a version-pinning
  test. Still a template: SHA256 placeholders are filled from
  `SHA256SUMS.txt` when the tap lands.

---

## [9.5.1] — 2026-09-15

### Fixed

- **Landing-screen keys leaked into the main view** — pressing `/` on the
  landing menu focused the search input on top of it, and `Space`, `t`, `c`,
  `?`, and `q` all double-fired through the second key listener (help opened
  and instantly closed; quit ran cleanup twice). The landing handler now
  claims its keys with `stopPropagation()` via the `landingKeysActive` /
  `landingConsumesKey` seam (previously built and tested but never wired),
  and the global handler ignores everything while the landing menu owns the
  screen. Also fixed while routing keys: `b` on the landing screen now opens
  bookmarks (hint bar updated), and overlays opened from landing hide the
  menu instead of drawing on top of it.
- **Update panel clipped the changelog** — the modal was hard-capped at 16
  rows and put the release notes in a single unsized text block, so anything
  past the first ~10 lines of the notes was invisible with no hint that more
  existed. The notes area is now a scrollable region (same mechanics as the
  README/org viewers): `↑↓/jk` move a fifth of a page, `PageUp`/`PageDown`
  and `Home`/`End` jump, a scrollbar shows when content overflows, and scroll
  position resets each time the panel opens. The box is taller (24 rows), and
  notes render at the panel's actual width so wrapped lines no longer clip
  horizontally on narrow terminals.
- **`--help` listed `ghfind user <name>` twice** — the 9.5.0 usage block
  carried a duplicated line, so the profile examples were printed twice. It
  now appears once, and the `ghfind pkg` line is aligned with its neighbours.

### Internal

- **Test isolation** — seven suites derived their temp dirs from a
  `Date.now()` stamp (`tmpdir()/<name>-<ms>`), a name two concurrent
  `bun test` processes can collide on, which intermittently failed
  bookmarks / config / doctor / history / login / saved-searches /
  update-check tests. They now use `mkdtempSync`, which is unique and
  collision-proof (the pattern `tests/releases.test.ts` already used), and
  the login `readGhCliToken` / `persistToken` dirs are removed after use
  instead of accumulating in the temp folder.
- **Docs sync** (README ↔ `src/help.ts` ↔ `--help`): README gained
  `--releases` / `--compare` / `pkg` examples plus Packages and Releases
  feature rows; the TUI help screen gained the `Org profile` command-menu
  entry the leader menu already had. `tests/cli-help.test.ts` pins the
  `--help` usage block (no duplicate rows, one description column).
- `package-lock.json` root version synced to 9.5.1 (`bun.lock` carries no
  root version), and the release workflow's manual dispatch now runs the
  gate only — the GitHub Release and npm publish jobs are tag-gated, so
  dispatching from a branch can't create a release on a non-tag ref.
- `--doctor` tests remove their temp config dirs after each test instead of
  leaving them behind.
- **CI was red on `windows-latest`** — `tests/landing.test.ts` source-greps
  `src/tui.ts` for a snippet containing `\n`, but Windows checks the tree out
  with CRLF, so the assertion could never match there while every other OS
  passed. The source-grep helpers now normalise line endings before
  asserting; `tests/overlay-registry.test.ts` does the same.

---

## [9.5.0] — 2026-09-15 (released)

### Added

- **`ghfind user <name>`** — GitHub user profiles from the terminal, the
  user-side counterpart to `ghfind org <name>`. Fetches the user's metadata
  and public repos from the GitHub REST API and aggregates them into one
  summary: public repo count, total stars/forks of the fetched repos,
  followers/following, top languages by repo count, top 5 repos by stars, and
  the 5 most recently pushed repos. Supports `--json`, `--csv`, `--markdown`,
  `--count`, and `--limit` just like `org`, and honors `--token` for higher
  rate limits. Leading `@` is stripped (`ghfind user @torvalds` works), and
  Organization / Bot accounts are labeled with an `[org]` / `[bot]` badge in
  text output (`[staff]` for site admins).

### Fixed

- `ghfind org <name>` mangled multi-word names with dashes (`ghfind org "in
tech"` looked up `in-tech`) — names are now joined with spaces, which the
  API handles. In practice org logins are single tokens, so existing one-word
  lookups are unaffected.

### Internal

- `src/user.ts` mirrors the org-profile module shape: pure
  `normalizeUser`/`normalizeUserRepo` aggregate functions testable with
  fixtures, thin formatters, and a `fetchUserProfile` wrapper that degrades
  gracefully when the repos request fails (metadata is still returned).
- 27 new tests in `tests/user.test.ts` covering normalization, aggregation,
  `@`-stripping, 404/network error paths, token headers, zero-repo users,
  non-array API responses, badges, and all four formatters.
- **TUI overlay registry seam** — `src/tui.ts` is 2,867 lines and was the
  most-changed file in the repo (28 of the last 200 commits). A new
  `src/tui/overlays/registry.ts` introduces the seam that future
  migrations will consume: `Overlay` interface plus `OVERLAYS` array and
  `getOverlay()` lookup. The first overlay (`help`) is extracted behind
  it. Behaviour is unchanged. Migration is gradual; subsequent commits
  move one overlay at a time and rewire `showOverlay()` to query the
  registry. 6 guard tests in `tests/overlay-registry.test.ts` pin the
  registry contract and source-grep `src/tui.ts` to fail on drift between
  the registered ids and the dispatcher's union type.

---

## [9.4.3] — 2026-09-13 (released)

### Added

- nothing added

### Changed

- tui bug that local works but global doesn't

### Fixed

- tui bug that local works but global doesn't

## [9.4.2] — 2026-09-12 (released)

### Added

- **Standalone binaries** — the release workflow now compiles
  self-contained `ghfind-<os>-<arch>` executables (Linux, macOS, Windows)
  via `bun build --compile` and attaches them to GitHub Releases. No
  Node.js or Bun needed — unblocks Homebrew / Scoop / winget / curl
  install channels.
- **npm provenance** — `publish-npm` runs `npm publish --provenance` with
  `id-token: write`, so published tarballs carry a verifiable provenance
  badge on npmjs.com.
- `src/version.ts` — single source for version resolution. Primary
  source is the `__GHFIND_VERSION__` constant injected at build time
  (tsup `define`, bun `--define`); falls back to reading package.json
  relative to the module in source/dist trees.
- **README trust & comparison** — npm version / weekly downloads / CI /
  TypeScript / license badges; a "Why ghfind?" table vs `gh search` and
  `hub`; standalone-binary install section.
- **`ghfind login`** — stores a GitHub token for 5,000 req/hr rate limits.
  Detects a token managed by the GitHub CLI (`~/.config/gh/hosts.yml`) and
  offers to import it, or accepts a pasted token; warns if it doesn't look
  like a GitHub credential (`ghp_` / `gho_` / `github_pat_`). Writes the same
  config file as `ghfind init`.
- **Better failure hints** — the `bin/ghfind.js` entry now points broken
  installs at `ghfind --doctor` instead of failing silently (previously a
  missing `src/` + `dist/` exited 0 without a word).
- **Hardened trending parser** — `parseTrendingHtml` moved to its own module
  (`src/trending-parser.ts`, no TUI/@opentui dependency). Layout changes that
  previously produced an **empty trending list with no explanation** now throw
  a friendly `ParseError` ("GitHub may have changed the layout. [r]etry").
  New golden-test harness: `tests/fixtures/trending.html` is a live capture
  of the page, and 11 tests pin the parser to it (including the login
  `/login?return_to=…` href and `/owner/name/stargazers`-link false positives).

### Changed

- Package description and keywords rewritten around real search intent
  (9 → 17 keywords, e.g. `github-search`, `trending-repositories`,
  `commandline`, `npm-search`, `octokit`).

### Fixed

- **In-app update loop was broken** — `performUpdate()` ran
  `npm install -g ghfind`, but no `ghfind` package exists on npm; every
  "Yes" on the update modal failed. Now installs `github-search-cli`,
  and works under Node.js too (previous code used `Bun.spawn`
  unconditionally).
- **`--version` crashed in compiled binaries** — version was read from
  `package.json` via filesystem paths in `cli.ts`, `tui.ts`,
  `update-check.ts`, and `error-report.ts`, which do not exist inside a
  single-file executable. Version is now embedded at build time.
- **TUI crashed on boot with upgrade state (`bun start` → exit 1)** — the
  update modal's `showOverlay("update")` called `updateSelect.focus()`, but
  `updateSelect` was never declared (vestigial reference from the 9.4.0
  refactor). Every launch where `update-state.json` recorded a version
  upgrade threw `ReferenceError: updateSelect is not defined` before the
  render loop started. The vestigial call is removed; the modal is driven by
  `updateSelectedOption` + the global key handler, which now renders
  correctly ("Updated ghfind X → Y" panel). Guarded by a source-grep test in
  `tests/overlay-registry.test.ts`.

---

## [9.4.0] — 2026-08-28

Release tracking for bookmarked repos, plus a bookmarks page and toast notifications in the TUI.

### Added

**Release tracker** — follow releases of repos you've bookmarked

- `src/releases.ts` — checks each bookmarked repo against `GET /repos/{owner}/{repo}/releases?per_page=5`
- Seen state is `lastSeenAt` per bookmark; "new" means published after that timestamp
- ETag conditional requests + `GITHUB_TOKEN` when available to conserve rate budget
- Prereleases shown and tagged `[pre]`; drafts never shown
- `ghfind --releases` prints the new-release feed, then marks everything seen; `--releases --json` for machine output
- Opening the Notifications panel (Space → System → Notifications) now runs a check in the background and files each new release as a `🚀` notification

**Bookmarks page** — bookmarks are now a first-class mode, not an overlay

- Reachable from the landing screen (`b`, or `Enter` on the new button) and from Space → Navigate → Bookmarks
- `Enter` opens the repo in a browser, `d` removes, `Esc` / `←` returns to landing
- `SessionState.mode` accepts `"bookmarks"`, so a restart restores you onto the page

**Landing bookmarks button** — fourth selectable row below the three mode cards, with a live count (`4 saved` / `none yet`) refreshed on every visit

**Toast popup** — top-right rounded card confirming bookmark changes; green border for bookmarked, yellow for unbookmarked, auto-hides after 2s

**`b` keybinding** — toggles bookmark on the selected repo from the main view (previously only reachable via Space → Repo → Bookmark)

**Diagnostics: `ghfind --doctor`** — environment troubleshooting command for the interactive TUI

- 10 checks: runtime, bundled Bun, system Bun, Node version, build output, source, TTY, config validity, GitHub token, state/cache dirs
- Per-check status: green `PASS`, yellow `WARN`, red `FAIL`; non-zero exit on any FAIL so scripts can detect broken installs
- `src/doctor.ts` is purely diagnostic (no TUI, no network) and exits with code 1 if any check fails
- `bin/ghfind.js` Strategy 1 now prefers the bundled `vendor/bun` (downloaded by `postinstall.js`) and falls back to a system-installed `bun` on PATH; doctor confirms which one wins

**Error report on uncaught exceptions** — never auto-posts

- When `ghfind` hits an unexpected error, builds a pre-filled `https://github.com/codersdfs/search-cli/issues/new?title=...&body=...&labels=bug` URL with the error class, message, stack, command line, and environment (ghfind version, runtime, platform)
- Tries to open the URL in the user's default browser (Bun.spawn when available, child_process.spawn detached fallback for Node); prints the URL when no browser can be launched
- Known user-facing errors (`SearchCliError` subclasses) keep their existing friendly message and skip the report flow
- `src/error-report.ts` is the new module; `tests/error-report.test.ts` covers URL format, ANSI stripping, long-message truncation, non-Error throwables, env + command in body

### Fixed

- Landing screen vanished after the bookmarks page landed — `showLanding()` revealed `landingBox` before `hideMainContent()` hid it again; ordering corrected
- Arrow keys moved the landing selection _and_ the bookmarks list at the same time — the landing handler only checked `currentMode`, which opening bookmarks doesn't change. Now gated on `landingKeysActive(mode, overlay)`
- `Enter` on the landing bookmarks button immediately opened the first bookmark in a browser — the same key event reached the global handler after the page opened. Consumed keys now call `key.stopPropagation()`
- `q` inside the bookmarks overlay quit the app instead of closing it — same double-handling root cause
- `tests/tips.test.ts` imported a `TipRotator` class that `src/tips.ts` never exported, so its module-load error was misattributed to whichever test file ran next. Added the class and `defaultRotator`; behavior unchanged

### Changed

- Help screen: new "Bookmarks Page" section; `b` / `c` / `t` documented under Main View; Landing section documents the button; "Overlay Keys" no longer lists bookmarks
- Leader menu "Notifications" now reads "View alerts — checks bookmarks for new releases"
- Landing hint line includes `[b]ookmarks`
- `Bookmark` type gains `lastSeenAt`; `src/bookmarks.ts` exports `getLastSeen()` / `markSeen()`

### Internal

- Extracted `src/toast.ts` and `src/landing.ts` so the toast, button, and key-routing predicates are testable without booting the TUI
- Tests: 187 passing — `tests/landing.test.ts` (30), `tests/toast.test.ts` (6), `tests/releases.test.ts`, `tests/tips.test.ts`, `tests/doctor.test.ts` (2), `tests/error-report.test.ts` (6)

---

## [9.3.0] — 2026-08-24

### Fixed

- `c` keybinding in the TUI not adding repos to comparison — a missing closing brace in the space-key handler broke every later key handler (`c`, `t`, `?`)
- README viewer now renders full markdown (headings, code blocks, lists, tables, blockquotes, rules) instead of stripping formatting

### Changed

- Widened compare table columns (min 35 chars) and added Description + URL rows
- Compare table shows up to 5 topics per repo (was 3)

---

## [9.2.1] — 2026-08-23

### Added

- npm package search (beta)
- New landing screen with selectable mode cards

### Fixed

- TUI layout issues on small terminals
- Trending not visible when launched from the landing screen — `loadTrending()` was the only mode switch that didn't set `body.visible`
- Trending tabs now fetch independently, with an active-tab underline

### Changed

- Removed the bundled Bun binary from the npm package; it is downloaded at install time on all platforms
- Package size reduced from 39.5 MB to 100 KB
- Postinstall no longer fails `npm install` when the Bun download fails (graceful fallback)
- Removed `bun` from the engines field — Bun need not be pre-installed
- Non-interactive modes (`--json`, `--csv`, …) run on Node.js 20+ alone

---

## [9.1.1] — 2026-08-11

### Fixed

- Postinstall now exits with code 1 on Bun download failure
- Removed dead Strategy 3 fallback in `bin/ghfind.js` (Node cannot import `.ts`)

### Changed

- Bundle `vendor/` and `dist/` in the npm package for offline install
- Bundled Bun updated from 1.3.12 to 1.3.14

---

## [9.1.0] — 2026-08-07

### Added

- Automatic update checking against the npm registry, with a Y/N/L modal (install now / skip / dismiss)
- Leader menu (Space) consolidating all contextual actions
- Topic explorer, notifications panel, and saved searches overlay
- Activity graph toggle (commit chart fullscreen)
- README viewer
- Tab auto-complete for search qualifiers
- PageUp / PageDown navigation
- `Ctrl+X` clears history, `Ctrl+C` clears all notifications

### Fixed

- Postinstall downloads the Bun binary correctly on all platforms
- Zip asset names match Bun's current release naming
- Zip parsing uses the central directory instead of local file headers
- `postinstall` uses `node` instead of `bun run`, so Bun need not be pre-installed
- TUI works on Node.js 20+ via the downloaded Bun binary

### Changed

- Removed `vendor/` from the npm package (Bun downloaded at install time)
- Improved export error handling and format selection

---

## [0.9.0] — 2026-07-31

### Added

- Watch mode (`--watch`) for polling a query
- Notifications panel and UI refinements

### Fixed

- Trending browser fixes

---

## [0.8.2] — 2026-07-31

### Fixed

- TUI stability fixes; rewritten keybindings reference

---

## [0.8.1] — 2026-07-27

### Fixed

- Follow-up fixes to the 0.8.0 breaking change

---

## [0.8.0] — 2026-07-26

### Added

- Trending browser, deep-dive, compare, export, share, topics, saved searches
- Activity graph, README viewer, notifications panel

**Breaking:** entry point and command surface changed; 0.8.1 shipped the same day as an emergency follow-up

---

## [0.7.0] — 2026-07-25

### Added

- Bookmarks and search history

---

## [0.6.1] — 2026-07-24

### Fixed

- Fixes for the initial release

---

## [0.6.0] — 2026-07-23

### Added

- First public release: repo search with qualifiers, sorting, and JSON output

---

## A note on version numbers

The jump from `0.9.0` to `9.1.0` was a one-time renumbering, not 9 major releases. The `9.x` line begins with the update checker and leader menu. There is no `9.0.0`, and `9.2.0` was never published — `9.2.1` superseded it before release.
