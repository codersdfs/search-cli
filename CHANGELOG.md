# Changelog

All notable changes to `github-search-cli` (published as the `ghfind` binary).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Published versions and dates mirror [npm](https://www.npmjs.com/package/github-search-cli?activeTab=versions).

---

## [Unreleased] — 9.4.0

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
- Arrow keys moved the landing selection *and* the bookmarks list at the same time — the landing handler only checked `currentMode`, which opening bookmarks doesn't change. Now gated on `landingKeysActive(mode, overlay)`
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
