import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guard the `--help` usage block in src/cli.ts. 9.5.0 shipped
// `ghfind user <name> --json` twice inside the template literal, so the
// profile example printed twice, and two rows had drifted out of column —
// nothing caught it because the help text is an inline template rather than
// an exported constant. Source-grep guards follow the precedent in
// tests/overlay-registry.test.ts.

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

  test("every row puts its description in the same column", () => {
    const columns = new Set<number>();
    for (const row of usageRows(readCli())) {
      const match = row.match(/^(.+?) {2,}(\S.*)$/);
      expect(match, `no description column: ${row}`).not.toBeNull();
      if (match) columns.add(row.length - match[2].length);
    }
    expect([...columns]).toEqual([DESCRIPTION_COLUMN]);
  });
});
