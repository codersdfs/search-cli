/**
 * Session restore — save/restore UI state between restarts.
 */
import type { SessionState } from "./types";
import { readJSON, writeJSON } from "./storage";

const SESSION_FILE = "session.json";

/** Upper bound for a plausible search query; anything longer is garbage. */
const MAX_QUERY_LENGTH = 200;

/**
 * Drop JSON-shaped or oversized queries. A search line is never raw JSON
 * (objects/arrays always arrive as paste payloads — e.g. an MCP handshake
 * request that a client piped into the TUI) and never thousands of chars,
 * so such a "query" is corruption, not intent. The TUI's input handler
 * applies the same shape rule to live pastes.
 */
export function sanitizeQuery(query: unknown): string | undefined {
  if (typeof query !== "string") return undefined;
  const trimmed = query.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_QUERY_LENGTH) {
    return undefined;
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return undefined;
  }
  return trimmed;
}

/** Keep only well-formed, known-good fields from a session snapshot. */
export function sanitizeSession(
  state: SessionState | null | undefined,
): SessionState | null {
  if (!state || typeof state !== "object") return null;
  const mode =
    state.mode === "trending" ||
    state.mode === "packages" ||
    state.mode === "search"
      ? state.mode
      : "search";
  const trendingTab =
    typeof state.trendingTab === "string" && state.trendingTab.length > 0
      ? state.trendingTab
      : "This Week";
  const limit =
    typeof state.limit === "number" && Number.isFinite(state.limit)
      ? state.limit
      : 50;
  const sort = typeof state.sort === "string" ? state.sort : "best-match";
  return {
    mode,
    query: sanitizeQuery(state.query) ?? "",
    sort,
    limit,
    trendingTab,
  };
}

export function saveSession(state: SessionState): void {
  try {
    writeJSON(SESSION_FILE, sanitizeSession(state));
  } catch (err) {
    if (process.env.DEBUG)
      console.error(
        `[ghfind] Failed to save session: ${err instanceof Error ? err.message : String(err)}`,
      );
  }
}

export function restoreSession(): SessionState | null {
  // Anything read from disk passes the same sanitizer as anything written —
  // protects against files corrupted before this guard existed.
  return sanitizeSession(readJSON<SessionState | null>(SESSION_FILE, null));
}

export function clearSession(): void {
  writeJSON(SESSION_FILE, null);
}
