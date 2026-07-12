/**
 * Bookmarks — saved repos with tags, persisted as JSON.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Bookmark, Repo } from "./types.ts";
import { stateDir } from "./config.ts";

const BOOKMARK_FILE = join(stateDir(), "bookmarks.json");

function ensureDir() {
  mkdirSync(stateDir(), { recursive: true });
}

function loadRaw(): Bookmark[] {
  ensureDir();
  try {
    const raw = readFileSync(BOOKMARK_FILE, "utf-8");
    return JSON.parse(raw) as Bookmark[];
  } catch {
    return [];
  }
}

function saveRaw(bookmarks: Bookmark[]): void {
  ensureDir();
  writeFileSync(BOOKMARK_FILE, JSON.stringify(bookmarks, null, 2));
}

/** Get all bookmarks, newest first. */
export function getBookmarks(): Bookmark[] {
  return loadRaw().sort((a, b) => b.savedAt - a.savedAt);
}

/** Check if a repo is bookmarked by fullName. */
export function isBookmarked(fullName: string): boolean {
  return loadRaw().some((b) => b.repo.fullName === fullName);
}

/** Toggle bookmark: add if not present, remove if present. Returns new state. */
export function toggleBookmark(repo: Repo, tags: string[] = []): boolean {
  const bookmarks = loadRaw();
  const idx = bookmarks.findIndex((b) => b.repo.fullName === repo.fullName);
  if (idx >= 0) {
    bookmarks.splice(idx, 1);
    saveRaw(bookmarks);
    return false; // removed
  }
  bookmarks.push({ repo, savedAt: Date.now(), tags });
  saveRaw(bookmarks);
  return true; // added
}

/** Remove a bookmark by fullName. */
export function removeBookmark(fullName: string): void {
  const bookmarks = loadRaw().filter((b) => b.repo.fullName !== fullName);
  saveRaw(bookmarks);
}

/** Search bookmarks by text (matches name, description, tags). */
export function searchBookmarks(query: string): Bookmark[] {
  const q = query.toLowerCase();
  return getBookmarks().filter(
    (b) =>
      b.repo.fullName.toLowerCase().includes(q) ||
      (b.repo.description ?? "").toLowerCase().includes(q) ||
      b.tags.some((t) => t.toLowerCase().includes(q)),
  );
}
