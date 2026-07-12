/**
 * Repo comparison — side-by-side table for 2+ repos.
 */
import type { Repo } from "./types.ts";

interface CompareRow {
  label: string;
  values: string[];
}

/** Build a comparison table as an array of text rows. */
export function buildComparisonTable(repos: Repo[]): string {
  if (repos.length < 2) return "Select at least 2 repos to compare (press c to add).";

  const rows: CompareRow[] = [];
  const names = repos.map((r) => r.fullName);

  rows.push({ label: "Stars", values: repos.map((r) => `★ ${r.stars.toLocaleString()}`) });
  rows.push({ label: "Forks", values: repos.map((r) => r.forks.toLocaleString()) });
  rows.push({ label: "Language", values: repos.map((r) => r.language ?? "—") });
  rows.push({ label: "Created", values: repos.map((r) => r.createdAt?.slice(0, 7) ?? "—") });
  rows.push({ label: "Updated", values: repos.map((r) => r.updatedAt?.slice(0, 10) ?? "—") });
  rows.push({ label: "Topics", values: repos.map((r) => (r.topics?.slice(0, 3).join(", ") ?? "—") || "—") });

  // Calculate the max width for each column
  const colW = Math.max(15, ...names.map((n) => n.length));
  const valW = Math.max(8, ...rows.flatMap((r) => r.values.map((v) => v.length)));

  // Header row
  const header = ["".padEnd(14), ...names.map((n) => n.padEnd(colW))];
  const sep = ["".padEnd(14, "─"), ...names.map(() => "".padEnd(colW, "─"))];

  const lines: string[] = [
    "┌" + sep.map((s) => "─" + s + "─").join("┬") + "┐",
    "│" + header.map((h) => ` ${h} `).join("│") + "│",
    "├" + sep.map((s) => "─" + s + "─").join("┼") + "┤",
  ];

  for (const row of rows) {
    const cells = [row.label.padEnd(14), ...row.values.map((v) => v.padEnd(colW))];
    lines.push("│" + cells.map((c) => ` ${c} `).join("│") + "│");
  }

  lines.push("└" + sep.map((s) => "─" + s + "─").join("┴") + "┘");
  return lines.join("\n");
}
