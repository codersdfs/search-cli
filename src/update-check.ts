/**
 * Update checker — polls the npm registry for the latest published version
 * of `github-search-cli` and reports whether a newer version is available.
 *
 * Design (locked in wayfinder):
 *  - Source: npm registry `latest` tag
 *  - Trigger: TUI entry only
 *  - Frequency: check every launch; "Later" suppresses only this session
 *  - Fail-open: network errors never block startup
 *  - State: cached under the XDG state dir (cacheDir)
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { cacheDir } from "./config";

const PACKAGE_NAME = "github-search-cli";
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CHECK_TIMEOUT_MS = 3000;

export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  url: string;
}

export interface UpdateCheckResult {
  info: UpdateInfo | null;
  error: string | null;
}

interface CachedCheck {
  latest: string;
  checkedAt: number;
}

const CACHE_FILE = join(cacheDir(), "update-check.json");

/** Compare two semver-ish version strings. Returns >0 if a>b, <0 if a<b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function loadCache(): CachedCheck | null {
  try {
    const raw = readFileSync(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.latest && typeof parsed.checkedAt === "number") {
      return parsed as CachedCheck;
    }
  } catch {
    // no cache yet
  }
  return null;
}

function saveCache(latest: string): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(
      CACHE_FILE,
      JSON.stringify({ latest, checkedAt: Date.now() }),
    );
  } catch {
    // non-critical — don't block startup
  }
}

/**
 * Fetch the latest version from npm registry.
 * Uses fetch with a timeout; returns null on any failure (fail-open).
 */
export async function fetchLatestVersion(
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Check for an update. Returns UpdateCheckResult with info (if newer) or error.
 *
 * @param currentVersion The currently running version (from package.json)
 * @param options.skipCache Bypass cache (useful for tests)
 */
export async function checkForUpdate(
  currentVersion: string,
  options: { skipCache?: boolean } = {},
): Promise<UpdateCheckResult> {
  // Use cache if available and not skipped
  if (!options.skipCache) {
    const cached = loadCache();
    if (cached) {
      if (compareVersions(cached.latest, currentVersion) > 0) {
        return {
          info: {
            current: currentVersion,
            latest: cached.latest,
            hasUpdate: true,
            url: `https://github.com/${PACKAGE_NAME}/releases`,
          },
          error: null,
        };
      }
      // cached version is not newer — still return null info, no error
      return { info: null, error: null };
    }
  }

  // Fetch fresh
  const latest = await fetchLatestVersion();
  if (latest === null) {
    return { info: null, error: "network" };
  }

  saveCache(latest);

  if (compareVersions(latest, currentVersion) > 0) {
    return {
      info: {
        current: currentVersion,
        latest,
        hasUpdate: true,
        url: `https://github.com/${PACKAGE_NAME}/releases`,
      },
      error: null,
    };
  }

  return { info: null, error: null };
}

/**
 * Run `npm install -g github-search-cli` to upgrade.
 * Spawns detached so it survives the TUI process exiting.
 */
export async function installUpdate(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const { spawnSync } = await import("child_process");
    const result = spawnSync("npm", ["install", "-g", PACKAGE_NAME], {
      stdio: "inherit",
      shell: true,
      detached: true,
    });
    if (result.status === 0) {
      return { success: true, message: "Update installed successfully." };
    }
    return {
      success: false,
      message: `npm install failed (exit ${result.status})`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to run npm install: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
