# Support

Thanks for using **ghfind**! Here's where to go for help.

## 1. Diagnose first

Most install/launch problems are caught by the built-in doctor:

```bash
ghfind --doctor
```

It checks the runtime, the bundled/system Bun, Node version, config
validity, and state/cache dirs — and tells you exactly which one is
broken. Include its output (token previews redacted) when asking for
help.

## 2. Where to ask

| Need                     | Where                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Bug reports              | [GitHub Issues](https://github.com/codersdfs/search-cli/issues/new?template=bug_report.md)                     |
| Feature ideas            | [GitHub Issues](https://github.com/codersdfs/search-cli/issues/new?template=feature_request.md)                |
| Questions / usage help   | [GitHub Discussions](https://github.com/codersdfs/search-cli/discussions)                                      |
| Security vulnerabilities | [Private advisory](https://github.com/codersdfs/search-cli/security/advisories/new) — **never a public issue** |

## 3. Common answers

- **TUI won't start** → `ghfind --doctor`. The TUI needs Bun
  (auto-downloaded at install) while scripting modes run on Node 20+
  alone.
- **Rate limited** → run `ghfind login` to import your `gh` CLI token
  or paste one (5,000 req/hr instead of 60/hr unauthenticated).
- **Trending is empty** → GitHub may have changed the trending page
  layout; ghfind tells you instead of failing silently. Check
  [Issues](https://github.com/codersdfs/search-cli/issues) for an open
  report before filing a new one.
- **Update problems** → the npm package is `github-search-cli` (the
  binary is `ghfind`): `npm install -g github-search-cli`.

## 4. Before opening an issue

Please include: ghfind version (`ghfind --version`), OS + terminal, and
the exact command you ran. Feature requests fare better with the
problem you're trying to solve rather than the proposed solution.
