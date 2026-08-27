/**
 * Release tracker — checks bookmarked repos for new GitHub releases.
 *
 * Decisions (map 003):
 *   - Signal: new GitHub releases only (`GET /repos/{o}/{r}/releases?per_page=5`).
 *   - Seen state: `lastSeenAt` per bookmark; "new" = published after it.
 *   - Rate budget: etag conditional requests + token when present.
 *   - Prereleases shown (tagged `[pre]`), drafts never.
 *
 * ponytail: sequential fetches — fine for ≤100 bookmarks at launch;
 * parallelize with p-limit if users report slow startup.
 */
import type { Bookmark } from "./types";
import { readJSON, writeJSON } from "./storage";
import { getBookmarks, getLastSeen, markSeen } from "./bookmarks";
import { addNotification } from "./notifications";
import { loadConfig } from "./config";

const RELEASES_FILE = "release-cache.json";
const PER_REPO = 5;

export interface TrackedRelease {
  id: number;
  tagName: string;
  name: string;
  url: string;
  publishedAt: string;
  prerelease: boolean;
}

/** Persisted cache: etag + last-known releases per repo. Only what the feed needs. */
interface RepoReleaseState {
  etag?: string;
  checkedAt: number;
  releases: TrackedRelease[];
}

type ReleaseCache = Record<string, RepoReleaseState>;

function loadCache(): ReleaseCache {
  return readJSON<ReleaseCache>(RELEASES_FILE, {});
}

function saveCache(cache: ReleaseCache): void {
  writeJSON(RELEASES_FILE, cache);
}

function toTracked(raw: Array<Record<string, unknown>>): TrackedRelease[] {
  return raw
    .filter((r) => r.draft !== true) // drafts: never shown
    .map((r) => ({
      id: r.id as number,
      tagName: r.tag_name as string,
      name: (r.name as string) || (r.tag_name as string),
      url: r.html_url as string,
      publishedAt: (r.published_at as string) || "",
      prerelease: r.prerelease === true,
    }));
}

/** Fetch /releases for one repo using its cached etag. */
async function fetchReleases(
  fullName: string,
  etag: string | undefined,
  token: string | undefined,
): Promise<{ status: number; etag?: string; releases?: TrackedRelease[] }> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (etag) headers["If-None-Match"] = etag;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${fullName}/releases?per_page=${PER_REPO}`, { headers });
  if (res.status === 304 || !res.ok) return { status: res.status };
  return {
    status: 200,
    etag: res.headers.get("etag") ?? undefined,
    releases: toTracked((await res.json()) as Array<Record<string, unknown>>),
  };
}

/**
 * Check all bookmarks for releases newer than their lastSeenAt.
 * Returns one result per bookmark so callers can render feeds or counts.
 */
export async function checkReleases(
  opts: { token?: string } = {},
): Promise<Array<{ fullName: string; newReleases: TrackedRelease[]; error?: string }>> {
  const bookmarks = getBookmarks();
  const cache = loadCache();
  const config = loadConfig();
  const token = opts.token ?? config.githubToken ?? process.env.GITHUB_TOKEN;
  const results: Array<{ fullName: string; newReleases: TrackedRelease[]; error?: string }> = [];

  for (const bm of bookmarks) {
    try {
      const prev = cache[bm.repo.fullName];
      const lastSeen = getLastSeen(bm.repo.fullName);
      const isNew = (r: TrackedRelease) =>
        !r.publishedAt || new Date(r.publishedAt).getTime() > lastSeen;

      const { status, etag, releases } = await fetchReleases(bm.repo.fullName, prev?.etag, token);

      if (status === 304 && prev) {
        // Unchanged upstream; recompute against lastSeenAt (it may have moved).
        results.push({ fullName: bm.repo.fullName, newReleases: prev.releases.filter(isNew) });
        continue;
      }
      if (status !== 200 || !releases) {
        results.push({ fullName: bm.repo.fullName, newReleases: [], error: `HTTP ${status}` });
        continue;
      }
      cache[bm.repo.fullName] = { checkedAt: Date.now(), etag, releases };
      results.push({ fullName: bm.repo.fullName, newReleases: releases.filter(isNew) });
    } catch (err) {
      results.push({ fullName: bm.repo.fullName, newReleases: [], error: (err as Error).message });
    }
  }

  saveCache(cache);
  return results;
}

/** Check + push unseen releases into the notification center, then mark them seen. Returns per-repo results. */
export async function checkAndNotify(opts: { token?: string } = {}): Promise<Array<{ fullName: string; newReleases: TrackedRelease[]; error?: string }>> {
  const results = await checkReleases(opts);
  for (const r of results) {
    for (const rel of r.newReleases) {
      addNotification(
        "release",
        `${r.fullName} released ${rel.tagName}${rel.prerelease ? " [pre]" : ""}`,
      );
    }
    if (r.newReleases.length > 0) markSeen(r.fullName);
  }
  return results;
}

/** All cached releases across bookmarks, newest first (for the Releases panel / CLI). */
export function allCachedReleases(): Array<TrackedRelease & { fullName: string }> {
  const cache = loadCache();
  const bookmarks = getBookmarks();
  return Object.entries(cache)
    .filter(([fullName]) => bookmarks.some((b) => b.repo.fullName === fullName))
    .flatMap(([fullName, s]) => s.releases.map((r) => ({ ...r, fullName })))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}
