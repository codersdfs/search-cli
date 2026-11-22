/**
 * hn.ts — Hacker News stories for `ghfind hn`.
 *
 * Talks to the public Hacker News Firebase API (no token, no login): a feed
 * endpoint returns story ids, then one request per item. Normalized rows are
 * the same shape the text/JSON/CSV/Markdown formatters and the interactive
 * viewer consume.
 */

export const HN_FEEDS = ["top", "new", "best", "ask", "show", "job"] as const;
export type HnFeed = (typeof HN_FEEDS)[number];

/** Display labels — "ask" reads better as "Ask HN" in a heading or tab. */
export const HN_FEED_LABELS: Record<HnFeed, string> = {
  top: "Top",
  new: "New",
  best: "Best",
  ask: "Ask HN",
  show: "Show HN",
  job: "Jobs",
};

/** API endpoint stem per feed (e.g. `topstories`). */
const FEED_ENDPOINTS: Record<HnFeed, string> = {
  top: "topstories",
  new: "newstories",
  best: "beststories",
  ask: "askstories",
  show: "showstories",
  job: "jobstories",
};

const API_BASE = "https://hacker-news.firebaseio.com/v0";
/** A blocked network must not hang the CLI or the viewer forever. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface HnStory {
  id: number;
  title: string;
  /** External article URL; null for Ask HN / text posts. */
  url: string | null;
  /** Canonical Hacker News discussion page for this item. */
  hnUrl: string;
  author: string | null;
  score: number;
  comments: number;
  /** ISO timestamp derived from the item's Unix `time`. */
  createdAt: string;
  type: string;
  /** Hostname of `url` (www. stripped), or null for text posts. */
  domain: string | null;
  /** Self text (HTML) for Ask HN and other text posts. */
  text: string | null;
}

/** Raw item fields we read from the Firebase API. */
export interface HnItemPayload {
  id?: number;
  deleted?: boolean;
  dead?: boolean;
  type?: string;
  by?: string;
  time?: number;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  text?: string;
}

/** Resolve user input ("top", "topstories", "ask") to a canonical feed id. */
export function resolveHnFeed(raw: string): HnFeed | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if ((HN_FEEDS as readonly string[]).includes(key)) return key as HnFeed;
  for (const feed of HN_FEEDS) {
    if (FEED_ENDPOINTS[feed] === key) return feed;
  }
  if (key === "jobs") return "job";
  return null;
}

export function hnItemUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

/** Hostname for display, or null when the URL is missing/unparseable. */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Normalize one API item. Deleted/dead items and anything without an id or a
 * title (e.g. comments) are dropped — they are not feed stories.
 */
export function normalizeHnItem(
  item: HnItemPayload | null | undefined,
): HnStory | null {
  if (!item || item.deleted || item.dead) return null;
  if (typeof item.id !== "number" || typeof item.title !== "string")
    return null;
  return {
    id: item.id,
    title: item.title,
    url: item.url ?? null,
    hnUrl: hnItemUrl(item.id),
    author: item.by ?? null,
    score: item.score ?? 0,
    comments: item.descendants ?? 0,
    createdAt:
      typeof item.time === "number"
        ? new Date(item.time * 1000).toISOString()
        : "",
    type: item.type ?? "story",
    domain: domainOf(item.url),
    text: item.text ?? null,
  };
}

export interface FetchHnOptions {
  /** Stories to return (default 30, clamped to 1–100). */
  limit?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch a feed and its stories. The feed order is preserved. One failing item
 * is skipped rather than failing the whole feed; a failing feed request is an
 * error worth reporting.
 */
export async function fetchHnStories(
  feed: HnFeed = "top",
  options: FetchHnOptions = {},
): Promise<HnStory[]> {
  if (!Object.hasOwn(FEED_ENDPOINTS, feed)) {
    throw new Error(`Unknown Hacker News feed: ${String(feed)}.`);
  }
  const endpoint = FEED_ENDPOINTS[feed];
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? 30) || 30, 1),
    100,
  );
  const doFetch = options.fetchImpl ?? fetch;

  let listRes: Response;
  try {
    listRes = await doFetch(`${API_BASE}/${endpoint}.json`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `Failed to reach Hacker News: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!listRes.ok) {
    throw new Error(
      `Failed to fetch Hacker News ${feed} stories (HTTP ${listRes.status}).`,
    );
  }
  const ids: unknown = await listRes.json();
  if (!Array.isArray(ids)) {
    throw new Error(`Hacker News returned an unexpected ${feed} feed.`);
  }

  const wanted = ids
    .filter((id): id is number => typeof id === "number")
    .slice(0, limit);

  const stories = await Promise.all(
    wanted.map(async (id) => {
      try {
        const res = await doFetch(`${API_BASE}/item/${id}.json`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const item = (await res.json()) as HnItemPayload | null;
        return normalizeHnItem(item);
      } catch {
        // A single vanished item must not lose the rest of the feed.
        return null;
      }
    }),
  );

  return stories.filter((story): story is HnStory => story !== null);
}

/** Compact age ("3h ago") used by the text output and the viewer. */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/**
 * One plain line per story for the CLI. Two lines is enough detail to decide
 * whether to open the story; the URL is always printed, including Ask HN's
 * discussion link.
 */
export function formatHnText(
  stories: HnStory[],
  feed: HnFeed = "top",
  now = Date.now(),
): string {
  const lines = [`Hacker News — ${HN_FEED_LABELS[feed]}`];
  if (stories.length === 0) {
    lines.push(`No ${HN_FEED_LABELS[feed].toLowerCase()} stories right now.`);
    return lines.join("\n");
  }
  stories.forEach((story, index) => {
    const rank = String(index + 1).padStart(2);
    const domain = story.domain ? ` (${story.domain})` : "";
    const meta = [
      `${story.score} pts`,
      `by ${story.author ?? "unknown"}`,
      relativeTime(story.createdAt, now),
      `${story.comments} comments`,
    ].join(" · ");
    lines.push(`${rank}. ${story.title}${domain}`);
    lines.push(`    ${meta}`);
    lines.push(`    ${story.url ?? story.hnUrl}`);
  });
  return lines.join("\n");
}

export function formatHnJson(stories: HnStory[]): string {
  return JSON.stringify(stories, null, 2);
}

function csvCell(value: string | number | null): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function formatHnCsv(stories: HnStory[]): string {
  const header =
    "rank,id,title,url,hn_url,author,score,comments,created_at,type,domain";
  const rows = stories.map((s, i) =>
    [
      i + 1,
      s.id,
      s.title,
      s.url ?? "",
      s.hnUrl,
      s.author ?? "",
      s.score,
      s.comments,
      s.createdAt,
      s.type,
      s.domain ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

export function formatHnMarkdown(
  stories: HnStory[],
  feed: HnFeed = "top",
  now = Date.now(),
): string {
  const lines = [
    `# Hacker News — ${HN_FEED_LABELS[feed]}`,
    "",
    "| # | Story | Points | Comments | Age |",
    "|---|---|---|---|---|",
  ];
  for (const [index, story] of stories.entries()) {
    const href = story.url ?? story.hnUrl;
    lines.push(
      `| ${index + 1} | [${mdCell(story.title)}](${href}) | ${story.score} | ${story.comments} | ${relativeTime(story.createdAt, now)} |`,
    );
  }
  return lines.join("\n");
}
