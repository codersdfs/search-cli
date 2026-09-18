# ghfind Launch Kit

Everything needed to launch `ghfind` publicly. Written 2026-09-18.

One goal for the whole kit: **get 500 people to try the tool, not to
"raise awareness."** Every asset below is written for that metric.

---

## 0. Ground truth (checked today, so nobody re-argues it)

| Fact                  | Status                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm package           | `github-search-cli` v9.5.1, published 2026-09-16, 573 KB unpacked                                                                                               |
| `ghfind` on npm       | **unregistered** (404) — do not mention as an npm install path anywhere                                                                                         |
| GitHub repo           | `codersdfs/search-cli` — 1 star, no description, no topics, no homepage                                                                                         |
| Binaries              | `ghfind-<os>-<arch>` via GitHub Releases (bun build --compile)                                                                                                  |
| TUI runtime           | needs Bun (auto-downloaded at install time, ~90 MB)                                                                                                             |
| Non-interactive modes | Node 20+ alone                                                                                                                                                  |
| Tests                 | 335 passing, 3-OS CI, format check, build gate                                                                                                                  |
| Known gaps            | `typecheck` (tsc) and `lint` (biome) fail on `@opentui/core` type drift — excluded from CI on purpose; **do not invite scrutiny of code quality in the launch** |
| Live demo             | none — README ships a static `demo.svg`; **there is no recorded GIF yet**                                                                                       |

### Blockers — do these BEFORE any launch (all under a day)

1. **Repo metadata.** Description ("Search GitHub repos from your terminal —
   trending, bookmarks, deep-dive, compare. Keyboard-driven TUI + pipeable
   CLI."), ~10 topics (`cli`, `tui`, `terminal`, `github`, `github-api`,
   `developer-tools`, `commandline`, `trending-repositories`,
   `npm-search`, `octokit`), homepage field = repo URL. This is what
   GitHub search, Explore, and topic pages index. Zero cost, biggest lift.
2. **Record a real demo GIF/asciinema** (tools: `vhs` or `asciinema` +
   `agg`, or `termtosvg`). The README's `demo.svg` is static; motion is
   what converts on Reddit/HN. 20–40s: search → trending → deep-dive →
   bookmark, using the tokyo-night theme at 90×28.
3. **Fix `scripts/brew.rb`** or delete it until Track B lands. It points at
   `github.com/frank/search-cli`, version 0.1.0, and asset names that don't
   match the release artifacts. If one HN commenter runs it, the launch
   thread becomes a bug report.
4. **Set the GitHub social preview image** (Settings → General). Any
   link posted anywhere renders this 1280×640 card.
5. **Enable GitHub Discussions** and add `SECURITY.md` — both are
   two-minute tasks; discussion tab doubles as a zero-friction feedback
   channel during the launch.
6. **Enable npm 2FA** on the publisher account before a thread sends
   strangers to npm.

### Non-blockers (fine after launch)

- Standalone `ghfind` npm pointer package
- Homebrew tap, Scoop manifest, winget (Track B)
- Landing page / GitHub Pages
- `NO_COLOR` support

---

## 1. Launch sequence

| Day                    | Channel           | Asset                                                                                  |
| ---------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| D-2                    | Repo              | metadata, topics, social preview, demo GIF, Discussions on                             |
| D-1                    | npm               | publish a final patch release so the "latest" date looks alive                         |
| D0 (Tue–Thu, 08:00 ET) | **Show HN**       | `marketing/show-hn.md`                                                                 |
| D0+2h                  | **r/commandline** | `marketing/reddit-commandline.md`                                                      |
| D0+4h                  | dev.to            | `marketing/devto-article.md` (cross-post to Medium/Hashnode later)                     |
| D0+1d                  | PRs               | awesome-cli-apps + related lists (`marketing/awesome-lists.md`)                        |
| D0+2d                  | Newsletters       | `marketing/newsletters.md` (Console.dev, Terminal Trove, Console Newsletter)           |
| D0+3d                  | X/Twitter thread  | `marketing/social-thread.md`                                                           |
| D0+7d                  | Follow-ups        | reply to every comment; ship a release fixing whatever the top comment complains about |

HN etiquette: one account, one self-post, never also run an "Ask HN".
Reddit: check each subreddit's self-promo rules (r/commandline allows
tools you wrote; r/rust, r/golang etc. do not apply here).

---

## 2. Files in this kit

| File                                           | Use                                        |
| ---------------------------------------------- | ------------------------------------------ |
| [show-hn.md](show-hn.md)                       | Show HN title + first comment (FAQ format) |
| [reddit-commandline.md](reddit-commandline.md) | Reddit post + comment templates            |
| [devto-article.md](devto-article.md)           | dev.to article, 7 min read                 |
| [newsletters.md](newsletters.md)               | 3 newsletter pitches with submission links |
| [awesome-lists.md](awesome-lists.md)           | Exact PR entries + target lists            |
| [social-thread.md](social-thread.md)           | 7-post X/Twitter thread                    |
| [demo-script.txt](demo-script.txt)             | Shot list for recording the GIF            |

Rule for all copy: **show real commands and real output. No
superlatives, no "blazingly fast", no emoji in HN copy.**
