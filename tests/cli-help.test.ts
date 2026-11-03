import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guard the `--help` usage block in src/cli.ts. 9.5.0 shipped
// `ghfind user <name> --json` twice inside the template literal, so the
// profile example printed twice, and two rows had drifted out of column —
// nothing caught it because the help text is an inline template rather than
// an exported constant. Source-grep guards follow the precedent in
// tests/deepdive.test.ts.

const USAGE_ROW = /^ {2}ghfind /;
const DESCRIPTION_COLUMN = 35;

function readCli(): string {
  return readFileSync(join(process.cwd(), "src/cli.ts"), "utf8");
}

/** Usage rows of the help block ("  ghfind org <name> --json      Org profile…"). */
function usageRows(src: string): string[] {
  return src
    .split(/\r?\n/)
    .filter((line) => USAGE_ROW.test(line))
    .map((line) => line.trimEnd());
}

describe("cli --help usage block", () => {
  test("lists every documented invocation", () => {
    expect(usageRows(readCli()).length).toBeGreaterThanOrEqual(20);
  });

  test("no usage row is duplicated", () => {
    const rows = usageRows(readCli());
    const dupes = rows.filter((row, i) => rows.indexOf(row) !== i);
    expect(dupes, `duplicated usage rows: ${dupes.join(" | ")}`).toEqual([]);
  });

  test("documents the read-only and skill-search subcommands", () => {
    const rows = usageRows(readCli()).join("\n");
    for (const invocation of [
      "ghfind bookmarks",
      "ghfind history",
      "ghfind topics",
      "ghfind saved",
      "ghfind readme",
      "ghfind share",
      "ghfind skill search",
    ]) {
      expect(rows, `missing usage row for: ${invocation}`).toContain(
        invocation,
      );
    }
  });

  test("the read-only subcommands accept every documented output flag", () => {
    const src = readCli();
    // Each list command branches on json first, then csv/markdown, then text.
    for (const command of ["--json", "--csv", "--markdown"]) {
      const occurrences = src.split(command).length - 1;
      expect(
        occurrences,
        `${command} should be handled broadly`,
      ).toBeGreaterThan(1);
    }
  });

  test("documents the flags those subcommands take", () => {
    const src = readCli();
    for (const flag of ["--remote", "--local", "--copy", "--raw", "--as"]) {
      expect(src, `missing option row for: ${flag}`).toContain(`${flag} `);
    }
  });

  test("no package usage row claims npm alone", () => {
    const rows = usageRows(readCli());
    const pkgRows = rows.filter((r) => r.includes("ghfind pkg"));
    expect(pkgRows.length).toBeGreaterThanOrEqual(2);
    for (const row of pkgRows) {
      expect(row, `usage row still npm-only: ${row}`).not.toMatch(
        /npm packages/,
      );
    }
  });

  test("every row puts its description in the same column", () => {
    const columns = new Set<number>();
    for (const row of usageRows(readCli())) {
      const match = row.match(/^(.+?) {2,}(\S.*)$/);
      expect(match, `no description column: ${row}`).not.toBeNull();
      if (match) columns.add(row.length - match[2].length);
    }
    expect([...columns]).toEqual([DESCRIPTION_COLUMN]);
  });

  test("the --sort row lists every strategy parseArgs accepts", () => {
    // Help promised four of seven modes, so `--sort score` looked unsupported
    // on the page that documents it. Keep the row and SORT_VALUES in sync.
    const src = readCli();
    const row = src
      .split(/\r?\n/)
      .find((line) => line.trimStart().startsWith("--sort <strategy>"));
    expect(row, "no --sort row in the help block").toBeTruthy();
    const listed = row!.match(/Sort: (.*)$/)?.[1].split("|") ?? [];
    const acceptedBody = src.match(/const SORT_VALUES = \[([\s\S]*?)\];/)?.[1];
    expect(acceptedBody, "SORT_VALUES not found").toBeTruthy();
    const accepted = [...acceptedBody!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(listed).toEqual(accepted);
    // Widening the row must not knock its description out of column: it starts
    // at the same column as --limit's and --since's.
    const columnOf = (prefix: string): number => {
      const line = src
        .split(/\r?\n/)
        .find((l) => l.trimStart().startsWith(prefix));
      expect(line, `no help row for ${prefix}`).toBeTruthy();
      const match = line!.match(/^( {2}\S+(?: <\S+>)?)( {2,})/) ?? [];
      return (match[1]?.length ?? 0) + (match[2]?.length ?? 0);
    };
    expect(columnOf("--sort <strategy>")).toBe(columnOf("--limit <n>"));
    expect(columnOf("--sort <strategy>")).toBe(columnOf("--since <period>"));
  });
});
