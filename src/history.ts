/**
 * Persistent search history — append-only JSONL with rotation.
 */
import type { HistoryEntry } from "./types";
import { readJSONL, appendJSONL, writeJSON, writeRaw } from "./storage";

const HISTORY_FILE = "history.jsonl";
const MAX_ENTRIES = 500;

/** Append one entry to the history log. */
export function appendHistory(entry: HistoryEntry): void {
  appendJSONL(HISTORY_FILE, entry);
}

/** Read all history entries, newest first, deduplicating consecutive identical queries. */
export function readHistory(): HistoryEntry[] {
  const entries = readJSONL<HistoryEntry>(HISTORY_FILE);
  entries.reverse();
  const deduped: HistoryEntry[] = [];
  let lastQuery: string | undefined;
  for (const e of entries) {
    if (e.query !== lastQuery) {
      deduped.push(e);
      lastQuery = e.query;
    }
  }
  return deduped;
}

/** Delete a single history entry by index (0 = newest). */
export function deleteHistoryEntry(index: number): void {
  const entries = readHistory();
  if (index < 0 || index >= entries.length) return;
  const removed = entries[index];
  const remaining = entries.filter((e) => e.timestamp !== removed.timestamp || e.query !== removed.query);
  writeRaw(HISTORY_FILE, remaining.reverse().map((e) => JSON.stringify(e)).join("\n") + "\n");
}

/** Clear all history. */
export function clearHistory(): void {
  writeRaw(HISTORY_FILE, "");
}

/** Rotate history to max entries (trim oldest). */
export function rotateHistory(): void {
  const entries = readHistory();
  if (entries.length <= MAX_ENTRIES) return;
  const trimmed = entries.slice(0, MAX_ENTRIES);
  writeRaw(HISTORY_FILE, trimmed.reverse().map((e) => JSON.stringify(e)).join("\n") + "\n");
}

/** Count entries in history file. */
export function historyCount(): number {
  return readJSONL<HistoryEntry>(HISTORY_FILE).length;
}
