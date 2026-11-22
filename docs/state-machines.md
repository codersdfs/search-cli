# State machines in ghfind

Most of this app is a state machine nobody wrote down. This is the inventory:
what each one's states actually are, where it lives, and — for the latent ones
— the bug it can cause, rated so only the ones worth fixing get fixed.

**Rule applied here: frequency (1–10) × severity (1–10).** Below 5 means file
it, don't design for it. Above 5 means it is worth code.

## Explicit now

| Machine           | States                                                                          | Home                                                              |
| ----------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| View / screen     | `mode` × `overlay` → which of the five main panels are visible                  | `src/view-state.ts`                                               |
| Search status bar | `idle` \| `searching` \| `loading` \| `success` \| `error`, plus spinner frames | `src/status.ts` (already explicit — the reference implementation) |

### View / screen (`src/view-state.ts`) — freq 6 × sev 5 = 30

`mode` is one of `landing` / `search` / `trending` / `packages` / `hn`; `overlay` is
one of the fifteen overlay ids or `none`. `panelsFor(state)` is the single
projection of that pair onto the main-view panels, and the shell's `applyView`
is the only writer of their visibility.

This is the one that earned its module: a panel shown but never reset has
already shipped once (`orgBox` kept half the content area until restart). The
matrix was hand-copied into six functions, which is how that copy drifted.

## Rated, filed, not fixed

| Bug                                                             | Freq | Sev | Product | Where                                                    |
| --------------------------------------------------------------- | ---- | --- | ------- | -------------------------------------------------------- |
| Update-available panel replaces the just-upgraded release notes | 2    | 2   | 4       | [#10](https://github.com/codersdfs/search-cli/issues/10) |
| Post-upgrade panel announces a downgrade as an update           | 1    | 3   | 3       | [#11](https://github.com/codersdfs/search-cli/issues/11) |

Fixing issue #10 would mean a session-scoped "notes already shown" flag in
`checkForUpdateAndShow`; #11 is a one-line `isNewerVersion` gate in
`checkPostUpgradePanel`. Neither is worth the state until someone is in that
code for another reason.

## Checked and already correct (no action)

These looked like implicit-machine bugs in the first pass; each is guarded in
the code today, so nothing is filed.

| Suspected bug                                              | Why it can't happen                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Error-hint keys (`r`/`t`/`u`/`c`) hijacked by a stale hint | `doSearch` and the package/trending paths set `errorHint = null` on every fresh search                                                                     |
| `/` repaints the query row over the token prompt           | the token prompt owns its own keyboard scope and returns before the global handlers                                                                        |
| MCP calls before `initialize` get half-served              | explicit pre-init guard rejects anything but `initialize`/`ping`, and `initialize` itself opens the gate for clients that skip `notifications/initialized` |
| Watch keeps polling after its retry budget is spent        | `failCount` resets on success and the interval is cleared at `MAX_FAILS`                                                                                   |
| Notification ids get reissued                              | `ensureLoaded()` loads once per process and derives `nextId` from the file                                                                                 |
| Leaving graph fullscreen leaves a half-screen              | `toggleGraph` restores `resultsBox.visible`, both widths, and the detail text                                                                              |
| Superseded async response repaints the list                | `packageSearchEpoch` and `healthEpoch` both gate their continuations                                                                                       |

## Still implicit, no known bug

| Machine                  | States as encoded today                                               | Home                                                      |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------- |
| Async load per screen    | `isLoading` + the two epochs above                                    | `src/tui.ts`, `src/trending.ts`, `src/package-browser.ts` |
| Token prompt             | `tokenPromptQuery: string \| null` = closed/open                      | `src/tui.ts`                                              |
| Bookmark unseen releases | `lastSeenAt` compared against release dates at render time            | `src/bookmarks.ts`, `src/releases.ts`                     |
| Image fetch slots        | `activeFetches` counter + `waiting` queue (already an explicit queue) | `src/image-loader.ts`                                     |
| Session restore          | total function from unknown → valid state                             | `src/session.ts`                                          |
