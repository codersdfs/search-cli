/**
 * Query layer: parse a raw user query into structured qualifiers/keywords and
 * build the GitHub search syntax string.
 *
 * This layer is deliberately free of any I/O. It only transforms strings into
 * the {@link ParsedQuery} shape and then into a GitHub `q` parameter. Keeping it
 * pure makes it trivially unit-testable and lets a future AI query-rewriter sit
 * in front of it without side effects.
 */
import type { ParsedQuery, Qualifier, SearchOptions, SortStrategy } from "./types.ts";

/** Qualifier keys we explicitly understand and can also accept as CLI flags. */
export const KNOWN_QUALIFIERS = [
  "language",
  "stars",
  "fork",
  "archived",
  "topic",
  "user",
  "org",
  "repo",
  "updated",
  "pushed",
  "visibility",
  "in",
  "size",
  "license",
  "created",
] as const;

export type KnownQualifier = (typeof KNOWN_QUALIFIERS)[number];

/** Qualifier suggestions for Tab auto-complete. Maps a prefix to matching qualifiers. */
export const QUALIFIER_SUGGESTIONS: Record<string, string[]> = {
  l: ["language:"],
  s: ["stars:", "size:"],
  t: ["topic:"],
  u: ["user:"],
  o: ["org:"],
  r: ["repo:"],
  c: ["created:"],
  p: ["pushed:"],
  v: ["visibility:"],
  i: ["in:"],
  f: ["fork:"],
  a: ["archived:"],
};

/** Find matching qualifier suggestions for a partial word. */
export function suggestFor(input: string): string[] {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) return [];
  // Single letter prefix
  if (trimmed.length === 1 && QUALIFIER_SUGGESTIONS[trimmed]) {
    return QUALIFIER_SUGGESTIONS[trimmed];
  }
  // Partial qualifier key (e.g. "lang" → "language:")
  const matches = KNOWN_QUALIFIERS.filter(k => k.startsWith(trimmed));
  return matches.map(k => k + ":");
}

/**
 * Tokenize a raw query string while respecting double quotes so that phrases
 * like `"machine learning"` or `repo:"my cool repo"` stay together as one
 * token even when the quote is not at a token boundary.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch; // keep the quote so callers can detect quoted values
    } else if (/\s/.test(ch) && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) {
    // Strip quotes only when the whole token is wrapped in them
    // (e.g. `"machine learning"`); leave `repo:"my repo"` intact for the
    // qualifier parser to handle.
    if (current.startsWith('"') && current.endsWith('"') && current.length >= 2) {
      current = current.slice(1, -1);
    }
    tokens.push(current);
  }
  return tokens;
}

/**
 * Parse a raw query string into a {@link ParsedQuery}.
 *
 * Rules:
 *  - `key:value` or `key:"quoted value"` becomes a qualifier.
 *  - `-key:value` becomes a negated qualifier.
 *  - Anything else is a free-text keyword (quotes are stripped).
 *  - The original string is preserved verbatim in `raw`.
 */
export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { keywords: [], qualifiers: [], raw };
  }

  const keywords: string[] = [];
  const qualifiers: Qualifier[] = [];

  for (const token of tokenize(trimmed)) {
    const qualifier = matchQualifier(token);
    if (qualifier) {
      qualifiers.push(qualifier);
    } else {
      keywords.push(token);
    }
  }

  return { keywords, qualifiers, raw: trimmed };
}

/** Match a single token against `[-]key:value` (value may be quoted). */
function matchQualifier(token: string): Qualifier | null {
  const negated = token.startsWith("-");
  const body = negated ? token.slice(1) : token;
  const idx = body.indexOf(":");
  if (idx <= 0) return null; // no key, or starts with ':'
  const key = body.slice(0, idx).toLowerCase();
  let value = body.slice(idx + 1);
  if (value === "") return null;
  // A qualifier key must be a plain word (letters only) so that URLs like
  // `http://example.com` are treated as free-text keywords, not qualifiers.
  if (!/^[a-z]+$/i.test(key)) return null;
  // A value starting with `//` is a URL scheme, not a qualifier value.
  if (value.startsWith("//")) return null;
  // Strip surrounding quotes from a quoted value (e.g. `repo:"my repo"`).
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1);
  }
  return { key, value, negated };
}

/** CLI flag filters that map onto qualifiers. */
export interface FlagFilters {
  language?: string;
  stars?: string;
  org?: string;
  user?: string;
  topic?: string;
  archived?: boolean;
  fork?: boolean;
}

/**
 * Merge flag-based filters into a parsed query. Flags are appended as
 * qualifiers. Returns a new {@link ParsedQuery} (does not mutate the input).
 */
export function applyFlagFilters(
  query: ParsedQuery,
  flags: FlagFilters,
): ParsedQuery {
  const qualifiers = [...query.qualifiers];

  if (flags.language) qualifiers.push({ key: "language", value: flags.language, negated: false });
  if (flags.stars) qualifiers.push({ key: "stars", value: flags.stars, negated: false });
  if (flags.org) qualifiers.push({ key: "org", value: flags.org, negated: false });
  if (flags.user) qualifiers.push({ key: "user", value: flags.user, negated: false });
  if (flags.topic) qualifiers.push({ key: "topic", value: flags.topic, negated: false });
  if (flags.archived !== undefined)
    qualifiers.push({ key: "archived", value: flags.archived ? "true" : "false", negated: false });
  if (flags.fork !== undefined)
    qualifiers.push({ key: "fork", value: flags.fork ? "true" : "false", negated: false });

  return { ...query, qualifiers };
}

/**
 * Validate a parsed query for conflicting or nonsensical filters.
 * Throws an Error describing the first conflict found.
 */
export function validateQuery(query: ParsedQuery): void {
  const has = (key: string) => query.qualifiers.some((q) => q.key === key && !q.negated);

  if (has("fork") && has("archived")) {
    throw new Error("Cannot combine `fork:` and `archived:` filters (a fork can still be archived, but the combination is usually unintended).");
  }
  if (has("user") && has("org")) {
    throw new Error("Cannot combine `user:` and `org:` filters (a repo belongs to one or the other).");
  }
  if (has("visibility") && has("private")) {
    throw new Error("Cannot combine `visibility:` and `private:` filters.");
  }
}

/**
 * Build the GitHub search `q` string from a parsed query.
 * Keywords are joined with spaces; qualifiers are emitted as `key:value`
 * (or `-key:value` when negated). Quoted values are re-quoted when they
 * contain spaces.
 */
export function buildGitHubQuery(query: ParsedQuery): string {
  const parts: string[] = [];

  for (const kw of query.keywords) {
    const alreadyQuoted = kw.startsWith('"') && kw.endsWith('"');
    parts.push(kw.includes(" ") && !alreadyQuoted ? `"${kw}"` : kw);
  }

  for (const q of query.qualifiers) {
    const needsQuote = q.value.includes(" ") && !q.value.startsWith('"');
    const value = needsQuote ? `"${q.value}"` : q.value;
    parts.push(`${q.negated ? "-" : ""}${q.key}:${value}`);
  }

  return parts.join(" ");
}

/**
 * Map our sort strategy to the GitHub `sort` param and the in-query `sort:`
 * qualifier. GitHub's repository search supports `stars`, `forks`, `updated`
 * and (implicitly) best-match. We encode best-match by omitting the param.
 */
export function githubSortParam(sort: SortStrategy): { sort?: string; order?: string } {
  switch (sort) {
    case "stars":
      return { sort: "stars", order: "desc" };
    case "forks":
      return { sort: "forks", order: "desc" };
    case "updated":
      return { sort: "updated", order: "desc" };
    case "best-match":
    default:
      return {}; // GitHub default relevance ranking
  }
}

/** Build the full GitHub search URL for the given query + options. */
export function buildSearchUrl(query: ParsedQuery, options: SearchOptions): string {
  const q = buildGitHubQuery(query);
  const { sort, order } = githubSortParam(options.sort);
  const perPage = Math.min(Math.max(options.limit, 1), 100); // GitHub max page size
  const params = new URLSearchParams({ q: q || " ", per_page: String(perPage) });
  if (sort) params.set("sort", sort);
  if (order) params.set("order", order);
  return `https://api.github.com/search/repositories?${params.toString()}`;
}