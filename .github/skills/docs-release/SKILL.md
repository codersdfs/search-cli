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

## 3. Release checklist (version bump)

1. Bump `version` in `package.json` only. `src/version.ts`, `tsup.config.ts`
   (`__GHFIND_VERSION__`), and the release workflow pick it up automatically.
2. `CHANGELOG.md`: rename `## [Unreleased]` →
   `## [X.Y.Z] — YYYY-MM-DD (released)`. Dates/versions must mirror npm.
3. Add `release-notes/X.Y.Z.md` (narrative + `Added`/`Fixed` sections).
4. `README.md` → `Changelog` section: prepend the new version, keep only the
   latest three, drop the oldest.
5. Tag: `git tag vX.Y.Z && git push --tags`. The `Release` workflow
   (`.github/workflows/release.yml`) verifies the tag with the CI gate, builds
   `ghfind-<os>-<arch>` binaries via `bun build --compile`, attaches them to
   the GitHub Release, then `publish-npm` runs `npm publish --provenance`.
6. Confirm `BUN_VERSION` env in `ci.yml` / `release.yml` matches
   `scripts/postinstall.js` if the Bun toolchain changed.

## 4. Anti-patterns

- Do not edit published CHANGELOG sections or rewrite git tags.
- Do not duplicate the full changelog into README — link to `CHANGELOG.md`.
- Do not invent test counts, versions, or dates — read them from the repo/npm.
- Do not remove `typecheck`/`lint` from the CI gates or the Release verify
  job — both are green (Biome 2.5.14 baseline, tsc clean; see the closed
  typecheck-opentui-drift ticket).
- Do not commit `*.tgz`, `vendor/` binaries, `.bak`, or scratch scripts
  (see CONTRIBUTING.md "No stray repo-junk").
