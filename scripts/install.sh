#!/bin/sh
# ghfind installer — https://github.com/codersdfs/search-cli
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/codersdfs/search-cli/main/scripts/install.sh | sh
#
# Downloads the standalone ghfind binary for your platform from GitHub
# Releases (no Node.js or Bun needed) into ~/.local/bin, /usr/local/bin,
# or a directory of your choice via GHFIND_INSTALL_DIR.
#
# Options via environment:
#   GHFIND_VERSION   a release tag without the leading v (default: latest)
#   GHFIND_INSTALL_DIR  target dir (default: ~/.local/bin if writable)
#
# The script never needs sudo: if the default dir is not writable it falls
# back to ~/.local/bin and prints a PATH reminder.

set -eu

REPO="codersdfs/search-cli"

printf '\n' # cosmetic spacing when piped

# ── Detect platform ────────────────────────────────────────────────────
os=$(uname -s)
arch=$(uname -m)

case "$os" in
  Linux) plat="linux" ;;
  Darwin) plat="darwin" ;;
  *)
    printf 'ghfind install: unsupported OS "%s".\n' "$os"
    printf 'Windows: install with npm (npm i -g github-search-cli) or scoop/winget once listed.\n' >&2
    exit 1
    ;;
esac

case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *)
    printf 'ghfind install: unsupported architecture "%s".\n' "$arch" >&2
    exit 1
    ;;
esac

asset="ghfind-${plat}-${arch}"

# ── Resolve version ────────────────────────────────────────────────────
if [ -n "${GHFIND_VERSION:-}" ]; then
  version="$GHFIND_VERSION"
else
  # Latest release tag, following redirects; avoids a jq dependency.
  version=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
    "https://github.com/${REPO}/releases/latest" | sed 's|.*/tag/v||')
  if [ -z "$version" ] || [ "$version" = "latest" ]; then
    printf 'ghfind install: could not resolve the latest release version.\n' >&2
    exit 1
  fi
fi

base_url="https://github.com/${REPO}/releases/download/v${version}"

# ── Pick install dir (never requires sudo) ─────────────────────────────
if [ -n "${GHFIND_INSTALL_DIR:-}" ]; then
  install_dir="$GHFIND_INSTALL_DIR"
elif [ -w /usr/local/bin ] 2>/dev/null; then
  install_dir="/usr/local/bin"
else
  install_dir="${HOME}/.local/bin"
fi

mkdir -p "$install_dir"

# ── Download binary + checksum ─────────────────────────────────────────
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

printf 'Installing ghfind %s (%s) -> %s\n' "$version" "$asset" "$install_dir"

curl -fsSL --retry 3 -o "$tmp/ghfind" "${base_url}/${asset}"
curl -fsSL --retry 3 -o "$tmp/SHA256SUMS.txt" "${base_url}/SHA256SUMS.txt" ||
  printf 'warning: could not download SHA256SUMS.txt; skipping checksum verification\n'

# ── Verify checksum when we have the sums file ─────────────────────────
if [ -f "$tmp/SHA256SUMS.txt" ]; then
  expected=$(grep " ${asset}\$" "$tmp/SHA256SUMS.txt" | awk '{print $1}')
  if [ -n "$expected" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual=$(sha256sum "$tmp/ghfind" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
      actual=$(shasum -a 256 "$tmp/ghfind" | awk '{print $1}')
    else
      actual=""
      printf 'warning: no sha256sum/shasum found; skipping checksum verification\n'
    fi
    if [ -n "$actual" ] && [ "$actual" != "$expected" ]; then
      printf 'ghfind install: checksum mismatch!\n  expected %s\n  actual   %s\n' "$expected" "$actual" >&2
      exit 1
    fi
    [ -n "$actual" ] && printf 'Checksum OK (%s)\n' "$actual"
  fi
fi

# ── Install ────────────────────────────────────────────────────────────
mv "$tmp/ghfind" "${install_dir}/ghfind"
chmod +x "${install_dir}/ghfind"

# ── PATH hint ──────────────────────────────────────────────────────────
case ":$PATH:" in
  *":${install_dir}:"*) ;;
  *)
    printf '\nNOTE: %s is not in your PATH.\n' "$install_dir"
    printf 'Add it, e.g.:\n  echo '"'"'export PATH="%s:$PATH"'"'"' >> ~/.bashrc   # or ~/.zshrc\n' "$install_dir"
    ;;
esac

printf 'Done. Run:  ghfind --version\n'
