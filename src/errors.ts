/** Structured error types with user-facing messages. */

export class SearchCliError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
    this.name = "SearchCliError";
  }
}

export class NetworkError extends SearchCliError {
  constructor() {
    super(
      "Network request failed",
      "⚠ Network error — check your connection. Retrying in 5s... [r]etry now",
    );
    this.name = "NetworkError";
  }
}

/**
 * HTTP 401 — the configured GitHub token was rejected.
 * Distinct from NetworkError: connectivity is fine, the credential is not.
 */
export class AuthError extends SearchCliError {
  constructor() {
    const msg =
      "⚠ Bad GitHub token (401). Press [t] to fix it, [u] to search without one";
    super("GitHub API returned 401 (invalid or revoked token)", msg);
    this.name = "AuthError";
  }
}

/**
 * HTTP 403 that is NOT a primary rate limit (i.e. `x-ratelimit-remaining`
 * was greater than zero). Three unrelated causes land here and the status
 * code cannot tell them apart:
 *   - the token's org enforces SAML SSO and has not authorized it
 *   - a secondary/abuse rate limit (concurrent or rapid-fire requests)
 *   - a valid token blocked by org or resource restrictions
 * The old message asserted SSO unconditionally, which sent people to fix a
 * credential problem that did not exist. Check GHFIND_LOG for the body.
 */
export class ForbiddenError extends SearchCliError {
  constructor(public readonly detail: string = "GitHub API returned 403") {
    const msg =
      `⚠ Forbidden (403) — ${detail}. Common causes: org SSO not authorizing the token, ` +
      `or a secondary rate limit. Press [t] to change the token`;
    super(msg, msg);
    this.name = "ForbiddenError";
  }
}

export class RateLimitError extends SearchCliError {
  constructor(
    public readonly hasToken: boolean,
    resetSeconds?: number,
  ) {
    const msg = hasToken
      ? `⚠ API rate limit exceeded (5,000/hr). Resets in ${resetSeconds ?? "?"}s. [r]etry [c]hange token`
      : "⚠ Rate limited (60/hr). Set GITHUB_TOKEN for 5,000/hr. [r]etry";
    super(msg, msg);
    this.name = "RateLimitError";
  }
}

export class BadQueryError extends SearchCliError {
  /** A concrete, corrected query the user can retry with. */
  constructor(
    public readonly detail: string,
    public readonly hint?: string,
  ) {
    super(
      `Invalid query: ${detail}`,
      hint
        ? `⚠ Invalid query: ${detail}\n  Try: ${hint}`
        : `⚠ Invalid query: ${detail}`,
    );
    this.name = "BadQueryError";
  }
}

export class NoResultsError extends SearchCliError {
  /** Concrete loosened queries to retry, most promising first. */
  constructor(
    public readonly query: string,
    public readonly relaxations: string[] = [],
  ) {
    const tips = relaxations.length
      ? relaxations.map((r) => `Try: ${r}`).join("\n  ")
      : "Tips: check spelling, try fewer qualifiers, or [b]rowse trending";
    super(
      relaxations.length > 0
        ? `No results for "${query}" — try loosening: ${relaxations.join(" / ")}`
        : `No results for "${query}"`,
      `🔍 No results for "${query}".\n  ${tips}`,
    );
    this.name = "NoResultsError";
  }
}

export class ParseError extends SearchCliError {
  constructor(source: string, detail: string) {
    super(
      `Parse error from ${source}: ${detail}`,
      `⚠ Could not parse ${source}. GitHub may have changed the layout. [r]etry`,
    );
    this.name = "ParseError";
  }
}
