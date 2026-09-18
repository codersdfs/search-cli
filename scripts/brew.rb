# typed: true
# frozen_string_literal: true

# Homebrew formula for ghfind.
#
# NOTE: this file is a template, kept in-tree for a future homebrew tap.
# Before use:
#   1. Replace VERSION with the released version tag.
#   2. Fill SHA256 placeholders from the SHA256SUMS.txt asset attached to
#      the GitHub Release (the release workflow generates it).
#   3. Host it in a tap repo (e.g. codersdfs/tap) at Formula/ghfind.rb,
#      then: brew install codersdfs/tap/ghfind
# See marketing/README.md (Track B) for the rollout order.

class Ghfind < Formula
  desc "Search GitHub repos from your terminal — trending, bookmarks, deep-dive"
  homepage "https://github.com/codersdfs/search-cli"
  version "9.5.1"
  license "MIT"

  livecheck do
    url :stable
    regex(/^v?(\d+(?:\.\d+)+)$/i)
  end

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/codersdfs/search-cli/releases/download/v#{version}/ghfind-darwin-arm64"
      sha256 "SHA256_PLACEHOLDER"
    else
      url "https://github.com/codersdfs/search-cli/releases/download/v#{version}/ghfind-darwin-x64"
      sha256 "SHA256_PLACEHOLDER"
    end
  end

  on_linux do
    if Hardware::CPU.arm? && Hardware::CPU.is_64_bit?
      url "https://github.com/codersdfs/search-cli/releases/download/v#{version}/ghfind-linux-arm64"
      sha256 "SHA256_PLACEHOLDER"
    else
      url "https://github.com/codersdfs/search-cli/releases/download/v#{version}/ghfind-linux-x64"
      sha256 "SHA256_PLACEHOLDER"
    end
  end

  def install
    bin.install "ghfind" => "ghfind"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/ghfind --version")
  end
end
