/**
 * Bookmarks — saved repos with tags, persisted as JSON.
 */
import type { Bookmark, Repo } from "./types";
import { readJSON, writeJSON } from "./storage";

const BOOKMARK_FILE = "bookmarks.json";

function loadRaw(): Bookmark[] {
  return readJSON<Bookmark[]>(BOOKMARK_FILE, []);
}

function saveRaw(bookmarks: Bookmark[]): void {
  writeJSON(BOOKMARK_FILE, bookmarks);
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
/** Read a repo's seen-marker (0 = never seen). */
export function getLastSeen(fullName: string): number {
  return loadRaw().find((b) => b.repo.fullName === fullName)?.lastSeenAt ?? 0;
}
/** Mark a repo's releases as seen up to now. */
export function markSeen(fullName: string): void {
  const bookmarks = loadRaw();
  const bm = bookmarks.find((b) => b.repo.fullName === fullName);
  if (bm) {
    bm.lastSeenAt = Date.now();
    saveRaw(bookmarks);
  }
}
