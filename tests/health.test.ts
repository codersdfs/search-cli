import { describe, it, expect } from "vitest";
import {
  pushRecencyScore,
  issueScore,
  releaseScore,
  communityScore,
  computeHealth,
  buildHealthJson,
  buildHealthText,
  buildHealthCsv,
  buildHealthMarkdown,
  formatHealthCell,
  formatHealthBody,
} from "../src/health.ts";
import type { HealthSignals, HealthScore } from "../src/health.ts";

const fullSignals = (over: Partial<HealthSignals> = {}): HealthSignals => ({
  daysSincePush: 3,
  commitsLast90Days: 150,
  issues: { open: 10, closedLast90Days: 90 },
  releases: { hasReleases: true, daysSinceRelease: 12 },
  contributors: 64,
  repoAgeDays: 1200,
  archived: false,
  ...over,
});

describe("pushRecencyScore", () => {
  it("honors the documented bands", () => {
    expect(pushRecencyScore(0)).toBe(100);
    expect(pushRecencyScore(7)).toBe(100);
    expect(pushRecencyScore(8)).toBe(80);
    expect(pushRecencyScore(30)).toBe(80);
    expect(pushRecencyScore(31)).toBe(60);
    expect(pushRecencyScore(90)).toBe(60);
    expect(pushRecencyScore(91)).toBe(40);
    expect(pushRecencyScore(180)).toBe(40);
    expect(pushRecencyScore(181)).toBe(20);
    expect(pushRecencyScore(365)).toBe(20);
    expect(pushRecencyScore(366)).toBe(0);
  });
});

describe("issueScore", () => {
  it("is neutral (50) when a repo has no issues at all", () => {
    expect(issueScore(0, 0)).toBe(50);
  });

  it("scores closing throughput tiers", () => {
    expect(issueScore(10, 90)).toBe(100);
    expect(issueScore(10, 50)).toBe(100);
    expect(issueScore(10, 20)).toBe(80);
    expect(issueScore(10, 10)).toBe(60);
    expect(issueScore(10, 5)).toBe(40);
    expect(issueScore(10, 1)).toBe(20);
    expect(issueScore(50, 0)).toBe(0);
  });
});

describe("releaseScore", () => {
  it("honors the recency bands", () => {
    expect(releaseScore({ hasReleases: true, daysSinceRelease: 30 }, 999)).toBe(
      100,
    );
    expect(releaseScore({ hasReleases: true, daysSinceRelease: 31 }, 999)).toBe(
      80,
    );
    expect(releaseScore({ hasReleases: true, daysSinceRelease: 91 }, 999)).toBe(
      50,
    );
    expect(
      releaseScore({ hasReleases: true, daysSinceRelease: 181 }, 999),
    ).toBe(25);
    expect(
      releaseScore({ hasReleases: true, daysSinceRelease: 366 }, 999),
    ).toBe(0);
  });

  it("is neutral for a young repo with no releases, 0 for an older one", () => {
    expect(
      releaseScore({ hasReleases: false, daysSinceRelease: null }, 30),
    ).toBe(50);
    expect(
      releaseScore({ hasReleases: false, daysSinceRelease: null }, 90),
    ).toBe(0);
    expect(
      releaseScore({ hasReleases: false, daysSinceRelease: null }, null),
    ).toBe(0);
  });
});

describe("communityScore", () => {
  it("honors the contributor tiers", () => {
    expect(communityScore(50)).toBe(100);
    expect(communityScore(20)).toBe(80);
    expect(communityScore(10)).toBe(60);
    expect(communityScore(5)).toBe(40);
    expect(communityScore(2)).toBe(20);
    expect(communityScore(1)).toBe(10);
    expect(communityScore(0)).toBe(0);
  });
});

describe("computeHealth", () => {
  it("weights the four dimensions 30/25/25/20", () => {
    const score = computeHealth(fullSignals(), "a/b");
    expect(score.repo).toBe("a/b");
    // 100*0.3 + 100*0.25 + 100*0.25 + 100*0.2 = 100
    expect(score.total).toBe(100);
    expect(score.grade).toBe("A");
    expect(score.dimensions.map((d) => d.weight)).toEqual([30, 25, 25, 20]);
  });

  it("re-normalizes weights when a dimension is unavailable", () => {
    const score = computeHealth(fullSignals({ contributors: null }), "a/b");
    // 100*30 + 100*25 + 100*25 = 8000 over 80 weight → 100
    expect(score.total).toBe(100);
    const community = score.dimensions.find((d) => d.key === "community");
    expect(community?.score).toBeNull();
    expect(community?.reason).toContain("unavailable");
  });

  it("scores maintenance from push recency alone when commits are unknown", () => {
    const score = computeHealth(
      fullSignals({ commitsLast90Days: null, daysSincePush: 10 }),
      "a/b",
    );
    const maintenance = score.dimensions.find((d) => d.key === "maintenance");
    expect(maintenance?.score).toBe(80);
    expect(maintenance?.reason).toBe("last push 10d ago");
  });

  it("returns a null total when no dimension produced data", () => {
    const score = computeHealth(
      fullSignals({
        daysSincePush: null,
        commitsLast90Days: null,
        issues: null,
        releases: null,
        contributors: null,
      }),
    );
    expect(score.total).toBeNull();
    expect(score.grade).toBe("—");
  });

  it("caps archived repos at 40 and reports why", () => {
    const score = computeHealth(fullSignals({ archived: true }), "a/b");
    expect(score.archived).toBe(true);
    expect(score.total).toBe(40);
    expect(score.grade).toBe("C");
  });

  it("maps totals to A/B/C/D grades", () => {
    const gradeOf = (signals: Partial<HealthSignals>) =>
      computeHealth(fullSignals(signals)).grade;
    expect(gradeOf({})).toBe("A");
    expect(
      gradeOf({
        daysSincePush: 400,
        commitsLast90Days: 0,
        issues: { open: 100, closedLast90Days: 0 },
        releases: { hasReleases: true, daysSinceRelease: 400 },
        contributors: 1,
      }),
    ).toBe("D");
  });
});

describe("formatters", () => {
  const score = computeHealth(fullSignals(), "owner/repo");

  it("buildHealthText shows the total, grade, and per-dimension bars", () => {
    const text = buildHealthText(score);
    expect(text).toContain("── Health ──");
    expect(text).toContain("owner/repo — 100/100 [A]");
    expect(text).toContain("Maintenance");
    expect(text).toContain("Issue health");
    expect(text).toContain("Release cadence");
    expect(text).toContain("Community");
    expect(text).toContain("100+ commits in 90d");
    expect(text).toContain("90 issues closed/touched in 90d · 10 open");
  });

  it("formatHealthBody marks unavailable dimensions", () => {
    const partial = computeHealth(fullSignals({ issues: null }), "a/b");
    expect(formatHealthBody(partial)).toContain(
      "(unavailable — search API unavailable)",
    );
  });

  it("buildHealthJson round-trips the score", () => {
    const parsed = JSON.parse(buildHealthJson(score)) as HealthScore;
    expect(parsed.total).toBe(score.total);
    expect(parsed.grade).toBe("A");
    expect(parsed.dimensions).toHaveLength(4);
  });

  it("buildHealthCsv emits empty cells for unavailable scores", () => {
    const csv = buildHealthCsv(
      computeHealth(fullSignals({ issues: null }), "a/b"),
    );
    expect(csv.split("\n")[0]).toBe(
      "repo,total,grade,archived,maintenance,issues,releases,community",
    );
    expect(csv.split("\n")[1]).toContain(",,");
    expect(csv.split("\n")[1]).not.toMatch(/,90,/);
  });

  it("buildHealthMarkdown renders one table row", () => {
    const md = buildHealthMarkdown(score);
    expect(md).toContain("| Repo | Total | Grade |");
    expect(md).toContain(
      "| owner/repo | 100/100 | A | 100 | 100 | 100 | 100 |",
    );
  });

  it("formatHealthCell degrades gracefully", () => {
    expect(formatHealthCell(score)).toBe("100 A");
    expect(formatHealthCell(null)).toBe("—");
    expect(
      formatHealthCell(computeHealth(fullSignals({ archived: true }), "a/b")),
    ).toBe("40 C (archived)");
  });
});
