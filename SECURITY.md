# Security Policy

## Supported versions

| Version                                 | Supported           |
| --------------------------------------- | ------------------- |
| latest release on npm / GitHub Releases | ✅                  |
| older releases                          | ❌ — please upgrade |

`ghfind` follows the Keep-a-Changelog versions in [CHANGELOG.md](CHANGELOG.md).

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Use GitHub's private vulnerability reporting:
[Security → Advisories → Report a vulnerability](https://github.com/codersdfs/search-cli/security/advisories/new)

You will need a GitHub account; the report stays private until a fix is
released, and credit is given in the release notes unless you prefer
otherwise.

## Scope notes

- `ghfind` is a local CLI. It stores config/state only in the user's
  home directory (`~/.config/ghfind/`, XDG state/cache dirs) and sends
  requests only to github.com (and the npm registry for update checks /
  `ghfind pkg`).
- A GitHub token, if the user configured one, is stored in the local
  config file. Reports involving token exposure (logs, error reports,
  process listings) are in scope and taken seriously.
- `scripts/postinstall.js` downloads the official Bun release binary at
  install time; supply-chain concerns about that download path are in
  scope.
