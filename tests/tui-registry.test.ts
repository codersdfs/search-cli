// The packages view must not claim "npm" once it can search five registries,
// and it must refuse sort modes the active registry cannot honour. src/tui.ts is
// not importable (it takes over the terminal), so these are source-shape guards
// — the same technique as tests/overlay-registry.test.ts and tests/session.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Read a source file with LF endings (Windows CI checks out CRLF). */
function readSource(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
}

describe("src/tui.ts package registry wiring", () => {
  const src = readSource("src/tui.ts");

  it("imports the catalog it needs", () => {
    expect(src).toContain('from "./registries/catalog"');
    expect(src).toMatch(/REGISTRY_IDS/);
    expect(src).toMatch(/sortableModesFor/);
  });

  it("keeps a currentRegistry alongside currentPackageSort", () => {
    expect(src).toMatch(
      /let currentRegistry: RegistryId = session\?\.registry \?\? "npm"/,
    );
  });

  it("searches through the active registry", () => {
    // No bare createPackageSearch() left: every call must name the registry.
    expect(src).not.toMatch(/createPackageSearch\(\s*\)/);
    expect(src).toMatch(/createPackageSearch\(currentRegistry\)/);
  });

  it("cycles sort only through modes the registry supports", () => {
    expect(src).toMatch(/sortableModesFor\(currentRegistry\)/);
    // The npm-only constant must no longer drive the TUI's package sort cycle.
    expect(src).not.toMatch(/PACKAGE_SORT_MODES\[\(idx \+ 1\)/);
  });

  it("no longer hard-codes npm in the packages copy", () => {
    expect(src).not.toContain('"Search npm packages"');
    expect(src).not.toContain(
      "Search npm packages by name, description, or tags",
    );
    expect(src).not.toMatch(/Searching npm for/);
  });

  it("offers Registry in the Esc menu", () => {
    expect(src).toMatch(/name: "Registry"/);
    expect(src).toMatch(/cycleRegistry/);
  });

  it("retires stale package results on registry cycle", () => {
    // Pressing p mid-search must not let the previous registry's response
    // repaint the list under the new label.
    expect(src).toMatch(/packageSearchEpoch/);
    expect(src).toMatch(/if \(epoch !== packageSearchEpoch\) return;/);
  });
});

describe("src/package-browser.ts registry awareness", () => {
  const src = readSource("src/package-browser.ts");

  it("takes the registry from its caller", () => {
    expect(src).toMatch(
      /export async function launchPackageBrowser\(\s*registry: RegistryId = "npm",\s*options: PackageBrowserOptions = \{\},?\s*\)/,
    );
    expect(src).toMatch(/createPackageSearch\(registry\)/);
  });

  it("prints downloads through the shared formatter", () => {
    expect(src).toMatch(/formatDownloads\(pack\)/);
    expect(src).not.toMatch(/score \$\{pack\.score\.toFixed\(2\)\}/);
  });

  it("fetches at the caller's limit and renders in the caller's sort", () => {
    // The browser used to hardcode 25 rows in registry order, so --limit and
    // --sort were silently dropped whenever pkg went interactive.
    expect(src).toMatch(/searchPackage\(q, limit\)/);
    expect(src).toMatch(/sortPackages\(res\.packages, sort\)/);
  });

  it("marks an inexact total with + in the footer", () => {
    expect(src).toMatch(/res\.totalIsExact === false \? "\+" : ""/);
  });
});

describe("the CLI passes the flag through to the browser", () => {
  it("launches the browser with the resolved registry", () => {
    expect(readSource("src/cli.ts")).toMatch(
      /launchPackageBrowser\(flags\.registry,\s*\{\s*limit: flags\.limit,\s*sort: flags\.sort as PackageSortMode,\s*\},?\s*\)/,
    );
  });

  it("validates the sort once, for both pkg paths", () => {
    const src = readSource("src/cli.ts");
    // One helper owns the message, so the interactive and one-shot paths
    // cannot drift apart.
    expect(src).toMatch(
      /function assertPkgSort\(registry: RegistryId, sort: string\)/,
    );
    expect(src.match(/assertPkgSort\(/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("src/tui.ts toolbar total honesty", () => {
  const src = readSource("src/tui.ts");

  it("renders an inexact package total as a bound", () => {
    expect(src).toMatch(/totalExact\?: boolean/);
    expect(src).toMatch(/totalExact === false \? "\+" : ""/);
  });

  it("keeps repo and trending totals exact", () => {
    // Only the packages branch of setToolbar passes the flag.
    expect(src).toMatch(/isPackages \? packageTotalIsExact : undefined/);
    expect(src).toMatch(/packageTotalIsExact = result\.totalIsExact !== false/);
  });
});

describe("help overlay documents the registry", () => {
  it("the packages section names the Registry keys, not npm alone", () => {
    const src = readSource("src/help.ts");
    expect(src).toContain('action: "Cycle package registry"');
    expect(src).not.toContain('action: "Search npm packages"');
  });
});

describe("session persistence of the registry", () => {
  it("keeps a known registry and drops an unknown one", async () => {
    const { sanitizeSession } = await import("../src/session.ts");
    expect(
      sanitizeSession({
        mode: "packages",
        query: "cli",
        sort: "best-match",
        limit: 50,
        trendingTab: "This Week",
        registry: "crates",
      })?.registry,
    ).toBe("crates");
    // A stale or hand-edited session must never select an unbuilt registry.
    expect(
      sanitizeSession({
        mode: "packages",
        query: "cli",
        sort: "best-match",
        limit: 50,
        registry: "pypi" as never, // not in RegistryId — exactly the corruption under test
      })?.registry,
    ).toBeUndefined();
  });
});
