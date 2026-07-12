#!/usr/bin/env bun
/**
 * search-cli — interactive GitHub repository browser (OpenTUI)
 *
 * Full-screen, keyboard-driven browser. This is the only entry point.
 * Pipeline: user query → provider → normalizer → ranking → rendered in TUI
 *
 * Layout:
 *   ┌─ search-cli  [s]sort  [l]limit  [r]refresh  [q]quit ─────┐
 *   │ > [query input ........................................]   │
 *   │ sort: best-match  limit: 50                               │
 *   ├─── Results ────────────────┬─── Details ──────────────────┤
 *   │  owner/repo           ★69k │ Name     owner/repo           │
 *   │  owner/repo           ★42k │ Stars    69,420               │
 *   │  owner/repo           ★12k │ Forks    1,337                │
 *   │  owner/repo           ★5k  │ Language TypeScript           │
 *   │  owner/repo           ★2k  │ Updated  2026-07-09           │
 *   │  owner/repo           ★1k  │ Topics   ai, agent, tui       │
 *   │                          │                              │
 *   │                          │ A description...              │
 *   │                          │ https://github.com/...        │
 *   ├──────────────────────────┴────────────────────────────────┤
 *   │ 42 results of 15000  (↑↓ nav  Enter open  o browser)      │
 *   └───────────────────────────────────────────────────────────┘
 */
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  SelectRenderable,
} from "@opentui/core";
import type { Repo, SearchOptions, SortStrategy } from "./types.ts";
import { parseQuery, applyFlagFilters, validateQuery, suggestFor } from "./query.ts";
import { GitHubSearchProvider, type Logger } from "./provider.ts";
import { rankRepos } from "./ranking.ts";
import { fetchTrendingRepos, tabSince, TAB_NAMES, fmtStars, type TrendingRepo } from "./trending.ts";
import { loadConfig } from "./config.ts";
import { buildHelpText } from "./help.ts";
import { SearchCliError, NetworkError, RateLimitError, BadQueryError, NoResultsError } from "./errors.ts";
import { appendHistory, readHistory, deleteHistoryEntry, clearHistory } from "./history.ts";
import { getBookmarks, isBookmarked, toggleBookmark, removeBookmark } from "./bookmarks.ts";
import { getSavedSearches, saveSearch, deleteSavedSearch, touchSavedSearch } from "./saved-searches.ts";
import { saveSession, restoreSession } from "./session.ts";
import { fetchDeepDive, buildDeepDiveText } from "./deepdive.ts";
import { buildComparisonTable } from "./compare.ts";
import { fetchTopics, type TopicItem } from "./explore.ts";
import { exportToFile, type ExportFormat } from "./export.ts";
import { loadTheme } from "./themes.ts";
import { StatusManager } from "./status.ts";
import { addNotification, getNotifications, dismissNotification, dismissAll } from "./notifications.ts";
import { formatShare, copyToClipboard, type ShareFormat } from "./share.ts";
import { nextTip } from "./tips.ts";

// ─── Theme ────────────────────────────────────────────────────────────
const colors = {
  bg: "#1e1e2e",
  surface: "#181825",
  text: "#cdd6f4",
  muted: "#6c7086",
  blue: "#89b4fa",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  red: "#f38ba8",
  teal: "#94e2d5",
  border: "#45475a",
  selectionBg: "#2d5bcf",
  selectionText: "#ffffff",
};

// ─── Logger ───────────────────────────────────────────────────────────
const logger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─── Sort cycle ───────────────────────────────────────────────────────
const SORT_MODES: { key: SortStrategy; label: string }[] = [
  { key: "best-match", label: "best-match" },
  { key: "stars", label: "stars" },
  { key: "updated", label: "updated" },
  { key: "forks", label: "forks" },
];

// ─── Main ─────────────────────────────────────────────────────────────
export async function launchBrowser(): Promise<void> {
  let renderer;
  try {
    renderer = await createCliRenderer();
  } catch (err) {
    console.error(
      "Failed to start the interactive browser. OpenTUI native backend unavailable.\n",
      `Reason: ${err instanceof Error ? err.message : String(err)}\n`,
      "Install Zig or use a platform with native OpenTUI support.",
    );
    process.exit(1);
    return;
  }

  const root = renderer.root;
  root.flexDirection = "column";
  root.backgroundColor = colors.bg;

  // ── Config ──
  const config = loadConfig();
  const githubToken = config.githubToken || process.env.GITHUB_TOKEN;

  // Apply theme
  const theme = loadTheme(config.theme);
  Object.assign(colors, theme);

  // ── Session restore ──
  const session = restoreSession();

  // ── State ───────────────────────────────────────────────────────────
  let currentRepos: Repo[] = [];
  let currentSort: SortStrategy = session?.sort ?? config.defaultSort;
  let currentLimit = session?.limit ?? config.defaultLimit;
  let currentQueryInput = session?.query ?? "";
  let isLoading = false;
  let currentMode: "search" | "trending" = session?.mode ?? "search";
  let trendingTab: typeof TAB_NAMES[number] = (session?.trendingTab as typeof TAB_NAMES[number]) ?? "This Week";
  let trendingPeriod = "this week";
  let graphFullscreen = false;
  let chartCommitData: number[] = [];
  let currentOverlay: "none" | "history" | "bookmarks" | "saved" | "help" | "topics" | "export" | "compare" | "notifications" | "share" = "none";
  let currentPage = 1;
  let totalCount = 0;
  let deepDiveActive = false;
  let compareList: Repo[] = [];

  // ── Header bar ──────────────────────────────────────────────────────
  const header = new TextRenderable(renderer, {
    content:
      " search-cli — GitHub repo browser   [t]rending  [/]search  [g]raph  [r]efresh  [q]uit",
    backgroundColor: colors.surface,
    color: colors.muted,
    height: 1,
  });
  root.add(header);

  // ── Trending tab bar (hidden in search mode) ────────────────────────
  const trendingTabBox = new BoxRenderable(renderer, {
    flexDirection: "row",
    height: 1,
    backgroundColor: colors.bg,
    paddingX: 1,
    visible: false,
  });
  // Hidden by default; shown when currentMode === "trending"
  const trendingTabTexts: TextRenderable[] = [];

  function renderTrendingTabs() {
    for (const t of trendingTabTexts) trendingTabBox.remove(t);
    trendingTabTexts.length = 0;
    TAB_NAMES.forEach((name, i) => {
      const isActive = name === trendingTab;
      const label = ` ${name} `;
      const tt = new TextRenderable(renderer, {
        content: label,
        color: isActive ? colors.bg : colors.muted,
        backgroundColor: isActive ? colors.blue : colors.bg,
        height: 1,
      });
      trendingTabTexts.push(tt);
      trendingTabBox.add(tt);
      if (i < TAB_NAMES.length - 1) {
        const sp = new TextRenderable(renderer, {
          content: "  ",
          color: colors.muted,
          backgroundColor: colors.bg,
          height: 1,
        });
        trendingTabTexts.push(sp);
        trendingTabBox.add(sp);
      }
    });
  }
  root.add(trendingTabBox);

  // ── Search input row ────────────────────────────────────────────────
  const searchBox = new BoxRenderable(renderer, {
    visible: true, // hidden in trending mode
    border: true,
    borderColor: colors.blue,
    paddingX: 1,
    height: 3,
  });
  const searchInput = new InputRenderable(renderer, {
    placeholder: "Search GitHub repos (e.g. rust cli, or language:Rust stars:>100)",
    value: "",
  });
  searchBox.add(searchInput);
  root.add(searchBox);

  // ── Toolbar (sort + limit indicator) ────────────────────────────────
  const toolbarText = new TextRenderable(renderer, {
    content: formatToolbar(currentSort, currentLimit),
    visible: true, // hidden in trending mode
    backgroundColor: colors.bg,
    color: colors.muted,
    height: 1,
    paddingX: 1,
  });
  root.add(toolbarText);

  // ── Body: results + detail ──────────────────────────────────────────
  const body = new BoxRenderable(renderer, {
    flexDirection: "row",
    flexGrow: 1,
    gap: 1,
    paddingY: 1,
    paddingX: 1,
  });

  // Results pane
  const resultsBox = new BoxRenderable(renderer, {
    border: true,
    borderColor: colors.border,
    title: " Results ",
    titleColor: colors.blue,
    width: "50%",
    flexDirection: "column",
    paddingLeft: 0,
    focusable: false,
  });
  const resultsSelect = new SelectRenderable(renderer, {
    options: [{ name: "", description: "Type a query and press Enter to search", value: null }],
    showDescription: false,
    showSelectionIndicator: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    textColor: colors.text,
    selectedBackgroundColor: colors.selectionBg,
    selectedTextColor: colors.selectionText,
    focusedBackgroundColor: colors.bg,
    focusedTextColor: colors.text,
    itemSpacing: 0,
  });
  resultsBox.add(resultsSelect);

  // Detail / Graph pane
  const detailBox = new BoxRenderable(renderer, {
    border: true,
    borderColor: colors.border,
    title: " Details ",
    titleColor: colors.green,
    width: "50%",
    flexDirection: "column",
    paddingX: 1,
    paddingY: 1,
    focusable: false,
  });
  const detailText = new TextRenderable(renderer, {
    content: "",
    color: colors.text,
  });
  detailBox.add(detailText);

  body.add(resultsBox);
  body.add(detailBox);
  root.add(body);

  // ── Overlay system ──────────────────────────────────────────────────
  function hideAllOverlays() {
    helpBox.visible = false;
    historyBox.visible = false;
    bookmarksBox.visible = false;
    savedBox.visible = false;
    topicsBox.visible = false;
    exportBox.visible = false;
    compareBox.visible = false;
    notifsBox.visible = false;
    shareBox.visible = false;
    currentOverlay = "none";
  }

  function showOverlay(type: typeof currentOverlay) {
    hideAllOverlays();
    if (type === "none") return;
    currentOverlay = type;
    if (type === "help") { helpBox.visible = true; }
    else if (type === "history") { historyBox.visible = true; }
    else if (type === "bookmarks") { bookmarksBox.visible = true; }
    else if (type === "saved") { savedBox.visible = true; }
    else if (type === "topics") { topicsBox.visible = true; }
    else if (type === "export") { exportBox.visible = true; }
    else if (type === "compare") { compareBox.visible = true; }
    else if (type === "notifications") { notifsBox.visible = true; }
    else if (type === "share") { shareBox.visible = true; }
    renderer.requestRender();
  }

  // ── Help overlay ────────────────────────────────────────────
  const helpBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    border: true,
    borderColor: colors.border,
  });
  const helpTextEl = new TextRenderable(renderer, {
    content: buildHelpText(),
    color: colors.text,
    backgroundColor: colors.bg,
  });
  helpBox.add(helpTextEl);
  root.add(helpBox);

  // ── History overlay ─────────────────────────────────────────
  const historyBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    border: true,
    borderColor: colors.border,
    title: " Search History ",
    titleColor: colors.blue,
  });
  const historySelect = new SelectRenderable(renderer, {
    options: [{ name: "(no history)", description: "", value: null }],
    showDescription: false,
    showSelectionIndicator: true,
    flexGrow: 1,
    backgroundColor: colors.bg,
    textColor: colors.text,
    selectedBackgroundColor: colors.selectionBg,
    selectedTextColor: colors.selectionText,
    itemSpacing: 0,
  });
  historyBox.add(historySelect);
  root.add(historyBox);

  function refreshHistory() {
    const entries = readHistory();
    if (entries.length === 0) {
      historySelect.options = [{ name: "(no history)", description: "", value: null }];
    } else {
      historySelect.options = entries.map((e, i) => ({
        name: `${e.query}  — ${e.mode}${e.tab ? ` (${e.tab})` : ""}`,
        description: `${e.resultCount} results`,
        value: { index: i, entry: e },
      }));
    }
    historySelect.setSelectedIndex(0);
  }

  // ── Bookmarks overlay ───────────────────────────────────────
  const bookmarksBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    border: true,
    borderColor: colors.border,
    title: " Bookmarks ",
    titleColor: colors.green,
  });
  const bookmarksSelect = new SelectRenderable(renderer, {
    options: [{ name: "(no bookmarks)", description: "", value: null }],
    showDescription: false,
    showSelectionIndicator: true,
    flexGrow: 1,
    backgroundColor: colors.bg,
    textColor: colors.text,
    selectedBackgroundColor: colors.selectionBg,
    selectedTextColor: colors.selectionText,
    itemSpacing: 0,
  });
  bookmarksBox.add(bookmarksSelect);
  root.add(bookmarksBox);

  function refreshBookmarks() {
    const bookmarks = getBookmarks();
    if (bookmarks.length === 0) {
      bookmarksSelect.options = [{ name: "(no bookmarks)", description: "", value: null }];
    } else {
      bookmarksSelect.options = bookmarks.map((b) => ({
        name: `${b.repo.fullName}  ★ ${b.repo.stars.toLocaleString()}`,
        description: b.repo.description ?? "",
        value: b,
      }));
    }
    bookmarksSelect.setSelectedIndex(0);
  }

  // ── Saved searches overlay ─────────────────────────────────
  const savedBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    border: true,
    borderColor: colors.border,
    title: " Saved Searches ",
    titleColor: colors.yellow,
  });
  const savedSelect = new SelectRenderable(renderer, {
    options: [{ name: "(no saved searches)", description: "", value: null }],
    showDescription: false,
    showSelectionIndicator: true,
    flexGrow: 1,
    backgroundColor: colors.bg,
    textColor: colors.text,
    selectedBackgroundColor: colors.selectionBg,
    selectedTextColor: colors.selectionText,
    itemSpacing: 0,
  });
  savedBox.add(savedSelect);
  root.add(savedBox);

  // ── Topic explorer overlay ───────────────────────────────────
  const topicsBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    border: true,
    borderColor: colors.border,
    title: " Topics ",
    titleColor: colors.purple ?? colors.blue,
  });
  const topicsSelect = new SelectRenderable(renderer, {
    options: [{ name: "(loading topics...)", description: "", value: null }],
    showDescription: true,
    showSelectionIndicator: true,
    flexGrow: 1,
    backgroundColor: colors.bg,
    textColor: colors.text,
    selectedBackgroundColor: colors.selectionBg,
    selectedTextColor: colors.selectionText,
    itemSpacing: 0,
  });
  topicsBox.add(topicsSelect);
  root.add(topicsBox);

  async function refreshTopics() {
    try {
      const topics = await fetchTopics();
      topicsSelect.options = topics.map((t) => ({
        name: `${t.name}  (${t.repoCount.toLocaleString()} repos)`,
        description: t.description.slice(0, 80),
        value: t,
      }));
    } catch {
      topicsSelect.options = [{ name: "(failed to load topics)", description: "", value: null }];
    }
    topicsSelect.setSelectedIndex(0);
  }

  // ── Export overlay ───────────────────────────────────────────
  const exportBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    border: true,
    borderColor: colors.border,
    title: " Export ",
    titleColor: colors.green,
  });
  const exportSelect = new SelectRenderable(renderer, {
    options: [
      { name: "  JSON", description: "Full repo data as JSON array", value: "json" },
      { name: "  CSV", description: "Rank, name, stars, forks, language, URL", value: "csv" },
      { name: "  Markdown", description: "Pretty table with links (paste into README)", value: "markdown" },
      { name: "  Plain text", description: "One repo per line", value: "text" },
    ],
    showDescription: true,
    showSelectionIndicator: true,
    flexGrow: 1,
    backgroundColor: colors.bg,
    textColor: colors.text,
    selectedBackgroundColor: colors.selectionBg,
    selectedTextColor: colors.selectionText,
    itemSpacing: 0,
  });
  exportBox.add(exportSelect);
  root.add(exportBox);

  // ── Compare overlay ──────────────────────────────────────────
  const compareBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    border: true,
    borderColor: colors.border,
    title: " Comparison ",
    titleColor: colors.yellow,
  });
  const compareText = new TextRenderable(renderer, {
    content: "",
    color: colors.text,
    backgroundColor: colors.bg,
  });
  compareBox.add(compareText);
  root.add(compareBox);

  // ── Notifications overlay ────────────────────────────────────
  const notifsBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    border: true,
    borderColor: colors.border,
    title: " Notifications ",
    titleColor: colors.yellow,
  });
  const notifsText = new TextRenderable(renderer, {
    content: "(no notifications)",
    color: colors.text,
    backgroundColor: colors.bg,
  });
  notifsBox.add(notifsText);
  root.add(notifsBox);

  function refreshNotifications() {
    const notifs = getNotifications();
    if (notifs.length === 0) {
      notifsText.content = "  (no notifications)";
    } else {
      notifsText.content = notifs
        .map((n) => `  ${n.icon} ${n.message}`)
        .join("\n");
    }
  }

  // ── Share overlay ────────────────────────────────────────────
  const shareBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    border: true,
    borderColor: colors.border,
    title: " Share Repo ",
    titleColor: colors.blue,
  });
  const shareSelect = new SelectRenderable(renderer, {
    options: [
      { name: "  Markdown", description: "[owner/repo](url) — description", value: "markdown" },
      { name: "  Plain", description: "owner/repo — description — url", value: "plain" },
      { name: "  GitHub CLI", description: "gh repo view owner/repo", value: "gh-cli" },
      { name: "  Short", description: "owner/repo", value: "short" },
    ],
    showDescription: true,
    showSelectionIndicator: true,
    flexGrow: 1,
    backgroundColor: colors.bg,
    textColor: colors.text,
    selectedBackgroundColor: colors.selectionBg,
    selectedTextColor: colors.selectionText,
    itemSpacing: 0,
  });
  shareBox.add(shareSelect);
  root.add(shareBox);

  function refreshCompare() {
    if (compareList.length < 2) {
      compareText.content = "Select at least 2 repos to compare (press c to add).";
    } else {
      compareText.content = buildComparisonTable(compareList);
    }
  }

  function refreshSavedSearches() {
    const saved = getSavedSearches();
    if (saved.length === 0) {
      savedSelect.options = [{ name: "(no saved searches)", description: "", value: null }];
    } else {
      savedSelect.options = saved.map((s) => ({
        name: `${s.name}`,
        description: `${s.query}  (${s.mode})`,
        value: s,
      }));
    }
    savedSelect.setSelectedIndex(0);
  }

  // ── Status bar ──────────────────────────────────────────────────────
  const statusBar = new TextRenderable(renderer, {
    content: " Ready. Press Enter to search.",
    backgroundColor: colors.surface,
    color: colors.muted,
    height: 1,
    paddingX: 1,
  });
  root.add(statusBar);

  const statusMgr = new StatusManager((text) => {
    statusBar.content = ` ${text}`;
    renderer.requestRender();
  });

  // ── Startup tip ──
  if (config.theme !== undefined || true) {
    // Show a tip after 2s idle
    setTimeout(() => {
      if (currentOverlay === "none") {
        setStatus(nextTip());
      }
    }, 2000);
  }

  // ── Helper functions ────────────────────────────────────────────────

  function setStatus(msg: string) {
    statusMgr.set("idle", msg);
  }

  function setToolbar() {
    toolbarText.content = formatToolbar(currentSort, currentLimit);
    renderer.requestRender();
  }

  function updateDetail(repo: Repo | null) {
    if (!repo) {
      detailText.content = "";
      return;
    }
    const topics = repo.topics.length ? repo.topics.slice(0, 8).join(", ") : "—";
    const desc = repo.description ?? "(no description)";
    const lines = [
      `Name     ${repo.fullName}`,
      `Stars    ${repo.stars.toLocaleString()}`,
      `Forks    ${repo.forks.toLocaleString()}`,
      `Lang     ${repo.language ?? "—"}`,
      `Updated  ${repo.updatedAt.slice(0, 10)}`,
      repo.archived ? "Status   archived" : "",
      repo.isFork ? "Status   fork" : "",
      `Topics   ${topics}`,
      "",
      desc,
      "",
      repo.url,
    ].filter((l) => l !== "");
    detailText.content = lines.join("\n");
  }

  // ── Graph / Chart ──────────────────────────────────────────────────

  /** Unicode blocks for 8 vertical levels within one character cell. */
  const BLOCKS = [" ", "\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];

  function buildChartString(values: number[], width: number, height: number): string[] {
    if (values.length === 0) return ["(no data)"];
    // Sample to fit width
    const sampled: number[] = [];
    for (let i = 0; i < width; i++) {
      sampled.push(values[Math.floor((i / width) * values.length)]);
    }
    const max = Math.max(...sampled, 1);
    const norm = sampled.map(v => Math.round((v / max) * (8 * height - 1)));

    // Build char grid from bottom
    const grid: string[][] = Array.from({ length: height }, () => Array(width).fill(" "));
    for (let c = 0; c < width; c++) {
      const p = norm[c];
      const full = Math.floor(p / 8);
      const part = p % 8;
      for (let r = 0; r < full && r < height; r++) grid[height - 1 - r][c] = "\u2588";
      if (full < height && part > 0) grid[height - 1 - full][c] = BLOCKS[part];
    }
    // Fill vertical gaps between adjacent columns
    for (let c = 0; c < width - 1; c++) {
      const r1 = Math.floor(norm[c] / 8);
      const r2 = Math.floor(norm[c + 1] / 8);
      const lo = Math.max(0, Math.min(r1, r2));
      const hi = Math.min(height - 1, Math.max(r1, r2));
      for (let r = lo; r <= hi; r++) {
        if (grid[height - 1 - r][c] === " ") grid[height - 1 - r][c] = "\u2588";
      }
    }

    // Build rows with Y-axis labels
    const lines: string[] = [];
    const labelRows = [0, Math.floor(height / 4), Math.floor(height / 2), Math.floor(3 * height / 4), height - 1];
    const labelVals = [max, Math.round(max * 0.75), Math.round(max / 2), Math.round(max / 4), 0];
    for (let r = 0; r < height; r++) {
      const idx = labelRows.indexOf(r);
      let label = "     ";
      if (idx >= 0) label = String(labelVals[idx]).padStart(4) + " ";
      lines.push(`${label}\u2524${grid[r].join("")}`);
    }
    // X-axis
    lines.push(`     \u2514${String.fromCharCode(0x2500).repeat(width)}`);
    return lines;
  }

  async function loadChart(repo: Repo) {
    detailText.content = "  Loading chart...";
    renderer.requestRender();
    try {
      const [chartRes, repoRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/stats/participation`,
          { headers: { "User-Agent": "search-cli/1.0" } }),
        fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}`,
          { headers: { "User-Agent": "search-cli/1.0" } }).then(r => r.ok ? r.json() : null),
      ]);

      let chartSection = "";
      if (chartRes.ok) {
        const data = await chartRes.json();
        if (data?.all && data.all.length >= 2) {
          chartCommitData = data.all;
          const chartW = Math.min(55, chartCommitData.length);
          const chartH = 10;
          const chartLines = buildChartString(chartCommitData, chartW, chartH);
          chartSection = ["", "Weekly commits (52 weeks)", ...chartLines].join("\n");
        }
      }

      const desc = repo.description ?? "";
      const lang = repo.language ?? "\u2014";
      const updated = repo.updatedAt ? repo.updatedAt.slice(0, 10) : "";
      const topics = repoRes?.topics?.length ? repoRes.topics.slice(0, 8).join(", ") : "";

      const growthLine = currentMode === "trending" && repo.score > 0
        ? ` Growth \u25b2 ${fmtStars(repo.score)} ${trendingPeriod}`
        : "";

      const detailLines = [
        ` ${repo.fullName}`,
        ` \u2606 ${repo.stars.toLocaleString()}  \u2666 ${repo.forks.toLocaleString()}  ${lang}`,
        growthLine,
        updated ? ` Updated ${updated}` : "",
        topics ? ` Topics  ${topics}` : "",
        "",
        desc,
        "",
        ` ${repo.url}`,
      ].filter(l => l !== "");

      detailText.content = [
        ...detailLines,
        chartSection,
      ].join("\n");
    } catch {
      detailText.content = "  Failed to load chart";
    }
    renderer.requestRender();
  }

  function toggleGraph() {
    graphFullscreen = !graphFullscreen;
    if (graphFullscreen) {
      resultsBox.visible = false;
      resultsBox.width = "0%";
      detailBox.width = "100%";
      const opt = resultsSelect.getSelectedOption();
      const repo = opt?.value as Repo | undefined;
      if (repo) loadChart(repo);
      else detailText.content = "  Select a repo to view activity";
    } else {
      resultsBox.visible = true;
      resultsBox.width = "50%";
      detailBox.width = "50%";
      const opt = resultsSelect.getSelectedOption();
      if (opt?.value) updateDetail(opt.value as Repo);
      else detailText.content = "";
    }
    renderer.requestRender();
  }

  // ── Trending helpers ────────────────────────────────────────────────

  function formatTrendingLine(r: { rank: number; owner: string; name: string; stars: number; starsToday: number; language: string }): string {
    const rank = String(r.rank).padStart(2, "0");
    const name = `${r.owner}/${r.name}`.padEnd(30).slice(0, 30);
    const lang = (r.language || "?").padEnd(12).slice(0, 12);
    const stars = `★ ${fmtStars(r.stars)}`.padEnd(9).slice(0, 9);
    const arrow = r.starsToday > 0 ? "▲" : r.starsToday < 0 ? "▼" : "—";
    const growth = `${arrow} ${fmtStars(r.starsToday)} ${trendingPeriod}`;
    return `[${rank}] ${name} ${lang} ${stars} ${growth}`;
  }

  function trendingRepoToSelectValue(r: TrendingRepo): Repo {
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

  async function loadTrending() {
    currentMode = "trending";
    isLoading = true;
    searchBox.visible = false;
    toolbarText.visible = false;
    trendingTabBox.visible = true;
    renderTrendingTabs();
    resultsSelect.options = [{ name: "  Loading trending...", description: "", value: null }];
    detailText.content = "";
    statusMgr.set("loading", "Loading trending repos...");
    renderer.requestRender();

    try {
      const fetched = await fetchTrendingRepos(tabSince(trendingTab));
      const since = tabSince(trendingTab);
      trendingPeriod = since === "daily" ? "today" : since === "weekly" ? "this week" : "this month";
      resultsSelect.options = fetched.map(r => ({
        name: formatTrendingLine(r),
        description: r.description,
        value: trendingRepoToSelectValue(r),
      }));
      if (fetched.length > 0) {
        resultsSelect.setSelectedIndex(0);
        updateDetail(trendingRepoToSelectValue(fetched[0]));
      } else {
        throw new NoResultsError(trendingTab);
      }
      statusMgr.set("success", `${fetched.length} trending repos — ${trendingTab}`);
      appendHistory({ query: `trending:${trendingTab}`, mode: "trending", tab: trendingTab, timestamp: Date.now(), resultCount: fetched.length });
    } catch (err) {
      const msg = err instanceof SearchCliError ? err.userMessage : (err instanceof Error ? err.message : String(err));
      resultsSelect.options = [{ name: " (error)", description: "", value: null }];
      statusMgr.set("error", msg.slice(0, 60));
    }
    isLoading = false;
    renderer.requestRender();
  }

  function showSearchMode() {
    currentMode = "search";
    trendingTabBox.visible = false;
    searchBox.visible = true;
    toolbarText.visible = true;
    searchInput.placeholder = "Search GitHub repos (e.g. rust cli, or language:Rust stars:>100)";
    searchInput.focus();
    renderer.requestRender();
  }

  async function doSearch(queryText: string, append = false) {
    const q = queryText.trim();
    if (q === "" || isLoading) return;

    if (!append) currentPage = 1;
    deepDiveActive = false;

    isLoading = true;
    currentQueryInput = q;
    if (!append) {
      resultsSelect.options = [{ name: "  Searching...", description: "", value: null }];
      detailText.content = "";
    }
    statusMgr.set("searching", `Searching for "${q}"`);

    try {
      const parsed = applyFlagFilters(parseQuery(q), {});
      validateQuery(parsed);
      const provider = new GitHubSearchProvider(logger);
      const options: SearchOptions = {
        limit: currentLimit,
        sort: currentSort,
        json: false,
        verbose: false,
        token: githubToken,
        page: currentPage,
      };
      const response = await provider.search(parsed, options);
      totalCount = response.totalCount;
      const newRepos = rankRepos(response.repos, options.sort);

      if (append) {
        currentRepos.push(...newRepos);
      } else {
        currentRepos = newRepos;
      }

      if (currentRepos.length === 0) {
        throw new NoResultsError(q);
      } else {
        resultsSelect.options = currentRepos.map((r) => ({
          name: formatResultLine(r),
          description: "",
          value: r,
        }));
        const idx = append ? resultsSelect.options.length - newRepos.length : 0;
        updateDetail(currentRepos[idx]);
        resultsSelect.setSelectedIndex(idx);
        statusMgr.set("success", `Page ${currentPage} — ${currentRepos.length} of ${totalCount.toLocaleString()} results`);
        if (!append) {
          appendHistory({ query: q, mode: "search", timestamp: Date.now(), resultCount: currentRepos.length });
        }
      }
    } catch (err) {
      currentRepos = [];
      resultsSelect.options = [{ name: " (error)", description: "", value: null }];
      const msg = err instanceof SearchCliError ? err.userMessage : (err instanceof Error ? err.message : String(err));
      statusMgr.set("error", msg.slice(0, 60));
    }

    isLoading = false;
    renderer.requestRender();
  }

  function changeSort() {
    const idx = SORT_MODES.findIndex((m) => m.key === currentSort);
    const next = SORT_MODES[(idx + 1) % SORT_MODES.length];
    currentSort = next.key;
    setToolbar();
    if (currentRepos.length > 0) {
      currentRepos = rankRepos(currentRepos, currentSort);
      resultsSelect.options = currentRepos.map((r) => ({
        name: formatResultLine(r),
        description: "",
        value: r,
      }));
      resultsSelect.setSelectedIndex(0);
      updateDetail(currentRepos[0]);
      renderer.requestRender();
    }
  }

  function changeLimit() {
    const limits = [10, 25, 50, 100];
    const idx = limits.indexOf(currentLimit);
    currentLimit = limits[(idx + 1) % limits.length];
    setToolbar();
    setStatus(`Limit set to ${currentLimit}. Press Enter to re-search.`);
    renderer.requestRender();
  }

  // ── Wire events ────────────────────────────────────────────────────

  // Enter in search input → search (resets to search mode)
  searchInput.on("enter", () => {
    showSearchMode();
    doSearch(searchInput.value);
  });

  // Navigate results → update detail pane
  resultsSelect.on("selectionChanged", () => {
    const opt = resultsSelect.getSelectedOption();
    const repo = opt?.value as Repo | undefined;
    if (repo) {
      if (graphFullscreen) loadChart(repo);
      else updateDetail(repo);
    }
    renderer.requestRender();
  });

  // Enter on a result → open URL
  resultsSelect.on("itemSelected", () => {
    const opt = resultsSelect.getSelectedOption();
    const repo = opt?.value as Repo | undefined;
    if (repo) openUrl(repo.url);
  });

  // ── Global keyboard shortcuts ──────────────────────────────────────
  renderer.keyInput.on("keypress", (key) => {
    // ── Overlay-mode handling ────────────────────────────────────────
    if (currentOverlay !== "none") {
      // Escape or q closes any overlay
      if (key.name === "escape" || key.name === "q") {
        showOverlay("none");
        renderer.requestRender();
        return;
      }

      // History overlay
      if (currentOverlay === "history") {
        if (key.ctrl && key.name === "d") {
          const sel = historySelect.getSelectedOption();
          if (sel?.value) {
            deleteHistoryEntry((sel.value as any).index);
            refreshHistory();
            setStatus("Deleted history entry");
          }
          renderer.requestRender();
          return;
        }
        if (key.ctrl && key.name === "x") {
          clearHistory();
          refreshHistory();
          setStatus("History cleared");
          renderer.requestRender();
          return;
        }
        // SelectRenderable handles ↑↓; Enter runs the search
        if (key.name === "enter" || key.name === "return") {
          const sel = historySelect.getSelectedOption();
          if (sel?.value) {
            const entry = (sel.value as any).entry;
            showOverlay("none");
            if (entry.mode === "trending") {
              if (entry.tab) trendingTab = entry.tab as typeof TAB_NAMES[number];
              loadTrending();
            } else {
              searchInput.value = entry.query;
              showSearchMode();
              doSearch(entry.query);
            }
          }
          return;
        }
        return; // all other keys ignored in history overlay
      }

      // Bookmarks overlay
      if (currentOverlay === "bookmarks") {
        if (key.name === "d") {
          const sel = bookmarksSelect.getSelectedOption();
          if (sel?.value) {
            removeBookmark((sel.value as any).repo.fullName);
            refreshBookmarks();
            setStatus("Bookmark removed");
          }
          renderer.requestRender();
          return;
        }
        if (key.name === "enter" || key.name === "return") {
          const sel = bookmarksSelect.getSelectedOption();
          if (sel?.value) openUrl((sel.value as any).repo.url);
          return;
        }
        return;
      }

      // Saved searches overlay
      if (currentOverlay === "saved") {
        if (key.name === "d") {
          const sel = savedSelect.getSelectedOption();
          if (sel?.value) {
            deleteSavedSearch((sel.value as any).name);
            refreshSavedSearches();
            setStatus("Saved search deleted");
          }
          renderer.requestRender();
          return;
        }
        if (key.name === "enter" || key.name === "return") {
          const sel = savedSelect.getSelectedOption();
          if (sel?.value) {
            const s = sel.value as any;
            showOverlay("none");
            touchSavedSearch(s.name);
            if (s.mode === "trending") {
              if (s.tab) trendingTab = s.tab as typeof TAB_NAMES[number];
              loadTrending();
            } else {
              searchInput.value = s.query;
              showSearchMode();
              currentSort = s.sort;
              currentLimit = s.limit;
              setToolbar();
              doSearch(s.query);
            }
          }
          return;
        }
        return;
      }

      // Topics explorer overlay
      if (currentOverlay === "topics") {
        if (key.name === "enter" || key.name === "return") {
          const sel = topicsSelect.getSelectedOption();
          if (sel?.value) {
            const topic = sel.value as any;
            showOverlay("none");
            searchInput.value = `topic:${topic.name}`;
            showSearchMode();
            doSearch(`topic:${topic.name}`);
          }
          return;
        }
        return;
      }

      // Export overlay
      if (currentOverlay === "export") {
        if (key.name === "enter" || key.name === "return") {
          const sel = exportSelect.getSelectedOption();
          if (sel?.value && currentRepos.length > 0) {
            const format = sel.value as ExportFormat;
            const path = exportToFile(currentRepos, format);
            showOverlay("none");
            setStatus(`✓ Exported to ${path}`);
          } else {
            setStatus("No results to export");
            showOverlay("none");
          }
          renderer.requestRender();
          return;
        }
        return;
      }

      // Compare overlay: Esc closes
      if (currentOverlay === "compare") {
        return;
      }

      // Notifications overlay
      if (currentOverlay === "notifications") {
        if (key.ctrl && key.name === "c") {
          dismissAll();
          refreshNotifications();
          renderer.requestRender();
          return;
        }
        if (key.name === "d") {
          const notifs = getNotifications();
          if (notifs.length > 0) {
            dismissNotification(notifs[0].id);
            refreshNotifications();
            setStatus("Notification dismissed");
          }
          renderer.requestRender();
          return;
        }
        return;
      }

      // Share overlay
      if (currentOverlay === "share") {
        if (key.name === "enter" || key.name === "return") {
          const sel = shareSelect.getSelectedOption();
          if (sel?.value) {
            const opt = resultsSelect.getSelectedOption();
            const repo = opt?.value as Repo | undefined;
            if (repo) {
              const text = formatShare(repo, sel.value as ShareFormat);
              copyToClipboard(text).then((ok) => {
                showOverlay("none");
                setStatus(ok ? "✓ Copied!" : "Clipboard not available");
              });
            }
          }
          renderer.requestRender();
          return;
        }
        return;
      }

      // Help overlay: any key closes
      if (currentOverlay === "help") {
        showOverlay("none");
        renderer.requestRender();
        return;
      }
    }

    // ── Main view handling (no overlay active) ────────────────────────

    // Always allow q to quit
    if (key.name === "q") {
      saveSession({ mode: currentMode, query: currentQueryInput, sort: currentSort, limit: currentLimit, trendingTab });
      cleanup();
      return;
    }

    // '?' / Ctrl+H toggle help overlay
    if (key.name === "?" || (key.name === "h" && key.ctrl)) {
      refreshHistory(); // refresh in background
      showOverlay("help");
      return;
    }

    // Ctrl+R — search history overlay
    if (key.ctrl && key.name === "r") {
      refreshHistory();
      showOverlay("history");
      return;
    }

    // Ctrl+S — save current search
    if (key.ctrl && key.name === "s") {
      if (currentQueryInput) {
        const name = currentQueryInput.length > 40
          ? currentQueryInput.slice(0, 37) + "..."
          : currentQueryInput;
        saveSearch(name, currentQueryInput, currentMode, currentSort, currentLimit, currentMode === "trending" ? trendingTab : undefined);
        setStatus(`✓ Saved as "${name}"`);
      } else {
        setStatus("No search to save");
      }
      renderer.requestRender();
      return;
    }

    // Ctrl+O — saved searches panel
    if (key.ctrl && key.name === "o") {
      refreshSavedSearches();
      showOverlay("saved");
      return;
    }

    // Ctrl+N — notifications panel
    if (key.ctrl && key.name === "n") {
      refreshNotifications();
      showOverlay("notifications");
      return;
    }

    // Ctrl+P — share repo
    if (key.ctrl && key.name === "p") {
      const opt = resultsSelect.getSelectedOption();
      const repo = opt?.value as Repo | undefined;
      if (!repo) {
        setStatus("No repo selected to share");
        renderer.requestRender();
        return;
      }
      showOverlay("share");
      return;
    }

    // 'b' — toggle bookmark on selected repo
    if (key.name === "b" && !key.shift) {
      const opt = resultsSelect.getSelectedOption();
      const repo = opt?.value as Repo | undefined;
      if (repo) {
        const added = toggleBookmark(repo);
        setStatus(added ? `Bookmarked ${repo.fullName}` : `Unbookmarked ${repo.fullName}`);
        renderer.requestRender();
      }
      return;
    }

    // 'B' (shift+b) — open bookmarks panel
    if (key.name === "b" && key.shift) {
      refreshBookmarks();
      showOverlay("bookmarks");
      return;
    }

    // Tab auto-completes qualifiers in search input
    if (key.name === "tab") {
      if (searchBox.visible) {
        const val = searchInput.value;
        const lastSpace = val.lastIndexOf(" ");
        const currentWord = lastSpace >= 0 ? val.slice(lastSpace + 1) : val;
        const suggestions = suggestFor(currentWord);
        if (suggestions.length > 0) {
          const newVal = lastSpace >= 0
            ? val.slice(0, lastSpace + 1) + suggestions[0]
            : suggestions[0];
          searchInput.value = newVal;
          renderer.requestRender();
        }
      }
      return;
    }

    // '/' focuses search, switches to search mode
    if (key.name === "/") {
      showSearchMode();
      return;
    }

    // ponytail: guard single-letter bindings behind !searchInput.focused
    // so typing a repo name containing t/g/r/s/l/o/d/c doesn't trigger actions
    if (!searchInput.focused) {

    if (key.name === "g") {
      toggleGraph();
      return;
    }

    if (key.name === "t") {
      if (currentMode === "trending") {
        showSearchMode();
      } else {
        loadTrending();
      }
      return;
    }

    // Number keys 1-5 switch trending tabs (only in trending mode)
    if (/^[1-5]$/.test(key.name)) {
      if (currentMode === "trending") {
        const idx = parseInt(key.name) - 1;
        if (idx >= 0 && idx < TAB_NAMES.length) {
          trendingTab = TAB_NAMES[idx];
          loadTrending();
        }
      }
      return;
    }

    if (key.name === "r") {
      if (currentMode === "trending") {
        loadTrending();
      } else {
        doSearch(searchInput.value || currentQueryInput);
      }
      return;
    }

    if (key.name === "s") {
      if (currentMode === "search") changeSort();
      return;
    }

    if (key.name === "l") {
      if (currentMode === "search") {
        changeLimit();
      } else if (currentMode === "trending") {
        const idx = TAB_NAMES.indexOf(trendingTab);
        if (idx < TAB_NAMES.length - 1) { trendingTab = TAB_NAMES[idx + 1]; loadTrending(); }
      }
      return;
    }

    if (key.name === "o") {
      const opt = resultsSelect.getSelectedOption();
      const repo = opt?.value as Repo | undefined;
      if (repo) openUrl(repo.url);
      return;
    }

    // Left/right/h arrows switch trending tabs
    if (key.name === "left" || key.name === "h") {
      if (currentMode === "trending") {
        const idx = TAB_NAMES.indexOf(trendingTab);
        if (idx > 0) { trendingTab = TAB_NAMES[idx - 1]; loadTrending(); }
      }
      return;
    }

    // ── P2: Power Tool keys ───────────────────────────────────────────

    // 'd' — toggle deep-dive on selected repo
    if (key.name === "d") {
      const opt = resultsSelect.getSelectedOption();
      const repo = opt?.value as Repo | undefined;
      if (!repo) return;
      deepDiveActive = !deepDiveActive;
      if (deepDiveActive) {
        detailText.content = "  Loading deep-dive...";
        renderer.requestRender();
        fetchDeepDive(repo, githubToken)
          .then((data) => {
            detailText.content = buildDeepDiveText(data);
            renderer.requestRender();
          })
          .catch(() => {
            detailText.content = "  Failed to load deep-dive";
            renderer.requestRender();
          });
      } else {
        updateDetail(repo);
        renderer.requestRender();
      }
      return;
    }

    // 'c' — toggle compare list for selected repo
    if (key.name === "c" && !key.shift) {
      const opt = resultsSelect.getSelectedOption();
      const repo = opt?.value as Repo | undefined;
      if (!repo) return;
      const idx = compareList.findIndex((r) => r.fullName === repo.fullName);
      if (idx >= 0) {
        compareList.splice(idx, 1);
        setStatus(`Removed ${repo.fullName} from comparison`);
      } else {
        compareList.push(repo);
        setStatus(`${repo.fullName} added to comparison (${compareList.length} selected)`);
      }
      renderer.requestRender();
      return;
    }

    // 'C' (Shift+c) — show comparison view
    if (key.name === "c" && key.shift) {
      refreshCompare();
      showOverlay("compare");
      return;
    }

    // 'E' (Shift+e) — topic explorer
    if (key.name === "e" && key.shift) {
      refreshTopics();
      showOverlay("topics");
      return;
    }

    } 

    // Ctrl+E — export
    if (key.ctrl && key.name === "e") {
      showOverlay("export");
      return;
    }

    // PageDown / Ctrl+F — next page
    if (key.name === "pagedown" || (key.ctrl && key.name === "f")) {
      if (currentMode === "search" && currentQueryInput) {
        currentPage++;
        doSearch(currentQueryInput, true);
      }
      return;
    }

    // PageUp / Ctrl+B — scroll to top of results
    if (key.name === "pageup" || (key.ctrl && key.name === "b")) {
      if (currentRepos.length > 0) {
        resultsSelect.setSelectedIndex(0);
        updateDetail(currentRepos[0]);
        renderer.requestRender();
      }
      return;
    }
  });

  // ── Start ──────────────────────────────────────────────────────────
  renderer.start();
  if (currentMode === "trending") {
    loadTrending();
  } else {
    searchInput.value = currentQueryInput;
    searchInput.focus();
    if (currentQueryInput) doSearch(currentQueryInput);
  }
  renderer.requestRender();
}

// ── Utilities ─────────────────────────────────────────────────────────

function formatResultLine(repo: Repo): string {
  const stars = formatStars(repo.stars);
  const lang = (repo.language ?? "?").padEnd(12).slice(0, 12);
  return `${repo.fullName}  ${stars}`;
}

function formatStars(n: number): string {
  if (n >= 1000) return `★ ${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `★ ${n}`;
}

function formatToolbar(sort: SortStrategy, limit: number): string {
  const sortLabel = SORT_MODES.find((m) => m.key === sort)?.label ?? sort;
  return ` sort: ${sortLabel}   limit: ${limit}   (s=cycle sort  l=cycle limit)`;
}

function openUrl(url: string): void {
  try {
    const p = process.platform;
    if (p === "win32") Bun.spawn(["cmd", "/c", "start", "", url]);
    else if (p === "darwin") Bun.spawn(["open", url]);
    else Bun.spawn(["xdg-open", url]);
  } catch {
    // non-critical
  }
}

function cleanup(): void {
  process.exit(0);
}

// ── Auto-run ──────────────────────────────────────────────────────────
if (import.meta.main) {
  launchBrowser();
}
