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
 * HTTP 403 — authenticated but not allowed (SAML enforcement, resource
 * restrictions, secondary limits). Not the same as the rate-limit 403,
 * which is detected by an exhausted x-ratelimit-remaining header first.
 */
export class ForbiddenError extends SearchCliError {
  constructor() {
    const msg =
      "⚠ Forbidden (403). If your org enforces SSO, authorize the token; [t] to change it";
    super("GitHub API returned 403 (token lacks access)", msg);
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
  constructor(public readonly detail: string) {
    super(`Invalid query: ${detail}`, `⚠ Invalid query: ${detail}`);
    this.name = "BadQueryError";
  }
}

export class NoResultsError extends SearchCliError {
  constructor(public readonly query: string) {
    super(
      `No results for "${query}"`,
      `🔍 No results for "${query}". Tips: check spelling, try fewer qualifiers, or [b]rowse trending`,
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
