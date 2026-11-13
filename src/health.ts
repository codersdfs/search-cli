/**
 * Repo health score — a four-dimension weighted maintenance signal for one
 * repo: maintenance activity (30%), issue responsiveness (25%), release
 * cadence (25%), and community breadth (20%). All inputs come from public
 * GitHub API endpoints; each fetch degrades to null independently, and the
 * total re-normalizes over the dimensions that did produce data (a missing
 * signal never silently scores 0).
 */
import type { Repo } from "./types";
import { githubFetch } from "./github-client";

const DAY_MS = 86_400_000;
const COMMIT_WINDOW_DAYS = 90;
const COMMIT_PER_PAGE = 100;
const COMMIT_ACTIVITY_DIVISOR = 1.5; // ≥150 commits in the window → activity 100

/** Signals the four dimensions are scored from. `null` = fetch failed. */
export interface HealthSignals {
  /** Days since the last push (from repo metadata; null when unknown). */
  daysSincePush: number | null;
  /** Commits in the trailing 90 days (capped: 100 means "100+"). */
  commitsLast90Days: number | null;
  /**
   * Real issue counts (PRs filtered out), from the core /issues endpoint.
   * `closedLast90Days` counts issues closed or touched in the window; both
   * cap at 100 ("100+"). null = endpoint failed.
   */
  issues: { open: number; closedLast90Days: number } | null;
  /** Latest-release recency; null = fetch failed, hasReleases=false = none. */
  releases: { hasReleases: boolean; daysSinceRelease: number | null } | null;
  /** Contributor count (capped: 100 means "100+"). */
  contributors: number | null;
  repoAgeDays: number | null;
  archived: boolean;
}

export type HealthDimensionKey =
  "maintenance" | "issues" | "releases" | "community";

export interface HealthDimension {
  key: HealthDimensionKey;
  label: string;
  /** 0-100, or null when the underlying signals were unavailable. */
  score: number | null;
  weight: number;
  /** Human explanation of the score (or why it is unavailable). */
  reason: string;
}

export type HealthGrade = "A" | "B" | "C" | "D";

export interface HealthScore {
  repo: string;
  /** Weighted 0-100, or null when no dimension produced data. */
  total: number | null;
  grade: HealthGrade | "—";
  /** Archived repos are capped (a frozen mirror is not "healthy"). */
  archived: boolean;
  dimensions: HealthDimension[];
}

// ─── Date helpers ─────────────────────────────────────────────────────────

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
}

// ─── Dimension scoring (pure; unit-testable without a clock) ──────────────

/** Push recency: ≤7d→100, ≤30d→80, ≤90d→60, ≤180d→40, ≤365d→20, else 0. */
export function pushRecencyScore(days: number): number {
  if (days <= 7) return 100;
  if (days <= 30) return 80;
  if (days <= 90) return 60;
  if (days <= 180) return 40;
  if (days <= 365) return 20;
  return 0;
}

/**
 * Issue health by closing throughput: ≥50 closed/touched in 90d→100, ≥20→80,
 * ≥10→60, ≥5→40, ≥1→20; zero flow with open issues → 0; none at all → 50.
 */
export function issueScore(open: number, closedLast90Days: number): number {
  if (closedLast90Days >= 50) return 100;
  if (closedLast90Days >= 20) return 80;
  if (closedLast90Days >= 10) return 60;
  if (closedLast90Days >= 5) return 40;
  if (closedLast90Days >= 1) return 20;
  return open > 0 ? 0 : 50;
}

/**
 * Release cadence: ≤30d→100, ≤90d→80, ≤180d→50, ≤365d→25, else 0.
 * A young repo (<90d old) with no releases is neutral; an older one scores 0.
 */
export function releaseScore(
  releases: NonNullable<HealthSignals["releases"]>,
  repoAgeDays: number | null,
): number {
  if (!releases.hasReleases) {
    return repoAgeDays !== null && repoAgeDays < 90 ? 50 : 0;
  }
  const days = releases.daysSinceRelease;
  if (days === null) return 50;
  if (days <= 30) return 100;
  if (days <= 90) return 80;
  if (days <= 180) return 50;
  if (days <= 365) return 25;
  return 0;
}

/** Community breadth by contributor count. */
export function communityScore(count: number): number {
  if (count >= 50) return 100;
  if (count >= 20) return 80;
  if (count >= 10) return 60;
  if (count >= 5) return 40;
  if (count >= 2) return 20;
  if (count === 1) return 10;
  return 0;
}

// ─── Aggregate scoring ────────────────────────────────────────────────────

export function computeHealth(
  signals: HealthSignals,
  repoName = "",
): HealthScore {
  const dimensions: HealthDimension[] = [];

  // Maintenance: 60% push recency + 40% commit activity in the window.
  if (signals.daysSincePush !== null) {
    const push = pushRecencyScore(signals.daysSincePush);
    let score = push;
    let activityNote = "";
    if (signals.commitsLast90Days !== null) {
      const capped = signals.commitsLast90Days >= COMMIT_PER_PAGE;
      const effective = capped ? 150 : signals.commitsLast90Days;
      const activity = Math.min(
        100,
        Math.round(effective / COMMIT_ACTIVITY_DIVISOR),
      );
      score = Math.round(0.6 * push + 0.4 * activity);
      activityNote = ` · ${capped ? "100+" : signals.commitsLast90Days} commits in ${COMMIT_WINDOW_DAYS}d`;
    }
    dimensions.push({
      key: "maintenance",
      label: "Maintenance",
      score,
      weight: 30,
      reason: `last push ${signals.daysSincePush}d ago${activityNote}`,
    });
  } else {
    dimensions.push({
      key: "maintenance",
      label: "Maintenance",
      score: null,
      weight: 30,
      reason: "push data missing",
    });
  }

  if (signals.issues) {
    const { open, closedLast90Days } = signals.issues;
    const capped = closedLast90Days >= COMMIT_PER_PAGE;
    dimensions.push({
      key: "issues",
      label: "Issue health",
      score: issueScore(open, closedLast90Days),
      weight: 25,
      reason: `${capped ? "100+" : closedLast90Days} issues closed/touched in ${COMMIT_WINDOW_DAYS}d · ${open >= COMMIT_PER_PAGE ? "100+" : open} open`,
    });
  } else {
    dimensions.push({
      key: "issues",
      label: "Issue health",
      score: null,
      weight: 25,
      reason: "search API unavailable",
    });
  }

  if (signals.releases) {
    const score = releaseScore(signals.releases, signals.repoAgeDays);
    dimensions.push({
      key: "releases",
      label: "Release cadence",
      score,
      weight: 25,
      reason: !signals.releases.hasReleases
        ? "no releases published"
        : `latest release ${signals.releases.daysSinceRelease ?? "?"}d ago`,
    });
  } else {
    dimensions.push({
      key: "releases",
      label: "Release cadence",
      score: null,
      weight: 25,
      reason: "release lookup failed",
    });
  }

  if (signals.contributors !== null) {
    const capped = signals.contributors >= COMMIT_PER_PAGE;
    dimensions.push({
      key: "community",
      label: "Community",
      score: communityScore(signals.contributors),
      weight: 20,
      reason: `${capped ? "100+" : signals.contributors} contributors`,
    });
  } else {
    dimensions.push({
      key: "community",
      label: "Community",
      score: null,
      weight: 20,
      reason: "contributors unavailable",
    });
  }

  const available = dimensions.filter((d) => d.score !== null);
  const weightSum = available.reduce((sum, d) => sum + d.weight, 0);
  let total =
    weightSum > 0
      ? Math.round(
          available.reduce(
            (sum, d) => sum + (d.score as number) * d.weight,
            0,
          ) / weightSum,
        )
      : null;
  if (signals.archived && total !== null) total = Math.min(total, 40);

  const grade: HealthGrade | "—" =
    total === null
      ? "—"
      : total >= 80
        ? "A"
        : total >= 60
          ? "B"
          : total >= 40
            ? "C"
            : "D";

  return {
    repo: repoName,
    total,
    grade,
    archived: signals.archived,
    dimensions,
  };
}

// ─── Fetch layer ──────────────────────────────────────────────────────────

/** GET a GitHub JSON endpoint; any classified failure degrades to null. */
async function fetchJson<T>(url: string, token?: string): Promise<T | null> {
  try {
    const res = await githubFetch(url, { token });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Latest release recency via /releases?per_page=1 — unlike /releases/latest
 * this includes prereleases, so a repo that only ships them still scores.
 * An empty list (or unparseable body) means "no releases"; any classified
 * failure degrades to null.
 */
async function fetchReleases(
  owner: string,
  name: string,
  token?: string,
): Promise<HealthSignals["releases"]> {
  try {
    const res = await githubFetch(
      `https://api.github.com/repos/${owner}/${name}/releases?per_page=1`,
      { token },
    );
    const list = (await res.json().catch(() => null)) as
      { published_at?: string }[] | null;
    const latest = Array.isArray(list) ? list[0] : undefined;
    if (!latest) return { hasReleases: false, daysSinceRelease: null };
    return {
      hasReleases: true,
      daysSinceRelease: daysSince(latest.published_at),
    };
  } catch {
    return null;
  }
}

export interface HealthFetchOverrides {
  /**
   * Pre-fetched contributor count; when the key is present (even null) the
   * /contributors request is skipped. Lets the deep-dive share its single
   * contributors call between the contributor list and the health count.
   */
  contributorsCount?: number | null;
}

/** Fetch every health signal for a repo; each endpoint fails independently. */
export async function fetchHealthSignals(
  repo: Repo,
  token?: string,
  overrides: HealthFetchOverrides = {},
): Promise<HealthSignals> {
  /** Issue payload from GET /issues — PRs carry a `pull_request` key. */
  interface IssueApiItem {
    pull_request?: unknown;
  }

  const countRealIssues = (items: IssueApiItem[]): number =>
    items.filter((item) => !item.pull_request).length;

  const since = new Date(
    Date.now() - COMMIT_WINDOW_DAYS * DAY_MS,
  ).toISOString();
  const base = `https://api.github.com/repos/${repo.owner}/${repo.name}`;

  const contributorsTask: Promise<number | null> =
    "contributorsCount" in overrides
      ? Promise.resolve(overrides.contributorsCount ?? null)
      : fetchJson<unknown[]>(
          `${base}/contributors?per_page=${COMMIT_PER_PAGE}`,
          token,
        ).then((arr) => (Array.isArray(arr) ? arr.length : null));

  const [commits, openIssues, closedIssues, releases, contributors] =
    await Promise.all([
      fetchJson<unknown[]>(
        `${base}/commits?per_page=${COMMIT_PER_PAGE}&since=${since}`,
        token,
      ),
      fetchJson<IssueApiItem[]>(
        `${base}/issues?state=open&per_page=${COMMIT_PER_PAGE}`,
        token,
      ),
      fetchJson<IssueApiItem[]>(
        `${base}/issues?state=closed&per_page=${COMMIT_PER_PAGE}&since=${since}`,
        token,
      ),
      fetchReleases(repo.owner, repo.name, token),
      contributorsTask,
    ]);

  return {
    daysSincePush: daysSince(repo.pushedAt),
    commitsLast90Days: Array.isArray(commits) ? commits.length : null,
    issues:
      openIssues && closedIssues
        ? {
            open: countRealIssues(openIssues),
            closedLast90Days: countRealIssues(closedIssues),
          }
        : null,
    releases,
    contributors,
    repoAgeDays: daysSince(repo.createdAt),
    archived: repo.archived,
  };
}

/** Fetch and score a repo's health in one call. */
export async function fetchHealth(
  repo: Repo,
  token?: string,
): Promise<HealthScore> {
  return computeHealth(await fetchHealthSignals(repo, token), repo.fullName);
}

// ─── Output formatters ────────────────────────────────────────────────────

const BAR_WIDTH = 10;

function bar(score: number): string {
  const filled = Math.round((score / 100) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

/** One-line summary used by the compare table row. */
export function formatHealthCell(
  score: HealthScore | null | undefined,
): string {
  if (!score || score.total === null) return "—";
  return `${score.total} ${score.grade}${score.archived ? " (archived)" : ""}`;
}

/** Body without the section header (shared with the deep-dive output). */
export function formatHealthBody(score: HealthScore): string {
  const head =
    score.total === null
      ? ` ${score.repo} — (health data unavailable)`
      : ` ${score.repo} — ${score.total}/100 [${score.grade}]${score.archived ? " (archived — capped at 40)" : ""}`;
  const lines = [head];
  for (const d of score.dimensions) {
    const label = d.label.padEnd(16);
    if (d.score === null) {
      lines.push(`  ${label} (unavailable — ${d.reason})`);
    } else {
      lines.push(
        `  ${label} ${bar(d.score)} ${String(d.score).padStart(3)}  ${d.reason}`,
      );
    }
  }
  return lines.join("\n");
}

/** Full standalone display (own header). */
export function buildHealthText(score: HealthScore): string {
  return [
    "── Health ────────────────────────────────────────",
    formatHealthBody(score),
  ].join("\n");
}

/** JSON string for `ghfind health --json`. */
export function buildHealthJson(score: HealthScore): string {
  return JSON.stringify(score, null, 2);
}

/** CSV row for `ghfind health --csv` (empty cells = unavailable). */
export function buildHealthCsv(score: HealthScore): string {
  const cell = (v: number | null) => (v === null ? "" : String(v));
  const byKey = (k: HealthDimensionKey) =>
    score.dimensions.find((d) => d.key === k)?.score ?? null;
  return [
    "repo,total,grade,archived,maintenance,issues,releases,community",
    [
      score.repo,
      cell(score.total),
      score.grade,
      String(score.archived),
      cell(byKey("maintenance")),
      cell(byKey("issues")),
      cell(byKey("releases")),
      cell(byKey("community")),
    ].join(","),
  ].join("\n");
}

/** Markdown table for `ghfind health --markdown`. */
export function buildHealthMarkdown(score: HealthScore): string {
  const cell = (v: number | null) => (v === null ? "—" : String(v));
  const byKey = (k: HealthDimensionKey) =>
    score.dimensions.find((d) => d.key === k)?.score ?? null;
  const total = score.total === null ? "—" : `${score.total}/100`;
  const grade =
    score.archived && score.grade !== "—"
      ? `${score.grade} (archived)`
      : score.grade;
  return [
    "| Repo | Total | Grade | Maintenance | Issues | Releases | Community |",
    "|------|-------|-------|-------------|--------|----------|-----------|",
    `| ${score.repo} | ${total} | ${grade} | ${cell(byKey("maintenance"))} | ${cell(byKey("issues"))} | ${cell(byKey("releases"))} | ${cell(byKey("community"))} |`,
  ].join("\n");
}
