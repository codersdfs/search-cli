/**
 * Output module — unified formatting, export, and pipe execution.
 *
 * All format functions (JSON, CSV, Markdown, text, urls, names, ssh-urls,
 * clone-commands, ids) register in a single registry. One `format()` function
 * dispatches. `exportToFile` and `pipeExec` are methods on the same module.
 */
import { writeFileSync } from "fs";
import type { Repo } from "./types";
import { openUrl } from "./open-url";

export type Format =
  | "json" | "csv" | "markdown" | "text"
  | "urls" | "names" | "ssh-urls" | "clone-commands" | "ids";

export type FormatFn = (repos: Repo[]) => string;

/** Registry of all format functions. Adding a format = 1 line here. */
const FORMATS: Map<Format, FormatFn> = new Map([
  // Export formats
  ["json", formatJson],
  ["csv", formatCsv],
  ["markdown", formatMarkdown],
  ["text", formatText],
  // Pipe formats
  ["urls", formatUrls],
  ["names", formatNames],
  ["ssh-urls", formatSshUrls],
  ["clone-commands", formatCloneCommands],
  ["ids", formatIds],
]);

// ── Export format functions ────────────────────────────────────────────

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

export function formatCsv(repos: Repo[]): string {
  const header = "rank,full_name,stars,forks,language,url";
  const rows = repos.map((r, i) =>
    `${i + 1},${csvEscape(r.fullName)},${r.stars},${r.forks},${csvEscape(r.language ?? "")},${csvEscape(r.url)}`,
  );
  return [header, ...rows].join("\n");
}

export function formatMarkdown(repos: Repo[]): string {
  const header = "| # | Repo | Stars | Forks | Language |";
  const sep = "|---|------|-------|-------|----------|";
  const rows = repos.map(
    (r, i) =>
      `| ${i + 1} | [${r.fullName}](${r.url}) | ${r.stars.toLocaleString()} | ${r.forks.toLocaleString()} | ${r.language ?? "—"} |`,
  );
  return [header, sep, ...rows].join("\n");
}

export function formatText(repos: Repo[]): string {
  return repos.map((r, i) => `${i + 1}. ${r.fullName} ★ ${r.stars.toLocaleString()} ${r.url}`).join("\n");
}

// ── Pipe format functions ──────────────────────────────────────────────

export function formatUrls(repos: Repo[]): string {
  return repos.map((r) => r.url).join("\n");
}

export function formatNames(repos: Repo[]): string {
  return repos.map((r) => r.fullName).join("\n");
}

export function formatSshUrls(repos: Repo[]): string {
  return repos.map((r) => `git@github.com:${r.fullName}.git`).join("\n");
}

export function formatCloneCommands(repos: Repo[]): string {
  return repos.map((r) => `git clone git@github.com:${r.fullName}.git`).join("\n");
}

export function formatIds(repos: Repo[]): string {
  return repos.map((r) => String(r.id)).join("\n");
}

// ── Public API ─────────────────────────────────────────────────────────

/** Format repos using the registered format function. */
export function format(repos: Repo[], format: Format): string {
  const fn = FORMATS.get(format);
  if (!fn) throw new Error(`Unknown format: ${format}`);
  return fn(repos);
}

/** Export repos to a file. Returns the file path. */
export function exportToFile(repos: Repo[], fmt: Format): string {
  const ext = fmt === "markdown" ? "md" : fmt;
  const ts = Date.now();
  const path = `./ghfind-export-${ts}.${ext}`;
  writeFileSync(path, format(repos, fmt), "utf-8");
  return path;
}

/** Execute a pipe target (clone, open) on repos. */
export async function pipeExec(repos: Repo[], target: string): Promise<void> {
  for (const repo of repos) {
    const url = repo.url;
    switch (target) {
      case "open":
        await openUrl(url);
        break;
      case "clone":
        console.log(`git clone git@github.com:${repo.fullName}.git`);
        break;
    }
  }
}

// ─── Backward-compatible re-exports ─────────────────────────────────────

export type ExportFormat = "json" | "csv" | "markdown" | "text";
export type FormatLine = "urls" | "names" | "ssh-urls" | "clone-commands" | "ids";

/** @deprecated Use `format()` instead. */
export function formatRepos(repos: Repo[], fmt: ExportFormat): string {
  return format(repos, fmt);
}

/** @deprecated Use `format()` instead. */
export function formatLines(repos: Repo[], fmt: FormatLine): string {
  return format(repos, fmt);
}
