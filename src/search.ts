/**
 * Search module — deep module that owns the full search pipeline:
 * query parsing → URL building → API fetch (via adapter) → normalize → cache → rank.
 *
 * The adapter seam (`SearchAdapter`) is the only point of contact with the
 * network. Two implementations justify the seam: GitHub in prod, in-memory in tests.
 */
import type {
  ParsedQuery,
  Qualifier,
  QueryCorrection,
  Repo,
  SearchOptions,
  SearchProvider,
  SearchResponse,
  SortStrategy,
  CacheEntry,
} from "./types";
import {
  NetworkError,
  RateLimitError,
  ParseError,
  AuthError,
  ForbiddenError,
  BadQueryError,
} from "./errors";
import { parseTrendingHtml, type RawTrendingRepo } from "./trending-parser";

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface SearchAdapter {
  search(query: ParsedQuery, options: SearchOptions): Promise<SearchResponse>;
}

export class MemoryCache<T> {
  private cache = new Map<string, CacheEntry<T>>();

  constructor(private defaultTtlMs: number = 300_000) {}

  static key(...parts: string[]): string {
    return parts.join("::").toLowerCase().replace(/\s+/g, " ");
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }

  set(key: string, data: T, ttlMs?: number): void {
    // Re-inserting an existing key must move it to the end of the
    // insertion-ordered Map, otherwise a refreshed entry keeps its original
    // position and is the first one evicted — FIFO instead of LRU.
    this.cache.delete(key);
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      data,
      cachedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

const MAX_CACHE_SIZE = 50;

export interface GitHubApiItem {
  id: number;
  name: string;
  full_name: string;
  owner?: { login?: string };
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  language: string | null;
  topics?: string[];
  archived: boolean;
  fork: boolean;
  private: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  score: number;
}

export interface GitHubSearchEnvelope {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubApiItem[];
}

export function normalizeRepo(item: GitHubApiItem): Repo {
  const owner = item.owner?.login ?? item.full_name?.split("/")[0] ?? "";
  return {
    id: item.id ?? 0,
    fullName: item.full_name ?? "",
    name: item.name ?? "",
    owner,
    description: item.description ?? null,
    url: item.html_url ?? "",
    stars: item.stargazers_count ?? 0,
    forks: item.forks_count ?? 0,
    watchers: item.watchers_count ?? 0,
    language: item.language ?? null,
    topics: item.topics ?? [],
    archived: item.archived ?? false,
    isFork: item.fork ?? false,
    private: item.private ?? false,
    createdAt: item.created_at ?? "",
    updatedAt: item.updated_at ?? "",
    pushedAt: item.pushed_at ?? "",
    score: item.score ?? 0,
  };
}

export function normalizeEnvelope(env: GitHubSearchEnvelope): Repo[] {
  return (env.items ?? []).map(normalizeRepo);
}

export const KNOWN_QUALIFIERS = [
  "language",
  "stars",
  "forks",
  "fork",
  "archived",
  "topic",
  "topics",
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
  "followers",
] as const;

export type KnownQualifier = (typeof KNOWN_QUALIFIERS)[number];

/**
 * The same set as `KNOWN_QUALIFIERS`, as a lookup for O(1) membership tests
 * during validation.
 */
const KNOWN_QUALIFIER_SET: ReadonlySet<string> = new Set(KNOWN_QUALIFIERS);

/**
 * Common misspellings of the qualifiers ghfind knows, mapped to the correct
 * key. Scoped deliberately to ghfind's own qualifier set: correcting a key we
 * don't recognize could silently rewrite a valid `props.*`, `is:`, or `has:`
 * qualifier into something else entirely.
 */
export const QUALIFIER_ALIASES: Record<string, string> = {
  // language
  langauge: "language",
  lang: "language",
  languge: "language",
  // stars / forks
  star: "stars",
  strs: "stars",
  forke: "forks",
  // topic
  topc: "topic",
  tpics: "topic",
  // user / org
  usr: "user",
  ogranization: "org",
  orginzation: "org",
  // date qualifiers
  push: "pushed",
  creat: "created",
  updat: "updated",
  // visibility
  visiblity: "visibility",
  visability: "visibility",
  // license
  licence: "license",
  // size
  siz: "size",
  // archived
  archive: "archived",
};

/**
 * Levenshtein edit distance, bounded to `max` so near-miss candidates don't
 * dominate the cost. Returns `max + 1` as soon as the distance provably
 * exceeds `max`.
 */
function editDistanceWithin(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Resolve a qualifier key to the canonical ghfind key, or return it unchanged.
 *
 * Two passes, in order of confidence:
 *  1. An exact hit in `QUALIFIER_ALIASES` (`langauge` → `language`).
 *  2. A near-miss within edit distance 2 of a known key (`starss` → `stars`).
 *
 * Anything else is returned as-is so unknown-but-valid qualifiers survive.
 */
export function resolveQualifierKey(key: string): string {
  const k = key.toLowerCase();
  // Check the exact set before the alias table: `fork`, `forks`, and `topic`
  // are all real GitHub qualifiers, so a fuzzy pass must never collapse one
  // into another (that would strip the numeric rule from `forks`).
  if (KNOWN_QUALIFIER_SET.has(k)) return k;

  const alias = QUALIFIER_ALIASES[k];
  if (alias) return alias;

  // Fuzzy correction is restricted to keys of 4+ characters. Short keys are
  // exactly where a wrong guess does real damage: `is` sits one edit from the
  // known `in`, so without this guard the valid qualifier `is:public` would be
  // rewritten to `in:public` and then rejected as an invalid search field.
  if (k.length < 4) return k;

  const maxDistance = k.length <= 5 ? 1 : 2;

  let best: string | undefined;
  let bestDistance = maxDistance + 1;
  let ties = 0;
  for (const known of KNOWN_QUALIFIERS) {
    const d = editDistanceWithin(k, known, maxDistance);
    if (d < bestDistance) {
      bestDistance = d;
      best = known;
      ties = 1;
      if (d === 0) break;
    } else if (d === bestDistance && best !== undefined) {
      // Two candidates equally close — not enough signal to rewrite.
      ties++;
    }
  }
  return best !== undefined && ties === 1 ? best : k;
}

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

export function suggestFor(input: string): string[] {
  const trimmed = input.trim().toLowerCase().replace(/:$/, "");
  if (trimmed.length === 0) return [];
  if (trimmed.length === 1 && QUALIFIER_SUGGESTIONS[trimmed]) {
    return QUALIFIER_SUGGESTIONS[trimmed];
  }

  // An exact alias (`langauge`) or a unique near-miss (`starss`) is the
  // highest-confidence completion, so it leads the list.
  const resolved = resolveQualifierKey(trimmed);
  const aliasHit =
    resolved !== trimmed && KNOWN_QUALIFIER_SET.has(resolved)
      ? [`${resolved}:`]
      : [];

  // Prefix matches, minus the alias hit so it isn't duplicated.
  const matches = KNOWN_QUALIFIERS.filter(
    (k) => k.startsWith(trimmed) && !aliasHit.includes(`${k}:`),
  ).map((k) => `${k}:`);

  return [...aliasHit, ...matches];
}

// ─── Qualifier value rules ──────────────────────────────────────────

/**
 * Qualifier keys whose value is a count. These accept comparison operators,
 * ranges, and `k`/`m` magnitude sugar (`stars:10k` → `stars:>=10000`).
 * Per GitHub docs: forks, size, stars, topics, followers.
 */
const NUMERIC_QUALIFIERS = new Set([
  "forks",
  "size",
  "stars",
  "topics",
  "followers",
]);

/**
 * Qualifier keys whose value is `true`/`false`. `fork` is handled separately
 * because GitHub additionally accepts `only` for it (per docs: "add
 * `fork:true` or `fork:only`"). `mirror:` and `template:` are valid GitHub
 * qualifiers but not in `KNOWN_QUALIFIERS`, so they pass through unvalidated
 * by design.
 */
const BOOLEAN_QUALIFIERS = new Set(["archived"]);

/** Accepted values for the `visibility:` qualifier. */
const VISIBILITY_VALUES = new Set(["public", "private", "internal"]);

/**
 * Accepted fields for the `in:` qualifier. GitHub accepts a comma-separated
 * list (documented form: `in:name,description`).
 */
const IN_FIELDS = new Set([
  "name",
  "description",
  "topics",
  "readme",
  "comments",
]);

/**
 * Qualifier keys whose value is an ISO8601 date, optionally prefixed by a
 * comparison operator or written as a `a..b` range.
 * Per GitHub docs: created, pushed, updated.
 */
const DATE_QUALIFIERS = new Set(["created", "pushed", "updated"]);

/** Every comparison operator GitHub's search syntax accepts on a value. */
const COMPARISON_OPERATORS = [">=", "<=", ">", "<"] as const;

/**
 * Strip a token out of a URL before logging. Guarded against the empty
 * string: `url.replace("", …)` inserts the replacement between every
 * character, which would mangle the whole URL whenever no token is in play.
 */
function redactToken(url: string, token: string | undefined): string {
  return token ? url.replace(token, "<token>") : url;
}

/** Strip a leading comparison operator, returning it alongside the rest. */
function splitComparison(value: string): { op: string; rest: string } {
  for (const op of COMPARISON_OPERATORS) {
    // `>=` must be tested before `>` or the value `>=5` parses as op `>`,
    // rest `=5` — which then fails the numeric rule.
    if (value.startsWith(op)) {
      return { op, rest: value.slice(op.length) };
    }
  }
  return { op: "", rest: value };
}

/**
 * Parse a magnitude-suffixed count: `10`, `10k`, `1.5m`, `2_000`.
 * Returns null when the input is not a well-formed count.
 *
 * Deliberately does not accept a bare float with a fractional part
 * (`stars:1.5`) — only fractional values *with* a k/m suffix, since
 * `stars:1.5` is a user mistake rather than a quantity.
 */
export function parseCount(raw: string): number | null {
  const trimmed = raw.trim().replace(/_/g, "");
  if (trimmed === "") return null;

  const match = /^(\d+(?:\.\d+)?)([km])?$/i.exec(trimmed);
  if (!match) return null;

  // A fraction is only meaningful with a magnitude suffix (`1.5m`); a bare
  // `1.5` is a typo that would otherwise silently floor to 1.
  if (!match[2] && match[1].includes(".")) return null;

  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) return null;

  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1;
  return Math.floor(base * multiplier);
}

/**
 * Validate an ISO8601 date as GitHub accepts it: `YYYY-MM-DD` optionally
 * followed by `THH:MM:SS` and a timezone offset. Rejects calendar-invalid
 * dates like `2024-13-45`, which `Date.parse` would otherwise roll over.
 */
export function isValidISODate(raw: string): boolean {
  const trimmed = raw.trim();
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      trimmed,
    );
  if (!m) return false;

  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return false;

  // Reject days past the end of the month (e.g. 2024-02-31, 2023-02-29).
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * Rewrite magnitude sugar into GitHub's comparison-operator form.
 * `stars:10k` → `stars:>=10000`; `stars:1k..5k` → `stars:1000..5000`.
 *
 * A plain integer is left alone: GitHub reads `stars:100` as *exactly* 100,
 * so rewriting it to `>=100` would silently change the question being asked.
 * Only the `k`/`m` sugar — which GitHub does not understand at all — gets an
 * operator, defaulting to `>=` because "10k" almost always means "10k+".
 */
export function normalizeQualifierValue(key: string, value: string): string {
  const normalizedKey = key.toLowerCase();
  if (!NUMERIC_QUALIFIERS.has(normalizedKey)) return value;
  if (value === "") return value;

  const { op, rest } = splitComparison(value);
  const rangeIdx = rest.indexOf("..");
  if (rangeIdx > 0) {
    const lo = parseCount(rest.slice(0, rangeIdx));
    const hi = parseCount(rest.slice(rangeIdx + 2));
    if (lo === null || hi === null) return value;
    return `${op}${lo}..${hi}`;
  }

  // A bare integer is GitHub's exact-match form — leave it alone. Only the
  // k/m sugar, which GitHub does not understand at all, gets rewritten.
  if (!/[km]$/i.test(rest.trim())) return value;

  const count = parseCount(rest);
  if (count === null) return value;
  // `>=10k` keeps its operator; a bare `10k` defaults to `>=`, since "10k"
  // almost always means "10k or more".
  return `${op || ">="}${count}`;
}

/**
 * Check one qualifier's value against its key's rule and return a
 * human-readable problem, or null when the value is acceptable.
 *
 * Only keys in `KNOWN_QUALIFIERS` are checked. An unknown key (e.g.
 * `props.environment`, `is:`, `has:`) is passed through untouched — ghfind
 * does not own GitHub's full qualifier set, and rejecting keys it hasn't
 * heard of would break valid queries.
 */
export function validateQualifierValue(
  key: string,
  value: string,
): string | null {
  const k = key.toLowerCase();
  if (!KNOWN_QUALIFIER_SET.has(k)) return null;

  if (value.trim() === "") {
    return `"${key}:" needs a value (e.g. ${key}:<something>)`;
  }

  if (NUMERIC_QUALIFIERS.has(k)) {
    const { rest } = splitComparison(value.trim());
    const rangeIdx = rest.indexOf("..");
    if (rangeIdx > 0) {
      const lo = parseCount(rest.slice(0, rangeIdx));
      const hi = parseCount(rest.slice(rangeIdx + 2));
      if (lo === null || hi === null) {
        return `"${key}:${value}" is not a valid range — use ${k}:100..500 or ${k}:>=100`;
      }
      if (lo > hi) {
        return `"${key}:${value}" has a reversed range (${lo} > ${hi})`;
      }
      return null;
    }
    if (parseCount(rest) === null) {
      return `"${key}:${value}" is not a number — use ${k}:100, ${k}:>=100, or ${k}:1k..10k`;
    }
    return null;
  }

  if (k === "fork") {
    const v = value.trim().toLowerCase();
    if (v !== "true" && v !== "false" && v !== "only") {
      return `"fork:${value}" is not valid — use fork:true, fork:false, or fork:only`;
    }
    return null;
  }

  if (BOOLEAN_QUALIFIERS.has(k)) {
    const v = value.trim().toLowerCase();
    if (v !== "true" && v !== "false") {
      return `"${key}:${value}" is not valid — use ${k}:true or ${k}:false`;
    }
    return null;
  }

  if (k === "visibility") {
    const v = value.trim().toLowerCase();
    if (!VISIBILITY_VALUES.has(v)) {
      return `"visibility:${value}" is not valid — use visibility:public, visibility:private, or visibility:internal`;
    }
    return null;
  }

  if (k === "in") {
    const parts = value.split(",").map((p) => p.trim().toLowerCase());
    if (parts.some((p) => !IN_FIELDS.has(p))) {
      const bad = parts.find((p) => !IN_FIELDS.has(p));
      return `"in:${value}" is not valid — ${bad ? `"${bad}" is not a ` : ""}searchable field. Try in:name, in:description, in:topics, or in:readme`;
    }
    return null;
  }

  if (DATE_QUALIFIERS.has(k)) {
    const trimmed = value.trim();
    const { rest } = splitComparison(trimmed);
    const rangeIdx = rest.indexOf("..");
    if (rangeIdx > 0) {
      const lo = rest.slice(0, rangeIdx);
      const hi = rest.slice(rangeIdx + 2);
      if (!isValidISODate(lo) || !isValidISODate(hi)) {
        return `"${key}:${value}" is not a valid date range — use ${k}:2020-01-01..2024-01-01`;
      }
      return null;
    }
    if (!isValidISODate(rest)) {
      return `"${key}:${value}" is not a valid date — use ${k}:2024-01-01 (optionally with >, >=, <, <=)`;
    }
    return null;
  }

  // Keys whose value is an opaque identifier (user, org, repo, topic,
  // license) — GitHub owns what counts as valid, so nothing to check here.
  return null;
}

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
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
    if (
      current.startsWith('"') &&
      current.endsWith('"') &&
      current.length >= 2
    ) {
      current = current.slice(1, -1);
    }
    tokens.push(current);
  }
  return tokens;
}
export type { ParsedQuery, QueryCorrection } from "./types";

/**
 * A no-op query, used where a search adapter needs a placeholder (the trending
 * adapter ignores the query entirely and reads `options.trendingSince`).
 */
export const EMPTY_QUERY: ParsedQuery = {
  keywords: [],
  qualifiers: [],
  raw: "",
  corrections: [],
};

/** The placeholder the trending surfaces pass, preserving the old `raw` value. */
export function trendingQuery(): ParsedQuery {
  return { ...EMPTY_QUERY, raw: "trending" };
}

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { keywords: [], qualifiers: [], raw, corrections: [] };
  }

  const keywords: string[] = [];
  const qualifiers: Qualifier[] = [];
  const corrections: QueryCorrection[] = [];

  for (const token of tokenize(trimmed)) {
    const qualifier = matchQualifier(token);
    if (qualifier) {
      // Correct the key in place (typo → canonical) and normalize the value
      // (magnitude sugar). Rewriting the qualifier object rather than
      // re-parsing a corrected copy of the query string keeps keyword order
      // and `raw` exactly as the user typed them.
      const resolvedKey = resolveQualifierKey(qualifier.key);
      const normalizedValue = normalizeQualifierValue(
        resolvedKey,
        qualifier.value,
      );
      const original = `${qualifier.negated ? "-" : ""}${qualifier.key}:${qualifier.value}`;
      const corrected = `${qualifier.negated ? "-" : ""}${resolvedKey}:${normalizedValue}`;
      if (original !== corrected) {
        corrections.push({ from: original, to: corrected });
      }
      qualifiers.push({
        key: resolvedKey,
        value: normalizedValue,
        negated: qualifier.negated,
      });
    } else {
      keywords.push(token);
    }
  }

  return { keywords, qualifiers, raw: trimmed, corrections };
}

function matchQualifier(token: string): Qualifier | null {
  const negated = token.startsWith("-");
  const body = negated ? token.slice(1) : token;
  const idx = body.indexOf(":");
  if (idx <= 0) return null;
  const key = body.slice(0, idx).toLowerCase();
  let value = body.slice(idx + 1);
  // An empty value (`stars:`) is kept as a qualifier so validation can report
  // "needs a value" instead of silently degrading it into a literal keyword.
  // Custom-property qualifiers (`props.environment:prod`) contain a dot, so
  // the key charset allows one and lets validation ignore what it doesn't own.
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/i.test(key)) return null;
  if (value.startsWith("//")) return null;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1);
  }
  return { key, value, negated };
}

export interface FlagFilters {
  language?: string;
  stars?: string;
  org?: string;
  user?: string;
  topic?: string;
  archived?: boolean;
  fork?: boolean;
}

export function applyFlagFilters(
  query: ParsedQuery,
  flags: FlagFilters,
): ParsedQuery {
  const qualifiers = [...query.qualifiers];

  if (flags.language)
    qualifiers.push({ key: "language", value: flags.language, negated: false });
  if (flags.stars)
    qualifiers.push({ key: "stars", value: flags.stars, negated: false });
  if (flags.org)
    qualifiers.push({ key: "org", value: flags.org, negated: false });
  if (flags.user)
    qualifiers.push({ key: "user", value: flags.user, negated: false });
  if (flags.topic)
    qualifiers.push({ key: "topic", value: flags.topic, negated: false });
  if (flags.archived !== undefined)
    qualifiers.push({
      key: "archived",
      value: flags.archived ? "true" : "false",
      negated: false,
    });
  if (flags.fork !== undefined)
    qualifiers.push({
      key: "fork",
      value: flags.fork ? "true" : "false",
      negated: false,
    });

  return { ...query, qualifiers };
}

/**
 * Rebuild a query string with one qualifier removed, for relaxation hints.
 * Returns null when removing it would leave nothing to search for.
 */
function withoutQualifier(query: ParsedQuery, index: number): string | null {
  const remaining = query.qualifiers.filter((_, i) => i !== index);
  const parts = [...query.keywords];
  for (const q of remaining) {
    const needsQuote = q.value.includes(" ") && !q.value.startsWith('"');
    const value = needsQuote ? `"${q.value}"` : q.value;
    parts.push(`${q.negated ? "-" : ""}${q.key}:${value}`);
  }
  const text = parts.join(" ").trim();
  return text === "" ? null : text;
}

/**
 * Validate a parsed query before it costs an API call.
 *
 * Throws `BadQueryError` with a specific message (and a concrete corrected
 * query where one exists) instead of letting a malformed qualifier reach
 * GitHub, whose 422 surfaces to the user as an opaque error.
 */
export function validateQuery(query: ParsedQuery): void {
  const has = (key: string) =>
    query.qualifiers.some((q) => q.key === key && !q.negated);

  // `private:` is GitHub's legacy spelling of `visibility:private`.
  if (has("visibility") && has("private")) {
    throw new BadQueryError(
      "Cannot combine `visibility:` and `private:` filters.",
      `${
        query.qualifiers
          .filter((q) => q.key === "private" && !q.negated)
          .map((q) => withoutQualifier(query, query.qualifiers.indexOf(q)))
          .find((v): v is string => v !== null) ?? query.raw
      }`,
    );
  }

  // Report the first bad qualifier, with the rest of the query as a retry.
  for (let i = 0; i < query.qualifiers.length; i++) {
    const q = query.qualifiers[i];
    const problem = validateQualifierValue(q.key, q.value);
    if (problem) {
      throw new BadQueryError(problem, withoutQualifier(query, i) ?? undefined);
    }
  }
}

// ─── Zero-result relaxation ─────────────────────────────────────────

/**
 * How likely a qualifier is to be the reason a search returned nothing.
 * Higher = drop it first.
 *
 * Ordered by how sharply the filter narrows GitHub's corpus:
 *  - `stars`/`size` thresholds are absolute, so a high bar empties the result
 *    set outright (`stars:>=500000` matches almost nothing).
 *  - a narrow date window is similarly absolute.
 *  - `user`/`org` restricts to one account's repos.
 *  - a plain `language` still matches every repo in that language, so it is
 *    the last thing worth dropping.
 */
const OVER_CONSTRAINT_WEIGHT: Record<string, number> = {
  size: 100,
  stars: 95,
  forks: 80,
  created: 75,
  pushed: 70,
  updated: 70,
  visibility: 65,
  repo: 60,
  user: 55,
  org: 50,
  topic: 45,
  in: 30,
  license: 25,
  language: 20,
  fork: 15,
  archived: 10,
};

/**
 * A concrete way to loosen a query that returned nothing, e.g.
 * `rust stars:>=50000` → `Try: rust stars:>=1000`.
 */
export interface Relaxation {
  /** What to suggest to the user. */
  suggestion: string;
  /** The qualifier being loosened. */
  qualifier: string;
  /** Higher means "try this one first". */
  confidence: number;
}

/** A looser bound for an over-tight numeric threshold. */
function loosenNumericBound(value: string): string | null {
  const { op, rest } = splitComparison(value.trim());
  const count = parseCount(rest);
  if (count === null || count === 0) return null;
  // Step down by an order of magnitude, but never below 1.
  const loosened = Math.max(1, Math.floor(count / 10));
  return `${op || ">="}${loosened}`;
}

/**
 * Widen a date bound by two years in the direction that admits more repos.
 * `pushed:>2024-01-01` → `pushed:>2022-01-01`.
 */
function loosenDateBound(value: string): { op: string; date: string } | null {
  const { op, rest } = splitComparison(value.trim());
  if (!isValidISODate(rest)) return null;

  const year = Number.parseInt(rest.slice(0, 4), 10);
  if (!Number.isFinite(year)) return null;

  // A `>` bound moves earlier (more repos qualify); a `<` bound moves later.
  const shifted =
    op === "<" || op === "<=" ? year + 2 : Math.max(1970, year - 2);
  return { op, date: `${shifted}${rest.slice(4)}` };
}

/**
 * Rank concrete relaxations for a query that returned zero results, most
 * promising first.
 *
 * Each suggestion rewrites one qualifier rather than stripping it outright,
 * so a retry is likely to return *some* results instead of a different
 * question. An empty array means nothing sensible can be loosened — the caller
 * should fall back to its generic advice.
 */
export function suggestRelaxations(
  query: ParsedQuery,
  limit = 3,
): Relaxation[] {
  const out: Relaxation[] = [];

  for (let i = 0; i < query.qualifiers.length; i++) {
    const q = query.qualifiers[i];
    const key = q.key.toLowerCase();
    // A negated filter (`-language:Rust`) only ever widens a search, so it
    // cannot be the reason a query came back empty.
    if (q.negated) continue;

    const weight = OVER_CONSTRAINT_WEIGHT[key] ?? 40;
    const emit = (relaxed: string, qualifier: string) => {
      const rest = query.qualifiers
        .filter((_, j) => j !== i)
        .map((other) => {
          const needsQuote =
            other.value.includes(" ") && !other.value.startsWith('"');
          const value = needsQuote ? `"${other.value}"` : other.value;
          return `${other.negated ? "-" : ""}${other.key}:${value}`;
        });
      const text = [...query.keywords, ...rest, relaxed].join(" ").trim();
      out.push({ suggestion: text, qualifier, confidence: weight });
    };

    if (NUMERIC_QUALIFIERS.has(key) || key === "followers") {
      const rangeIdx = q.value.indexOf("..");
      if (rangeIdx > 0) {
        // A range with an unreachable upper bound: widen the ceiling.
        const hi = parseCount(q.value.slice(rangeIdx + 2));
        if (hi !== null) {
          const lo = q.value.slice(0, rangeIdx);
          emit(`${key}:${lo}..${Math.floor(hi / 10) || hi * 2}`, key);
        }
      } else {
        const looser = loosenNumericBound(q.value);
        if (looser) emit(`${key}:${looser}`, key);
        else {
          // Already at the floor (`stars:>=1`) — try widening a range instead.
          const dropped = withoutQualifier(query, i);
          if (dropped) {
            out.push({
              suggestion: dropped,
              qualifier: key,
              confidence: weight - 30,
            });
          }
        }
      }
      continue;
    }

    if (DATE_QUALIFIERS.has(key)) {
      const loosened = loosenDateBound(q.value);
      if (loosened) {
        emit(`${key}:${loosened.op || ">="}${loosened.date}`, key);
      } else {
        const dropped = withoutQualifier(query, i);
        if (dropped) {
          out.push({
            suggestion: dropped,
            qualifier: key,
            confidence: weight - 30,
          });
        }
      }
      continue;
    }

    // Everything else (language, org, topic, …): dropping the qualifier is
    // the only meaningful relaxation.
    const dropped = withoutQualifier(query, i);
    if (dropped) {
      out.push({
        suggestion: dropped,
        qualifier: key,
        confidence: weight - 30,
      });
    }
  }

  // Deduplicate (two qualifiers can relax to the same text), then rank.
  const seen = new Set<string>();
  const unique = out.filter((r) => {
    if (seen.has(r.suggestion)) return false;
    seen.add(r.suggestion);
    return true;
  });

  unique.sort((a, b) => b.confidence - a.confidence);
  return unique.slice(0, limit).map((r) => ({
    ...r,
    // Clamp so a "drop the qualifier" hint never reports a negative score.
    confidence: Math.max(0, r.confidence),
  }));
}

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

export function githubSortParam(sort: SortStrategy): {
  sort?: string;
  order?: string;
} {
  switch (sort) {
    case "stars":
      return { sort: "stars", order: "desc" };
    case "forks":
      return { sort: "forks", order: "desc" };
    case "updated":
      return { sort: "updated", order: "desc" };
    default:
      return {};
  }
}

export function buildSearchUrl(
  query: ParsedQuery,
  options: SearchOptions,
): string {
  const q = buildGitHubQuery(query);
  const { sort, order } = githubSortParam(options.sort);
  const params = new URLSearchParams({ q: q || " " });
  if (sort) params.set("sort", sort);
  if (order) params.set("order", order);
  return `https://api.github.com/search/repositories?${params.toString()}`;
}

export function rankRepos(repos: Repo[], strategy: SortStrategy): Repo[] {
  const copy = [...repos];
  switch (strategy) {
    case "stars":
      copy.sort(byKey((r) => r.stars));
      break;
    case "forks":
      copy.sort(byKey((r) => r.forks));
      break;
    case "updated":
      copy.sort(byKey((r) => Date.parse(r.updatedAt)));
      break;
    default:
      break;
  }
  return copy;
}

function byKey(key: (r: Repo) => number): (a: Repo, b: Repo) => number {
  return (a, b) => key(b) - key(a) || b.stars - a.stars || a.id - b.id;
}

export function compositeScore(r: Repo): number {
  const starScore = Math.log10(r.stars + 1);
  const recencyMs = Date.now() - Date.parse(r.pushedAt);
  const recencyScore = Math.max(0, 1 - recencyMs / (1000 * 60 * 60 * 24 * 365));
  return starScore * 0.7 + recencyScore * 0.3;
}

export class GitHubSearchAdapter implements SearchAdapter {
  readonly name = "github";
  private readonly logger: Logger;
  private tokens: string[];
  private tokenIndex = 0;

  constructor(logger: Logger = noopLogger, tokens: string[] = []) {
    this.logger = logger;
    this.tokens = tokens.filter(Boolean);
  }

  private nextToken(): string | undefined {
    if (this.tokens.length === 0) return undefined;
    const token = this.tokens[this.tokenIndex % this.tokens.length];
    this.tokenIndex++;
    return token;
  }

  async search(
    query: ParsedQuery,
    options: SearchOptions,
  ): Promise<SearchResponse> {
    const url = buildSearchUrl(query, options);
    this.logger.debug(`[github] outgoing query: ${query.raw}`);
    this.logger.debug(`[github] request url: ${url}`);

    const all: Repo[] = [];
    let totalCount = 0;
    let rateLimited = false;
    let rateLimitRemaining: number | undefined;

    const perPage = Math.min(Math.max(options.limit, 1), 100);
    const startPage = options.page ?? 1;
    const maxPages =
      startPage > 1 ? startPage : Math.ceil(options.limit / perPage);

    for (let page = startPage > 1 ? startPage : 1; page <= maxPages; page++) {
      const pagedUrl = appendPage(url, page, perPage);
      let lastErr: Error | undefined;

      for (let attempt = 0; attempt <= this.tokens.length; attempt++) {
        const token = this.tokens.length > 0 ? this.nextToken() : options.token;
        try {
          const res = await fetch(pagedUrl, {
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "ghfind",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });

          const remainingStr = res.headers.get("x-ratelimit-remaining");
          rateLimitRemaining =
            remainingStr !== null ? Number(remainingStr) : undefined;
          if (process.env.GHFIND_LOG) {
            this.logger.debug(
              `[github] ${res.status} remaining=${remainingStr ?? "none"} ` +
                `url=${redactToken(pagedUrl, token)}`,
            );
          }

          if (res.status === 403) {
            if (remainingStr === "0" || remainingStr === null) {
              if (this.tokens.length > 0 && attempt < this.tokens.length) {
                continue;
              }
              this.logger.warn("[github] rate limit exceeded");
              rateLimited = true;
              throw new RateLimitError(!!token);
            }
            const body = await res.text().catch(() => "");
            // These three 403s are indistinguishable from the status code
            // alone, and each needs a different fix: SSO enforcement, a
            // secondary/abuse rate limit, or a token blocked by org policy.
            // Log the headers that tell them apart.
            this.logger.error(
              `[github] non-rate-limit 403: remaining=${remainingStr} ` +
                `retry-after=${res.headers.get("retry-after") ?? "none"} ` +
                `x-ratelimit-reset=${res.headers.get("x-ratelimit-reset") ?? "none"} ` +
                `authed=${token ? "yes" : "no"} url=${redactToken(pagedUrl, token)}`,
            );
            this.logger.error(`[github] 403 body: ${body.slice(0, 400)}`);
            // Surface GitHub's own explanation ("Resource not accessible by
            // integration", "secondary rate limit", …) rather than asserting
            // a cause we cannot actually know.
            let reason = "no reason given";
            try {
              const parsed = JSON.parse(body) as { message?: unknown };
              if (typeof parsed.message === "string" && parsed.message) {
                reason = parsed.message;
              }
            } catch {
              // Non-JSON body (HTML/CAPTCHA); keep the generic reason.
            }
            throw new ForbiddenError(reason);
          }
          if (res.status === 401) {
            const body = await res.text().catch(() => "");
            this.logger.error(
              `[github] auth rejected (401): ${body.slice(0, 200)}`,
            );
            throw new AuthError();
          }
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            this.logger.error(
              `[github] API error ${res.status}: ${body.slice(0, 200)}`,
            );
            throw new NetworkError();
          }

          const raw = await res.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            const snippet = raw.slice(0, 200);
            this.logger.error(`[github] invalid JSON response: ${snippet}`);
            throw new ParseError(
              "GitHub API",
              snippet.includes("<!DOCTYPE")
                ? "GitHub returned an HTML page (maintenance or CAPTCHA?)"
                : "Invalid JSON response",
            );
          }
          if (
            !parsed ||
            typeof parsed !== "object" ||
            !Array.isArray((parsed as { items?: unknown }).items)
          ) {
            this.logger.error(
              `[github] unexpected response shape: ${JSON.stringify(parsed).slice(0, 200)}`,
            );
            throw new ParseError(
              "GitHub API",
              "Unexpected response shape — missing items array",
            );
          }
          const env = parsed as GitHubSearchEnvelope;
          totalCount = env.total_count;
          const repos = normalizeEnvelope(env);
          all.push(...repos);
          lastErr = undefined;
          break;
        } catch (err) {
          // RateLimitError must propagate: swallowing it turns the failure
          // into a silent zero-result "success" and the user never learns
          // why their search died.
          if (err instanceof RateLimitError) throw err;
          lastErr = err as Error;
          if (rateLimited) break;
        }
      }

      if (lastErr && !rateLimited) throw lastErr;
      if (rateLimited) break;
      if (all.length >= options.limit) break;
    }

    const repos = all.slice(0, options.limit);
    if (repos.length === 0) {
      this.logger.debug("[github] empty results");
    }
    return { totalCount, repos, rateLimited, rateLimitRemaining };
  }
}

function appendPage(url: string, page: number, perPage: number): string {
  const u = new URL(url);
  u.searchParams.set("page", String(page));
  u.searchParams.set("per_page", String(perPage));
  return u.toString();
}

// ─── Trending adapter ─────────────────────────────────────────────────

const TRENDING_URL = "https://github.com/trending";

/**
 * Languages github.com/trending accepts as a `?language=` filter (path-slug
 * form, lowercase). The MCP `ghfind_trending` tool validates against this
 * list instead of round-tripping an invalid language through a scrape.
 */
export const TRENDING_LANGUAGES: ReadonlySet<string> = new Set([
  "c",
  "c#",
  "c++",
  "clojure",
  "crystal",
  "css",
  "dart",
  "dockerfile",
  "elixir",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "jupyter-notebook",
  "kotlin",
  "lua",
  "objective-c",
  "ocaml",
  "perl",
  "php",
  "powershell",
  "python",
  "r",
  "ruby",
  "rust",
  "scala",
  "shell",
  "solidity",
  "svelte",
  "swift",
  "typescript",
  "vue",
  "zig",
]);

/**
 * Normalize a user-supplied language to the slug form github.com/trending
 * uses: lowercase, whitespace runs collapsed to dashes ("Jupyter Notebook"
 * → "jupyter-notebook").
 */
export function trendingLanguageSlug(language: string): string {
  return language.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Validate a user-supplied trending language and return its slug, or null if
 * empty. Throws with a user-facing suggestion list for unknown languages.
 * Shared by the MCP trending tool and the CLI trending filter.
 */
export function resolveTrendingLanguage(
  language: string | undefined | null,
): string | undefined {
  const trimmed = typeof language === "string" ? language.trim() : "";
  if (!trimmed) return undefined;
  const slug = trendingLanguageSlug(trimmed);
  if (!TRENDING_LANGUAGES.has(slug)) {
    throw new Error(
      `"${trimmed}" is not a trending language filter. Try one of: rust, python, typescript, javascript, go, zig.`,
    );
  }
  return slug;
}

/** Build the github.com/trending URL for a period + optional language filter. */
export function buildTrendingUrl(
  since: "daily" | "weekly" | "monthly",
  language?: string,
): string {
  const params = new URLSearchParams();
  if (since !== "daily") params.set("since", since);
  if (language) {
    const slug = trendingLanguageSlug(language);
    if (TRENDING_LANGUAGES.has(slug)) params.set("language", slug);
  }
  const qs = params.toString();
  return qs ? `${TRENDING_URL}?${qs}` : TRENDING_URL;
}

function trendingRepoToRepo(r: RawTrendingRepo): Repo {
  return {
    id: 0,
    fullName: `${r.owner}/${r.name}`,
    name: r.name,
    owner: r.owner,
    description: r.description,
    url: `https://github.com/${r.owner}/${r.name}`,
    stars: r.stars,
    forks: 0,
    watchers: 0,
    language: r.language,
    topics: [],
    archived: false,
    isFork: false,
    private: false,
    createdAt: "",
    updatedAt: "",
    pushedAt: "",
    score: r.starsToday,
  };
} /**
 * Trending adapter — scrapes github.com/trending HTML and returns SearchResponse.
 */
export class TrendingAdapter implements SearchAdapter {
  readonly name = "trending";
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: part of the adapter constructor contract — callers pass a shared logger (search.ts:757) even though this adapter currently logs nothing itself.
  private readonly logger: Logger;

  constructor(logger: Logger = noopLogger) {
    this.logger = logger;
  }

  async search(
    _query: ParsedQuery,
    options: SearchOptions,
  ): Promise<SearchResponse> {
    const since = options.trendingSince ?? "daily";
    const url = buildTrendingUrl(since, options.trendingLanguage);
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": "ghfind" } });
    } catch {
      throw new NetworkError();
    }
    if (!res.ok) throw new NetworkError();
    const html = await res.text();
    const repos = parseTrendingHtml(html).map(trendingRepoToRepo);
    return { totalCount: repos.length, repos, rateLimited: false };
  }
}

// ─── In-memory adapter (for tests) ────────────────────────────────────

/**
 * In-memory adapter that returns canned responses.
 * Use in tests to avoid network calls.
 */
export class InMemoryAdapter implements SearchAdapter {
  readonly name = "in-memory";
  private responses: Map<string, SearchResponse> = new Map();
  private defaultResponse: SearchResponse = {
    totalCount: 0,
    repos: [],
    rateLimited: false,
  };

  /** Set a canned response keyed by the raw query string. */
  setResponse(queryRaw: string, response: SearchResponse): void {
    this.responses.set(queryRaw.toLowerCase(), response);
  }

  /** Set the default response returned when no canned response matches. */
  setDefault(response: SearchResponse): void {
    this.defaultResponse = response;
  }

  async search(
    query: ParsedQuery,
    _options: SearchOptions,
  ): Promise<SearchResponse> {
    const key = query.raw.toLowerCase();
    return this.responses.get(key) ?? { ...this.defaultResponse };
  }

  clear(): void {
    this.responses.clear();
  }
}

// ─── Search module (orchestrator) ─────────────────────────────────────

/**
 * Deep Search module — owns the cache, delegates network I/O to an adapter,
 * and orchestrates the full pipeline: cache → adapter → rank.
 */
export class SearchModule implements SearchProvider {
  readonly name = "search";
  private readonly adapter: SearchAdapter;
  private readonly logger: Logger;
  /** Shared cache across instances. */
  static cache = new MemoryCache<SearchResponse>(300_000);

  constructor(adapter: SearchAdapter, logger: Logger = noopLogger) {
    this.adapter = adapter;
    this.logger = logger;
  }

  async search(
    query: ParsedQuery,
    options: SearchOptions,
  ): Promise<SearchResponse> {
    const cacheKey = MemoryCache.key(
      query.raw,
      options.sort,
      String(options.limit),
      String(options.page ?? 1),
      options.trendingSince ?? "none",
      options.trendingLanguage ?? "none",
    );
    const cached = SearchModule.cache.get(cacheKey);
    if (cached) {
      this.logger.debug("[search] cache hit");
      return cached;
    }
    this.logger.debug("[search] cache miss");

    const response = await this.adapter.search(query, options);
    if (!response.rateLimited) {
      SearchModule.cache.set(cacheKey, response);
    }
    return response;
  }
}

// ─── Convenience: create a GitHub-backed SearchModule ──────────────────

/**
 * Create a SearchModule backed by the GitHub adapter.
 * This is the primary entry point for production code.
 */
export function createGitHubSearch(
  logger: Logger = noopLogger,
  tokens: string[] = [],
): SearchModule {
  return new SearchModule(new GitHubSearchAdapter(logger, tokens), logger);
}

/**
 * Create a SearchModule backed by the Trending adapter.
 */
export function createTrendingSearch(
  logger: Logger = noopLogger,
): SearchModule {
  return new SearchModule(new TrendingAdapter(logger), logger);
}
