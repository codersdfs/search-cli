/**
 * Saved searches — named queries you can re-run anytime.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SavedSearch, SortStrategy } from "./types.ts";
import { stateDir } from "./config.ts";

const SAVED_FILE = join(stateDir(), "saved-searches.json");

function loadRaw(): SavedSearch[] {
  mkdirSync(stateDir(), { recursive: true });
  try {
    return JSON.parse(readFileSync(SAVED_FILE, "utf-8")) as SavedSearch[];
  } catch {
    return [];
  }
}

function saveRaw(searches: SavedSearch[]): void {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(SAVED_FILE, JSON.stringify(searches, null, 2));
}

/** Get all saved searches, sorted by last run time (most recent first). */
export function getSavedSearches(): SavedSearch[] {
  return loadRaw().sort((a, b) => (b.lastRunAt ?? b.createdAt) - (a.lastRunAt ?? a.createdAt));
}

/** Save a new search. Overwrites if name already exists. */
export function saveSearch(name: string, query: string, mode: "search" | "trending", sort: SortStrategy, limit: number, tab?: string): SavedSearch {
  const searches = loadRaw();
  const now = Date.now();
  const existing = searches.findIndex((s) => s.name === name);
  const entry: SavedSearch = { name, query, mode, sort, limit, tab, createdAt: now, lastRunAt: now };
  if (existing >= 0) {
    searches[existing] = { ...searches[existing], ...entry, createdAt: searches[existing].createdAt };
  } else {
    searches.push(entry);
  }
  saveRaw(searches);
  return entry;
}

/** Delete a saved search by name. */
export function deleteSavedSearch(name: string): void {
  saveRaw(loadRaw().filter((s) => s.name !== name));
}

/** Update lastRunAt for a saved search. */
export function touchSavedSearch(name: string): void {
  const searches = loadRaw();
  const found = searches.find((s) => s.name === name);
  if (found) {
    found.lastRunAt = Date.now();
    saveRaw(searches);
  }
}
