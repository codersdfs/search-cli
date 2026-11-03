// A download number without its window is a lie: npm's figure is monthly,
// crates.io' is a rolling 90 days, RubyGems' and NuGet's are lifetime, and Maven
// publishes nothing at all. These formatters are the only place that decides how
// each is printed, so the rules live under test.
import { describe, it, expect } from "vitest";
import type { Package } from "../src/types.ts";
import {
  formatDownloads,
  formatPackagesCsv,
  formatPackagesMarkdown,
  formatScore,
} from "../src/package.ts";

function pkg(partial: Partial<Package> & { name: string }): Package {
  return {
    version: "1.0.0",
    description: null,
    url: `https://example.test/${partial.name}`,
    downloads: 0,
    score: 0,
    publisher: null,
    keywords: [],
    registry: "npm",
    ...partial,
  };
}

describe("formatDownloads", () => {
  it("labels npm's monthly window", () => {
    expect(
      formatDownloads(
        pkg({ name: "zod", registry: "npm", downloads: 1234567 }),
      ),
    ).toBe("1,234,567/mo");
  });

  it("labels crates' 90-day window", () => {
    expect(
      formatDownloads(
        pkg({ name: "clap", registry: "crates", downloads: 8200000 }),
      ),
    ).toBe("8,200,000/90d");
  });

  it("labels RubyGems and NuGet as lifetime tallies", () => {
    expect(
      formatDownloads(
        pkg({ name: "thor", registry: "rubygems", downloads: 729 }),
      ),
    ).toBe("729 total");
    expect(
      formatDownloads(
        pkg({ name: "Serilog", registry: "nuget", downloads: 10 }),
      ),
    ).toBe("10 total");
  });

  it("says n/a for Maven instead of printing a fake zero", () => {
    expect(
      formatDownloads(pkg({ name: "g:a", registry: "maven", downloads: 0 })),
    ).toBe("n/a");
  });
});

describe("formatScore", () => {
  it("prints npm's relevance score to two decimals", () => {
    expect(formatScore(pkg({ name: "zod", score: 1666.6299 }))).toBe("1666.63");
  });

  it("prints an em dash for registries that publish no score", () => {
    for (const registry of ["crates", "rubygems", "nuget", "maven"] as const) {
      expect(formatScore(pkg({ name: "x", registry, score: 0 }))).toBe("—");
    }
  });
});

describe("formatPackagesCsv", () => {
  it("carries the registry and its download window in every row", () => {
    const rows = formatPackagesCsv([
      pkg({ name: "zod", registry: "npm", downloads: 100, score: 3.5 }),
      pkg({ name: "clap", registry: "crates", downloads: 200, score: 0 }),
    ]);
    expect(rows.split("\n")[0]).toBe(
      "rank,registry,name,version,downloads,downloads_window,score,url",
    );
    expect(rows).toContain(
      "1,npm,zod,1.0.0,100,monthly,3.50,https://example.test/zod",
    );
    // Score is empty, never zero, when the registry has no relevance data.
    expect(rows).toContain(
      "2,crates,clap,1.0.0,200,quarterly,,https://example.test/clap",
    );
  });
});

describe("formatPackagesMarkdown", () => {
  it("names the registry column and window-suffixes the downloads", () => {
    const out = formatPackagesMarkdown([
      pkg({ name: "thor", registry: "rubygems", downloads: 729093 }),
    ]);
    expect(out.split("\n")[0]).toBe(
      "| # | Registry | Package | Version | Downloads | Score |",
    );
    expect(out).toContain("| 1 | RubyGems | [thor@1.0.0]");
    expect(out).toContain("729,093 total");
    expect(out).toContain("| — |");
  });
});
