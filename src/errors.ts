/**
 * Structured error types with user-facing messages.
 * Every error knows what to tell the user and (optionally) what to do next.
 */

export class SearchCliError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
    public readonly recoverable: boolean = true,
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

export class RateLimitError extends SearchCliError {
  constructor(public readonly hasToken: boolean, resetSeconds?: number) {
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
