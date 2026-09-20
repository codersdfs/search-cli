/**
 * Defensive parser for `github.com/trending` HTML.
 *
 * Pure module: no I/O, no TUI/@opentui dependency, so it can be unit-tested
 * against real captured markup (see tests/fixtures/trending.html). Throws a
 * `ParseError` instead of silently returning an empty list, so a GitHub layout
 * change surfaces to the user as a friendly "[r]etry" message.
 */
import { ParseError } from "./errors";

export interface RawTrendingRepo {
  rank: number;
  owner: string;
  name: string;
  stars: number;
  starsToday: number;
  language: string;
  description: string;
}

/** Collapse all whitespace runs inside tags/attributes to single spaces. */
function flattenHtml(html: string): string {
  return html.replace(/>\s+</g, "><").replace(/\s+/g, " ");
}

interface RepoLink {
  owner: string;
  name: string;
}

function parseRepoLink(block: string): RepoLink | undefined {
  // The title heading is the only anchor whose href is a bare /owner/name
  // path followed by class="Link" (star/fork links carry sub-paths and
  // different classes). Regex runs left-to-right, so the login/star-panel
  // `/login?...&return_to=...` href fails the bare-path requirement and the
  // stargazers/forks links don't carry the heading's class="Link".
  const anchor = block.match(
    /<a[^>]*?href="\/([A-Za-z0-9._-]+)\/([^"?#]+)"[^>]*class="Link"/,
  );
  if (!anchor) return undefined;
  return { owner: anchor[1], name: anchor[2] };
}

function parseStars(block: string): number {
  const starsMatch = block.match(
    /href="\/[^/"]+\/[^/"]+\/stargazers"[^>]*>.*?<\/svg>\s*(\d[\d,]*)/,
  );
  return starsMatch ? parseInt(starsMatch[1].replace(/,/g, ""), 10) : 0;
}

function parseStarsToday(block: string): number {
  const growthMatch = block.match(/(\d[\d,]*)\s+stars\s+(today|this\s+\w+)/);
  return growthMatch ? parseInt(growthMatch[1].replace(/,/g, ""), 10) : 0;
}

function parseLanguage(block: string): string {
  const langMatch = block.match(/itemprop="programmingLanguage">([^<]+)</);
  return langMatch ? langMatch[1].trim() : "";
}

function parseDescription(block: string): string {
  const descMatch = block.match(
    /<p[^>]*class="[^"]*color-fg-muted[^"]*"[^>]*>([^<]+)</,
  );
  return descMatch ? descMatch[1].trim() : "";
}

export function parseTrendingHtml(html: string): RawTrendingRepo[] {
  const flat = flattenHtml(html);
  const repos: RawTrendingRepo[] = [];
  const articleRe = /<article class="Box-row">(.*?)<\/article>/gi;
  let rank = 0;

  for (const match of flat.matchAll(articleRe)) {
    rank++;
    const block = match[1];
    const link = parseRepoLink(block);
    if (!link) continue;
    repos.push({
      rank,
      owner: link.owner,
      name: link.name,
      stars: parseStars(block),
      starsToday: parseStarsToday(block),
      language: parseLanguage(block),
      description: parseDescription(block),
    });
  }

  if (rank === 0) {
    throw new ParseError(
      "github.com/trending",
      "no article rows found — response may be an error page or a rewrite",
    );
  }
  if (repos.length === 0) {
    throw new ParseError(
      "github.com/trending",
      "article rows present but no repository heading could be parsed",
    );
  }
  return repos;
}
