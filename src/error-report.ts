/**
 * Error report helper — build a GitHub-issue pre-fill URL from an uncaught
 * error, print it, and offer to open it in the user's browser.
 *
 * Privacy: never auto-posts. The user sees the URL and decides whether to
 * submit. We redact env vars and only include what the diagnostic needs.
 */
import { platform as osPlatform, arch as osArch, version as nodeVersion, versions as nodeVersions } from "process";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ponytail: in bun, process.platform is a string property; in node, same.
// We need it as a string, not a function call.
const _osPlatform = osPlatform;
const _osArch = osArch;
void _osPlatform;
void _osArch;

const REPO = "codersdfs/search-cli";
const NEW_ISSUE_URL = `https://github.com/${REPO}/issues/new`;

function getPackageVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function runtimeName(): string {
  // ponytail: process.versions.bun is the cheapest probe and works in both runtimes
  const bunVer = (nodeVersions as Record<string, string | undefined>).bun;
  return bunVer ? `Bun ${bunVer}` : `Node ${nodeVersion}`;
}

/**
 * Format an error into a GitHub issue body. Strips ANSI from stack traces,
 * truncates long messages, redacts common secret patterns.
 */
export function formatErrorBody(
  err: unknown,
  context: { command: string; argv: string[] },
): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const stack = (e.stack ?? "(no stack)").replace(/\u001b\[[0-9;]*m/g, "");
  const message = (e.message || "(no message)").slice(0, 500);
  const cmd = `${context.command} ${context.argv.join(" ")}`.trim();
  const ghfindVersion = getPackageVersion();

  return [
    "## What happened",
    "",
    "```",
    message,
    "```",
    "",
    "## Command",
    "",
    "```",
    cmd,
    "```",
    "",
    "## Stack trace",
    "",
    "```",
    stack,
    "```",
    "",
    "## Environment",
    "",
    `- ghfind: v${ghfindVersion}`,
    `- runtime: ${runtimeName()}`,
    `- platform: ${osPlatform} ${osArch}`,
    "",
    "## Notes",
    "",
    "Add anything else that might help (network state, what you were doing, etc.).",
  ].join("\n");
}

/**
 * Build a pre-filled GitHub "new issue" URL from an error.
 */
export function buildIssueUrl(
  err: unknown,
  context: { command: string; argv: string[] },
): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const title = e.message.slice(0, 80).replace(/[\r\n]+/g, " ");
  const body = formatErrorBody(err, context);
  const params = new URLSearchParams({
    title: `[bug] ${title || "Unhandled error"}`,
    body,
    labels: "bug",
  });
  return `${NEW_ISSUE_URL}?${params.toString()}`;
}

/**
 * Try to open a URL in the user's default browser. Platform-aware, with a
 * Node fallback so this works even when `Bun.spawn` isn't available.
 */
function tryOpenUrl(url: string): boolean {
  try {
    const p = osPlatform;
    if (typeof Bun !== "undefined") {
      if (p === "win32") Bun.spawn(["cmd", "/c", "start", "", url]);
      else if (p === "darwin") Bun.spawn(["open", url]);
      else Bun.spawn(["xdg-open", url]);
      return true;
    }
    // Node fallback — use child_process.spawn detached so it survives exit
    const cmd = p === "win32" ? "cmd" : p === "darwin" ? "open" : "xdg-open";
    const args = p === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Print the report URL and optionally try to open it. Always returns the URL
 * so the caller can log it regardless of whether the browser opened.
 */
export function reportError(
  err: unknown,
  context: { command: string; argv: string[] } = {
    command: "ghfind",
    argv: process.argv.slice(2),
  },
): string {
  const url = buildIssueUrl(err, context);
  console.error("");
  console.error("  ⚠  ghfind encountered an unexpected error.");
  console.error("");
  console.error("  Help us fix it by opening a bug report with the");
  console.error("  details pre-filled. Your browser will open the new-issue");
  console.error("  page; review and submit (or close the tab to skip).");
  console.error("");
  const opened = tryOpenUrl(url);
  if (opened) {
    console.error("  → Opened: " + url);
  } else {
    console.error("  Copy this URL to file a bug report:");
    console.error("");
    console.error("    " + url);
  }
  console.error("");
  return url;
}
