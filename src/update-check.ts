/**
 * Update checker — checks npm registry for a newer ghfind version.
 *
 * Uses the npm registry HTTP API (no subprocess needed — Bun has native fetch).
 * Persists check state in the XDG state dir via storage.ts.
 */
import { readJSON, writeJSON } from "./storage";
import { stateDir } from "./config";
import { appendFileSync } from "fs";
import { join } from "path";

function debugLog(msg: string): void {
  if (!process.env.DEBUG) return;
  try {
    appendFileSync(join(stateDir(), "ghfind-debug.log"), `[${new Date().toISOString()}] ${msg}\n`, "utf-8");
  } catch { /* ignore */ }
}

const REGISTRY_URL = "https://registry.npmjs.org/github-search-cli/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REQUEST_TIMEOUT_MS = 5000;

export interface UpdateState {
  /** Timestamp of last successful check. */
  lastCheck: number;
  /** Timestamp until which we should suppress the panel (snooze). */
  snoozeUntil: number;
  /** If true, never show the update panel again. */
  suppressed: boolean;
  /** Latest version found on last check (for display). */
  latestVersion?: string;
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
  // Fallback: naive string comparison (works for simple semver)
  const curParts = current.split(".").map(Number);
  const newParts = latest.split(".").map(Number);
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
  if (process.env.DEBUG) debugLog(`Checking for update (current: ${currentVersion})`);
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (process.env.DEBUG) debugLog(`Registry returned ${res.status}`);
      return null;
    }
    const data = await res.json() as { version?: string };
    const latest = data.version;
    if (!latest) {
      if (process.env.DEBUG) debugLog("No version in registry response");
      return null;
    }
    if (process.env.DEBUG) debugLog(`Registry latest: ${latest}`);
    if (!isNewerVersion(currentVersion, latest)) return null;
    return latest;
  } catch (e) {
    if (process.env.DEBUG) debugLog(`Update check failed: ${e instanceof Error ? e.message : String(e)}`);
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
 * Attempt to update ghfind in-place.
 * Detects installation method via process.env._ and runs the appropriate command.
 */
export async function performUpdate(): Promise<boolean> {
  const execPath = process.env._ || "";
  const isBun = execPath.includes("bun");
  const cmd = isBun
    ? ["bun", "install", "-g", "ghfind"]
    : ["npm", "install", "-g", "ghfind"];

  try {
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}
