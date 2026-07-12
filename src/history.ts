/**
 * Persistent search history — append-only JSONL with rotation.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import type { HistoryEntry } from "./types.ts";
import { stateDir } from "./config.ts";

const HISTORY_FILE = join(stateDir(), "history.jsonl");
const MAX_ENTRIES = 500;

function ensureDir() {
  mkdirSync(stateDir(), { recursive: true });
}

/** Append one entry to the history log. */
export function appendHistory(entry: HistoryEntry): void {
  ensureDir();
  const line = JSON.stringify(entry) + "\n";
  try {
    appendFileSync(HISTORY_FILE, line, "utf-8");
  } catch {
    // non-critical
  }
}

/** Read all history entries, newest first, deduplicating consecutive identical queries. */
export function readHistory(): HistoryEntry[] {
  try {
    const raw = readFileSync(HISTORY_FILE, "utf-8").trim();
    if (!raw) return [];
    const lines = raw.split("\n").filter(Boolean);
    const entries: HistoryEntry[] = lines.map((l) => JSON.parse(l) as HistoryEntry);

    // Sorted oldest-first in file; reverse to newest-first
    entries.reverse();

    // Deduplicate consecutive identical queries (keep newest)
    const deduped: HistoryEntry[] = [];
    let lastQuery: string | undefined;
    for (const e of entries) {
      if (e.query !== lastQuery) {
        deduped.push(e);
        lastQuery = e.query;
      }
    }
    return deduped;
  } catch {
    return [];
  }
}

/** Delete a single history entry by index (0 = newest). */
export function deleteHistoryEntry(index: number): void {
  const entries = readHistory();
  if (index < 0 || index >= entries.length) return;
  const removed = entries[index];
  // Rewrite file without the removed entry
  const remaining = entries.filter((e) => e.timestamp !== removed.timestamp || e.query !== removed.query);
  ensureDir();
  // Reverse back to oldest-first for file order
  writeFileSync(HISTORY_FILE, remaining.reverse().map((e) => JSON.stringify(e)).join("\n") + "\n");
}

/** Clear all history. */
export function clearHistory(): void {
  try {
    writeFileSync(HISTORY_FILE, "");
  } catch {
    // non-critical
  }
}

/** Rotate history to max entries (trim oldest). */
export function rotateHistory(): void {
  const entries = readHistory();
  if (entries.length <= MAX_ENTRIES) return;
  const trimmed = entries.slice(0, MAX_ENTRIES);
  ensureDir();
  writeFileSync(HISTORY_FILE, trimmed.reverse().map((e) => JSON.stringify(e)).join("\n") + "\n");
}

/** Count entries in history file. */
export function historyCount(): number {
  try {
    const raw = readFileSync(HISTORY_FILE, "utf-8").trim();
    return raw ? raw.split("\n").length : 0;
  } catch {
    return 0;
  }
}
