# typed: true
# frozen_string_literal: true

class SearchCli < Formula
  desc "Interactive GitHub repository browser for the terminal"
  homepage "https://github.com/frank/search-cli"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/frank/search-cli/releases/download/v#{version}/search-cli-darwin-arm64"
      sha256 "SHA256_PLACEHOLDER"
    else
      url "https://github.com/frank/search-cli/releases/download/v#{version}/search-cli-darwin-x64"
      sha256 "SHA256_PLACEHOLDER"
    end
  end

  on_linux do
    url "https://github.com/frank/search-cli/releases/download/v#{version}/search-cli-linux-x64"
    sha256 "SHA256_PLACEHOLDER"
  end

  def install
    bin.install "search-cli"
  end

  test do
    assert_match "search-cli", shell_output("#{bin}/search-cli --version")
  end
end
