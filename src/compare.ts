/**
 * Repo comparison — side-by-side table for 2+ repos, plus JSON/CSV/Markdown
 * exports (shared by the CLI `--compare` formatters and the MCP server).
 */
import type { Repo } from "./types";

interface CompareRow {
  label: string;
  values: string[];
}

/** Build a comparison table as an array of text rows. */
export function buildComparisonTable(repos: Repo[]): string {
  if (repos.length < 2)
    return "Select at least 2 repos to compare (press c to add).";

  const rows: CompareRow[] = [];
  const names = repos.map((r) => r.fullName);

  rows.push({
    label: "Stars",
    values: repos.map((r) => `★ ${r.stars.toLocaleString()}`),
  });
  rows.push({
    label: "Forks",
    values: repos.map((r) => r.forks.toLocaleString()),
  });
  rows.push({ label: "Language", values: repos.map((r) => r.language ?? "—") });
  rows.push({
    label: "Created",
    values: repos.map((r) => r.createdAt?.slice(0, 7) ?? "—"),
  });
  rows.push({
    label: "Updated",
    values: repos.map((r) => r.updatedAt?.slice(0, 10) ?? "—"),
  });
  rows.push({
    label: "Topics",
    values: repos.map((r) => (r.topics?.slice(0, 5).join(", ") ?? "—") || "—"),
  });
  rows.push({
    label: "Description",
    values: repos.map((r) => r.description?.slice(0, 50) ?? "—"),
  });
  rows.push({ label: "URL", values: repos.map((r) => r.url || "—") });

  // Calculate the max width for each column
  const colW = Math.max(35, ...names.map((n) => n.length));

  // Header row
  const header = ["".padEnd(14), ...names.map((n) => n.padEnd(colW))];
  const sep = ["".padEnd(14, "─"), ...names.map(() => "".padEnd(colW, "─"))];

  const lines: string[] = [
    "┌" + sep.map((s) => "─" + s + "─").join("┬") + "┐",
    "│" + header.map((h) => ` ${h} `).join("│") + "│",
    "├" + sep.map((s) => "─" + s + "─").join("┼") + "┤",
  ];

  for (const row of rows) {
    const cells = [
      row.label.padEnd(14),
      ...row.values.map((v) => v.padEnd(colW)),
    ];
    lines.push("│" + cells.map((c) => ` ${c} `).join("│") + "│");
  }

  lines.push("└" + sep.map((s) => "─" + s + "─").join("┴") + "┘");
  return lines.join("\n");
}

// ─── Export formatters (parity with org/user/package modules) ──────────

/** The repo fields the comparison surface exposes. */
export interface ComparisonRepo {
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  createdAt: string;
  updatedAt: string;
  topics: string[];
  archived: boolean;
}

function comparisonRepo(r: Repo): ComparisonRepo {
  return {
    fullName: r.fullName,
    url: r.url,
    description: r.description,
    stars: r.stars,
    forks: r.forks,
    language: r.language,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    topics: r.topics,
    archived: r.archived,
  };
}

export function comparisonJson(repos: Repo[]): string {
  return JSON.stringify(repos.map(comparisonRepo), null, 2);
}

function csvEscape(val: unknown): string {
  const str = String(val ?? "");
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function comparisonCsv(repos: Repo[]): string {
  const header = "full_name,stars,forks,language,created,updated,archived,url";
  const rows = repos.map((r) =>
    [
      r.fullName,
      r.stars,
      r.forks,
      r.language ?? "",
      r.createdAt?.slice(0, 10) ?? "",
      r.updatedAt?.slice(0, 10) ?? "",
      String(r.archived),
      r.url,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

export function comparisonMarkdown(repos: Repo[]): string {
  const header =
    "| Repo | Stars | Forks | Language | Created | Updated | Topics |";
  const sep =
    "|------|-------|-------|----------|---------|---------|--------|";
  const rows = repos.map(
    (r) =>
      `| [${r.fullName}](${r.url}) | ${r.stars.toLocaleString()} | ${r.forks.toLocaleString()} | ${r.language ?? "—"} | ${r.createdAt?.slice(0, 7) ?? "—"} | ${r.updatedAt?.slice(0, 10) ?? "—"} | ${(r.topics?.slice(0, 5).join(", ") ?? "") || "—"} |`,
  );
  return [header, sep, ...rows].join("\n");
}
