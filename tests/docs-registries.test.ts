// Every registry ghfind can search must be documented in the same places users
// and agents look, and the README's test count must match the real suite. Both
// have drifted before (the `--interval` and Ctrl+E incidents in the CHANGELOG).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY_IDS } from "../src/registries/catalog.ts";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("registry documentation", () => {
  it("README names every registry in its examples", () => {
    const readme = read("README.md");
    for (const id of REGISTRY_IDS) {
      expect(readme, `README missing --registry ${id}`).toContain(
        `--registry ${id}`,
      );
    }
  });

  it("HOW-TO documents the windows each registry reports", () => {
    const doc = read("docs/HOW-TO.md");
    const section = doc.split("## Package registries")[1];
    expect(
      section,
      "docs/HOW-TO.md has no Package registries section",
    ).toBeTruthy();
    for (const id of REGISTRY_IDS) {
      expect(section, `HOW-TO omits ${id}`).toContain(id);
    }
    for (const claim of ["monthly", "90 days", "lifetime", "no download"]) {
      expect(section, `HOW-TO must explain ${claim}`).toContain(claim);
    }
  });

  it("the agent skill guide carries the --registry flag", () => {
    const guide = read("src/agent-skill.ts");
    for (const id of REGISTRY_IDS) {
      expect(guide, `skill guide omits ${id}`).toContain(id);
    }
    expect(guide).toContain("--registry");
  });

  it("CHANGELOG records the registry feature", () => {
    // Find the section that introduced ghfind pkg instead of assuming it is
    // the newest: later releases (like 9.13.0's similar-repo discovery) may
    // top the file without erasing the registry documentation.
    const log = read("CHANGELOG.md");
    const sections = log.split(/^## \[/m).slice(1);
    expect(
      sections.some(
        (section) =>
          section.includes("ghfind pkg") && section.includes("registry"),
      ),
      "no CHANGELOG section documents ghfind pkg + registry",
    ).toBe(true);
  });

  it("README advertises one test count, stated identically twice", () => {
    const counts = [...read("README.md").matchAll(/# (\d+) tests/g)].map((m) =>
      Number(m[1]),
    );
    expect(
      counts.length,
      "README should state the count in both install paths",
    ).toBeGreaterThanOrEqual(2);
    // Two numbers that disagree is the drift this guard exists for; the value
    // itself comes from a real `bun test` run (Step 7), never from a guess.
    expect(
      new Set(counts).size,
      `README counts disagree: ${counts.join(", ")}`,
    ).toBe(1);
  });
});
