/**
 * Error report helper — build a GitHub-issue pre-fill URL from an uncaught
 * error, print it, and offer to open it in the user's browser.
 *
 * Privacy: never auto-posts. The user sees the URL and decides whether to
 * submit. Credentials found in argv or the error text are redacted before
 * they can reach the URL, and a redacted report is never auto-opened.
 */
import {
  platform as osPlatform,
  arch as osArch,
  version as nodeVersion,
  versions as nodeVersions,
} from "node:process";
import { spawn } from "node:child_process";
import { getVersion } from "./version";

// ponytail: in bun, process.platform is a string property; in node, same.
// We need it as a string, not a function call.
const _osPlatform = osPlatform;
const _osArch = osArch;
void _osPlatform;
void _osArch;

const REPO = "codersdfs/search-cli";
const NEW_ISSUE_URL = `https://github.com/${REPO}/issues/new`;

const SECRET_PLACEHOLDER = "***";

/** Flags whose *next* argument is a credential. */
const SECRET_FLAGS = /^(?:--token|-t)$/;

/** GitHub credential shapes: classic (ghp_/gho_/ghu_/ghs_/ghr_) and fine-grained. */
const SECRET_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
];

/** Replace anything that looks like a token inside a free-form string. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, SECRET_PLACEHOLDER);
  }
  return out;
}

/**
 * Redact an argv: the value following a credential flag, `--token=…`/`-t=…`
 * forms, and any bare argument that looks like a token.
 */
export function redactArgv(argv: string[]): string[] {
  const out: string[] = [];
  let redactNext = false;
  for (const arg of argv) {
    if (redactNext) {
      out.push(SECRET_PLACEHOLDER);
      redactNext = false;
      continue;
    }
    if (SECRET_FLAGS.test(arg)) {
      out.push(arg);
      redactNext = true;
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq > 0 && SECRET_FLAGS.test(arg.slice(0, eq))) {
      out.push(`${arg.slice(0, eq)}=${SECRET_PLACEHOLDER}`);
      continue;
    }
    out.push(redactSecrets(arg));
  }
  return out;
}

/** True when `argv` carries a credential that redaction would remove. */
function argvHasSecret(argv: string[]): boolean {
  return redactArgv(argv).some((arg, i) => arg !== argv[i]);
}

function getPackageVersion(): string {
  return getVersion();
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
  const stack = redactSecrets(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI color escapes from stack traces
    (e.stack ?? "(no stack)").replace(/\u001b\[[0-9;]*m/g, ""),
  );
  const message = redactSecrets(e.message || "(no message)").slice(0, 500);
  const cmd = `${context.command} ${redactArgv(context.argv).join(" ")}`.trim();
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
  const title = redactSecrets(e.message)
    .slice(0, 80)
    .replace(/[\r\n]+/g, " ");
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
      if (p === "win32") {
        // explorer.exe, not `cmd /c start` — cmd splits the URL at the first
        // unquoted `&` (query separator) and runs the rest as a command,
        // truncating every pre-filled issue URL. See src/open-url.ts.
        Bun.spawn(["explorer", url]);
      } else if (p === "darwin") Bun.spawn(["open", url]);
      else Bun.spawn(["xdg-open", url]);
      return true;
    }
    // Node fallback — use child_process.spawn detached so it survives exit
    const cmd =
      p === "win32" ? "explorer" : p === "darwin" ? "open" : "xdg-open";
    const args = [url];
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
  const hadSecret = argvHasSecret(context.argv);
  // Build the URL from the scrubbed argv, never the raw one.
  const url = buildIssueUrl(err, {
    command: context.command,
    argv: redactArgv(context.argv),
  });
  console.error("");
  console.error("  ⚠  ghfind encountered an unexpected error.");
  console.error("");
  if (hadSecret) {
    console.error("  A token was found in the command line and has been");
    console.error("  redacted. Your browser will NOT be opened — review the");
    console.error("  scrubbed URL below before sharing it anywhere.");
  } else {
    console.error("  Help us fix it by opening a bug report with the");
    console.error("  details pre-filled. Your browser will open the new-issue");
    console.error("  page; review and submit (or close the tab to skip).");
  }
  console.error("");
  // Never auto-open a report that contained a credential.
  const opened = hadSecret ? false : tryOpenUrl(url);
  if (opened) {
    console.error(`  → Opened: ${url}`);
  } else {
    console.error("  Copy this URL to file a bug report:");
    console.error("");
    console.error(`    ${url}`);
  }
  console.error("");
  return url;
}
