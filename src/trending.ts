#!/usr/bin/env node
/** trending.ts — "Trending Repositories" view for the GitHub repo browser CLI. */
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  StyledText,
  bold,
  fg,
  dim,
  t,
} from "@opentui/core";
import type { Repo } from "./types";
import { openUrl } from "./open-url";
import { NetworkError } from "./errors";
// ─── Tokyo Night palette ──────────────────────────────────────────────
const C = {
  bg: "#1a1b26",
  surface: "#16161e",
  text: "#a9b1d6",
  muted: "#565f89",
  cyan: "#7dcfff",
  purple: "#bb9af7",
  green: "#9ece6a",
  gold: "#e0af68",
  orange: "#ff9e64",
  red: "#f7768e",
  blue: "#7aa2f7",
  lightBlue: "#b4f9f8",
  selectionBg: "#3b6ce8",
  selectionText: "#c0caf5",
  border: "#363b54",
  descText: "#6c7086", // lighter muted for descriptions
  rankBg: "#2a2e42",
  rankTop1: "#e0af68", // gold
  rankTop2: "#9ece6a", // silver-ish green
  rankTop3: "#ff9e64", // bronze-ish orange
  rankRest: "#565f89", // muted gray
};
// ─── Language → color mapping ─────────────────────────────────────────
const LANG_COLORS: Record<string, string> = {
  Rust: "#e0af68",
  TypeScript: "#7dcfff",
  JavaScript: "#e0d068",
  Python: "#7aa2f7",
  Go: "#73daca",
  Java: "#f7768e",
  Ruby: "#f7768e",
  C: "#f7768e",
  "C++": "#f7768e",
  "C#": "#f7768e",
  Shell: "#9ece6a",
  Zig: "#e0af68",
  Lua: "#7dcfff",
  Haskell: "#bb9af7",
  Elixir: "#bb9af7",
  Dart: "#73daca",
  Swift: "#f7768e",
  Kotlin: "#7aa2f7",
};
function langColor(lang: string): string {
  return LANG_COLORS[lang] ?? C.muted;
}
function rankColor(rank: number): string {
  if (rank === 1) return C.rankTop1;
  if (rank === 2) return C.rankTop2;
  if (rank === 3) return C.rankTop3;
  return C.rankRest;
}
// ─── Tab definitions ──────────────────────────────────────────────────
export const TAB_NAMES = ["Today", "This Week", "This Month"] as const;
export type TabName = (typeof TAB_NAMES)[number];
/** Map TabName to github.com/trending?since= param */
export function tabSince(tab: TabName): "daily" | "weekly" | "monthly" {
  switch (tab) {
    case "Today":     return "daily";
    case "This Week": return "weekly";
    default:          return "monthly";
  }
}
// ─── Types ────────────────────────────────────────────────────────────
export interface TrendingRepo {
  rank: number;
  owner: string;
  name: string;
  stars: number;
  starsToday: number;
  language: string;
  description: string;
}
// ─── HTML scraping parser ─────────────────────────────────────────────
const TRENDING_URL = "https://github.com/trending";
/**
 * Fetch trending repos by scraping github.com/trending HTML.
 *
 * The page structure (2026):
 *   <article class="Box-row">
 *     <h2><a href="/owner/name">repo name</a></h2>
 *     <p>description</p>
 *     <span itemprop="programmingLanguage">TypeScript</span>
 *     <a href="/owner/name/stargazers">  N,NNN </a>
 *     <span> NNN stars today </span>
 *
 * github.com/trending?since=daily|weekly|monthly
 *
 * Falls back to starsToday: 0 if the HTML format changes.
 */
export async function fetchTrendingRepos(since: "daily" | "weekly" | "monthly"): Promise<TrendingRepo[]> {
  const url = since === "daily" ? TRENDING_URL : `${TRENDING_URL}?since=${since}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": "ghfind" } });
  } catch {
    throw new NetworkError();
  }
  if (!res.ok) throw new NetworkError();
  const html = await res.text();
  return parseTrendingHtml(html);
}
/** Parse github.com/trending HTML into TrendingRepo[]. */
export function parseTrendingHtml(html: string): TrendingRepo[] {
  // Trim whitespace before flattening to avoid regex issues
  const flat = html.replace(/>\s+</g, "><").replace(/\s+/g, " ");
  const repos: TrendingRepo[] = [];
  // Regex to extract each article block
  // We match articles and then extract fields from each
  const articleRe = /<article class="Box-row">(.*?)<\/article>/gi;
  let match: RegExpExecArray | null;
  let rank = 0;
  while ((match = articleRe.exec(flat)) !== null) {
    rank++;
    const block = match[1];
    // Extract owner/name from href="/owner/name" within a Link class anchor
    // The repo link is the first h2 > a in the article
    const repoMatch = block.match(/href="\/([^\/"]+)\/([^\/"?#]+)"[^>]*class="Link"/);
    if (!repoMatch) continue;
    const owner = repoMatch[1];
    const name = repoMatch[2];
    // Total stars: the stargazers link contains the count
    // Total stars: appears after </svg> inside the stargazers link
    const starsMatch = block.match(/href="\/[^\/"]+\/[^\/"]+\/stargazers"[^>]*>.*?<\/svg>\s*(\d[\d,]*)/);
    const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, ""), 10) : 0;
    // Growth: "NNN stars today" or "NNN stars this week/month"
    const growthMatch = block.match(/(\d[\d,]*)\s+stars\s+(today|this\s+\w+)/);
    const starsToday = growthMatch ? parseInt(growthMatch[1].replace(/,/g, ""), 10) : 0;
    // Language: <span itemprop="programmingLanguage">TypeScript</span>
    const langMatch = block.match(/itemprop="programmingLanguage">([^<]+)</);
    const language = langMatch ? langMatch[1].trim() : "";
    // Description: <p class="col-9 color-fg-muted my-1 tmp-pr-4">desc</p>
    const descMatch = block.match(/<p[^>]*class="[^"]*color-fg-muted[^"]*"[^>]*>([^<]+)</);
    const description = descMatch ? descMatch[1].trim() : "";
    repos.push({ rank, owner, name, stars, starsToday, language, description });
  }
  return repos;
}
/** Convert TrendingRepo → Repo for use with export/format functions. */
export function trendingRepoToRepo(r: TrendingRepo, query?: string): Repo {
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
}
// ─── Number formatting ────────────────────────────────────────────────
/** 1234 → "1.2k", 1234567 → "1.2M", 999999 → "1M" */
export function fmtStars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 999_500) return "1M"; // ponytail: round 999500+ up before showing 1000k
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
/** Format signed number: 1204 → "+1.2k" */
export function fmtSigned(n: number): string {
  const abs = fmtStars(Math.abs(n));
  return n >= 0 ? `+${abs}` : `-${abs}`;
}
// ─── Row formatting ───────────────────────────────────────────────────
/**
 * Format one repo as a StyledText for per-chunk coloring.
 *
 * Layout (two lines):
 *   "[01] owner/name  ● Rust  ★ 89.2k  ▲ +235 today"
 *   "  Build smaller, faster desktop apps."
 *
 * Uses OpenTUI's StyledText + bold/fg/dim helpers for per-element colors:
 *   - Rank badge: colored background via bracket style, rank color
 *   - owner/name: bold white
 *   - Language dot: language-specific color
 *   - Stars: gold
 *   - Growth: green bold
 *   - Description: dim muted gray
 */
export function formatRepoLine(repo: TrendingRepo): StyledText {
  const rank = String(repo.rank).padStart(2, "0");
  const full = `${repo.owner}/${repo.name}`;
  const lc = langColor(repo.language);
  const rc = rankColor(repo.rank);
  const star = "★";
  const arrow = repo.starsToday > 0 ? "▲" : "▼";
  const growth = `${arrow} ${fmtSigned(repo.starsToday)} today`;
  const desc = repo.description.length > 60
    ? repo.description.slice(0, 57) + "..."
    : repo.description;
  const line1 = t`${dim(fg(C.rankBg)(`[${rank}]`))} ${bold(fg("#c0caf5")(full))}  ${fg(lc)(`● ${repo.language}`)}  ${fg(C.gold)(`${star} ${fmtStars(repo.stars)}`)}  ${bold(fg(C.green)(growth))}`;
  const line2 = t`  ${dim(fg(C.muted)(desc))}`;
  const chunks = [
    ...line1.chunks,
    { text: "\n", __isChunk: true as const, fg: C.text },
    ...line2.chunks,
  ];
  return new StyledText(chunks);
}
// ─── Tab query builder ────────────────────────────────────────────────
/**
 * Build a GitHub search query string for the given time range tab.
 *
 * Examples:
 *   "Today"      → "created:>2026-07-09 sort:stars"
 *   "This Week"  → "created:>2026-07-03 sort:stars"
 *   "All Time"   → "sort:stars"
 */
export function getTrendingQuery(tab: TabName): string {
  const now = Date.now();
  const msPerDay = 86_400_000;
  const ranges: Record<TabName, number> = {
    Today: 1,
    "This Week": 7,
    "This Month": 30,
  };
  const days = ranges[tab];
  if (days === 0) return "sort:stars";
  const d = new Date(now - days * msPerDay);
  return `created:>${d.toISOString().slice(0, 10)} sort:stars`;
}
// ─── Main TUI entry ───────────────────────────────────────────────────
export async function launchTrending(): Promise<void> {
  let renderer;
  try {
    renderer = await createCliRenderer();
  } catch (err) {
    console.error(
      "Failed to start the interactive browser.\n",
      `Reason: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
    return;
  }
  const root = renderer.root;
  root.flexDirection = "column";
  root.backgroundColor = C.bg;
  // ── State ──
  let selectedTab = 1; // "This Week" default
  let currentPeriod = "this week";
  let repos: TrendingRepo[] = [];
  let selectedRepoIdx = 0;
  let isLoading = false;
  // ── Fetch from github.com/trending ──
  async function loadTab(index: number) {
    if (index < 0 || index >= TAB_NAMES.length) return;
    selectedTab = index;
    const since = tabSince(TAB_NAMES[index]);
    currentPeriod = since === "daily" ? "today" : since === "weekly" ? "this week" : "this month";
    isLoading = true;
    for (const rb of rowBoxes) scrollBox.remove(rb);
    rowBoxes.length = 0;
    rowTexts.length = 0;
    const loadingText = new TextRenderable(renderer, {
      content: t`${dim(fg(C.muted)(`  Loading trending repos...`))}`,
      backgroundColor: C.bg,
      height: 1,
    });
    scrollBox.add(loadingText);
    renderer.requestRender();
    try {
      const fetched = await fetchTrendingRepos(tabSince(TAB_NAMES[index]));
      scrollBox.remove(loadingText);
      repos = fetched;
      selectedRepoIdx = 0;
      rebuildList();
    } catch (err) {
      scrollBox.remove(loadingText);
      const msg = err instanceof Error ? err.message : String(err);
      const errText = new TextRenderable(renderer, {
        content: t`${fg(C.red)(`  Error: ${msg.slice(0, 70)}`)}`,
        backgroundColor: C.bg,
        height: 1,
      });
      scrollBox.add(errText);
    }
    isLoading = false;
    renderTabBar();
    renderer.requestRender();
  }
  // ── Switch tab ──
  function switchTab(index: number) {
    if (index < 0 || index >= TAB_NAMES.length || index === selectedTab) return;
    loadTab(index);
  }
  // ── Outer frame ──
  const outerBox = new BoxRenderable(renderer, {
    flexGrow: 1,
    flexDirection: "column",
    backgroundColor: C.bg,
    border: true,
    borderColor: C.border,
    borderStyle: "rounded",
    paddingX: 0,
    paddingY: 0,
  });
  // ── Header bar ──
  const headerBox = new BoxRenderable(renderer, {
    height: 1,
    backgroundColor: C.bg,
    paddingX: 1,
  });
  const headerText = new TextRenderable(renderer, {
    content: t`${bold(fg(C.purple)("⟠ tulipsearch"))}${fg(C.muted)(" — Trending")}`,
    height: 1,
  });
  headerBox.add(headerText);
  outerBox.add(headerBox);
  // ── Tab bar ──
  const tabBox = new BoxRenderable(renderer, {
    flexDirection: "row",
    height: 1,
    backgroundColor: C.bg,
    paddingX: 1,
  });
  const tabTexts: TextRenderable[] = [];
  function renderTabBar() {
    for (const t of tabTexts) tabBox.remove(t);
    tabTexts.length = 0;
    TAB_NAMES.forEach((name, i) => {
      const isActive = i === selectedTab;
      const label = ` ${name} `;
      const tt = new TextRenderable(renderer, {
        content: isActive ? t`${bold(fg(C.bg)(label))}` : t`${fg(C.muted)(label)}`,
        color: isActive ? C.bg : C.muted,
        backgroundColor: isActive ? C.cyan : C.bg,
        height: 1,
      });
      tabTexts.push(tt);
      tabBox.add(tt);
      if (i < TAB_NAMES.length - 1) {
        const sp = new TextRenderable(renderer, {
          content: "  ",
          color: C.muted,
          backgroundColor: C.bg,
          height: 1,
        });
        tabTexts.push(sp);
        tabBox.add(sp);
      }
    });
  }
  renderTabBar();
  outerBox.add(tabBox);
  const divider = new TextRenderable(renderer, {
    content: "─".repeat(80),
    color: C.border,
    height: 1,
    backgroundColor: C.bg,
  });
  outerBox.add(divider);
  // ── Repo list (scrollable) ──
  const scrollBox = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    backgroundColor: C.bg,
    scrollY: true,
    scrollX: false,
    viewportCulling: true,
  });
  const rowBoxes: BoxRenderable[] = [];
  const rowTexts: TextRenderable[] = [];
  function rebuildList() {
    for (const rb of rowBoxes) scrollBox.remove(rb);
    rowBoxes.length = 0;
    rowTexts.length = 0;
    repos.forEach((r, i) => {
      const isEven = i % 2 === 0;
      const isSelected = i === selectedRepoIdx;
      const rowBg = isSelected ? C.selectionBg : (isEven ? C.bg : C.surface);
      const rank = i + 1;
      const rc = rankColor(rank);
      const lc = langColor(r.language ?? "");
      const desc = (r.description ?? "").length > 55
        ? (r.description ?? "").slice(0, 52) + "..."
        : (r.description ?? "");
      const arrow = r.starsToday > 0 ? "▲" : r.starsToday < 0 ? "▼" : "—";
      const growthStr = `${arrow} ${fmtStars(Math.abs(r.starsToday))} ${currentPeriod}`;
      const rankStr = `[${String(rank).padStart(2, "0")}]`;
      const nameStr = `${r.owner}/${r.name}`.padEnd(30).slice(0, 30);
      const langStr = `● ${r.language || "—"}`.padEnd(14).slice(0, 14);
      const starsStr = `★ ${fmtStars(r.stars)}`.padEnd(12).slice(0, 12);
      const rankText = new TextRenderable(renderer, {
        content: t`${bold(fg(rc)(rankStr))}`,
        backgroundColor: C.rankBg,
        color: rc,
        height: 1,
      });
      const descStr = desc.length > 60 ? desc.slice(0, 57) + "..." : desc;
      const pad = "     ";
      const line1 = t`${bold(fg("#c0caf5")(nameStr))}${fg(lc)(langStr)}${fg(C.muted)(starsStr)}${bold(fg(C.green)(growthStr))}`;
      const line2 = t`${fg(C.descText)(`${pad}${descStr}`)}`;
      const chunks = [
        ...line1.chunks,
        { text: "\n", __isChunk: true as const, fg: C.text },
        ...line2.chunks,
      ];
      const rowText = new TextRenderable(renderer, {
        content: new StyledText(chunks),
        backgroundColor: rowBg,
        height: 2,
      });
      const rowBox = new BoxRenderable(renderer, {
        flexDirection: "row",
        backgroundColor: rowBg,
      });
      rowBox.add(rankText);
      rowBox.add(rowText);
      rowBoxes.push(rowBox);
      rowTexts.push(rowText);
      scrollBox.add(rowBox);
    });
  }
  outerBox.add(scrollBox);
  // ── Footer bar ──
  const footerBox = new BoxRenderable(renderer, {
    height: 1,
    backgroundColor: C.bg,
    paddingX: 1,
  });
  const footerText = new TextRenderable(renderer, {
    content: " ↑↓ navigate  ↵ open  / search  1-5 tab  q quit  r refresh",
    color: C.muted,
    height: 1,
  });
  footerBox.add(footerText);
  outerBox.add(footerBox);
  root.add(outerBox);
  // ── Helpers ──
  function openSelectedRepo() {
    if (selectedRepoIdx < 0 || selectedRepoIdx >= repos.length) return;
    const r = repos[selectedRepoIdx];
    openUrl(`https://github.com/${r.owner}/${r.name}`);
  }
  function moveSelection(delta: number) {
    const oldIdx = selectedRepoIdx;
    const newIdx = Math.max(0, Math.min(repos.length - 1, oldIdx + delta));
    if (newIdx === oldIdx) return;
    selectedRepoIdx = newIdx;
    const setBg = (idx: number, selected: boolean) => {
      if (idx < 0 || idx >= rowBoxes.length) return;
      const bg = selected ? C.selectionBg : (idx % 2 === 0 ? C.bg : C.surface);
      rowBoxes[idx].backgroundColor = bg;
      if (rowTexts[idx]) rowTexts[idx].backgroundColor = bg;
    };
    setBg(oldIdx, false);
    setBg(newIdx, true);
    renderer.requestRender();
  }
  // ── Global key events ──
  renderer.keyInput.on("keypress", (key) => {
    const name = key.name || "";
    if (name === "q") {
      process.exit(0);
      return;
    }
    if (/^[1-3]$/.test(name)) {
      switchTab(parseInt(name, 10) - 1);
      return;
    }
    if (name === "left" || name === "h") {
      switchTab(selectedTab - 1);
      return;
    }
    if (name === "right" || name === "l") {
      switchTab(selectedTab + 1);
      return;
    }
    if (name === "up" || name === "k") {
      moveSelection(-1);
      return;
    }
    if (name === "down" || name === "j") {
      moveSelection(1);
      return;
    }
    if (name === "enter" || name === "return" || name === "o") {
      openSelectedRepo();
      return;
    }
    if (name === "/") {
      moveSelection(-selectedRepoIdx);
      return;
    }
    if (name === "r") {
      loadTab(selectedTab);
      return;
    }
  });
  // ── Start ──
  renderer.start();
  renderer.requestRender();
  loadTab(selectedTab);
}
// ── Auto-run ──────────────────────────────────────────────────────────
if (import.meta.main && !process.env.GHFIND_BUNDLED) {
  launchTrending();
}
