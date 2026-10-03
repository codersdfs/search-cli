# How to use ghfind

A task-oriented guide. For the flag and keybinding _reference_, see
[`README.md`](../README.md) and `ghfind --help`; this page is about **getting a
good result out of a query**, and what to do when one goes wrong.

- [Set up a token first](#set-up-a-token-first)
- [Write a query](#write-a-query)
- [Qualifier reference](#qualifier-reference)
- [Read the results](#read-the-results)
- [When a search returns nothing](#when-a-search-returns-nothing)
- [When something goes wrong](#when-something-goes-wrong)
- [Recipes](#recipes)
- [Environment variables](#environment-variables)

---

## Set up a token first

Without a token GitHub allows **60 requests/hour** from your IP. With one you
get **5,000/hour**. A TUI session that pages through results will exhaust 60
fast, so a token is the difference between a usable session and a session that
stops halfway through.

```bash
ghfind login          # interactive: paste a token, saved to config
```

Or set it for one shell session:

```bash
export GITHUB_TOKEN=ghp_yourtoken
```

Create a token at **GitHub → Settings → Developer settings → Personal access
tokens**. For searching public repositories no scopes are required; a
fine-grained token with no extra permissions is fine. Confirm it took effect:

```bash
ghfind --doctor
```

A token is optional — everything below works without one, just with a much
smaller budget.

---

## Write a query

A query is free text plus optional `qualifier:value` filters:

```bash
ghfind "terminal http client language:Rust"
```

Three things to know:

**1. Typos in qualifiers are corrected, not rejected.** `langauge:Rust`,
`star:1000` and `push:>2024-01-01` all work — ghfix maps them to `language:`,
`stars:` and `pushed:`. Only qualifiers ghfind knows are corrected, so a
qualifier it has never heard of (`is:`, `has:`, `props.*`) is passed through
untouched rather than mangled into something else.

**2. Counts accept `k` and `m`.** `stars:10k` means 10,000 or more. Without a
suffix, a bare number means _exactly_ that number — `stars:100` matches repos
with exactly 100 stars, which is rarely what you want, so prefer `stars:>=100`
or `stars:10k`.

```bash
ghfind "cli stars:10k"          # 10,000 or more
ghfind "cli stars:>=10000"      # identical
ghfind "cli stars:1k..10k"      # between 1,000 and 10,000
```

**3. Quote multi-word phrases.** Unquoted, every word is a separate term:

```bash
ghfind '"machine learning" language:Python'   # the phrase
ghfind 'machine learning language:Python'     # both words, anywhere
```

Prefix any qualifier with `-` to exclude it:

```bash
ghfind "cli topic:cli -language:JavaScript"
```

---

## Qualifier reference

| Qualifier     | Example                    | Notes                                     |
| ------------- | -------------------------- | ----------------------------------------- |
| `language:`   | `language:Rust`            |                                           |
| `stars:`      | `stars:10k`, `stars:>=500` | count, `k`/`m` sugar, `a..b` range        |
| `forks:`      | `forks:>100`               | count                                     |
| `topics:`     | `topics:>3`                | number of topics a repo has               |
| `followers:`  | `followers:>=10000`        | count                                     |
| `size:`       | `size:<1000`               | kilobytes                                 |
| `fork:`       | `fork:true`, `fork:only`   | `fork` is a boolean, `forks` is a count   |
| `archived:`   | `archived:false`           | boolean                                   |
| `topic:`      | `topic:machine-learning`   | one topic (repeat for more)               |
| `user:`       | `user:torvalds`            | repos owned by a user                     |
| `org:`        | `org:rust-lang`            | repos owned by an organization            |
| `repo:`       | `repo:facebook/react`      | one exact repository                      |
| `in:`         | `in:name,description`      | `name`, `description`, `topics`, `readme` |
| `pushed:`     | `pushed:>2024-01-01`       | `YYYY-MM-DD`                              |
| `created:`    | `created:>2020-01-01`      | `YYYY-MM-DD`                              |
| `updated:`    | `updated:>2024-06-01`      | `YYYY-MM-DD`                              |
| `license:`    | `license:apache-2.0`       | SPDX-ish keyword                          |
| `visibility:` | `visibility:public`        | `public`, `private`, `internal`           |

An invalid value is rejected **before** the request is sent, with the fix in the
message:

```console
$ ghfind "cli stars:abc"
⚠ Invalid query: "stars:abc" is not a number — use stars:100, stars:>=100, or stars:1k..10k
  Try: cli
```

---

## Read the results

Results are shown in the TUI. In the CLI, `--json` / `--csv` / `--markdown`
give you the same data in a form you can pipe:

```bash
ghfind "cli language:Rust" --json | jq -r '.[].fullName'
ghfind "cli language:Rust" --json | jq 'length'      # how many came back
ghfind "cli language:Rust" --markdown                # for pasting into an issue
```

Sort changes the order, not the query:

```bash
ghfind "cli" --sort stars      # most-starred
ghfind "cli" --sort updated    # most recently touched
ghfind "cli" --sort forks
ghfind "cli" --sort best-match # GitHub's own relevance order
```

In the TUI, `Esc` opens the leader menu (or click the <kbd>☰ menu</kbd> button in
the bottom-right corner), where **Sort** cycles the same strategies without
leaving the results.

---

## When a search returns nothing

ghfind ranks the qualifiers by how likely each is to be what killed the
result, and suggests a loosened query rather than a generic "try again":

```console
🔍 No results for "rust stars:>=5000000".
  Try: rust stars:>=500000
```

Each suggestion rewrites one qualifier instead of dropping it, so the retry is
still a recognisable version of your question. The order reflects how sharply
each filter narrows things: a star or size threshold empties a result set
outright, so those are loosened first and a `language:` filter — which matches
plenty on its own — is touched last.

If a suggestion still returns nothing, the qualifier you most care about is
probably `repo:`, `user:` or `org:` — those restrict to a single account.

---

## When something goes wrong

| Message                              | Meaning                                      | Fix                                                                                            |
| ------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `API rate limit exceeded (60/hr)`    | No token, or the hourly budget is spent      | `ghfind login`, or wait for the reset                                                          |
| `API rate limit exceeded (5,000/hr)` | Authenticated budget spent                   | Wait, or `c` in the TUI to swap tokens                                                         |
| `Bad GitHub token (401)`             | Token rejected — usually revoked or mistyped | `t` in the TUI, or `ghfind login`                                                              |
| `Forbidden (403)`                    | Authenticated but not allowed                | Read the reason in the message; often SSO not authorizing the token, or a secondary rate limit |
| `Network error`                      | Genuine connectivity or a 5xx                | Retry with `r`                                                                                 |

While one of these is showing in the TUI status bar, these keys work:

| Key | Action                                                |
| --- | ----------------------------------------------------- |
| `r` | Retry                                                 |
| `t` | Fix the token inline (saves it and re-runs the query) |
| `u` | Drop the token and retry unauthenticated              |
| `c` | Swap in a different token (rate limit)                |

**To see the actual reason behind an error**, set `GHFIND_LOG` — the TUI owns
the screen and cannot print diagnostics into it, so it writes them to a file:

```bash
GHFIND_LOG=/tmp/ghfind.log ghfind
# then quit with q and read the log
```

A `403` includes the response body, which names the real cause; token values
are redacted from logged URLs.

---

## Recipes

```bash
# Popular, actively maintained Rust CLI tools
ghfind "cli language:Rust stars:10k -archived:true"

# Something big and recently touched by a specific org
ghfind "org:rust-lang pushed:>2025-01-01"

# Exactly this repository
ghfind "repo:facebook/react"

# Topic + size ceiling (small, focused libraries)
ghfind "topic:parser size:<500 stars:>=100"

# Find the name of a project you half-remember
ghfind "json schema validator in:name"

# Just how many repos match (no output formatting)
ghfind "topic:cli language:Rust" --count

# Top 5 by stars, as CSV
ghfind "topic:cli" --sort stars --limit 5 --csv

# Watch a query for new results
ghfind "topic:ai language:Rust" --watch --interval 300

# Trending instead of searching
ghfind --trending --since weekly
ghfind --trending rust --count

# Pipe into another tool
ghfind "cli language:Rust" --json | jq -r '.[].url'
```

---

## Environment variables

| Variable          | Effect                                                  |
| ----------------- | ------------------------------------------------------- |
| `GITHUB_TOKEN`    | Raises the rate limit from 60/hr to 5,000/hr            |
| `GHFIND_CONFIG`   | Config file path, overriding the XDG lookup             |
| `GHFIND_LOG`      | Write TUI diagnostics to this file                      |
| `NO_COLOR`        | Disables colored `--doctor` output                      |
| `XDG_CONFIG_HOME` | Relocates `~/.config` (config lives at `<dir>/ghfind/`) |
| `XDG_STATE_HOME`  | Relocates history/bookmarks/session state               |

`GITHUB_TOKEN` takes precedence over a token saved in the config file.

See [`README.md`](../README.md) for the full flag, subcommand and keybinding
reference, [`CONTRIBUTING.md`](../CONTRIBUTING.md) for development commands, and
[`CHANGELOG.md`](../CHANGELOG.md) for what changed in each release.
