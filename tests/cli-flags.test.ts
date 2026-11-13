import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FORMAT_VALUES, format, type Format } from "../src/output.ts";
import { resolveTrendingSince } from "../src/watch.ts";

// Bug-crawl regressions (9.10.x):
//  - `--interval` was documented everywhere but never parsed, so the value
//    leaked into the search query.
//  - `--format <typo>` threw `Unknown format` and routed into the crash-report
//    flow (auto-opening a GitHub issue tab); `--pipe <typo>` silently no-op'd.
//  - An empty query was sent to GitHub as `q=" "` → 422 → "Network error".
//  - Bare `ghfind --trending` fell through to the landing menu.
//  - `--since` accepted any value and silently fell back to daily.
//
// These spawn the real CLI because parseArgs/main are not importable
// (importing src/cli.ts runs main()). Validation happens before any network
// call, so every case below is offline and fast.

const CLI = join(process.cwd(), "src/cli.ts");
const BUN = process.execPath.includes("bun") ? process.execPath : "bun";

function runCli(...args: string[]) {
  const res = spawnSync(BUN, [CLI, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env },
  });
  return {
    code: res.status,
    out: res.stdout ?? "",
    err: res.stderr ?? "",
  };
}

function readSrc(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("--interval", () => {
  test("rejects a non-numeric interval with a friendly error", () => {
    const { code, err } = runCli("--interval", "abc", "--count");
    expect(code).toBe(1);
    expect(err).toContain("Invalid interval");
    expect(err).not.toContain("Network error");
  });

  test("a valid interval parses and reaches --help", () => {
    const { code, out } = runCli("--interval", "60", "--help");
    expect(code).toBe(0);
    expect(out).toContain("--interval <s>");
  });

  test("parseArgs actually has an --interval case", () => {
    expect(readSrc("src/cli.ts")).toContain('case "--interval"');
  });
});

describe("--since", () => {
  test("rejects values outside daily|weekly|monthly", () => {
    const { code, err } = runCli("--since", "fortnightly", "--count");
    expect(code).toBe(1);
    expect(err).toContain("Invalid since");
    expect(err).toContain("daily|weekly|monthly");
  });

  test("accepts a documented period", () => {
    const { code, err } = runCli("--since", "weekly", "--help");
    expect(code).toBe(0);
    expect(err).toBe("");
  });
});

describe("--format / --pipe validation", () => {
  test("an unknown --format fails fast without the crash-report flow", () => {
    const { code, err } = runCli("--format", "bogus");
    expect(code).toBe(1);
    expect(err).toContain("Invalid format");
    expect(err).not.toContain("unexpected error");
    expect(err).not.toContain("Help us fix it");
  });

  test("an unknown --pipe target fails fast instead of silently no-oping", () => {
    const { code, err } = runCli("--pipe", "bogus");
    expect(code).toBe(1);
    expect(err).toContain("Invalid pipe target");
    expect(err).toContain("open|clone");
  });

  test("every advertised format is accepted by the format registry", () => {
    for (const value of FORMAT_VALUES) {
      expect(() => format([], value as Format)).not.toThrow();
    }
    expect(FORMAT_VALUES).toEqual(
      expect.arrayContaining(["json", "csv", "markdown", "urls", "names"]),
    );
  });
});

describe("health subcommand", () => {
  test("parseArgs has the health cases", () => {
    const src = readSrc("src/cli.ts");
    expect(src).toContain('case "health"');
    expect(src).toContain('case "--health"');
  });

  test("a malformed ref fails fast with the owner/name hint", () => {
    const { code, err } = runCli("health", "not-a-repo");
    expect(code).toBe(1);
    expect(err).toContain("owner/name");
    expect(err).not.toContain("Network error");
  });

  test("bare health falls through to a query instead of a usage error", () => {
    // `ghfind health` with no ref is a search for "health" (same convention
    // as bare `ghfind deep-dive`), so it must not exit before any output.
    const src = readSrc("src/cli.ts");
    expect(src).toMatch(/case "health": \{[\s\S]*?flags\.health = next/);
  });

  test("--health without --compare fails fast with a hint", () => {
    const { code, err } = runCli("--health");
    expect(code).toBe(1);
    expect(err).toContain("--health requires --compare");
  });
});

describe("empty query", () => {
  test("fails fast with usage instead of GitHub 422 → Network error", () => {
    const { code, err } = runCli("--count");
    expect(code).toBe(1);
    expect(err).toContain("No search query");
    expect(err).not.toContain("Network error");
    expect(err).not.toContain("unexpected error");
  });

  test("also guards --format and --pipe with no query", () => {
    for (const args of [
      ["--format", "urls"],
      ["--pipe", "clone"],
      ["--watch"],
    ]) {
      const { code, err } = runCli(...args);
      expect(code, `expected fail-fast for ${args.join(" ")}`).toBe(1);
      expect(err).toContain("No search query");
    }
  });
});

describe("bare --trending", () => {
  test("cli passes the trending start mode into the TUI", () => {
    const src = readSrc("src/cli.ts");
    expect(src).toContain('flags.trending ? "trending" : undefined');
  });

  test("launchBrowser honors startMode instead of always landing", () => {
    const src = readSrc("src/tui.ts");
    expect(src).toContain('if (startMode === "trending")');
    expect(src).toMatch(/startMode\?: "trending"/);
  });
});

describe("MCP user profile text", () => {
  test("ghfind_user_profile returns formatted text, not raw JSON", () => {
    const src = readSrc("src/mcp-server.ts");
    expect(src).toContain("formatUserText(profile)");
    expect(src).not.toContain("formatUserJson");
  });
});

describe("trending TUI", () => {
  test("footer documents `/` as scroll-to-top, matching the key handler", () => {
    const src = readSrc("src/trending.ts");
    expect(src).toContain("/ top");
    expect(src).not.toContain("/ search");
    expect(src).toContain("moveSelection(-selectedRepoIdx)");
  });

  test("quit paths destroy the renderer before process.exit", () => {
    for (const file of ["src/trending.ts", "src/package-browser.ts"]) {
      const src = readSrc(file);
      expect(src, `${file} should destroy the renderer on quit`).toContain(
        "renderer.destroy()",
      );
    }
    expect(readSrc("src/tui.ts")).toContain("activeRenderer?.destroy()");
  });
});

describe("watch --since passthrough", () => {
  test("explicit --since wins over the query-string convention", () => {
    expect(resolveTrendingSince({ query: "", since: "weekly" })).toBe("weekly");
    expect(resolveTrendingSince({ query: "daily", since: "monthly" })).toBe(
      "monthly",
    );
    // Explicit --daily overrides the legacy `ghfind --watch --trending weekly`.
    expect(resolveTrendingSince({ query: "weekly", since: "daily" })).toBe(
      "daily",
    );
  });

  test("legacy query-string convention still applies when --since is absent", () => {
    expect(resolveTrendingSince({ query: "weekly" })).toBe("weekly");
    expect(resolveTrendingSince({ query: "monthly" })).toBe("monthly");
    expect(resolveTrendingSince({ query: "" })).toBe("daily");
  });

  test("cli forwards an explicit --since to watch mode", () => {
    expect(readSrc("src/cli.ts")).toContain(
      "since: flags.sinceExplicit ? flags.since : undefined",
    );
  });
});

describe("clone usage guards", () => {
  // Every case below fails before git is spawned, so it stays offline.

  test("bare `clone` prints usage and exits 1", () => {
    const { code, err } = runCli("clone");
    expect(code).toBe(1);
    expect(err).toContain("Usage: ghfind clone <owner/repo>");
  });

  test("a malformed ref is rejected with the expected shape", () => {
    const { code, err } = runCli("clone", "not-a-repo-ref");
    expect(code).toBe(1);
    expect(err).toContain("is not a repo name");
  });

  test("`--dir` with no value is a usage error, not a stray query word", () => {
    const { code, err } = runCli("clone", "facebook/react", "--dir");
    expect(code).toBe(1);
    expect(err).toContain("Missing value for --dir");
  });

  test("`clone` is documented in --help", () => {
    const { out } = runCli("--help");
    expect(out).toContain("ghfind clone <owner/repo>");
    expect(out).toContain("--dir <path>");
    expect(out).toContain("--ssh");
  });
});

describe("release workflow dispatch", () => {
  // Every case below fails before any dispatch is attempted, so it stays offline.

  test("bare `release` prints usage and exits 1", () => {
    const { code, err } = runCli("release");
    expect(code).toBe(1);
    expect(err).toContain("Usage: ghfind release run --tag");
  });

  test("`release run` without --tag is a usage error", () => {
    const { code, err } = runCli("release", "run");
    expect(code).toBe(1);
    expect(err).toContain("Missing --tag");
  });

  test("an invalid --tag is rejected before any dispatch", () => {
    const { code, err } = runCli("release", "run", "--tag", "not-a-tag");
    expect(code).toBe(1);
    expect(err).toContain("Invalid tag");
  });

  test("`release run --tag v9.12.0 --dry-run` succeeds offline", () => {
    const { code, out } = runCli(
      "release",
      "run",
      "--tag",
      "v9.12.0",
      "--dry-run",
    );
    expect(code).toBe(0);
    expect(out).toContain("Dry run");
  });

  test("`release` is documented in --help", () => {
    const { out } = runCli("--help");
    expect(out).toContain("ghfind release run --tag");
    expect(out).toContain("--dry-run");
  });
});

describe("--registry", () => {
  test("rejects an unknown registry before touching the network", () => {
    const { code, err } = runCli(
      "pkg",
      "express",
      "--registry",
      "pypi",
      "--json",
    );
    expect(code).toBe(1);
    expect(err).toContain('Unknown registry: "pypi"');
    expect(err).toContain("npm|crates|rubygems|nuget|maven");
    expect(err).not.toContain("search failed");
    expect(err).not.toContain("Network error");
  });

  test("a missing value is reported as a missing value", () => {
    const { code, err } = runCli("pkg", "express", "--registry", "--json");
    expect(code).toBe(1);
    expect(err).toContain("Missing value for --registry");
  });

  test("accepts each canonical id", () => {
    for (const id of ["npm", "crates", "rubygems", "nuget", "maven"]) {
      // --help short-circuits before any search, so this proves acceptance
      // without a network round trip.
      const { code, err } = runCli("pkg", "cli", "--registry", id, "--help");
      expect(code, `--registry ${id} rejected: ${err}`).toBe(0);
    }
  });

  test("accepts the crates.io spelling", () => {
    const { code } = runCli("pkg", "cli", "--registry", "crates.io", "--help");
    expect(code).toBe(0);
  });

  test("rejects a sort the chosen registry cannot do, naming its modes", () => {
    const { code, err } = runCli(
      "pkg",
      "json",
      "--registry",
      "maven",
      "--sort",
      "downloads",
      "--count",
    );
    expect(code).toBe(1);
    expect(err).toContain("Invalid sort for maven");
    expect(err).toContain("best-match|name");
    expect(err).not.toContain("Network error");
  });

  test("the flag row in --help names the real registries", () => {
    const { out } = runCli("--help");
    expect(out).toContain(
      "Registry for pkg: npm (default)|crates|rubygems|nuget|maven",
    );
    expect(out).not.toContain("others TBD");
  });

  test("--registry on a non-pkg search is rejected, not silently ignored", () => {
    // `ghfind rust --registry crates` used to exit 0 with GitHub repos: the
    // registry was validated, then thrown away.
    for (const args of [
      ["rust", "--registry", "crates", "--count"],
      ["--registry", "nuget", "--json", "serilog"],
    ]) {
      const { code, err } = runCli(...args);
      expect(code, `expected fail for ${args.join(" ")}`).toBe(1);
      expect(err).toContain("--registry applies only to ghfind pkg.");
    }
  });

  test("the interactive pkg path validates --sort before opening the browser", () => {
    // No output flag, so this is the interactive branch: it must fail rather
    // than launch a browser that ignores the sort (and stays offline).
    const { code, err } = runCli(
      "pkg",
      "--registry",
      "maven",
      "--sort",
      "downloads",
    );
    expect(code).toBe(1);
    expect(err).toContain("Invalid sort for maven");
    expect(err).toContain("best-match|name");
    expect(err).not.toContain("Network error");
  });

  test("a bound count is printed with its +", () => {
    // RubyGems publishes no total, so its --count must not present 30 as the
    // number of matching gems. The live `30+` needs the network, so this guards
    // the renderer's shape; the real output is in the fix report.
    const src = readSrc("src/cli.ts");
    expect(src).toMatch(/totalIsExact === false \? `\$\{totalCount\}\+`/);
  });

  test("completions advertise every id", () => {
    expect(readSrc("completions/ghfind.bash")).toContain(
      'compgen -W "npm crates rubygems nuget maven"',
    );
    expect(readSrc("completions/ghfind.zsh")).toContain(
      "'--registry[Registry for pkg]:(npm crates rubygems nuget maven)'",
    );
    expect(readSrc("completions/ghfind.fish")).toContain(
      '-a "npm crates rubygems nuget maven"',
    );
  });
});
