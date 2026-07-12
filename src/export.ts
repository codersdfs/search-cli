/**
 * Export — format repos as JSON, CSV, Markdown, or plain text.
 */
import { writeFileSync } from "fs";
import type { Repo } from "./types.ts";

export type ExportFormat = "json" | "csv" | "markdown" | "text";

/** Format repos as JSON string. */
export function formatJson(repos: Repo[]): string {
  return JSON.stringify(repos, null, 2);
}

function csvEscape(val: unknown): string {
  const str = String(val ?? "");
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Format repos as CSV string. */
export function formatCsv(repos: Repo[]): string {
  const header = "rank,full_name,stars,forks,language,url";
  const rows = repos.map((r, i) =>
    `${i + 1},${csvEscape(r.fullName)},${r.stars},${r.forks},${csvEscape(r.language ?? "")},${csvEscape(r.url)}`,
  );
  return [header, ...rows].join("\n");
}

/** Format repos as Markdown table. */
export function formatMarkdown(repos: Repo[]): string {
  const header = "| # | Repo | Stars | Forks | Language |";
  const sep = "|---|------|-------|-------|----------|";
  const rows = repos.map(
    (r, i) =>
      `| ${i + 1} | [${r.fullName}](${r.url}) | ${r.stars.toLocaleString()} | ${r.forks.toLocaleString()} | ${r.language ?? "—"} |`,
  );
  return [header, sep, ...rows].join("\n");
}

/** Format repos as plain text, one per line. */
export function formatText(repos: Repo[]): string {
  return repos.map((r, i) => `${i + 1}. ${r.fullName} ★ ${r.stars.toLocaleString()} ${r.url}`).join("\n");
}

/** Format repos in the given format. */
export function formatRepos(repos: Repo[], format: ExportFormat): string {
  switch (format) {
    case "json": return formatJson(repos);
    case "csv": return formatCsv(repos);
    case "markdown": return formatMarkdown(repos);
    case "text": return formatText(repos);
  }
}

/** Export repos to a file. Returns the file path. */
export function exportToFile(repos: Repo[], format: ExportFormat): string {
  const ext = format === "markdown" ? "md" : format;
  const ts = Date.now();
  const path = `./search-cli-export-${ts}.${ext}`;
  writeFileSync(path, formatRepos(repos, format), "utf-8");
  return path;
}
