/**
 * github-client.ts — the one seam every GitHub HTTP call crosses.
 *
 * Two things live here and nowhere else:
 *
 *   1. Token resolution — flag > surface state > config. `loadConfig()` folds
 *      GITHUB_TOKEN into `githubToken` at load time (env wins over the file),
 *      so every surface resolves identically. `resolveTokens` additionally
 *      expands the config `githubTokens` list for rotation, deduped.
 *   2. Status classification — 401 → AuthError; 403 with an exhausted
 *      `x-ratelimit-remaining` → RateLimitError; any other 403 →
 *      ForbiddenError carrying GitHub's own reason; anything else !ok →
 *      NetworkError.
 *
 * GET-only. The one deliberate exception is readme.ts / image-loader.ts /
 * release-cmd.ts, which talk to non-API hosts or need binary bodies and keep
 * their own paths. `passthroughStatuses` lets callers handle specific statuses
 * (304 Not Modified, 404 Not Found) themselves.
 */
import {
  AuthError,
  ForbiddenError,
  NetworkError,
  RateLimitError,
} from "./errors";
import { loadConfig } from "./config";

/** Minimal logger shape; structurally compatible with search.ts's Logger. */
export interface GitHubClientLogger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** Strip a token out of a URL before logging. */
export function redactToken(url: string, token: string | undefined): string {
  // Guarded against the empty string: url.replace("", …) inserts between
  // every character.
  return token ? url.replace(token, "<token>") : url;
}

/** Token precedence: explicit flag > surface state > config (env folded in). */
export function resolveToken(
  explicit?: string,
  state?: string,
): string | undefined {
  return explicit || state || loadConfig().githubToken || undefined;
}

/**
 * Every token worth trying, in rotation order: explicit, surface state,
 * config singles, then the config `githubTokens` list. Deduped, order kept.
 */
export function resolveTokens(explicit?: string, state?: string): string[] {
  const config = loadConfig();
  const list = Array.isArray(config.githubTokens) ? config.githubTokens : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [explicit, state, config.githubToken, ...list]) {
    const v = typeof t === "string" ? t.trim() : "";
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** The canonical GitHub API headers; `extra` overrides or extends them. */
export function githubHeaders(
  token?: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ghfind",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

/** True when a 403 is an exhausted primary rate limit (or GitHub said nothing). */
export function isRateLimit403(res: Response): boolean {
  const remaining = res.headers.get("x-ratelimit-remaining");
  return remaining === "0" || remaining === null;
}

export interface ClassifyOptions {
  token?: string;
  logger?: GitHubClientLogger;
  /** For log lines only; the token is redacted before printing. */
  url?: string;
}

function rateLimitResetSeconds(res: Response): number | undefined {
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (!Number.isFinite(reset) || reset <= 0) return undefined;
  return Math.max(0, Math.round(reset - Date.now() / 1000));
}

/** GitHub's own explanation, or a generic placeholder for non-JSON bodies. */
function forbiddenReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message) {
      return parsed.message;
    }
  } catch {
    // Non-JSON body (HTML/CAPTCHA); keep the generic reason.
  }
  return "no reason given";
}

/**
 * Throw the typed error for any non-OK response; a no-op otherwise.
 * Reads (and consumes) the body only on failure paths.
 */
export async function throwIfGitHubError(
  res: Response,
  opts: ClassifyOptions = {},
): Promise<void> {
  if (res.ok) return;
  const { token, logger, url } = opts;
  const redactedUrl = url ? redactToken(url, token) : undefined;

  if (res.status === 403) {
    if (isRateLimit403(res)) {
      logger?.warn("[github] rate limit exceeded");
      throw new RateLimitError(!!token, rateLimitResetSeconds(res));
    }
    const body = await res.text().catch(() => "");
    logger?.error(
      `[github] non-rate-limit 403: remaining=${res.headers.get("x-ratelimit-remaining")} ` +
        `retry-after=${res.headers.get("retry-after") ?? "none"} ` +
        `x-ratelimit-reset=${res.headers.get("x-ratelimit-reset") ?? "none"} ` +
        `authed=${token ? "yes" : "no"}${redactedUrl ? ` url=${redactedUrl}` : ""}`,
    );
    logger?.error(`[github] 403 body: ${body.slice(0, 400)}`);
    // SSO enforcement, secondary rate limit, or org policy — the status code
    // cannot tell them apart, so surface GitHub's own message.
    throw new ForbiddenError(forbiddenReason(body));
  }
  if (res.status === 401) {
    const body = await res.text().catch(() => "");
    logger?.error(`[github] auth rejected (401): ${body.slice(0, 200)}`);
    throw new AuthError();
  }
  const body = await res.text().catch(() => "");
  logger?.error(`[github] API error ${res.status}: ${body.slice(0, 200)}`);
  throw new NetworkError();
}

export interface GitHubFetchOptions extends ClassifyOptions {
  /** Extra/override headers, merged after the canonical set. */
  headers?: Record<string, string>;
  /** Statuses returned as-is for the caller to handle (e.g. 304, 404). */
  passthroughStatuses?: readonly number[];
}

/** GET a GitHub URL; non-OK responses throw typed errors unless passed through. */
export async function githubFetch(
  url: string,
  opts: GitHubFetchOptions = {},
): Promise<Response> {
  const { token, headers, passthroughStatuses, ...classify } = opts;
  const res = await fetch(url, { headers: githubHeaders(token, headers) });
  if (passthroughStatuses?.includes(res.status)) return res;
  await throwIfGitHubError(res, { ...classify, token, url });
  return res;
}
