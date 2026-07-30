/**
 * Session restore — save/restore UI state between restarts.
 */
import type { SessionState } from "./types";
import { readJSON, writeJSON } from "./storage";

const SESSION_FILE = "session.json";

export function saveSession(state: SessionState): void {
  try {
    writeJSON(SESSION_FILE, state);
  } catch (err) {
    if (process.env.DEBUG)
      console.error(`[ghfind] Failed to save session: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function restoreSession(): SessionState | null {
  return readJSON<SessionState | null>(SESSION_FILE, null);
}

export function clearSession(): void {
  writeJSON(SESSION_FILE, null);
}
