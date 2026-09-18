# Awesome lists + social thread

## Awesome-list PRs

Submit after the launch posts, while there's a thread to point at
(some lists like signs of life). PRs are one-liners — match each list's
alphabetical placement and line format exactly, or CI will bounce it.

### 1. agarrharr/awesome-cli-apps (~20k stars)

File: `README.md`, under **Developer Tools → GitHub** (or the closest
existing subsection — keep alphabetical order):

```markdown
- [ghfind](https://github.com/codersdfs/search-cli) — Search GitHub repos from the terminal with a keyboard-driven TUI; trending, bookmarks, release tracking and pipeable JSON/CSV output
```

PR title: `Add ghfind`
PR body: one sentence on what it does + which section/position you
picked + "happy to adjust the description." Link the demo GIF.

### 2. More lists worth the same one-line PR

- `unixorn/awesome-git-addons` — only if you frame the clone/pipe flow
- `alebcay/awesome-shell` — command-line productivity section
- `rothgar/awesome-tuis` — TUI-specific; this is your best-fit list,
  submit here first (they want a screenshot in the PR)
- `sindresorhus/awesome` nodejs section — only after >100 stars

### 3. Not lists, but higher leverage

- **GitHub Topics**: add the 10 topics from the checklist — topic pages
  are GitHub's own discovery surfaces
- **stackshare / AlternativeTo** entries for "gh search alternatives"
  queries — set-and-forget SEO

---

## X/Twitter thread (7 posts)

Post at 09:00 ET on a weekday. Post 1 carries the GIF.

---

**1/**
Search GitHub from your terminal — no browser, no login.

ghfind: repo search, trending, bookmarks, and release tracking in one keyboard-driven TUI.

npm install -g github-search-cli

[GIF]

**2/**
The search is the whole GitHub qualifier language:

ghfind "language:rust stars:>1000 topic:cli" --json | jq '.[].fullName'

JSON, CSV, Markdown, or just the count. Tokenless at 10 req/min; import your gh CLI token for 5,000 req/hr.

**3/**
Trending repos — the thing GitHub's API doesn't give you:

ghfind --trending --since weekly

Day / week / month / year, filter by language. (Yes, it scrapes. Yes, it's golden-tested against a live capture so it fails loudly, not silently.)

**4/**
Deep-dive any repo without leaving the terminal: languages, contributors, the README rendered properly, activity.

Then bookmark it — and ghfind --releases tells you when your bookmarks ship a new release.

**5/**
Comparing libraries? Pick two+ repos, get a side-by-side table: stars, forks, languages, topics, description.

ghfind --compare denoland/deno oven-sh/bun

**6/**
No Node? No problem — standalone static binaries on GitHub Releases for Linux, macOS, Windows. One file, no runtime.

And the scripting modes run on plain Node 20+, so CI scripts never need the TUI at all.

**7/**
MIT, 335 tests, CI on three OSes, no telemetry, no account.

Repo + README with the full feature table:
https://github.com/codersdfs/search-cli

Feature requests very welcome — what's missing for you?

---

## Reply strategy for the thread

- Every reply with a screenshot of ghfind handling a real query gets a
  like from the main account — replies boost reach more than the
  original post.
- If someone builds a feature request into a reply, open a GitHub issue
  from it and reply with the issue link. It shows the loop works.
