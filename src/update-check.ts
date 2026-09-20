/**
 * Update checker — checks npm registry for a newer ghfind version.
 *
 * Uses the npm registry HTTP API (no subprocess needed — Bun has native fetch).
 * Persists check state in the XDG state dir via storage.ts.
 */
import { readJSON, writeJSON, debugLog } from "./storage";
import { readFileSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY_URL = "https://registry.npmjs.org/github-search-cli/latest";
// The npm package name is `github-search-cli`; `ghfind` is the bin name.
const PKG_NAME = "github-search-cli";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REQUEST_TIMEOUT_MS = 5000;
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");

export interface UpdateState {
  /** Timestamp of last successful check. */
  lastCheck: number;
  /** Timestamp until which we should suppress the panel (snooze). */
  snoozeUntil: number;
  /** If true, never show the update panel again. */
  suppressed: boolean;
  /** Latest version found on last check (for display). */
  latestVersion?: string;
  /** Version at time of last successful install (populated before performUpdate). */
  lastInstalledVersion?: string;
}

const STATE_FILE = "update-state.json";
export const DEFAULTS: UpdateState = {
  lastCheck: 0,
  snoozeUntil: 0,
  suppressed: false,
};

/** Read update-check state from disk. */
export function readUpdateState(): UpdateState {
  return { ...DEFAULTS, ...readJSON<Partial<UpdateState>>(STATE_FILE, {}) };
}

/** Write update-check state to disk. */
export function writeUpdateState(state: UpdateState): void {
  writeJSON(STATE_FILE, state);
}

/**
 * Whether we should run an update check now, based on cached state.
 * Returns false if: suppressed, snoozed, or checked within the last 24h.
 */
export function shouldCheckUpdate(): boolean {
  const state = readUpdateState();
  if (state.suppressed) return false;
  if (Date.now() < state.snoozeUntil) return false;
  if (Date.now() - state.lastCheck < CHECK_INTERVAL_MS) return false;
  return true;
}

/**
 * Compare two semver strings. Returns true if `latest` is newer than `current`.
 * Uses Bun's built-in semver if available, falls back to simple comparison.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  // ponytail: Bun.semver.order is the right tool — native, correct on edge cases
  if (typeof Bun !== "undefined" && Bun.semver) {
    return Bun.semver.order(current, latest) < 0;
  }
  // Fallback: naive string comparison (works for simple semver; does not handle pre-release tags)
  const curParts = current.split(".").map((s) => Number(s.split("-")[0]));
  const newParts = latest.split(".").map((s) => Number(s.split("-")[0]));
  for (let i = 0; i < Math.max(curParts.length, newParts.length); i++) {
    const c = curParts[i] ?? 0;
    const n = newParts[i] ?? 0;
    if (n > c) return true;
    if (n < c) return false;
  }
  return false;
}

/**
 * Check the npm registry for a newer version of ghfind.
 * Returns the latest version string if an update is available, or null.
 * Never throws — failures (offline, timeout, DNS) return null silently.
 */
export async function checkForUpdate(
  currentVersion: string,
): Promise<string | null> {
  if (process.env.DEBUG)
    debugLog(`Checking for update (current: ${currentVersion})`);
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (process.env.DEBUG) debugLog(`Registry returned ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { version?: string };
    const latest = data.version;
    if (!latest) {
      if (process.env.DEBUG) debugLog("No version in registry response");
      return null;
    }
    if (process.env.DEBUG) debugLog(`Registry latest: ${latest}`);
    if (!isNewerVersion(currentVersion, latest)) return null;
    return latest;
  } catch (e) {
    if (process.env.DEBUG)
      debugLog(
        `Update check failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    return null;
  }
}

/**
 * Mark the update check as done. Stores the latest version if one was found.
 */
export function markUpdateChecked(latestVersion?: string): void {
  writeUpdateState({
    ...readUpdateState(),
    lastCheck: Date.now(),
    latestVersion,
  });
}

/**
 * Snooze update notifications for the given number of days.
 */
export function snoozeUpdateNotices(days: number): void {
  writeUpdateState({
    ...readUpdateState(),
    snoozeUntil: Date.now() + days * 24 * 60 * 60 * 1000,
  });
}

/**
 * Permanently suppress the update panel.
 */
export function suppressUpdateNotices(): void {
  writeUpdateState({
    ...readUpdateState(),
    suppressed: true,
  });
}

/**
 * Where the running install lives and which package manager owns it.
 *
 * Detection walks up from the package dir to its `node_modules` ancestor:
 * - npm global install: `<prefix>/node_modules/<pkg>` (Windows) or
 *   `<prefix>/lib/node_modules/<pkg>` (Unix)
 * - Bun global install: `<bun-home>/install/global/node_modules/<pkg>`
 * - Anything else (compiled binary, `bunx`/`npx` cache edges, dev checkout
 *   without a `node_modules` ancestor): `null` — self-update is refused
 *   rather than npm-installing a copy the user isn't running.
 */
export interface InstallLocation {
  channel: "npm" | "bun";
  /** npm prefix that owns the running install (npm channel only). */
  prefix?: string;
}

/**
 * Detect the install channel and owning npm prefix for a package directory.
 * Separators are normalized so layouts match regardless of the host OS.
 */
export function detectInstallLocation(pkgDir: string): InstallLocation | null {
  const norm = pkgDir.split("\\").join("/");
  const nodeModules = posix.dirname(norm);
  if (posix.basename(nodeModules) !== "node_modules") return null;
  const owner = posix.dirname(nodeModules);
  // Bun's global root is ~/.bun by default (BUN_INSTALL override may rename
  // it, but the default layout is what `bun install -g` produces for the
  // overwhelming majority of installs).
  if (/(^|\/)\.bun(\/|$)/.test(owner)) return { channel: "bun" };
  // Unix npm global layout nests one level deeper: <prefix>/lib/node_modules
  const prefix = posix.basename(owner) === "lib" ? posix.dirname(owner) : owner;
  return { channel: "npm", prefix };
}

/**
 * Build the install command for an update, targeting the npm prefix that
 * owns the running install. Under Bun this must NOT be `bun install -g`:
 * that writes to Bun's own global dir, leaving the running npm copy stale
 * while still exiting 0.
 */
export function buildUpdateCommand(loc: InstallLocation): string[] {
  if (loc.channel === "bun") return ["bun", "install", "-g", PKG_NAME];
  const args = ["npm", "install", "-g"];
  if (loc.prefix) args.push("--prefix", loc.prefix);
  args.push(PKG_NAME);
  return args;
}

/** Minimal quoting for win32 spawns, which go through a shell. */
function quoteWin32(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

/**
 * Attempt to update ghfind in-place.
 *
 * Runs the install command through `node:child_process` on every runtime
 * (works under Bun and Node alike; on Windows npm is `npm.cmd`, which needs
 * `shell: true` to resolve). Always returns a definitive boolean — the TUI
 * surfaces false as "Update failed".
 */
export async function performUpdate(
  location: InstallLocation | null = detectInstallLocation(PKG_DIR),
): Promise<boolean> {
  if (!location) {
    debugLog(
      "Update skipped: the running install is not under a node_modules tree " +
        "(compiled binary or dev checkout). Update it manually.",
    );
    return false;
  }
  const argv = buildUpdateCommand(location);
  try {
    const { spawn } = await import("node:child_process");
    const useShell = process.platform === "win32";
    const proc = spawn(
      argv[0],
      useShell ? argv.slice(1).map(quoteWin32) : argv.slice(1),
      { stdio: ["ignore", "ignore", "pipe"], shell: useShell },
    );
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += String(chunk);
    });
    const code = await new Promise<number | null>((resolve) => {
      proc.on("close", (c) => resolve(c));
      proc.on("error", () => resolve(-1));
    });
    if (code !== 0) {
      debugLog(`Install failed (code ${code}): ${stderr.trim()}`);
    }
    return code === 0;
  } catch (e) {
    debugLog(`Update failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * Record the current version as "last installed" before performing an update.
 * This lets the post-upgrade startup detect the version change and show notes.
 */
export function recordPreUpdateState(currentVersion: string): void {
  writeUpdateState({
    ...readUpdateState(),
    lastInstalledVersion: currentVersion,
  });
}

/**
 * Fetch release notes for a given version.
 * Tries release-notes/<version>.md first, then falls back to CHANGELOG.md section.
 * Returns the markdown text or null if not found.
 */
export function fetchReleaseNotes(version: string): string | null {
  // ponytail: embedded notes are the primary source — they ship in the tarball, no network
  try {
    const notesPath = join(PKG_DIR, "release-notes", `${version}.md`);
    const md = readFileSync(notesPath, "utf-8");
    if (md.trim().length > 0) return md;
  } catch {
    // File doesn't exist for this version — fall through to CHANGELOG
  }

  // ponytail: CHANGELOG.md fallback — parse section for this version
  try {
    const changelogPath = join(PKG_DIR, "CHANGELOG.md");
    const changelog = readFileSync(changelogPath, "utf-8");
    // ponytail: find "## [version]" header, slice until next "## "
    const header = `## [${version}]`;
    const start = changelog.indexOf(header);
    if (start === -1) return null;
    const bodyStart = start + header.length;
    const rest = changelog.substring(bodyStart);
    const nextHeaderIdx = rest.indexOf("\n## ");
    const end =
      nextHeaderIdx === -1 ? changelog.length : bodyStart + nextHeaderIdx;
    return changelog.substring(bodyStart, end).trim();
  } catch {
    // CHANGELOG.md doesn't exist either
  }
  return null;
}
