# Contributing to ghfind

Thanks for wanting to improve `github-search-cli`! CI and the release workflow
both run on **Bun**, so `bun install` is the blessed path — but plain npm works
for non-TUI work too.

## Dev setup

```bash
git clone https://github.com/codersdfs/search-cli.git
cd search-cli
bun install
bun run dev     # TUI with live reload
```

## Commands

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `bun run dev`       | Run the TUI with `--watch`                    |
| `bun test`          | Run the test suite (Bun's runner)             |
| `bun run check`     | Green gate — Prettier check + full test suite |
| `bun run format`    | Format everything with Prettier               |
| `bun run typecheck` | `tsc --noEmit` (see _Known gaps_ below)       |
| `bun run lint`      | Biome lint (see _Known gaps_ below)           |
| `bun run build`     | Build `dist/` via tsup                        |

## Conventions

- **Tests live next to the module's domain**, under `tests/`, named
  `<module>.test.ts`, and run under `bun test`. Import with explicit `.ts`
  extensions (Bun requirement); test code imports the vitest API surface
  (`describe`/`expect`/`test`/`vi`) from `"vitest"` — Bun aliases this to
  `bun:test` at runtime (see `tests/vitest.d.ts` for the typecheck shim).
- **Keep `src/tui.ts` small.** New overlays/panels should migrate behind the
  overlay registry in `src/tui/overlays/` (`Overlay` interface, `OVERLAYS`
  array). One overlay per commit while parsing the monolith.
- **Changelog first.** User-visible changes go under `[Unreleased]` in
  `CHANGELOG.md` (Keep a Changelog format) in the same PR. The full
  README/CHANGELOG/release-notes/release checklist lives in
  [.github/skills/docs-release/SKILL.md](.github/skills/docs-release/SKILL.md)
  — coding agents follow it, and so should a release PR.
- **No stray repo-junk.** Do not commit `*.tgz` bundles, `vendor/` binaries,
  `.bak` files, or scratch scripts — the repo was recently purged of all
  three.

## Changing behavior

- CLI flags, TUI keybindings and help text must stay in sync: `--help`,
  `src/help.ts`, and the README are the source of truth for users.
- Network code must keep the two-`fetch`-style adaptations (Node 20 + Bun)
  working; compile binaries can't read `package.json` from disk, so version
  must flow through `src/version.ts`.

## Known gaps (status quo, not yours to fix unless you take the ticket)

| Area                | Status                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run typecheck` | Fails on `@opentui/core` 0.4.5 type drift (code uses 0.4.3-era `color`/`backgroundColor` options). Tracked in [.issues/tickets/typecheck-opentui-drift.md](.issues/tickets/typecheck-opentui-drift.md). |
| `bun run lint`      | Biome 2.x configured with `recommended: true`; first clean baseline is tracked in [.issues/tickets/typecheck-opentui-drift.md](.issues/tickets/typecheck-opentui-drift.md).                             |

The green gate (`bun run check`), release workflow, and CI all deliberately
exclude both until those tickets land.

## Releasing

Releases are cut by the maintainers via the GitHub Actions release workflow
(standalone binaries for Linux/macOS/Windows + npm provenance).
