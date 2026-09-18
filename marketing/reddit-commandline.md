# Reddit launch post — r/commandline

Check the sub's rules on the day you post (self-promo is tolerated for
tools you wrote, but the mods vary). Cross-post targets afterwards, in
this order: r/Terminal_UI (TUI screenshots are the native content
there), r/devops, r/programming (only if it gains traction first).

## Title

```
ghfind — search GitHub repos from your terminal, keyboard-driven TUI, no login needed
```

## Body

---

I kept having the same loop: browser → github.com/search → sort by
stars → open repo → skim README → new tab. So I built ghfind, a
terminal client for it. Repo: https://github.com/codersdfs/search-cli

**Search** — qualifiers work like GitHub's own:
`ghfind "language:rust stars:>1000 topic:cli" --json | jq '.[].fullName'`
No token needed for search. `ghfind login` imports your gh CLI token
for 5k req/hr.

**Trending** — day/week/month/year with language filters (GitHub has no
API for this, so it's scraped — with golden tests pinned to a captured
page so breakage fails loudly, not silently).

**TUI stuff** ([GIF placeholder — record before posting, r/commandline
upvotes motion]):

- bookmarks with tags + a release tracker (`ghfind --releases`)
- deep-dive: languages, contributors, full README rendered in-terminal
- side-by-side compare of 2+ repos
- everything exportable: JSON / CSV / Markdown / count / URLs

**Install:**

```
npm install -g github-search-cli
```

or grab a single static binary from Releases (Linux/macOS/Windows) —
no Node needed. Non-interactive modes run on plain Node 20+; the TUI
uses a Bun binary downloaded at install time (skippable, CLI works
without it).

Feedback welcome, especially on the TUI keybindings (Space = leader
menu, `?` shows everything). It's MIT, 335 tests, CI on all three OSes.

---

## Comment templates

**When someone asks "why not gh CLI":**

> gh search covers plain search, but no trending, no bookmarks/release
> tracking, no compare, and it requires login. ghfind is complementary —
> the JSON output is deliberately jq-shaped so you can pipe either into
> the same scripts.

**When someone reports the trending parser broke:**

> Thanks — that's the scraper, GitHub changed their layout. Pinning it
> now; `ghfind --json` search modes are unaffected. Fix will be in the
> next release (changelog gets it same-day).

**When someone says "just use the API":**

> The search features do use the REST API. Trending is the one thing
> GitHub doesn't expose, hence the scraper. If that ever dies, search +
> bookmarks + releases all keep working.

## Post-launch rhythm

Reply within the first 2 hours; Reddit ranks by comment velocity. Never
argue with "just use curl" comments — one polite link, move on.
