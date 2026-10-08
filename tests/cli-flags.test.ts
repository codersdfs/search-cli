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
