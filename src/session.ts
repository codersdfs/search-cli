/**
 * Session restore — save/restore UI state between restarts.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SessionState, SortStrategy } from "./types.ts";
import { stateDir } from "./config.ts";

const SESSION_FILE = join(stateDir(), "session.json");

export function saveSession(state: SessionState): void {
  mkdirSync(stateDir(), { recursive: true });
  try {
    writeFileSync(SESSION_FILE, JSON.stringify(state));
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[search-cli] Failed to save session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function restoreSession(): SessionState | null {
  try {
    const raw = readFileSync(SESSION_FILE, "utf-8");
    return JSON.parse(raw) as SessionState;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    writeFileSync(SESSION_FILE, "");
  } catch {
    // non-critical
  }
}
