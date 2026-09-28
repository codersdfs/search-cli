---
name: docs-release
description: Keep README.md, CHANGELOG.md, and release-notes in sync with code changes, and cut versioned releases for ghfind (github-search-cli).
---

# Docs & Release Skill (ghfind)

Use this skill whenever a change is user-visible (CLI flags, TUI keys/views,
config, install flow, rate limits) or when cutting a release.

## 1. Sources of truth

| Artifact                          | Rule                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--help` + `src/help.ts`          | Behavioral truth for flags/keys. Code changes here REQUIRE README + CHANGELOG updates in the same PR.               |
| `package.json` version            | Single version source. `src/version.ts` embeds it at build time — never hardcode versions elsewhere.                |
| `CHANGELOG.md`                    | Full history, Keep a Changelog (`Added` / `Changed` / `Fixed`). Published sections are append-only — never rewrite. |
| `README.md` → `Changelog` section | Last ~3 released versions only. Full history lives in `CHANGELOG.md`.                                               |
| `release-notes/X.Y.Z.md`          | One per release, narrative style (see `release-notes/9.3.0.md`).                                                    |
| `CONTRIBUTING.md`                 | Dev commands, conventions, known gaps.                                                                              |

## 2. Same-PR docs checklist (feature/fix PRs)

1. **CHANGELOG first** (per CONTRIBUTING.md): add bullets under `## [Unreleased]` →
   `### Added` / `### Changed` / `### Fixed`. No version header yet.
2. **README sync** if the surface changed:
   - Flags/examples in `Use` / `Non-interactive` / `Search syntax` match `--help`.
   - New TUI keys → keybindings table; new config keys → `Config` JSON + env list.
   - Test count in `From source` (`bun test # N tests`) matches the real suite.
   - Do NOT touch the `Why ghfind?` table unless the comparison actually changed.
   - Do NOT add a version entry to the README `Changelog` section for unreleased work.
3. **Help text**: update `src/help.ts` alongside README.
4. **Verify**: `bun run check` (Prettier + tests), `bun run lint`
   (Biome), `bun run typecheck` (tsc), and `bun run build` — all four are
   gates in CI (`.github/workflows/ci.yml`).

## 3. Pre-flight checklist (run BEFORE `git tag`)

Every item below was learned the hard way in the 9.7.1 release. Do not tag
until all boxes tick.

### Repo state

- [ ] All four gates green locally: `bun test`, `bun run format:check`,
      `bun run lint`, `bun run typecheck` — plus `bun run build`.
- [ ] CI green on the release PR **and** on `main` after merge
      (`gh run list --branch main`). A red main is a red release.
- [ ] Docs synced (checklist §4 below): CHANGELOG dated, release-notes file,
      README Changelog (last 3), `package.json` version.

### Environment prerequisites

- [ ] **`NPM_TOKEN` repo secret exists** — this was the 9.7.1 failure and
      is the one pre-flight item that silently ruins a release. Without it,
      `publish-npm` fails with an empty `NODE_AUTH_TOKEN` (401) _after_ the
      binaries are already attached, so the release lands on GitHub and never
      on npm.
  - **Currently satisfied** — `NPM_TOKEN` was created 2026-09-24T14:32Z and
    9.8.0 / 9.8.1 both published afterwards. Confirm with
    `gh secret list -R codersdfs/search-cli`, or more cheaply and more
    reliably with `npm view github-search-cli version`: if npm's `latest`
    matches the last release you cut, the secret works. Do **not** try to
    re-mint a token to "check" this — see the note below.
  - **Do not follow the old "mint an Automation token" instruction.** npm no
    longer offers **Automation** as a Classic token type, so that step is
    impossible today and will waste a release. Existing Automation tokens
    keep working, which is why the stored `NPM_TOKEN` is still fine.
  - If the secret ever genuinely has to be replaced, use npm **Trusted
    Publishing (OIDC)** instead of a long-lived token: bind the workflow on
    npmjs.com → Package Settings → Trusted Publisher, and drop
    `NODE_AUTH_TOKEN` from `publish-npm` entirely. `release.yml` already
    requests `id-token: write`, which provenance and OIDC both need. This
    retires the 9.7.1 failure mode for good.
  - Set it if you must: `gh secret set NPM_TOKEN -R codersdfs/search-cli`
    (paste when prompted — never paste the token into chat/logs/issues).
  - Recover: `gh run rerun <run-id> --failed` re-runs only `publish-npm`;
    binaries/checksums jobs are not repeated.
- [ ] Local npm auth is irrelevant for CI but check `npm whoami` if you plan
      a manual `npm publish` fallback (a dead `~/.npmrc` token returns 401).
- [ ] `BUN_VERSION` matches across `ci.yml`, `release.yml`, and
      `scripts/postinstall.js` if the toolchain changed.

### Machine state (release-cutting machine)

- [ ] `ghfind --doctor` run **from source** shows no WARNs. Shadowing WARNs
      (multiple installs on PATH with mismatched versions) mean updates/tests
      hit a different copy than the one you think — clean up before releasing
      (`npm uninstall -g github-search-cli --prefix <stale-dir>`).
      A single install whose version differs from source is a PASS (running
      newer source than published), not a problem.
- [ ] No stray untracked files in the repo (`git status`): `*.tgz`, `.bak`,
      scratch notes, `nul` (a Windows reserved-name accident — delete with
      `rm ./nul` in Git Bash).
- [ ] **Ignore the red `Release` rows in `gh run list` history.** `release.yml`
      only triggers on `tags: ["v*"]` now, but it used to fire on every push to
      `main`, so the run list is full of failures that were just the
      `if: startsWith(github.ref, 'refs/tags/v')` guard skipping every job.
      They are noise, not broken releases. Judge health by the `CI` rows on
      `main` and by whether npm's `latest` matches your last tag.

## 4. Release checklist (tag + verify)

1. Bump `version` in `package.json` only. `src/version.ts`, `tsup.config.ts`
   (`__GHFIND_VERSION__`), and the release workflow pick it up automatically.
2. `CHANGELOG.md`: rename `## [Unreleased]` →
   `## [X.Y.Z] — YYYY-MM-DD (released)`. Dates/versions must mirror npm.
3. Add `release-notes/X.Y.Z.md` (narrative + `Added`/`Fixed` sections).
4. `README.md` → `Changelog` section: prepend the new version, keep only the
   latest three, drop the oldest.
5. Tag: `git tag vX.Y.Z && git push --tags`. The `Release` workflow
   (`.github/workflows/release.yml`) verifies the tag with the CI gate
   (tests, format, **lint**, **typecheck**, build), builds
   `ghfind-<os>-<arch>` binaries via `bun build --compile`, attaches them to
   the GitHub Release with `SHA256SUMS.txt`, then `publish-npm` runs
   `npm publish --provenance`.
6. **Verify the artifacts** (9.7.1 lesson: `gh release download` truncated
   large binaries silently — twice):
   - Compare asset sizes against GitHub:
     `gh api repos/codersdfs/search-cli/releases/tags/vX.Y.Z --jq '.assets[] | "\(.name) \(.size)"'`.
   - Download each binary and `sha256sum` it against `SHA256SUMS.txt`. If a
     size/hash mismatches, your download is truncated — resume with
     `curl -L -C - --retry 3 -o <file> <asset-url>` and re-hash. A mismatch
     is a broken download, not a broken release, unless the resumed file
     still mismatches.
   - Smoke-test one binary (`ghfind --version`); note it may hang in
     sandboxed/non-TTY shells because of the update check.
7. **Confirm npm**: `npm view github-search-cli version` must mirror the tag
   and the CHANGELOG. Then update local global installs
   (`npm install -g github-search-cli`) and re-run `ghfind --doctor`.

## 4b. Windows spawning quirks (MCP / agent integrations)

Strict Node/Bun `spawn()` on Windows cannot resolve npm's `.cmd`/`.ps1`/
extensionless shims (EINVAL/ENOENT since Node 18.20) — a bare `"command":
"ghfind"` only ever resolves to a real `ghfind.exe` on PATH. This broke the
pi agent twice: first via a stale `~/.bun/bin/ghfind.exe` (v9.4.4, predating
the `mcp` command), then via ENOENT after that exe was removed.

Rules for agent configs (e.g. pi's `~/.pi/agent/mcp.json`):

- Use a command that IS a real `.exe`: `"command": "bun", "args":
["<repo>/src/cli.ts", "mcp"]` (dev — runs latest source) or
  `"command": "node", "args": ["<npm-global>/node_modules/github-search-cli/dist/cli.js",
"mcp"]` (installed release).
- `ghfind mcp` must keep stdout pure JSON-RPC — never `console.log` anything
  else on stdout; diagnostics go to stderr. Test with a piped
  initialize/`tools/list` handshake before shipping.

## 5. Anti-patterns

- Do not edit published CHANGELOG sections or rewrite git tags.
- Do not duplicate the full changelog into README — link to `CHANGELOG.md`.
- Do not invent test counts, versions, or dates — read them from the repo/npm.
- Do not remove `typecheck`/`lint` from the CI gates or the Release verify
  job — both are green (Biome 2.5.14 baseline, tsc clean; see the closed
  typecheck-opentui-drift ticket).
- Do not commit `*.tgz`, `vendor/` binaries, `.bak`, or scratch scripts
  (see CONTRIBUTING.md "No stray repo-junk").
