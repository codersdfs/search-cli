#!/usr/bin/env node
/**
 * ghfind — interactive GitHub repository browser (OpenTUI)
 *
 * Full-screen, keyboard-driven browser. This is the only entry point.
 * Pipeline: user query → provider → normalizer → ranking → rendered in TUI
 *
 * Layout:
 *   ┌─ ghfind  [s]sort  [l]limit  [r]refresh  [q]uit ────────────────┐
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
  ScrollBoxRenderable,
} from "@opentui/core";
import type { Repo, SearchOptions, SortStrategy } from "./types";
import {
  parseQuery,
  applyFlagFilters,
  validateQuery,
  suggestFor,
  rankRepos,
  createGitHubSearch,
  SearchModule,
  TrendingAdapter,
  type Logger,
} from "./search";
import {
  tabSince,
  TAB_NAMES,
  fmtStars,
} from "./trending";
import { loadConfig, saveConfig } from "./config";
import { buildHelpSections, HELP_KEYS_COLUMN } from "./help";
import {
  SearchCliError,
  NetworkError,
  RateLimitError,
  BadQueryError,
  NoResultsError,
} from "./errors";
import {
  appendHistory,
  readHistory,
  deleteHistoryEntry,
  clearHistory,
  rotateHistory,
} from "./history";
import {
  getBookmarks,
  isBookmarked,
  toggleBookmark,
  removeBookmark,
} from "./bookmarks";
import {
  getSavedSearches,
  saveSearch,
  deleteSavedSearch,
  touchSavedSearch,
} from "./saved-searches";
import { saveSession, restoreSession } from "./session";
import { fetchDeepDive, buildDeepDiveText } from "./deepdive";
import { buildComparisonTable } from "./compare";
import { fetchTopics, type TopicItem } from "./explore";
import { exportToFile, type ExportFormat } from "./output";
import { listThemes, loadTheme } from "./themes";
import {
  createPackageSearch,
  sortPackages,
  PACKAGE_SORT_MODES,
  type Package,
  type PackageSortMode,
} from "./package";
import { StatusManager } from "./status";
import {
  getNotifications,
  dismissNotification,
  dismissAll,
} from "./notifications";
import { formatShare, copyToClipboard, type ShareFormat } from "./share";
import { nextTip } from "./tips";
import { openUrl } from "./open-url";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");

let cachedVersion: string | null = null;
import {
  checkForUpdate,
  shouldCheckUpdate,
  markUpdateChecked,
  snoozeUpdateNotices,
  suppressUpdateNotices,
  performUpdate,
} from "./update-check";
import { debugLog } from "./storage";
const colors = {
  bg: "#3D3B3B",
  surface: "#4a4848",
  surfaceAlt: "#525050",
  text: "#e0e4f0",
  muted: "#a8a6a6",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  red: "#f38ba8",
  teal: "#94e2d5",
  purple: "#cba6f7",
  orange: "#fab387",
  border: "#1C1C1C",
  borderAlt: "#2a2a2a",
  separator: "#1C1C1C",  // Dark thin colorblock - thicker than border, visible separation
  selectionBg: "#2A2A9C",
  selectionText: "#ffffff",
  // Premium accents for the command menu
  accent: "#89b4fa",
  accentDim: "#587cf5",
  surfaceDim: "#1a1919",
  borderAccent: "#1a1919",
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
export async function launchBrowser(theme_override?: string): Promise<void> {
  let renderer;
  try {
    const isTTY = process.stdout.isTTY && process.stdin.isTTY;
    if (isTTY) {
      renderer = await createCliRenderer();
    } else {
      renderer = await createCliRenderer({
        width: 80,
        height: 24,
        screenMode: "main-screen",
        autoFocus: false,
      });
    }
  } catch (err) {
    const isNode = process.versions.bun === undefined;
    if (isNode) {
      console.error("\n❌  The interactive TUI requires Bun runtime.\n");
      console.error("  Install Bun:  curl -fsSL https://bun.sh/install | bash");
      console.error("  Then run:    bunx ghfind");
      console.error("\n  Or use non-interactive mode (works on Node.js):");
      console.error("  ghfind \"language:Rust\" --json | jq '.[].fullName'");
      console.error("  ghfind --trending --count");
    } else {
      console.error(
        "Failed to start the interactive browser. OpenTUI native backend unavailable.\n",
        `Reason: ${err instanceof Error ? err.message : String(err)}\n`,
        "Install Zig or use a platform with native OpenTUI support.",
      );
    }
    process.exit(1);
    return;
  }

  const root = renderer.root;
  root.flexDirection = "column";
  root.border = true;
  root.borderTop = true;
  root.borderBottom = true;
  root.borderLeft = true;
  root.borderRight = true;
  root.borderColor = colors.borderAccent;
  root.backgroundColor = colors.bg;

  // ── Config ──
  const config = loadConfig();
  const githubToken = config.githubToken || process.env.GITHUB_TOKEN;

  // Apply theme
  const theme = loadTheme(theme_override || config.theme);
  Object.assign(colors, theme);

  // ── Session restore ──
  const session = restoreSession();

  // ── State ───────────────────────────────────────────────────────────
  let currentRepos: Repo[] = [];
  let currentSort: SortStrategy = session?.sort ?? config.defaultSort;
  let currentLimit = session?.limit ?? config.defaultLimit;
  let currentQueryInput = session?.query ?? "";
  let isLoading = false;
  let currentMode: "landing" | "search" | "trending" | "packages" = session?.mode ?? "search";
  let packages: Package[] = [];
  let currentPackageSort: PackageSortMode = "best-match";
  let packageResultsRaw: Package[] = [];
  let trendingTab: (typeof TAB_NAMES)[number] =
    (session?.trendingTab as (typeof TAB_NAMES)[number]) ?? "This Week";
  let trendingPeriod = "this week";
  let graphFullscreen = false;
  let chartCommitData: number[] = [];
  let currentOverlay:
    | "none"
    | "history"
    | "bookmarks"
    | "saved"
    | "help"
    | "topics"
    | "export"
    | "compare"
    | "notifications"
    | "share"
    | "leader"
    | "readme"
    | "update"
    | "landing" = "none";
  let currentPage = 1;
  let totalCount = 0;
  let deepDiveActive = false;
  let compareList: Repo[] = [];
  let quitArmed = false;

  const header = new TextRenderable(renderer, {
    content:
      " ghfind — GitHub repo browser   [/]search  [Space]menu  [\u2192]open  [?]help  [q]uit",
    backgroundColor: colors.bg,
    color: colors.muted,
    height: 1,
    borderBottom: true,
    borderBottomColor: colors.border,
  });

  // ── Trending tab bar (hidden in search mode) ────────────────────────
  const trendingTabBox = new BoxRenderable(renderer, {
    flexDirection: "row",
    height: 1,
    backgroundColor: colors.surface,
    // No border — pure contract-edge separation via text contrast
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
  root.add(header);
  root.add(trendingTabBox);
  // ── Gap between header/tabs and search ────────────────────────────────
  const gapBox = new BoxRenderable(renderer, {
    height: 1,
    visible: true,
  });
  root.add(gapBox);

  // ── Search input row ────────────────────────────────────────────────
  const searchBox = new BoxRenderable(renderer, {
    visible: true,
    bordered: true,
    borderColor: colors.border,
    title: "",
    titleColor: colors.blue,
    width: "100%",
    flexDirection: "row",
    marginTop: 1,
    backgroundColor: colors.surface,
  });
  const searchInput = new InputRenderable(renderer, {
    placeholder:
      "Search GitHub repos (e.g. rust cli, or language:Rust stars:>100)",
    value: "",
    backgroundColor: colors.surface,
    textColor: colors.text,
    borderColor: colors.blue,
    selectedBorderColor: colors.blue,
    paddingX: 0,
    flexGrow: 1,
  });
  searchBox.add(searchInput);
  root.add(searchBox);

  // ── Toolbar (sort + limit indicator) ────────────────────────────────
  const toolbarText = new TextRenderable(renderer, {
    content: formatToolbar(currentSort, currentLimit, totalCount),
    visible: true, // hidden in trending mode
    backgroundColor: colors.surface,                  // Surface panel
    color: colors.muted,
    height: 1,
    borderBottom: true,
    borderBottomColor: colors.border,
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
    bordered: true,
    borderColor: colors.border,
    borderBottomColor: colors.border,
    title: " Results ",
    titleColor: colors.blue,
    width: "50%",
    flexDirection: "column",
    paddingLeft: 0,
    focusable: false,
  });
  const resultsSelect = new SelectRenderable(renderer, {
    options: [
      {
        name: "",
        description: "Type a query and press Enter to search",
        value: null,
      },
    ],
    showDescription: false,
    showSelectionIndicator: false,
    flexGrow: 1,
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
    bordered: true,
    borderColor: colors.border,
    borderBottomColor: colors.border,
    title: " Details ",
    titleColor: colors.green,
    width: "50%",
    flexDirection: "column",
    paddingX: 1,
    paddingY: 1,
    focusable: false,
    backgroundColor: colors.surface,
  });
  const detailText = new TextRenderable(renderer, {
    content: "",
    color: colors.text,
    wrapMode: "none",
  });
  detailBox.add(detailText);

  body.add(resultsBox);
  body.add(detailBox);
  root.add(body);
  // ── Landing screen ────────────────────────────────────────────────
  const landingBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  });
  root.add(landingBox);
  const landingBanner = new TextRenderable(renderer, {
    content: [
      " ██████╗ ██╗  ██╗███████╗██╗███╗   ██╗██████╗ ",
      "██╔════╝ ██║  ██║██╔════╝██║████╗  ██║██╔══██╗",
      "██║  ███╗███████║█████╗  ██║██╔██╗ ██║██║  ██║",
      "██║   ██║██╔══██║██╔══╝  ██║██║╚██╗██║██║  ██║",
      "╚██████╔╝██║  ██║██║     ██║██║ ╚████║██████╔",
      " ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═══╝╚═════╝",
    ].join("\n"),
    color: colors.accent,
    backgroundColor: colors.bg,
    height: 6,
  });
  landingBox.add(landingBanner);
  // Three option cards
  const landingOptions = [
    {
      icon: "\u{1F50D}",
      title: "Repo Search",
      desc: "Search GitHub repositories by query, language, stars, and more",
      action: () => { currentMode = "search"; showLanding(false); showSearchMode(); },
    },
    {
      icon: "\u{1F4E6}",
      title: "Package Search",
      desc: "Search npm packages by name, description, or tags",
      action: () => { currentMode = "packages"; showLanding(false); showPackagesMode(); },
    },
    {
      icon: "\u{1F525}",
      title: "Trending",
      desc: "Browse the hottest repos on GitHub right now",
      action: () => { currentMode = "trending"; showLanding(false); loadTrending(); },
    },
  ];
  let landingSelected = 0;

  const landingCards: BoxRenderable[] = [];
  for (let i = 0; i < landingOptions.length; i++) {
    const opt = landingOptions[i];
    const card = new BoxRenderable(renderer, {
      flexDirection: "column",
      height: 5,
      width: "60%",
      marginTop: 1,
      border: true,
      borderColor: i === 0 ? colors.accent : colors.border,
      paddingX: 1,
      focusable: false,
    });
    landingCards.push(card);
    landingBox.add(card);

    const spacerTop = new TextRenderable(renderer, { content: "", height: 1 });
    const titleLine = new TextRenderable(renderer, {
      content: opt.title,
      color: i === 0 ? colors.accent : colors.text,
      height: 1,
    });
    const spacerBot = new TextRenderable(renderer, { content: "", height: 1 });
    card.add(spacerTop);
    card.add(titleLine);
    card.add(spacerBot);
  }

  const landingHint = new TextRenderable(renderer, {
    content: "   \u2191\u2193 Navigate  \u21E9 Select  [?]help  [q]uit",
    color: colors.muted,
    backgroundColor: colors.bg,
    height: 1,
    marginTop: 1,
  });
  landingBox.add(landingHint);

  function showLanding(visible: boolean) {
    landingBox.visible = visible;
    if (visible) {
      currentMode = "landing";
      hideMainContent();
      landingSelected = 0;
      updateLandingCards();
      renderer.requestRender();
    }
  }

  function updateLandingCards() {
    for (let i = 0; i < landingCards.length; i++) {
      const isSel = i === landingSelected;
      landingCards[i].borderColor = isSel ? colors.accent : colors.border;
      const children = landingCards[i].children ?? [];
      const titleChild = children[1] as TextRenderable;
      if (titleChild) {
        titleChild.color = isSel ? colors.accent : colors.text;
      }
    }
  }

  // Landing keyboard handler
  renderer.keyInput.on("keypress", (key) => {
    if (currentMode === "landing") {
      if (key.name === "up" || key.name === "k") {
        landingSelected = Math.max(0, landingSelected - 1);
        updateLandingCards();
        renderer.requestRender();
      } else if (key.name === "down" || key.name === "j") {
        landingSelected = Math.min(landingOptions.length - 1, landingSelected + 1);
        updateLandingCards();
        renderer.requestRender();
      } else if (key.name === "enter" || key.name === "return") {
        landingOptions[landingSelected].action();
      } else if (key.name === "?" || key.name === "h") {
        showOverlay(currentOverlay === "help" ? "none" : "help");
      } else if (key.name === "q") {
        cleanup();
      }
      return;
    }
  });

  // Hide main content so overlays can take 100% of the content area
  function hideMainContent() {
    trendingTabBox.visible = false;
    gapBox.visible = false;
    searchBox.visible = false;
    toolbarText.visible = false;
    body.visible = false;
  }

  function showMainContent() {
    if (currentMode === "trending") {
      trendingTabBox.visible = true;
    } else {
      searchBox.visible = true;
      gapBox.visible = true;
      toolbarText.visible = true;
    }
    body.visible = true;
  }

  function showOverlay(type: typeof currentOverlay) {
    helpBox.visible = false;
    historyBox.visible = false;
    bookmarksBox.visible = false;
    savedBox.visible = false;
    topicsBox.visible = false;
    exportBox.visible = false;
    compareBox.visible = false;
    notifsBox.visible = false;
    shareBox.visible = false;
    leaderBox.visible = false;
    leaderDim.visible = false;
    readmeBox.visible = false;
    updateBox.visible = false;
    updateDim.visible = false;
    if (type === "none") {
      currentOverlay = "none";
      if (currentMode === "landing") {
        landingBox.visible = true;
        body.visible = false;
        trendingTabBox.visible = false;
        gapBox.visible = false;
        searchBox.visible = false;
        toolbarText.visible = false;
      } else {
        showMainContent();
      }
      renderer.requestRender();
      return;
    }
    currentOverlay = type;
    // Leader menu is a floating overlay — main content stays visible behind it
    if (type !== "leader") {
      hideMainContent();
    }
    if (type === "help") {
      helpBox.visible = true;
    } else if (type === "history") {
      historyBox.visible = true;
    } else if (type === "bookmarks") {
      bookmarksBox.visible = true;
    } else if (type === "saved") {
      savedBox.visible = true;
    } else if (type === "topics") {
      topicsBox.visible = true;
    } else if (type === "export") {
      exportBox.visible = true;
    } else if (type === "compare") {
      compareBox.visible = true;
    } else if (type === "notifications") {
      notifsBox.visible = true;
    } else if (type === "share") {
      shareBox.visible = true;
    } else if (type === "leader") {
      leaderDim.visible = true;
      leaderBox.visible = true;
    } else if (type === "readme") {
      readmeBox.visible = true;
    } else if (type === "update") {
      updateDim.visible = true;
      updateBox.visible = true;
      updateSelect.focus();
    }
    renderer.requestRender();
  }

  // ── Help overlay (OpenTUI components) ────────────────────────
  const helpSections = buildHelpSections();
  const helpBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    borderBottom: true,
    borderBottomColor: colors.border,
  });
  const helpScroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    backgroundColor: colors.bg,
    scrollY: true,
    scrollX: false,
    paddingX: 0,
    viewportOptions: { backgroundColor: colors.bg },
    contentOptions: { backgroundColor: colors.bg, flexDirection: "column" },
    scrollbarOptions: {
      backgroundColor: colors.bg,
      foregroundColor: colors.muted,
      width: 1,
    },
  });
  for (const section of helpSections) {
    const sectionBox = new BoxRenderable(renderer, {
      borderBottom: true,
      borderBottomColor: colors.border,
      title: section.title,
      titleColor:
        (colors as Record<string, string>)[section.titleColor] ??
        section.titleColor,
      flexDirection: "column",
      paddingY: 0,
      marginLeft: 1,
      marginRight: 1,
      marginTop: 1,
    });
    for (const row of section.rows) {
      const keys = row.keys.padEnd(HELP_KEYS_COLUMN);
      sectionBox.add(
        new TextRenderable(renderer, {
          content: `  ${keys} ${row.action}`,
          color: colors.text,
        }),
      );
    }
    if (section.note) {
      sectionBox.add(
        new TextRenderable(renderer, {
          content: `  ${section.note}`,
          color: colors.muted,
        }),
      );
    }
    helpScroll.add(sectionBox);
  }
  helpBox.add(helpScroll);
  root.add(helpBox);

  // ── History overlay ─────────────────────────────────────────
  const historyBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    borderBottom: true,
    borderBottomColor: colors.border,
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
      historySelect.options = [
        { name: "(no history)", description: "", value: null },
      ];
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
    borderBottom: true,
    borderBottomColor: colors.border,
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
      bookmarksSelect.options = [
        { name: "(no bookmarks)", description: "", value: null },
      ];
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
    borderBottom: true,
    borderBottomColor: colors.border,
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
    borderBottom: true,
    borderBottomColor: colors.border,
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
      topicsSelect.options = [
        { name: "(failed to load topics)", description: "", value: null },
      ];
    }
    topicsSelect.setSelectedIndex(0);
  }

  // ── Export overlay ───────────────────────────────────────────
  const exportBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    borderBottom: true,
    borderBottomColor: colors.border,
    title: " Export ",
    titleColor: colors.green,
  });
  const exportSelect = new SelectRenderable(renderer, {
    options: [
      {
        name: "  JSON",
        description: "Full repo data as JSON array",
        value: "json",
      },
      {
        name: "  CSV",
        description: "Rank, name, stars, forks, language, URL",
        value: "csv",
      },
      {
        name: "  Markdown",
        description: "Pretty table with links (paste into README)",
        value: "markdown",
      },
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
    borderBottom: true,
    borderBottomColor: colors.border,
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
    borderBottom: true,
    borderBottomColor: colors.border,
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
    borderBottom: true,
    borderBottomColor: colors.border,
    title: " Share Repo ",
    titleColor: colors.blue,
  });
  const shareSelect = new SelectRenderable(renderer, {
    options: [
      {
        name: "  Markdown",
        description: "[owner/repo](url) — description",
        value: "markdown",
      },
      {
        name: "  Plain",
        description: "owner/repo — description — url",
        value: "plain",
      },
      {
        name: "  GitHub CLI",
        description: "gh repo view owner/repo",
        value: "gh-cli",
      },
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
      compareText.content =
        "Select at least 2 repos to compare (press c to add).";
    } else {
      compareText.content = buildComparisonTable(compareList);
    }
  }

  function refreshSavedSearches() {
    const saved = getSavedSearches();
    if (saved.length === 0) {
      savedSelect.options = [
        { name: "(no saved searches)", description: "", value: null },
      ];
    } else {
      savedSelect.options = saved.map((s) => ({
        name: `${s.name}`,
        description: `${s.query}  (${s.mode})`,
        value: s,
      }));
    }
    savedSelect.setSelectedIndex(0);
  }

  // ── Leader menu overlay (Space key) ─────────────────────────────
  // Dim overlay — sits behind the menu, above main content
  const leaderDim = new BoxRenderable(renderer, {
    visible: false,
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundColor: "#00000099", // 60% opacity black (hex alpha: 0x99 ≈ 153/255)
  });
  root.add(leaderDim);

  const leaderBox = new BoxRenderable(renderer, {
    visible: false,
    position: "absolute",
    width: "80%",
    height: 18,
    left: "10%",
    top: "30%",
    backgroundColor: colors.surfaceDim,
    border: true,
    borderStyle: "rounded",
    borderColor: colors.borderAccent,
    title: " ⚙ Menu ",
    titleColor: colors.accent,
    titleAlignment: "left",
    flexDirection: "column",
    paddingX: 1,
  });
  const leaderSelect = new SelectRenderable(renderer, {
    options: [{ name: "(empty)", description: "", value: null }],
    showDescription: true,
    showSelectionIndicator: true,
    flexGrow: 1,
    backgroundColor: colors.surfaceDim,
    textColor: colors.text,
    focusedBackgroundColor: colors.surfaceDim,
    focusedTextColor: colors.text,
    selectedBackgroundColor: colors.accent,
    selectedTextColor: colors.selectionText,
    descriptionColor: colors.muted,
    selectedDescriptionColor: colors.selectionText,
    itemSpacing: 0,
  });
  const leaderFooter = new TextRenderable(renderer, {
    content: " ↑↓ select   Enter run   Esc/q close ",
    color: colors.muted,
    backgroundColor: colors.surfaceDim,
    height: 1,
    borderTop: true,
    borderTopColor: colors.border,
    paddingX: 2,
  });
  leaderBox.add(leaderSelect);
  leaderBox.add(leaderFooter);
  root.add(leaderDim);
  root.add(leaderBox);

  // ── Update panel overlay ────────────────────────────────────────
  const updateDim = new BoxRenderable(renderer, {
    visible: false,
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundColor: "#00000088",
  });

  root.add(updateDim);

  const updateBox = new BoxRenderable(renderer, {
    visible: false,
    position: "absolute",
    width: "55%",
    height: 16,
    left: "22.5%",
    top: "25%",
    backgroundColor: colors.surfaceDim,
    border: true,
    borderStyle: "rounded",
    borderColor: colors.border,
    title: " ghfind ",
    titleColor: colors.accent,
    titleAlignment: "left",
    flexDirection: "column",
    paddingX: 2,
    paddingLeft: 2,
    paddingRight: 2,
  });
  const updateText = new TextRenderable(renderer, {
    content: "",
    color: colors.accent,
    backgroundColor: colors.surfaceDim,
  });

  // Horizontal option boxes
  let updateSelectedOption = 0;

  const updateOptionsRow = new BoxRenderable(renderer, {
    flexDirection: "row",
    gap: 1,
    backgroundColor: colors.surfaceDim,
    height: 3,
    width: "100%",
  });

  const updateNowBox = new BoxRenderable(renderer, {
    border: true,
    borderColor: updateSelectedOption === 0 ? colors.yellow : colors.border,
    backgroundColor: colors.surfaceDim,
    height: 3,
    width: "50%",
    paddingLeft: 1,
    paddingRight: 1,
  });
  const updateNowText = new TextRenderable(renderer, {
    content: "   Update Now  ",
    color: updateSelectedOption === 0 ? colors.yellow : colors.text,
    backgroundColor: colors.surfaceDim,
  });
  updateNowBox.add(updateNowText);

  const laterBox = new BoxRenderable(renderer, {
    border: true,
    borderColor: updateSelectedOption === 1 ? colors.yellow : colors.border,
    backgroundColor: colors.surfaceDim,
    height: 3,
    width: "50%",
    paddingLeft: 1,
    paddingRight: 1,
  });
  const laterText = new TextRenderable(renderer, {
    content: "  Later",
    color: updateSelectedOption === 1 ? colors.yellow : colors.text,
    backgroundColor: colors.surfaceDim,
  });
  laterBox.add(laterText);

  const neverBox = new BoxRenderable(renderer, {
    border: true,
    borderColor: updateSelectedOption === 2 ? colors.yellow : colors.border,
    backgroundColor: colors.surfaceDim,
    height: 3,
    width: "50%",
    paddingLeft: 1,
    paddingRight: 1,
  });
  const neverText = new TextRenderable(renderer, {
    content: "  Don't show again",
    color: updateSelectedOption === 2 ? colors.yellow : colors.text,
    backgroundColor: colors.surfaceDim,
  });
  neverBox.add(neverText);

  function renderUpdateOptions() {
    updateNowBox.borderColor = updateSelectedOption === 0 ? colors.yellow : colors.border;
    laterBox.borderColor = updateSelectedOption === 1 ? colors.yellow : colors.border;
    neverBox.borderColor = updateSelectedOption === 2 ? colors.yellow : colors.border;
    updateNowText.color = updateSelectedOption === 0 ? colors.yellow : colors.text;
    laterText.color = updateSelectedOption === 1 ? colors.yellow : colors.text;
    neverText.color = updateSelectedOption === 2 ? colors.yellow : colors.text;
    renderer.requestRender();
  }

  updateOptionsRow.add(updateNowBox);
  updateOptionsRow.add(laterBox);

  const updateFooter = new TextRenderable(renderer, {
    content: "  ←→ select  Enter  Esc/q close",
    color: colors.muted,
    backgroundColor: colors.surfaceDim,
    height: 1,
    paddingX: 1,
  });
  updateBox.add(updateText);
  updateBox.add(updateOptionsRow);
  updateBox.add(updateFooter);
  root.add(updateDim);
  root.add(updateBox);

  // ── Hierarchical menu types ──────────────────────────────────────
  interface MenuAction {
    type: "action";
    name: string;
    description: string;
    action: () => void;
  }

  interface MenuCategory {
    type: "category";
    name: string;
    description: string;
    icon: string;
    children: MenuEntry[];
  }

  type MenuEntry = MenuAction | MenuCategory;

  // ── Submenu navigation ──────────────────────────────────────────
  interface MenuLevel {
    title: string;
    parentTitle: string;
    entries: MenuEntry[];
    selectedIndex: number;
  }

  const menuStack: MenuLevel[] = [];

  function pushMenuLevel(
    title: string,
    parentTitle: string,
    entries: MenuEntry[],
    selectIndex = 0,
  ) {
    menuStack.push({
      title,
      parentTitle,
      entries,
      selectedIndex: leaderSelect.getSelectedIndex?.(),
    });
    leaderSelect.options = entries.map((e) => ({
      name:
        e.type === "category" ? `  ${e.icon} ${e.name} \u2192` : `  ${e.name}`,
      description: e.description,
      value: e,
    }));
    leaderSelect.setSelectedIndex(selectIndex);
    leaderBox.title = title;
    const isTop = menuStack.length === 1;
    leaderFooter.content = isTop
      ? "  \u2191\u2193 select  \u2192 open category  Enter run  Esc/q close"
      : "  Esc back  \u2191\u2193 select  Enter run";
  }

  function popMenuLevel(): boolean {
    if (menuStack.length <= 1) return false;
    const prev = menuStack[menuStack.length - 2];
    const current = menuStack.pop()!;
    leaderSelect.options = prev.entries.map((e) => ({
      name:
        e.type === "category" ? `  ${e.icon} ${e.name} \u2192` : `  ${e.name}`,
      description: e.description,
      value: e,
    }));
    leaderSelect.setSelectedIndex(current.selectedIndex);
    leaderBox.title = prev.title;
    const isTop = menuStack.length === 1;
    leaderFooter.content = isTop
      ? "  \u2191\u2193 select  \u2192 open category  Enter run  Esc/q close"
      : "  Esc back  \u2191\u2193 select  Enter run";
    return true;
  }

  function resetMenu() {
    menuStack.length = 0;
  }

  // ── Build hierarchical menu ─────────────────────────────────────
  function buildMenuHierarchy(): MenuCategory[] {
    const hasRepo = (() => {
      const opt = resultsSelect.getSelectedOption();
      return opt?.value && typeof (opt.value as any)?.fullName === "string";
    })();

    const groups: MenuCategory[] = [];

    // Search group
    const searchItems: MenuEntry[] = [];
    if (currentMode === "search") {
      searchItems.push(
        {
          type: "action",
          name: "Sort",
          description: `Cycle sort (current: ${currentSort})`,
          action: () => changeSort(),
        },
        {
          type: "action",
          name: "Limit",
          description: `Cycle result limit (current: ${currentLimit})`,
          action: () => changeLimit(),
        },
        {
          type: "action",
          name: "Refresh",
          description: "Re-run current search",
          action: () => {
            if (currentQueryInput) doSearch(currentQueryInput);
          },
        },
        {
          type: "action",
          name: "Save search",
          description: "Save current query as a named search",
          action: () => saveCurrentSearch(),
        },
        {
          type: "action",
          name: "Saved searches",
          description: "Load a saved search",
          action: () => {
            refreshSavedSearches();
            showOverlay("saved");
          },
        },
      );
    } else if (currentMode === "packages") {
      searchItems.push(
        {
          type: "action",
          name: "Sort",
          description: `Cycle package sort (current: ${currentPackageSort})`,
          action: () => changePackageSort(),
        },
        {
          type: "action",
          name: "Limit",
          description: `Cycle result limit (current: ${currentLimit})`,
          action: () => changeLimit(),
        },
        {
          type: "action",
          name: "Refresh",
          description: "Re-run current package search",
          action: () => {
            if (currentQueryInput) doPackageSearch(currentQueryInput);
          },
        },
      );
    }
    if (searchItems.length > 0) {
      groups.push({
        type: "category",
        name: "Search",
        description: "Sort, limit, refresh, save searches",
        icon: "\uD83D\uDD0D",
        children: searchItems,
      });
    }

    //  Repo group
    const repoItems: MenuEntry[] = [];
    if (hasRepo) {
      repoItems.push(
        {
          type: "action",
          name: "Open in browser",
          description: "Open selected repo in browser",
          action: () => openUrlIfSelected(),
        },
        {
          type: "action",
          name: "Readme",
          description: "Full README viewer",
          action: () => {
            showReadme();
          },
        },
        {
          type: "action",
          name: "Activity graph",
          description: "Toggle commit chart fullscreen",
          action: () => toggleGraph(),
        },
      );
      if (currentMode === "search") {
        repoItems.push({
          type: "action",
          name: "Deep-dive",
          description: "Languages, contributors, README excerpt",
          action: () => {
            showOverlay("none");
            triggerDeepDive();
          },
        });
      }
      repoItems.push(
        {
          type: "action",
          name: "Bookmark",
          description: "Save / unsave selected repo",
          action: () => toggleBookmarkOnSelected(),
        },
        {
          type: "action",
          name: "Compare",
          description: "Add/remove repo to comparison",
          action: () => toggleCompareOnSelected(),
        },
        {
          type: "action",
          name: "Share",
          description: "Copy repo link to clipboard",
          action: () => showShareIfRepo(),
        },
      );
    }
    if (repoItems.length > 0) {
      groups.push({
        type: "category",
        name: "Repo",
        description: "Open, readme, bookmark, share, compare",
        icon: "\uD83D\uDCCB",
        children: repoItems,
      });
    }

    //  Navigate group
    const navItems: MenuEntry[] = [];
    navItems.push({
        type: "action",
        name: "Packages",
        description: "Search npm packages",
        action: () => {
          showOverlay("none");
          showPackagesMode();
        },
      });
    if (currentMode === "search") {
      navItems.push({
        type: "action",
        name: "Trending",
        description: "Browse GitHub trending repos",
        action: () => loadTrending(),
      });
    } else {
      navItems.push({
        type: "action",
        name: "Search mode",
        description: "Switch to query search",
        action: () => showSearchMode(),
      });
    }
    navItems.push(
      {
        type: "action",
        name: "History",
        description: "Search history",
        action: () => {
          refreshHistory();
          showOverlay("history");
        },
      },
      {
        type: "action",
        name: "Bookmarks",
        description: "Browse saved repos",
        action: () => {
          refreshBookmarks();
          showOverlay("bookmarks");
        },
      },
      {
        type: "action",
        name: "Topics",
        description: "Browse popular GitHub topics",
        action: () => {
          refreshTopics();
          showOverlay("topics");
        },
      },
      {
        type: "action",
        name: "Export",
        description: "Export results to JSON/CSV/Markdown",
        action: () => showOverlay("export"),
      },
    );
    groups.push({
      type: "category",
      name: "Navigate",
      description: "Trending, history, bookmarks, topics, export",
      icon: "\uD83E\uDDED",
      children: navItems,
    });

    // ⚙️ System group
    const sysItems: MenuEntry[] = [
      {
        type: "action",
        name: "Check for updates",
        description: "Check npm for a newer version (debug)",
        action: () => {
          showOverlay("none");
          checkForUpdateAndShow(true);
        },
      },
      {
        type: "action",
        name: "Help",
        description: "Keybindings reference",
        action: () => showOverlay("help"),
      },
      {
        type: "action",
        name: "Notifications",
        description: "View alerts",
        action: () => {
          refreshNotifications();
          showOverlay("notifications");
        },
      },
      {
        type: "action",
        name: "Compare view",
        description: "Show side-by-side comparison",
        action: () => {
          refreshCompare();
          showOverlay("compare");
        },
      },
      {
        type: "action",
        name: "Quit",
        description: "Exit ghfind",
        action: () => {
          saveSession({
            mode: currentMode,
            query: currentQueryInput,
            sort: currentSort,
            limit: currentLimit,
            trendingTab,
          });
          cleanup();
        },
      },
    ];
    groups.push({
      type: "category",
      name: "System",
      description: "Help, notifications, compare, quit",
      icon: "\u2699\uFE0F",
      children: sysItems,
    });

    return groups;
  }

  function showLeaderMenu() {
    resetMenu();
    const topLevel = buildMenuHierarchy();
    pushMenuLevel(" ⚙ Menu ", "", topLevel, 0);
    leaderSelect.focus();
    showOverlay("leader");
  }

  async function checkForUpdateAndShow(force: boolean = false) {
    if (!force && !shouldCheckUpdate()) return;
    if (cachedVersion === null) {
      try {
        const pkg = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf-8"));
        cachedVersion = pkg.version;
      } catch {
        debugLog("Failed to read package.json");
        return;
      }
    }
    const currentVersion = cachedVersion;
    // ponytail: DEBUG_FORCE_UPDATE lets you test the panel without a real newer version
    const latest = process.env.DEBUG_FORCE_UPDATE || await checkForUpdate(currentVersion);
    markUpdateChecked(latest ?? undefined);
    if (latest) {
      updateSelectedOption = 0;
      updateText.content = `  A new version is available\n\n  Current: ${currentVersion}\n  Latest:   ${latest}\n\n  Run "npm install -g ghfind"`;
      renderUpdateOptions();
      showOverlay("update");
    } else {
      // ponytail: debug to file so it's not swallowed by TUI renderer
      debugLog(`No update available (current: ${currentVersion})`);
    }
  }

  function openUrlIfSelected() {
    const opt = resultsSelect.getSelectedOption();
    const repo = opt?.value as Repo | undefined;
    if (repo) openUrl(repo.url);
    else setStatus("No repo selected");
  }

  function toggleBookmarkOnSelected() {
    const opt = resultsSelect.getSelectedOption();
    const repo = opt?.value as Repo | undefined;
    if (repo) {
      const added = toggleBookmark(repo);
      setStatus(
        added ? `Bookmarked ${repo.fullName}` : `Unbookmarked ${repo.fullName}`,
      );
    }
  }

  function toggleCompareOnSelected() {
    const opt = resultsSelect.getSelectedOption();
    const repo = opt?.value as Repo | undefined;
    if (!repo) return;
    const idx = compareList.findIndex((r) => r.fullName === repo.fullName);
    if (idx >= 0) {
      compareList.splice(idx, 1);
      setStatus(`Removed ${repo.fullName} from comparison`);
    } else {
      compareList.push(repo);
      setStatus(
        `${repo.fullName} added to comparison (${compareList.length} selected)`,
      );
    }
  }

  function showShareIfRepo() {
    const opt = resultsSelect.getSelectedOption();
    const repo = opt?.value as Repo | undefined;
    if (!repo) {
      setStatus("No repo selected to share");
      return;
    }
    showOverlay("share");
  }

  function saveCurrentSearch() {
    if (currentQueryInput) {
      const name =
        currentQueryInput.length > 40
          ? currentQueryInput.slice(0, 37) + "..."
          : currentQueryInput;
      saveSearch(
        name,
        currentQueryInput,
        currentMode,
        currentSort,
        currentLimit,
        currentMode === "trending" ? trendingTab : undefined,
      );
      setStatus(`Saved as "${name}"`);
    } else {
      setStatus("No search to save");
    }
  }

  function triggerDeepDive() {
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
  }

  // ── README viewer overlay ────────────────────────────────────
  const readmeBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderBottom: true,
    borderBottomColor: colors.border,
    title: " README ",
    titleColor: colors.green,
  });
  const readmeScroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    backgroundColor: colors.bg,
    scrollY: true,
    scrollX: false,
    paddingX: 1,
    viewportOptions: { backgroundColor: colors.bg },
    contentOptions: { backgroundColor: colors.bg, flexDirection: "column" },
    scrollbarOptions: {
      backgroundColor: colors.bg,
      foregroundColor: colors.muted,
      width: 1,
    },
  });
  const readmeText = new TextRenderable(renderer, {
    content: "",
    color: colors.text,
    backgroundColor: colors.bg,
  });
  readmeScroll.add(readmeText);
  readmeBox.add(readmeScroll);
  const readmeFooter = new TextRenderable(renderer, {
    content: "  ↑↓/jk scroll  Esc/q close",
    color: colors.muted,
    backgroundColor: colors.bg,
    height: 1,
    paddingX: 1,
  });
  readmeBox.add(readmeFooter);
  root.add(readmeBox);

  async function showReadme() {
    const opt = resultsSelect.getSelectedOption();
    const repo = opt?.value as Repo | undefined;
    if (!repo) {
      setStatus("No repo selected");
      return;
    }
    readmeText.content = `  Loading README for ${repo.fullName}...`;
    showOverlay("readme");
    try {
      const headers: Record<string, string> = { "User-Agent": "ghfind/1.0" };
      if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
      let text = "";
      for (const path of [
        `${repo.owner}/${repo.name}/main/README.md`,
        `${repo.owner}/${repo.name}/master/README.md`,
        `${repo.owner}/${repo.name}/main/README.rst`,
      ]) {
        const r = await fetch(`https://raw.githubusercontent.com/${path}`, {
          headers,
        });
        if (r.ok) {
          text = await r.text();
          break;
        }
      }
      if (!text) {
        readmeText.content = `  (no README found for ${repo.fullName})`;
      } else {
        // ponytail: just strip markdown formatting, show full text
        const stripped = text
          .replace(/```[\s\S]*?```/g, "[code block]")
          .replace(/#{1,6}\s/g, "")
          .replace(/\*\*(.+?)\*\*/g, "$1")
          .replace(/\[(.+?)\]\(.+?\)/g, "$1")
          .replace(/`([^`]+)`/g, "$1")
          .split("\n")
          .map((l) => l.trimEnd())
          .join("\n");
        readmeText.content = stripped;
      }
    } catch {
      readmeText.content = "  Failed to load README";
    }
    renderer.requestRender();
  }

  // ── Status bar ──────────────────────────────────────────────────────
  const statusBar = new TextRenderable(renderer, {
    content: " Ready. Press Enter to search.",
    backgroundColor: colors.surface,
    color: colors.muted,
    height: 1,
    paddingX: 1,
    borderTop: true,
    borderTopColor: colors.border,
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
    const sort = currentMode === "packages" ? currentPackageSort : currentSort;
    toolbarText.content = formatToolbar(sort, currentLimit, totalCount);
    renderer.requestRender();
  }

  function updateDetail(repo: Repo | null) {
    if (!repo) {
      detailText.content = "";
      return;
    }
    const topics = repo.topics.length
      ? repo.topics.slice(0, 8).join(", ")
      : "—";
    const desc = repo.description ?? "(no description)";
    const stars = repo.stars.toLocaleString();
    const forks = repo.forks.toLocaleString();
    const lang = repo.language ?? "—";
    const updated = repo.updatedAt.slice(0, 10);
    const statusTags: string[] = [];
    if (repo.archived) statusTags.push("archived");
    if (repo.isFork) statusTags.push("fork");
    const tagStr = statusTags.length ? `  [${statusTags.join(", ")}]` : "";

    const lines = [
      `  ${repo.fullName}${tagStr}`,
      ``,
      `  ★  ${stars}    ♡  ${forks}    ${lang}`,
      `  Updated  ${updated}`,
      `  Topics   ${topics}`,
      ``,
      `  ${desc}`,
      ``,
      `  ${repo.url}`,
    ];
    detailText.content = lines.join("\n");
  }

  // ── Graph / Chart ──────────────────────────────────────────────────

  /** Unicode blocks for 8 vertical levels within one character cell. */
  // Braille dot encoding: each byte is 8 dots (2 cols × 4 rows per char).
  // Bit layout (LSB first): 0-2=col0 rows, 3-5=col1 rows, 6=col0 row3, 7=col1 row3.
  // Unicode offset is 0x2800, so braille code point = 0x2800 + bitmask.
  function brailleChar(bits: number): string {
    return bits === 0 ? " " : String.fromCodePoint(0x2800 + bits);
  }

  function buildChartString(
    values: number[],
    termW: number,
    termH: number,
  ): string[] {
    if (values.length === 0) return ["(no data)"];

    // Braille resolution: 2 horizontal dots and 4 vertical dots per terminal cell.
    const dotW = termW * 2;
    const dotH = termH * 4;

    // Sample values to fit braille dot columns.
    const sampled: number[] = [];
    for (let i = 0; i < dotW; i++) {
      sampled.push(values[Math.floor((i / dotW) * values.length)]);
    }
    const max = Math.max(...sampled, 1);
    // Map each sample to a dot row (0 = bottom, dotH-1 = top).
    const dotRows = sampled.map((v) => Math.round((v / max) * (dotH - 1)));

    // Build a mask grid: dotGrid[row][col] = true if the silhouette passes through.
    const dotGrid: boolean[][] = Array.from({ length: dotH }, () =>
      Array(dotW).fill(false),
    );

    // Draw the silhouette line: mark the dot at each column.
    for (let c = 0; c < dotW; c++) {
      dotGrid[dotH - 1 - dotRows[c]][c] = true;
    }
    // Fill gaps between adjacent columns so the line is continuous.
    for (let c = 0; c < dotW - 1; c++) {
      const r1 = dotRows[c];
      const r2 = dotRows[c + 1];
      const lo = Math.min(r1, r2);
      const hi = Math.max(r1, r2);
      for (let r = lo; r <= hi; r++) {
        dotGrid[dotH - 1 - r][c] = true;
      }
    }

    // Convert 4-row × 2-col blocks of dots into braille characters.
    const lines: string[] = [];
    for (let tr = 0; tr < termH; tr++) {
      const chars: string[] = [];
      for (let tc = 0; tc < termW; tc++) {
        const r0 = tr * 4;
        const c0 = tc * 2;
        let bits = 0;
        if (r0 + 0 < dotH && c0 + 0 < dotW && dotGrid[r0 + 0][c0 + 0])
          bits |= 0x01;
        if (r0 + 1 < dotH && c0 + 0 < dotW && dotGrid[r0 + 1][c0 + 0])
          bits |= 0x02;
        if (r0 + 2 < dotH && c0 + 0 < dotW && dotGrid[r0 + 2][c0 + 0])
          bits |= 0x04;
        if (r0 + 0 < dotH && c0 + 1 < dotW && dotGrid[r0 + 0][c0 + 1])
          bits |= 0x08;
        if (r0 + 1 < dotH && c0 + 1 < dotW && dotGrid[r0 + 1][c0 + 1])
          bits |= 0x10;
        if (r0 + 2 < dotH && c0 + 1 < dotW && dotGrid[r0 + 2][c0 + 1])
          bits |= 0x20;
        if (r0 + 3 < dotH && c0 + 0 < dotW && dotGrid[r0 + 3][c0 + 0])
          bits |= 0x40;
        if (r0 + 3 < dotH && c0 + 1 < dotW && dotGrid[r0 + 3][c0 + 1])
          bits |= 0x80;
        chars.push(brailleChar(bits));
      }

      // Y-axis labels
      const labelRows = [
        0,
        Math.floor(termH / 4),
        Math.floor(termH / 2),
        Math.floor((3 * termH) / 4),
        termH - 1,
      ];
      const labelVals = [
        max,
        Math.round(max * 0.75),
        Math.round(max / 2),
        Math.round(max / 4),
        0,
      ];
      const idx = labelRows.indexOf(tr);
      let label = "     ";
      if (idx >= 0) {
        const val = labelVals[idx];
        label = val >= 1000 ? `${(val/1000).toFixed(1).replace(/\.0$/, "")}k` : String(val);
        label = label.padStart(5) + " ";
      }
      lines.push(`${label}┆${chars.join("")}`);
    }

    // X-axis with week labels
    const xAxis = `     ┆${"─".repeat(termW)}`;
    const weekLabels = `     ┆ ${"1w".padEnd(Math.floor(termW/4))} ${"13w".padEnd(Math.floor(termW/4))} ${"26w".padEnd(Math.floor(termW/4))} ${"52w"}`;
    return [...lines, xAxis, weekLabels];
  }

  async function loadChart(repo: Repo) {
    detailText.content = "  Loading chart...";
    renderer.requestRender();
    try {
      const headers: Record<string, string> = { "User-Agent": "ghfind/1.0" };
      if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
      const [chartRes, repoRes] = await Promise.all([
        fetch(
          `https://api.github.com/repos/${repo.owner}/${repo.name}/stats/participation`,
          { headers },
        ),
        fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}`, {
          headers,
        }).then((r) => (r.ok ? r.clone().json() : null)),
      ]);
      let chartSection = "";
      if (chartRes.ok) {
        const data = await chartRes.json();
        if (data?.all && data.all.length >= 2) {
          chartCommitData = data.all;
          // Chart width: leave room for y-axis labels (6 chars) and padding.
          // In fullscreen graph mode, detailBox takes 100% width.
          // In normal mode (50%), use half the terminal width.
          const termW = graphFullscreen
            ? (process.stdout.columns || 120) - 12
            : Math.floor((process.stdout.columns || 120) / 2) - 12;
          const chartW = Math.max(20, Math.min(60, termW));
          const chartH = 10;
          const chartLines = buildChartString(chartCommitData, chartW, chartH);
          chartSection = ["", "Weekly commits (52 weeks)", ...chartLines].join("\n");
        } else if (data?.message) {
          chartSection = ["", `Chart unavailable: ${data.message}`].join("\n");
        }
      } else {
        chartSection = ["", `Chart unavailable (API ${chartRes.status})`].join("\n");
      }


      const desc = repo.description ?? "";
      const lang = repo.language ?? "—";
      const updated = repo.updatedAt ? repo.updatedAt.slice(0, 10) : "";
      const topics = repoRes?.topics?.length
        ? repoRes.topics.slice(0, 8).join(", ")
        : "";

      const growthLine =
        currentMode === "trending" && repo.score > 0
          ? ` Growth \u25b2 ${fmtStars(repo.score)} ${trendingPeriod}`
          : "";

      const detailLines = [
        `  ${repo.fullName}`,
        ``,
        `  ★  ${repo.stars.toLocaleString()}    ♡  ${repo.forks.toLocaleString()}    ${lang}`,
        growthLine,
        updated ? ` Updated ${updated}` : "",
        topics ? ` Topics  ${topics}` : "",
        "",
        desc,
        "",
        ` ${repo.url}`,
      ].filter((l) => l !== "");

      detailText.content = [...detailLines, chartSection].join("\n");
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

  function formatTrendingLine(r: Repo, rank: number): string {
    const rankStr = String(rank).padStart(2, "0");
    const name = `${r.owner}/${r.name}`.padEnd(30).slice(0, 30);
    const lang = (r.language || "?").padEnd(12).slice(0, 12);
    const stars = `★ ${fmtStars(r.stars)}`.padEnd(9).slice(0, 9);
    const arrow = r.score > 0 ? "▲" : r.score < 0 ? "▼" : "—";
    const growth = `${arrow} ${fmtStars(r.score)} ${trendingPeriod}`;
    return `[${rankStr}] ${name} ${lang} ${stars} ${growth}`;
  }

  async function loadTrending() {
    currentMode = "trending";
    isLoading = true;
    searchBox.visible = false;
    toolbarText.visible = false;
    trendingTabBox.visible = true;
    body.visible = true;
    renderTrendingTabs();
    resultsSelect.options = [
      { name: "  Loading trending...", description: "", value: null },
    ];
    detailText.content = "";
    statusMgr.set("loading", "Loading trending repos...");
    renderer.requestRender();

    try {
      const searchModule = new SearchModule(new TrendingAdapter());
      const response = await searchModule.search(
        { keywords: [], qualifiers: [], raw: "trending" },
        { limit: 25, sort: "stars", json: false, verbose: false, trendingSince: tabSince(trendingTab) },
      );
      const fetched = response.repos;
      const since = tabSince(trendingTab);
      trendingPeriod =
        since === "daily"
          ? "today"
          : since === "weekly"
            ? "this week"
            : "this month";
      resultsSelect.options = fetched.map((r, i) => ({
        name: formatTrendingLine(r, i + 1),
        description: r.description ?? "",
        value: r,
      }));
      if (fetched.length > 0) {
        resultsSelect.setSelectedIndex(0);
        updateDetail(fetched[0]);
      } else {
        throw new NoResultsError(trendingTab);
      }
      statusMgr.set(
        "success",
        `${fetched.length} trending repos — ${trendingTab}`,
      );
      appendHistory({
        query: `trending:${trendingTab}`,
        mode: "trending",
        tab: trendingTab,
        timestamp: Date.now(),
        resultCount: fetched.length,
      });
    } catch (err) {
      const msg =
        err instanceof SearchCliError
          ? err.userMessage
          : err instanceof Error
            ? err.message
            : String(err);
      resultsSelect.options = [
        { name: " (error)", description: "", value: null },
      ];
      statusMgr.set("error", msg.slice(0, 60));
    }
    isLoading = false;
    renderer.requestRender();
  }

  function showSearchMode() {
    currentMode = "search";
    trendingTabBox.visible = false;
    gapBox.visible = false;
    searchBox.visible = true;
    toolbarText.visible = true;
    body.visible = true;
    searchInput.placeholder =
      "Search GitHub repos (e.g. rust cli, or language:Rust stars:>100)";
    searchInput.focus();
    renderer.requestRender();
  }

  function showPackagesMode() {
    currentMode = "packages";
    trendingTabBox.visible = false;
    gapBox.visible = false;
    searchBox.visible = true;
    toolbarText.visible = true;
    body.visible = true;
    searchInput.placeholder = "Search npm packages (e.g. react, vue, typescript)";
    searchInput.focus();
    packages = [];
    resultsSelect.options = [
      { name: "", description: "Type a query and press Enter to search", value: null },
    ];
    detailText.content = "";
    renderer.requestRender();
  }
  async function doPackageSearch(queryText: string) {
    const q = queryText.trim();
    if (q === "" || isLoading) return;
    currentQueryInput = q;
    isLoading = true;
    resultsSelect.options = [
      { name: "  Searching packages...", description: "", value: null },
    ];
    detailText.content = "";
    statusMgr.set("searching", `Searching npm for "${q}"`);
    renderer.requestRender();
    try {
      const search = createPackageSearch();
      const result = await search.searchPackage(q, currentLimit);
      totalCount = result.totalCount;
      packageResultsRaw = result.packages;
      packages = sortPackages(packageResultsRaw, currentPackageSort);
      setToolbar();
      if (packages.length > 0) {
        resultsSelect.options = packages.map((p) => ({
          name: `${p.name}@${p.version}`,
          description: p.description ?? "",
          value: p,
        }));
        resultsSelect.setSelectedIndex(0);
        statusMgr.set("success", `${packages.length} packages found`);
      } else {
        throw new NoResultsError(q);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err);
      resultsSelect.options = [
        { name: " (error)", description: "", value: null },
      ];
      statusMgr.set("error", msg.slice(0, 60));
    }
    isLoading = false;
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
      resultsSelect.options = [
        { name: "  Searching...", description: "", value: null },
      ];
      detailText.content = "";
    }
    statusMgr.set("searching", `Searching for "${q}"`);

    try {
      const parsed = applyFlagFilters(parseQuery(q), {});
      validateQuery(parsed);
      const provider = createGitHubSearch(logger);
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
        statusMgr.set(
          "success",
          `Page ${currentPage} — ${currentRepos.length} of ${totalCount.toLocaleString()} results`,
        );
        if (!append) {
          appendHistory({
            query: q,
            mode: "search",
            timestamp: Date.now(),
            resultCount: currentRepos.length,
          });
        }
      }
    } catch (err) {
      currentRepos = [];
      resultsSelect.options = [
        { name: " (error)", description: "", value: null },
      ];
      const msg =
        err instanceof SearchCliError
          ? err.userMessage
          : err instanceof Error
            ? err.message
            : String(err);
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

  function changePackageSort() {
    const idx = PACKAGE_SORT_MODES.findIndex((m) => m.key === currentPackageSort);
    const next = PACKAGE_SORT_MODES[(idx + 1) % PACKAGE_SORT_MODES.length];
    currentPackageSort = next.key;
    setToolbar();
    if (packageResultsRaw.length > 0) {
      packages = sortPackages(packageResultsRaw, currentPackageSort);
      resultsSelect.options = packages.map((p) => ({
        name: `${p.name}@${p.version}`,
        description: p.description ?? "",
        value: p,
      }));
      resultsSelect.setSelectedIndex(0);
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

  // Enter in search input → show results
  searchInput.on("enter", () => {
    if (searchInput.value.trim() === "" || isLoading) return;
    if (currentMode === "packages") {
      doPackageSearch(searchInput.value);
    } else {
      doSearch(searchInput.value);
    }
  });

  // Navigate results → update detail pane
  resultsSelect.on("selectionChanged", () => {
    const opt = resultsSelect.getSelectedOption();
    if (currentMode === "packages") {
      const pack = opt?.value as Package | undefined;
      if (pack) {
        detailText.content = `Package: ${pack.name}@${pack.version}
Downloads: ${pack.downloads.toLocaleString()}
Score: ${pack.score.toFixed(2)}
${pack.description ?? ""}`;
      }
    } else {
      const repo = opt?.value as Repo | undefined;
      if (repo) {
        if (graphFullscreen) loadChart(repo);
        else updateDetail(repo);
      }
    }
    renderer.requestRender();
  });

  // Enter on a result → open URL
  resultsSelect.on("itemSelected", () => {
    const opt = resultsSelect.getSelectedOption();
    if (currentMode === "packages") {
      const pack = opt?.value as Package | undefined;
      if (pack?.url) openUrl(pack.url);
    } else {
      const repo = opt?.value as Repo | undefined;
      if (repo) openUrl(repo.url);
    }
  });

  // ── Global keyboard shortcuts ──────────────────────────────────────
  renderer.keyInput.on("keypress", (key) => {
    // ── Overlay-mode handling ────────────────────────────────────────
    if (currentOverlay !== "none") {
      // Escape or q closes any overlay (except: leader uses Esc for back-nav, q to close)
      if (key.name === "escape") {
        if (currentOverlay === "leader") {
          if (!popMenuLevel()) {
            showOverlay("none");
          }
          setToolbar();
          renderer.requestRender();
        } else {
          showOverlay("none");
          renderer.requestRender();
        }
        return;
      }
      if (key.name === "q") {
        showOverlay("none");
        renderer.requestRender();
        return;
      }

      // Leader menu: hierarchical submenu navigation
      if (currentOverlay === "leader") {
        if (
          key.name === "enter" ||
          key.name === "return" ||
          key.name === "right" ||
          key.name === "l"
        ) {
          const sel = leaderSelect.getSelectedOption();
          const entry = sel?.value as MenuEntry | undefined;
          if (!entry) return;
          if (entry.type === "category") {
            pushMenuLevel(
              `  Menu > ${entry.name}`,
              entry.name,
              entry.children,
              0,
            );
            renderer.requestRender();
          } else {
            resetMenu();
            showOverlay("none");
            entry.action();
            renderer.requestRender();
          }
          return;
        }
        if (key.name === "left" || key.name === "h") {
          if (popMenuLevel()) {
            setToolbar();
            renderer.requestRender();
          }
          return;
        }
        // Let up/down/j/k fall through to SelectRenderable
      }

      // README viewer: scrollable, Esc/q already handled above
      if (currentOverlay === "readme") {
        return;
      }

      // History overlay
      if (currentOverlay === "history") {
        if (key.name === "d") {
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
        if (key.name === "enter" || key.name === "return") {
          const sel = historySelect.getSelectedOption();
          if (sel?.value) {
            const entry = (sel.value as any).entry;
            showOverlay("none");
            if (entry.mode === "trending") {
              if (entry.tab)
                trendingTab = entry.tab as (typeof TAB_NAMES)[number];
              loadTrending();
            } else {
              searchInput.value = entry.query;
              showSearchMode();
              doSearch(entry.query);
            }
          }
          return;
        }
        return;
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
              if (s.tab) trendingTab = s.tab as (typeof TAB_NAMES)[number];
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

      // Compare overlay: Esc/q closes
      if (currentOverlay === "compare") {
        return;
      }

      // Notifications overlay
      if (currentOverlay === "notifications") {
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
        if (key.ctrl && key.name === "c") {
          dismissAll();
          refreshNotifications();
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

      // Update panel
      if (currentOverlay === "update") {
        if (key.name === "escape" || key.name === "q") {
          showOverlay("none");
          renderer.requestRender();
          return;
        }
        if (key.name === "left" || key.name === "h") {
          updateSelectedOption = Math.max(0, updateSelectedOption - 1);
          renderUpdateOptions();
          return;
        }
        if (key.name === "right" || key.name === "l") {
          updateSelectedOption = Math.min(2, updateSelectedOption + 1);
          renderUpdateOptions();
          return;
        }
        if (key.name === "enter" || key.name === "return") {
          const action = ["now", "later", "never"][updateSelectedOption] as "now" | "later" | "never" | undefined;
          if (action === "now") {
            showOverlay("none");
            performUpdate().then((ok) => {
              if (ok) {
                setStatus("✓ Update complete — restart ghfind");
              } else {
                setStatus("✗ Update failed — check terminal output");
              }
            }).catch(() => {
              setStatus("✗ Update failed — check terminal output");
            });
          } else if (action === "never") {
            suppressUpdateNotices();
            showOverlay("none");
            setStatus("Update notices suppressed");
          } else {
            snoozeUpdateNotices(3);
            showOverlay("none");
            setStatus("Update reminder snoozed for 3 days");
          }
          renderer.requestRender();
          return;
        }
        return;
      }

      return;
    }

    // ── Main view handling (no overlay active) ────────────────────────

    // q quits
    if (key.name === "q") {
      if (graphFullscreen) {
        toggleGraph();
        return;
      }
      saveSession({
        mode: currentMode,
        query: currentQueryInput,
        sort: currentSort,
        limit: currentLimit,
        trendingTab,
      });
      cleanup();
      return;
    }

    // Esc exits graph mode
    if (key.name === "escape" && graphFullscreen) {
      toggleGraph();
      return;
    }

    // Space toggles leader menu (open if closed, close if open)
    // Skip when the search input is focused so spaces can be typed in queries
    if (key.name === "space" && !searchInput.focused) {
      if (currentOverlay === "leader") {
        showOverlay("none");
      } else {
        showLeaderMenu();
      }
      return;
    // 't' toggles theme and persists to config
    if (key.name === "t" && !searchInput.focused) {
      const current = config.theme;
      const themes = listThemes();
      const idx = themes.indexOf(current);
      const next = themes[(idx + 1) % themes.length];
      const nextTheme = loadTheme(next);
      Object.assign(colors, nextTheme);
      config.theme = next;
      saveConfig(config);
      renderer.requestRender();
      return;
    }
    }

    // 'c' toggles compare on selected repo (when not typing in search)
    if (key.name === "c" && !searchInput.focused) {
      if (currentOverlay === "compare") {
        showOverlay("none");
      } else {
        toggleCompareOnSelected();
        refreshCompare();
        showOverlay("compare");
      }
      return;
    }

    // '?' / Ctrl+H toggle help overlay (fast path)
    if (key.name === "?" || (key.name === "h" && key.ctrl)) {
      showOverlay("help");
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
          const newVal =
            lastSpace >= 0
              ? val.slice(0, lastSpace + 1) + suggestions[0]
              : suggestions[0];
          searchInput.value = newVal;
          renderer.requestRender();
        }
      }
      return;
    }

    // '/' focuses search
    if (key.name === "/") {
      searchInput.focus();
      showSearchMode();
      renderer.requestRender();
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

    // Left/right arrows (and h/l) switch trending tabs
    if (key.name === "left" || key.name === "h") {
      if (currentMode === "trending") {
        const idx = TAB_NAMES.indexOf(trendingTab);
        if (idx > 0) {
          trendingTab = TAB_NAMES[idx - 1];
          loadTrending();
        }
      }
      return;
    }
    if (key.name === "right" || key.name === "l") {
      if (currentMode === "trending") {
        const idx = TAB_NAMES.indexOf(trendingTab);
        if (idx < TAB_NAMES.length - 1) {
          trendingTab = TAB_NAMES[idx + 1];
          loadTrending();
        }
      }
      return;
    }

    // PageDown — next page (search mode)
    if (key.name === "pagedown") {
      if (currentMode === "search" && currentQueryInput) {
        currentPage++;
        doSearch(currentQueryInput, true);
      }
      return;
    }

    // PageUp — scroll to top of results
    if (key.name === "pageup") {
      if (currentRepos.length > 0) {
        resultsSelect.setSelectedIndex(0);
        updateDetail(currentRepos[0]);
        renderer.requestRender();
      }
      return;
    }
  });

  // ── Update check (before start) ──────────────────────────────────────
  const pkgPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json",
  );
  let currentVersion = "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    currentVersion = pkg.version;
  } catch {
    // non-critical
  }
  // ── Start ──────────────────────────────────────────────────────────
  // Check for updates (non-blocking — doesn't delay TUI startup)
  if (!session || !session.mode) {
    showLanding(true);
  }
  checkForUpdateAndShow();
  renderer.start();
  if (session && session.mode) {
    if (currentMode === "trending") {
      loadTrending();
    } else {
      searchInput.value = currentQueryInput;
      if (currentQueryInput) {
        doSearch(currentQueryInput);
      } else {
        showSearchMode();
      }
      searchInput.focus();
    }
  }
  renderer.requestRender();
}

// ── Utilities ─────────────────────────────────────────────────────────

function formatResultLine(repo: Repo): string {
  const stars = formatStars(repo.stars);
  const lang = (repo.language ?? "?").padEnd(12).slice(0, 12);
  const name = repo.fullName.padEnd(40).slice(0, 40);
  return `${name}  ${lang}  ${stars}`;
}

function formatStars(n: number): string {
  if (n >= 1000000) return `★ ${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `★ ${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `★ ${n}`;
}

function formatToolbar(
  sort: SortStrategy | PackageSortMode,
  limit: number,
  totalCount: number,
): string {
  const sortLabel = SORT_MODES.find((m) => m.key === sort)?.label ?? sort;
  return ` sort: ${sortLabel}   limit: ${limit}   results: ${totalCount.toLocaleString()}`;
}

function cleanup(): void {
  try {
    rotateHistory();
  } catch {
    /* non-critical */
  }
  process.exit(0);
}

// ── Auto-run ──────────────────────────────────────────────────────────
// Only launch when run directly (bun run src/tui.ts), not when bundled
// into cli.js or imported as a module.
if (import.meta.main && !process.env.GHFIND_BUNDLED && !process.env.GHFIND_CLI_RUN) {
  launchBrowser();
}
