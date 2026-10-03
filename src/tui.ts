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
import { appendFileSync } from "node:fs";
import type { CliRenderer } from "@opentui/core";
import type {
  Repo,
  SearchOptions,
  SortStrategy,
  Package,
  SessionState,
  HistoryEntry,
  SavedSearch,
} from "./types";
import { fetchOrgProfile, type OrgProfile } from "./org";
import {
  parseQuery,
  applyFlagFilters,
  validateQuery,
  suggestFor,
  suggestRelaxations,
  trendingQuery,
  rankRepos,
  createGitHubSearch,
  SearchModule,
  TrendingAdapter,
  type Logger,
} from "./search";
import { tabSince, TAB_NAMES, fmtStars } from "./trending";
import {
  attachClickToSelect,
  attachClickOutside,
  attachClickableBox,
  NON_INTERACTIVE_TEXT,
  DOUBLE_CLICK_MS,
} from "./tui/mouse";
import { loadConfig, saveConfig } from "./config";
import { buildHelpSections, HELP_KEYS_COLUMN } from "./help";
import {
  SearchCliError,
  NoResultsError,
  NetworkError,
  RateLimitError,
  AuthError,
  ForbiddenError,
} from "./errors";
import {
  appendHistory,
  readHistory,
  deleteHistoryEntry,
  clearHistory,
  rotateHistory,
} from "./history";
import { getBookmarks, toggleBookmark, removeBookmark } from "./bookmarks";
import {
  getSavedSearches,
  saveSearch,
  deleteSavedSearch,
  touchSavedSearch,
} from "./saved-searches";
import { saveSession, restoreSession } from "./session";
import { fetchDeepDive, buildDeepDiveText } from "./deepdive";
import { buildComparisonTable } from "./compare";
import { createMarkdownView } from "./markdown-view";
import { fetchImageBytes } from "./image-loader";
import { fetchReadme } from "./readme";
import { fetchTopics } from "./explore";
import { exportToFile, type ExportFormat } from "./output";
import {
  listThemes,
  loadTheme,
  detectTerminalBackground,
  deriveSurfaceLayers,
} from "./themes";
import {
  createPackageSearch,
  sortPackages,
  PACKAGE_SORT_MODES,
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
import { getVersion } from "./version";

let cachedVersion: string | null = null;
import {
  checkForUpdate,
  shouldCheckUpdate,
  markUpdateChecked,
  snoozeUpdateNotices,
  suppressUpdateNotices,
  performUpdate,
  fetchReleaseNotes,
  readUpdateState,
  recordPreUpdateState,
  markPostUpgradeSeen,
} from "./update-check";
import { debugLog } from "./storage";
import {
  landingConsumesKey,
  landingKeysActive,
  moveSelection,
} from "./landing";
const colors: Record<string, string> = {
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
  separator: "#1C1C1C", // Dark thin colorblock - thicker than border, visible separation
  selectionBg: "#2A2A9C",
  selectionText: "#ffffff",
  // Premium accents for the command menu
  accent: "#89b4fa",
  accentDim: "#587cf5",
  surfaceDim: "#1a1919",
  borderAccent: "#1a1919",
};

// ─── Logger ───────────────────────────────────────────────────────────
/**
 * TUI diagnostic log.
 *
 * The TUI owns the screen, so it cannot print debug output to stdout without
 * corrupting the render — and the logger used to be a silent no-op, which made
 * API failures (403/401) undiagnosable from the status-bar message alone.
 *
 * Set GHFIND_LOG=<path> to append timestamped lines to that file. Unset (the
 * default) keeps logging completely off, so there is no cost in normal use.
 * Only the shape of a response is recorded; tokens and headers are redacted.
 */
function createTuiLogger(): Logger {
  const target = process.env.GHFIND_LOG;
  if (!target) {
    return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  }
  const write = (level: string, msg: string) => {
    try {
      appendFileSync(
        target,
        `[${new Date().toISOString()}] [${level}] ${msg}\n`,
      );
    } catch {
      // A broken log path must never take down the TUI.
    }
  };
  return {
    debug: (m) => write("debug", m),
    info: (m) => write("info", m),
    warn: (m) => write("warn", m),
    error: (m) => write("error", m),
  };
}

const logger: Logger = createTuiLogger();

// ─── Sort cycle ───────────────────────────────────────────────────────
const SORT_MODES: { key: SortStrategy; label: string }[] = [
  { key: "best-match", label: "best-match" },
  { key: "stars", label: "stars" },
  { key: "updated", label: "updated" },
  { key: "forks", label: "forks" },
];

// ─── Main ─────────────────────────────────────────────────────────────
export async function launchBrowser(theme_override?: string): Promise<void> {
  // Ask the terminal for its real background color (OSC 11) BEFORE the
  // renderer takes over stdin — after that, reading the reply gets messy.
  // Used below so the app backdrop matches the user's terminal theme.
  const terminalBg = await detectTerminalBackground();
  let renderer: CliRenderer;
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

  // ── Config ──
  const config = loadConfig();
  // Mutable: the AuthError flow lets the user fix or clear the token without
  // restarting (the next search re-reads this variable).
  let githubToken: string | undefined =
    config.githubToken || process.env.GITHUB_TOKEN;

  // Apply theme
  const theme = loadTheme(theme_override || config.theme);
  Object.assign(colors, theme);
  // Prefer the terminal's own background so the app blends into the terminal
  // instead of painting a rectangle of theme-bg over it. Falls back to the
  // theme bg when the terminal can't be queried (conhost, piped, etc.).
  if (terminalBg) {
    colors.bg = terminalBg;
    // Blend card/surface/border layers toward that background so panels are
    // subtle tints of the terminal color rather than foreign theme chips.
    Object.assign(colors, deriveSurfaceLayers(terminalBg));
  }
  // Must come after the theme is applied — this paints the whole terminal
  // backdrop, and doing it earlier bakes in the hardcoded default palette.
  renderer.setBackgroundColor(colors.bg);

  // ── Session restore ──
  const session = restoreSession();

  // ── State ───────────────────────────────────────────────────────────
  let currentRepos: Repo[] = [];
  let currentSort: SortStrategy = session?.sort ?? config.defaultSort;
  let currentLimit = session?.limit ?? config.defaultLimit;
  let currentQueryInput = session?.query ?? "";
  let isLoading = false;
  let currentMode: "landing" | "search" | "trending" | "packages" =
    session?.mode === "trending" || session?.mode === "packages"
      ? session.mode
      : "search";
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
    | "org"
    | "update"
    | "landing" = "none";
  let currentPage = 1;
  let totalCount = 0;
  let deepDiveActive = false;
  const compareList: Repo[] = [];
  const _quitArmed = false;

  const header = new TextRenderable(renderer, {
    content:
      " ghfind — GitHub repo browser   [/]search  [Esc]menu  [\u2192]open  [?]help  [q]uit   ·   click select · dbl-click open",
    bg: colors.bg,
    fg: colors.muted,
    height: 1,
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
        ...NON_INTERACTIVE_TEXT,
        content: label,
        fg: isActive ? colors.bg : colors.muted,
        bg: isActive ? colors.blue : colors.bg,
        height: 1,
      });
      // Click a tab to switch to it — same path as the 1-5 number keys.
      tt.onMouseDown = (event) => {
        event.stopPropagation();
        if (name === trendingTab) return;
        trendingTab = name;
        loadTrending();
      };
      tt.onMouseOver = () => renderer.setMousePointer("pointer");
      tt.onMouseOut = () => renderer.setMousePointer("default");
      trendingTabTexts.push(tt);
      trendingTabBox.add(tt);
      if (i < TAB_NAMES.length - 1) {
        const sp = new TextRenderable(renderer, {
          ...NON_INTERACTIVE_TEXT,
          content: "  ",
          fg: colors.muted,
          bg: colors.bg,
          height: 1,
        });
        trendingTabTexts.push(sp);
        trendingTabBox.add(sp);
      }
    });
  }
  root.add(header);
  root.add(trendingTabBox);

  // ── Search input row ────────────────────────────────────────────────
  const searchBox = new BoxRenderable(renderer, {
    visible: true,
    width: "100%",
    flexDirection: "row",
    marginTop: 1,
    paddingY: 1,
    paddingLeft: 1,
    backgroundColor: colors.surface,
  });
  const searchInput = new InputRenderable(renderer, {
    placeholder:
      "Search GitHub repos (e.g. rust cli, or language:Rust stars:>100)",
    value: "",
    backgroundColor: colors.surface,
    textColor: colors.text,
    paddingX: 0,
    flexGrow: 1,
  });
  searchBox.add(searchInput);
  root.add(searchBox);

  // ── Toolbar (sort + limit indicator) ────────────────────────────────
  const toolbarText = new TextRenderable(renderer, {
    content: formatToolbar(currentSort, currentLimit, totalCount),
    visible: true, // hidden in trending mode
    fg: colors.muted,
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
    width: "50%",
    flexDirection: "column",
    paddingX: 1,
    paddingY: 1,
    focusable: false,
    backgroundColor: colors.surface,
  });
  const detailText = new TextRenderable(renderer, {
    content: "",
    fg: colors.text,
    wrapMode: "none",
    // Non-interactive: a left-press here would otherwise be swallowed as a
    // text-selection drag instead of reaching the click handlers.
    selectable: false,
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
    ...NON_INTERACTIVE_TEXT,
    content: [
      " ██████╗ ██╗  ██╗███████╗██╗███╗   ██╗██████╗ ",
      "██╔════╝ ██║  ██║██╔════╝██║████╗  ██║██╔══██╗",
      "██║  ███╗███████║█████╗  ██║██╔██╗ ██║██║  ██║",
      "██║   ██║██╔══██║██╔══╝  ██║██║╚██╗██║██║  ██║",
      "╚██████╔╝██║  ██║██║     ██║██║ ╚████║██████╔",
      " ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═══╝╚═════╝",
    ].join("\n"),
    fg: colors.accent,
    bg: colors.bg,
    height: 6,
  });
  landingBox.add(landingBanner);
  // Three option cards
  const landingOptions = [
    {
      icon: "\u{1F50D}",
      title: "Repo Search",
      desc: "Search GitHub repositories by query, language, stars, and more",
      action: () => {
        currentMode = "search";
        showLanding(false);
        showSearchMode();
        // Restore the saved query (if any) as a prefill, never auto-run it.
        if (currentQueryInput) {
          searchInput.value = currentQueryInput;
          renderer.requestRender();
        }
      },
    },
    {
      icon: "\u{1F4E6}",
      title: "Package Search",
      desc: "Search npm packages by name, description, or tags",
      action: () => {
        currentMode = "packages";
        showLanding(false);
        showPackagesMode();
      },
    },
    {
      icon: "\u{1F525}",
      title: "Trending",
      desc: "Browse the hottest repos on GitHub right now",
      action: () => {
        currentMode = "trending";
        showLanding(false);
        loadTrending();
      },
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
      fg: i === 0 ? colors.accent : colors.text,
      height: 1,
    });
    const spacerBot = new TextRenderable(renderer, { content: "", height: 1 });
    card.add(spacerTop);
    card.add(titleLine);
    card.add(spacerBot);
  }

  const landingHint = new TextRenderable(renderer, {
    ...NON_INTERACTIVE_TEXT,
    content:
      "   \u2191\u2193 Navigate  \u21E9 Select  [b]ookmarks  [?]help  [q]uit   ·   click to pick a mode",
    fg: colors.muted,
    bg: colors.bg,
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
      const children = landingCards[i].getChildren();
      const titleChild = children[1] as TextRenderable;
      if (titleChild) {
        titleChild.fg = isSel ? colors.accent : colors.text;
      }
    }
  }

  // ── Landing mouse ───────────────────────────────────────────
  // Click selects, double-click runs the card's action (same as Enter), hover
  // shows a pointer cursor. `updateLandingCards` is the single source of truth
  // for the card colours, so hover and selection cannot drift.
  landingCards.forEach((card, i) => {
    let lastClickAt = 0;
    card.onMouseDown = (event) => {
      event.stopPropagation();
      const now = Date.now();
      const isDouble =
        landingSelected === i && now - lastClickAt < DOUBLE_CLICK_MS;
      lastClickAt = now;
      if (isDouble) {
        landingOptions[i].action();
        return;
      }
      landingSelected = i;
      updateLandingCards();
      renderer.requestRender();
    };
    card.onMouseOver = () => {
      renderer.setMousePointer("pointer");
    };
    card.onMouseOut = () => {
      renderer.setMousePointer("default");
    };
  });

  // Landing keyboard handler. Registered before the global handler below,
  // and both listeners receive the same key event — so keys the landing
  // screen consumes must be claimed with stopPropagation(), or the global
  // handler re-reads them (e.g. "/" focusing the search input on top of the
  // menu, or "?" opening help and instantly closing it again).
  renderer.keyInput.on("keypress", (key) => {
    if (!landingKeysActive(currentMode, currentOverlay)) return;
    if (key.name === "up" || key.name === "k") {
      landingSelected = moveSelection(
        landingSelected,
        -1,
        landingOptions.length,
      );
      updateLandingCards();
      renderer.requestRender();
    } else if (key.name === "down" || key.name === "j") {
      landingSelected = moveSelection(
        landingSelected,
        1,
        landingOptions.length,
      );
      updateLandingCards();
      renderer.requestRender();
    } else if (key.name === "enter" || key.name === "return") {
      landingOptions[landingSelected].action();
    } else if (key.name === "b") {
      refreshBookmarks();
      showOverlay("bookmarks");
    } else if (key.name === "?" || key.name === "h") {
      showOverlay(currentOverlay === "help" ? "none" : "help");
    } else if (key.name === "q") {
      cleanup();
    } else {
      return; // not a landing key — let the global handler see it
    }
    if (landingConsumesKey(key.name)) key.stopPropagation();
  });

  // Hide main content so overlays can take 100% of the content area
  function hideMainContent() {
    trendingTabBox.visible = false;
    searchBox.visible = false;
    toolbarText.visible = false;
    body.visible = false;
  }

  function showMainContent() {
    if (currentMode === "trending") {
      trendingTabBox.visible = true;
    } else {
      searchBox.visible = true;
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
      menuButton.visible = true;
      if (currentMode === "landing") {
        landingBox.visible = true;
        body.visible = false;
        trendingTabBox.visible = false;
        searchBox.visible = false;
        toolbarText.visible = false;
      } else {
        showMainContent();
      }
      renderer.requestRender();
      return;
    }
    currentOverlay = type;
    // The button floats above the layout, so it would sit on top of every
    // full-screen overlay (and stay clickable through the dim layer).
    menuButton.visible = false;
    // An overlay opened from the landing screen must hide the menu too
    // (hideMainContent only covers the search/trending/toolbar boxes).
    landingBox.visible = false;
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
    } else if (type === "org") {
      orgBox.visible = true;
    } else if (type === "update") {
      updateDim.visible = true;
      updateBox.visible = true;
      // Fresh notes start at the top of the changelog
      updateScroll.scrollTop = 0;
      // Selection is driven by updateSelectedOption + the global key handler
      // (see the "Update panel" block); there is no focusable Select here.
    }
    renderer.requestRender();
  }

  // ── Help overlay (OpenTUI components) ────────────────────────
  const helpSections = buildHelpSections();
  const helpBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
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
      width: 1,
      trackOptions: {
        backgroundColor: colors.bg,
        foregroundColor: colors.muted,
      },
    },
  });
  for (const section of helpSections) {
    const sectionBox = new BoxRenderable(renderer, {
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
          fg: colors.text,
        }),
      );
    }
    if (section.note) {
      sectionBox.add(
        new TextRenderable(renderer, {
          content: `  ${section.note}`,
          fg: colors.muted,
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
    title: " Comparison ",
    titleColor: colors.yellow,
  });
  const compareText = new TextRenderable(renderer, {
    content: "",
    fg: colors.text,
    bg: colors.bg,
    selectable: false,
  });
  compareBox.add(compareText);
  root.add(compareBox);

  // ── Notifications overlay ────────────────────────────────────
  const notifsBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.bg,
    title: " Notifications ",
    titleColor: colors.yellow,
  });
  const notifsText = new TextRenderable(renderer, {
    content: "(no notifications)",
    fg: colors.text,
    bg: colors.bg,
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

  // ── Leader menu overlay (Esc key) ─────────────────────────────
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
    ...NON_INTERACTIVE_TEXT,
    content:
      " ↑↓ select   Enter run   Esc/q close   ·   click to run   click outside to close ",
    fg: colors.muted,
    bg: colors.surfaceDim,
    height: 1,
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
    height: 24,
    left: "22.5%",
    top: "20%",
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
  // Version header only — the release notes below it are rendered markdown.
  const updateHeader = new TextRenderable(renderer, {
    content: "",
    fg: colors.accent,
    bg: colors.surfaceDim,
  });
  const updateNotes = createMarkdownView({
    renderer,
    colors,
    // Notes ship with the release and are mostly prose/lists; skip the
    // image pipeline in this narrow panel.
    images: false,
    background: colors.surfaceDim,
  });
  // ponytail: the notes are markdown now; keep the content a column so
  // blocks stack and the scroll box can measure them.
  const updateScroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    backgroundColor: colors.surfaceDim,
    scrollY: true,
    scrollX: false,
    viewportOptions: { backgroundColor: colors.surfaceDim },
    contentOptions: {
      backgroundColor: colors.surfaceDim,
      flexDirection: "column",
    },
    scrollbarOptions: {
      width: 1,
      trackOptions: {
        backgroundColor: colors.surfaceDim,
        foregroundColor: colors.muted,
      },
    },
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
    fg: updateSelectedOption === 0 ? colors.yellow : colors.text,
    bg: colors.surfaceDim,
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
    fg: updateSelectedOption === 1 ? colors.yellow : colors.text,
    bg: colors.surfaceDim,
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
    fg: updateSelectedOption === 2 ? colors.yellow : colors.text,
    bg: colors.surfaceDim,
  });
  neverBox.add(neverText);

  function renderUpdateOptions() {
    updateNowBox.borderColor =
      updateSelectedOption === 0 ? colors.yellow : colors.border;
    laterBox.borderColor =
      updateSelectedOption === 1 ? colors.yellow : colors.border;
    neverBox.borderColor =
      updateSelectedOption === 2 ? colors.yellow : colors.border;
    updateNowText.fg = updateSelectedOption === 0 ? colors.yellow : colors.text;
    laterText.fg = updateSelectedOption === 1 ? colors.yellow : colors.text;
    neverText.fg = updateSelectedOption === 2 ? colors.yellow : colors.text;
    renderer.requestRender();
  }

  // ── Update panel mouse ────────────────────────────────────────────
  // Click a card to select *and* run it in one gesture: these three options are
  // terminal actions (install now / snooze / suppress), and a modal that needs
  // select-then-Enter would be two clicks for the common case. `renderUpdateOptions`
  // stays the single source of truth for the colours.
  function runUpdateOption(index: number) {
    updateSelectedOption = index;
    renderUpdateOptions();
    const action = ["now", "later", "never"][index] as
      "now" | "later" | "never" | undefined;
    if (action === "now") {
      showOverlay("none");
      // ponytail: record the running version so the next launch detects the upgrade
      recordPreUpdateState(cachedVersion ?? "");
      performUpdate()
        .then((ok) => {
          if (ok) {
            setStatus("✓ Update complete — restart ghfind");
          } else {
            setStatus("✗ Update failed — check terminal output");
          }
        })
        .catch(() => {
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
  }

  const updateCards: [BoxRenderable, number][] = [
    [updateNowBox, 0],
    [laterBox, 1],
    [neverBox, 2],
  ];
  for (const [box, index] of updateCards) {
    attachClickableBox(renderer, box, {
      onActivate: () => runUpdateOption(index),
      idleBorder:
        updateSelectedOption === index ? colors.yellow : colors.border,
      activeBorder: colors.yellow,
      // Hovering must not fight the selection highlight, so it only moves the
      // pointer cursor; the border stays owned by renderUpdateOptions().
      onStateChange: () => {
        box.borderColor =
          updateSelectedOption === index ? colors.yellow : colors.border;
      },
    });
  }

  // Clicking the dim layer behind the panel dismisses it without applying
  // anything (equivalent to Esc).
  attachClickOutside(updateDim, () => {
    showOverlay("none");
    renderer.requestRender();
  });

  updateOptionsRow.add(updateNowBox);
  updateOptionsRow.add(laterBox);

  const updateFooter = new TextRenderable(renderer, {
    ...NON_INTERACTIVE_TEXT,
    content:
      "  ↑↓/jk/PgUp/PgDn scroll  ←→ select  Enter  Esc/q close  ·  click a button  click outside to close",
    fg: colors.muted,
    bg: colors.surfaceDim,
    height: 1,
    paddingX: 1,
  });
  updateBox.add(updateScroll);
  updateScroll.add(updateHeader);
  updateScroll.add(updateNotes.renderable);
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
    const current = menuStack.pop();
    if (!current) return false;
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
      return (
        opt?.value &&
        typeof (opt.value as { fullName?: unknown })?.fullName === "string"
      );
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
          name: "Org profile",
          description: "Org summary for the selected repo's owner",
          action: () => {
            const opt = resultsSelect.getSelectedOption();
            const repo = opt?.value as Repo | undefined;
            if (repo?.owner) {
              showOverlay("none");
              showOrgProfile(repo.owner);
            }
          },
        },
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
    navItems.push(
      {
        type: "action",
        name: "Packages",
        description: "Search npm packages",
        action: () => {
          showOverlay("none");
          showPackagesMode();
        },
      },
      {
        type: "action",
        name: "Org profile",
        description: "Look up any GitHub organization",
        action: () => {
          showOverlay("none");
          // Pre-fill with the selected repo's owner, if any
          const opt = resultsSelect.getSelectedOption();
          const repo = opt?.value as Repo | undefined;
          showOrgProfile(repo?.owner ?? currentQueryInput.trim());
        },
      },
    );
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
          saveSession(buildSessionState());
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

  // ponytail: post-upgrade panel — fires when lastInstalledVersion != current version
  // (no network, just reads bundled release notes for the new version)
  function checkPostUpgradePanel() {
    const state = readUpdateState();
    if (state.suppressed) return;
    if (!cachedVersion) {
      cachedVersion = getVersion();
    }
    const currentVersion = cachedVersion;
    if (!state.lastInstalledVersion) return;
    if (state.lastInstalledVersion === currentVersion) return;
    // We just upgraded — show notes for the new version
    const notes = fetchReleaseNotes(currentVersion);
    // Acknowledge immediately: this panel's trigger is a version inequality,
    // so leaving it unacknowledged makes it reappear on every launch.
    markPostUpgradeSeen(currentVersion);
    updateSelectedOption = 0;
    updateHeader.content = `  Updated ghfind ${state.lastInstalledVersion} → ${currentVersion}\n`;
    updateNotes.setContent(
      notes ?? "_No release notes found for this version._",
    );
    renderUpdateOptions();
    showOverlay("update");
  }

  async function checkForUpdateAndShow(force: boolean = false) {
    if (!force && !shouldCheckUpdate()) return;
    if (cachedVersion === null) {
      cachedVersion = getVersion();
    }
    const currentVersion = cachedVersion;
    // ponytail: DEBUG_FORCE_UPDATE lets you test the panel without a real newer version
    const latest =
      process.env.DEBUG_FORCE_UPDATE || (await checkForUpdate(currentVersion));
    markUpdateChecked(latest ?? undefined);
    if (latest) {
      updateSelectedOption = 0;
      const notes = fetchReleaseNotes(latest);
      updateHeader.content = `  A new version is available\n\n  Current: ${currentVersion}\n  Latest:   ${latest}\n`;
      updateNotes.setContent(notes ?? "Run `npm install -g ghfind` to update.");
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
          ? `${currentQueryInput.slice(0, 37)}...`
          : currentQueryInput;
      saveSearch(
        name,
        currentQueryInput,
        currentMode === "trending" ? "trending" : "search",
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

  // ── Org profile overlay ─────────────────────────────────────
  const orgBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.surface,
    title: " Org profile ",
    titleColor: colors.green,
  });
  const orgScroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    backgroundColor: colors.bg,
    scrollY: true,
    scrollX: false,
    paddingX: 1,
    viewportOptions: { backgroundColor: colors.bg },
    contentOptions: { backgroundColor: colors.bg, flexDirection: "column" },
    scrollbarOptions: {
      width: 1,
      trackOptions: {
        backgroundColor: colors.bg,
        foregroundColor: colors.muted,
      },
    },
  });
  const orgText = new TextRenderable(renderer, {
    content: "",
    fg: colors.text,
    bg: colors.bg,
  });
  orgScroll.add(orgText);
  orgBox.add(orgScroll);
  const orgFooter = new TextRenderable(renderer, {
    content: "  ↑↓/jk scroll  Esc/q close",
    fg: colors.muted,
    bg: colors.bg,
    height: 1,
    paddingX: 1,
  });
  orgBox.add(orgFooter);
  root.add(orgBox);

  function formatOrgSummary(p: OrgProfile): string {
    const lines: string[] = [];
    const title = p.name ? `${p.login} — ${p.name}` : p.login;
    lines.push(title);
    if (p.description) lines.push(p.description);
    if (p.location) lines.push(`Location  ${p.location}`);
    if (p.blog) lines.push(`Web       ${p.blog}`);
    if (p.createdAt) lines.push(`Created   ${p.createdAt.slice(0, 10)}`);
    lines.push(
      `Repos     ${p.publicRepoCount.toLocaleString()} public${p.fetchedRepoCount < p.publicRepoCount ? ` (aggregated ${p.fetchedRepoCount})` : ""}`,
    );
    lines.push(
      `Stars     ${p.totalStars.toLocaleString()} (sum of aggregated repos)`,
    );
    lines.push(
      `Forks     ${p.totalForks.toLocaleString()} (sum of aggregated repos)`,
    );
    if (p.topLanguages.length > 0) {
      lines.push(
        `Languages ${p.topLanguages.map((l) => `${l.language} (${l.repos})`).join(", ")}`,
      );
    }
    if (p.topRepos.length > 0) {
      lines.push("");
      lines.push("Top repos by stars:");
      for (const r of p.topRepos) {
        lines.push(
          `  ${r.fullName}  ★ ${r.stars.toLocaleString()}  ${r.language ?? ""}`,
        );
      }
    }
    if (p.activeRepos.length > 0) {
      lines.push("");
      lines.push("Recently active:");
      for (const r of p.activeRepos) {
        lines.push(`  ${r.fullName}  pushed ${r.pushedAt.slice(0, 10)}`);
      }
    }
    return lines.join("\n");
  }

  async function showOrgProfile(owner: string) {
    const name = owner.trim().replace(/^@/, "");
    if (!name) {
      setStatus("No org selected");
      return;
    }
    orgBox.title = ` Org profile — ${name} `;
    orgText.content = `  Loading org profile for ${name}...`;
    showOverlay("org");
    try {
      const profile = await fetchOrgProfile(name, { token: githubToken });
      orgText.content = formatOrgSummary(profile);
    } catch (err) {
      orgText.content = `  Failed to load org profile: ${err instanceof Error ? err.message : String(err)}`;
    }
    renderer.requestRender();
  }

  // ── README viewer overlay ────────────────────────────────────
  const readmeBox = new BoxRenderable(renderer, {
    visible: false,
    flexGrow: 1,
    backgroundColor: colors.surface,
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
      width: 1,
      trackOptions: {
        backgroundColor: colors.bg,
        foregroundColor: colors.muted,
      },
    },
  });
  // Full markdown rendering (headings, tables, code, inline images).
  const readmeView = createMarkdownView({
    renderer,
    colors,
    loadImage: (url) => fetchImageBytes(url, { token: githubToken }),
    getImageWidth: () => Math.max(24, (process.stdout.columns || 80) - 12),
  });
  readmeScroll.add(readmeView.renderable);
  readmeBox.add(readmeScroll);

  const readmeFooterText = () =>
    `  ↑↓/jk scroll  PgUp/PgDn page  i images: ${
      readmeView.imagesEnabled ? "on" : "off"
    }  Esc/q close`;
  const readmeFooter = new TextRenderable(renderer, {
    content: readmeFooterText(),
    fg: colors.muted,
    bg: colors.bg,
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
    readmeView.setContent(`Loading README for ${repo.fullName}…`);
    readmeFooter.content = readmeFooterText();
    readmeScroll.scrollTop = 0;
    showOverlay("readme");
    try {
      const readme = await fetchReadme(repo.owner, repo.name, {
        token: githubToken,
        private: repo.private,
      });
      if (readme) {
        readmeView.setContent(readme.text, readme.sourceUrl);
      } else {
        readmeView.setContent(`_(no README found for ${repo.fullName})_`);
      }
    } catch {
      readmeView.setContent("_Failed to load README._");
    }
    renderer.requestRender();
  }

  // ── Status bar ──────────────────────────────────────────────────────
  const statusBar = new TextRenderable(renderer, {
    content: " Ready. Press Enter to search.",
    fg: colors.muted,
    height: 1,
    paddingX: 1,
  });
  root.add(statusBar);

  // ── Menu button (bottom-right corner) ─────────────────────────────
  // Mouse-only affordance: Space types a space in the query, so a mouse user
  // needs a target to reach the command menu. Absolutely positioned so it
  // floats over the results pane instead of stealing a flex row, and added
  // after every other root child so it wins the hit test on overlap.
  const menuButton = new BoxRenderable(renderer, {
    position: "absolute",
    bottom: 1,
    right: 1,
    height: 1,
    paddingX: 1,
    backgroundColor: colors.surface,
    focusable: false,
  });
  const menuButtonLabel = new TextRenderable(renderer, {
    ...NON_INTERACTIVE_TEXT,
    content: "☰ menu",
    fg: colors.muted,
    bg: colors.surface,
    height: 1,
  });
  menuButton.add(menuButtonLabel);
  root.add(menuButton);

  menuButton.onMouseDown = (event) => {
    event.stopPropagation();
    // Toggle, so clicking the button twice returns to where you were.
    if (currentOverlay === "leader") showOverlay("none");
    else showLeaderMenu();
    renderer.requestRender();
  };
  menuButton.onMouseOver = () => {
    renderer.setMousePointer("pointer");
    menuButtonLabel.fg = colors.accent;
    renderer.requestRender();
  };
  menuButton.onMouseOut = () => {
    renderer.setMousePointer("default");
    menuButtonLabel.fg = colors.muted;
    renderer.requestRender();
  };

  const statusMgr = new StatusManager((text) => {
    statusBar.content = ` ${text}`;
    renderer.requestRender();
  });
  setTimeout(() => {
    if (currentOverlay === "none") {
      setStatus(nextTip());
    }
  }, 2000);

  // ── Token fix flow (from 401/403 error hints) ───────────────────────
  // Inline prompt box that slides over the search input row. Enter saves the
  // token to config and re-runs the failed query; Esc cancels.
  const tokenPromptBox = new BoxRenderable(renderer, {
    visible: false,
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    flexDirection: "row",
    paddingY: 1,
    paddingLeft: 1,
    backgroundColor: colors.surface,
  });
  const tokenPromptLabel = new TextRenderable(renderer, {
    content: " GitHub token:",
    fg: colors.accent,
    height: 1,
  });
  const tokenPromptInput = new InputRenderable(renderer, {
    placeholder: "paste token, Enter to save — Esc cancels",
    value: "",
    backgroundColor: colors.surface,
    textColor: colors.text,
    flexGrow: 1,
  });
  tokenPromptBox.add(tokenPromptLabel);
  tokenPromptBox.add(tokenPromptInput);
  root.add(tokenPromptBox);

  let tokenPromptQuery: string | null = null;

  function showTokenPrompt(query: string) {
    tokenPromptQuery = query;
    tokenPromptInput.value = "";
    tokenPromptBox.visible = true;
    searchBox.visible = false;
    tokenPromptInput.focus();
    renderer.requestRender();
  }

  function hideTokenPrompt() {
    tokenPromptBox.visible = false;
    tokenPromptQuery = null;
    if (currentMode === "search" || currentMode === "packages") {
      searchBox.visible = true;
      searchInput.focus();
    }
    renderer.requestRender();
  }

  function persistToken(token: string): void {
    githubToken = token;
    config.githubToken = token;
    saveConfig(config);
  }

  tokenPromptInput.on("enter", () => {
    const token = tokenPromptInput.value.trim();
    const query = tokenPromptQuery;
    hideTokenPrompt();
    if (!token || !query) return;
    persistToken(token);
    setStatus("Token saved");
    doSearch(query);
  });

  // ── Error-hint key actions ([t] fix token, [u] unset) ──────────────

  function fixTokenAction() {
    showTokenPrompt(currentQueryInput || "stars:>10000");
  }

  function unsetTokenAction() {
    githubToken = undefined;
    if (config.githubToken) {
      delete config.githubToken;
      saveConfig(config);
    }
    setStatus("Token cleared — searching without one");
    if (currentQueryInput) doSearch(currentQueryInput);
  }

  // ── Helper functions ────────────────────────────────────────────────

  function setStatus(msg: string) {
    statusMgr.set("idle", msg);
  }

  /**
   * Which error family is showing in the status bar, for the bracketed key
   * hints the messages advertise ([r]etry, [t]/[c] token, [u]nset).
   * Null once the next search starts, so the hint keys can't hijack
   * theme/compare forever after a transient failure.
   */
  type ErrorHintKind = "auth" | "forbidden" | "ratelimit" | "network" | null;
  let errorHint: ErrorHintKind = null;

  /** Render an error in the status bar and remember which hints apply. */
  function reportError(err: unknown) {
    errorHint =
      err instanceof AuthError
        ? "auth"
        : err instanceof ForbiddenError
          ? "forbidden"
          : err instanceof RateLimitError
            ? "ratelimit"
            : err instanceof NetworkError
              ? "network"
              : null;
    const msg =
      err instanceof SearchCliError
        ? err.userMessage
        : err instanceof Error
          ? err.message
          : String(err);
    statusMgr.set("error", msg.slice(0, 60));
  }

  /** Session snapshot; only restorable modes are persisted (see SessionState). */
  function buildSessionState(): SessionState {
    const mode: SessionState["mode"] =
      currentMode === "trending"
        ? "trending"
        : currentMode === "packages"
          ? "packages"
          : "search";
    return {
      mode,
      query: currentQueryInput,
      sort: currentSort,
      limit: currentLimit,
      trendingTab,
    };
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
        label =
          val >= 1000
            ? `${(val / 1000).toFixed(1).replace(/\.0$/, "")}k`
            : String(val);
        label = `${label.padStart(5)} `;
      }
      lines.push(`${label}┆${chars.join("")}`);
    }

    // X-axis with week labels
    const xAxis = `     ┆${"─".repeat(termW)}`;
    const weekLabels = `     ┆ ${"1w".padEnd(Math.floor(termW / 4))} ${"13w".padEnd(Math.floor(termW / 4))} ${"26w".padEnd(Math.floor(termW / 4))} ${"52w"}`;
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
        }).then(
          (
            r,
          ): Promise<{
            all?: number[];
            topics?: string[];
            message?: string;
          } | null> | null =>
            r.ok
              ? (r.clone().json() as Promise<{
                  all?: number[];
                  topics?: string[];
                  message?: string;
                }>)
              : null,
        ),
      ]);
      let chartSection = "";
      if (chartRes.ok) {
        const data = (await chartRes.json()) as {
          all?: number[];
          message?: string;
        };
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
          chartSection = ["", "Weekly commits (52 weeks)", ...chartLines].join(
            "\n",
          );
        } else if (data?.message) {
          chartSection = ["", `Chart unavailable: ${data.message}`].join("\n");
        }
      } else {
        chartSection = ["", `Chart unavailable (API ${chartRes.status})`].join(
          "\n",
        );
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
    errorHint = null;
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
      const response = await searchModule.search(trendingQuery(), {
        limit: 25,
        sort: "stars",
        json: false,
        verbose: false,
        trendingSince: tabSince(trendingTab),
      });
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
      resultsSelect.options = [
        { name: " (error)", description: "", value: null },
      ];
      reportError(err);
    }
    isLoading = false;
    renderer.requestRender();
  }

  function showSearchMode() {
    currentMode = "search";
    trendingTabBox.visible = false;
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
    searchBox.visible = true;
    toolbarText.visible = true;
    body.visible = true;
    searchInput.placeholder =
      "Search npm packages (e.g. react, vue, typescript)";
    searchInput.focus();
    packages = [];
    resultsSelect.options = [
      {
        name: "",
        description: "Type a query and press Enter to search",
        value: null,
      },
    ];
    detailText.content = "";
    renderer.requestRender();
  }
  async function doPackageSearch(queryText: string) {
    const q = queryText.trim();
    if (q === "" || isLoading) return;
    currentQueryInput = q;
    isLoading = true;
    errorHint = null; // npm errors never carry GitHub auth hints
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
      const msg = err instanceof Error ? err.message : String(err);
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

    errorHint = null; // a fresh search retires the previous error's hint keys
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
        // A zero-result search usually means one qualifier over-constrained
        // it. Offer the ranked loosenings instead of generic advice.
        throw new NoResultsError(
          q,
          suggestRelaxations(parsed).map((r) => r.suggestion),
        );
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
      // A failed "load more" page must not wipe the pages already on screen.
      if (!append) {
        currentRepos = [];
        resultsSelect.options = [
          { name: " (error)", description: "", value: null },
        ];
      }
      reportError(err);
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
    const idx = PACKAGE_SORT_MODES.findIndex(
      (m) => m.key === currentPackageSort,
    );
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

  // Pasted content flows through "input"; purge JSON-shaped blobs that
  // slipped into the query (a search line is never raw JSON: objects/arrays
  // always arrive as paste payloads from API responses / deep-dive output).
  searchInput.on("input", () => {
    const v = searchInput.value;
    if (v.length > 0) {
      const t = v.trim();
      if (
        (t.startsWith("{") && t.endsWith("}")) ||
        (t.startsWith("[") && t.endsWith("]"))
      ) {
        searchInput.value = "";
        setStatus("Ignored JSON paste — search queries accept plain text");
        renderer.requestRender();
      }
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

  // ── Mouse on the results list ───────────────────────────────────────
  // Click selects (the `selectionChanged` handler above refreshes the detail
  // pane), double-click opens via the same path as Enter, and the wheel steps
  // the selection. `keepFocus` stops OpenTUI from auto-focusing the list away
  // from the query input, so typing after a click still edits the query.
  attachClickToSelect(renderer, resultsSelect, {
    keepFocus: true,
    onOpen: () => resultsSelect.selectCurrent(),
  });

  /**
   * Enter-equivalent for every list overlay. Single source of truth for both
   * the keyboard handler below and the overlay mouse wiring, so a click can
   * never drift from pressing Enter.
   */
  function activateOverlaySelection() {
    switch (currentOverlay) {
      case "history": {
        const sel = historySelect.getSelectedOption();
        if (sel?.value) {
          const entry = (sel.value as { entry?: HistoryEntry }).entry;
          showOverlay("none");
          if (!entry) return;
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
      case "bookmarks": {
        const sel = bookmarksSelect.getSelectedOption();
        if (sel?.value)
          openUrl((sel.value as { repo?: { url?: string } }).repo?.url ?? "");
        return;
      }
      case "saved": {
        const sel = savedSelect.getSelectedOption();
        if (sel?.value) {
          const s = sel.value as SavedSearch;
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
      case "topics": {
        const sel = topicsSelect.getSelectedOption();
        if (sel?.value) {
          const topic = sel.value as { name?: string };
          showOverlay("none");
          searchInput.value = `topic:${topic.name ?? ""}`;
          showSearchMode();
          doSearch(`topic:${topic.name}`);
        }
        return;
      }
      case "export": {
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
      case "share": {
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
      case "help": {
        showOverlay("none");
        renderer.requestRender();
        return;
      }
      default:
        // Leader / update / readme / org / compare / notifications have their
        // own activation paths (see the key handler) or are not list-driven.
        return;
    }
  }

  /**
   * Wire the overlay lists. A click selects, a double-click activates (the
   * overlay's Enter-equivalent), the wheel scrolls, and a click on the panel
   * outside the rows dismisses the overlay like Esc.
   */
  function attachOverlayMouse(
    box: Parameters<typeof attachClickOutside>[0],
    select: Parameters<typeof attachClickToSelect>[1],
  ) {
    attachClickToSelect(renderer, select, {
      onOpen: () => activateOverlaySelection(),
      onClickMiss: () => {
        showOverlay("none");
        renderer.requestRender();
      },
    });
    attachClickOutside(box, () => {
      showOverlay("none");
      renderer.requestRender();
    });
  }

  attachOverlayMouse(historyBox, historySelect);
  attachOverlayMouse(bookmarksBox, bookmarksSelect);
  attachOverlayMouse(savedBox, savedSelect);
  attachOverlayMouse(topicsBox, topicsSelect);
  attachOverlayMouse(exportBox, exportSelect);
  attachOverlayMouse(shareBox, shareSelect);

  // Read-only overlays have no rows to click, so the panel itself is the
  // dismiss target (same as Esc). Their ScrollBox children handle the wheel
  // natively; claiming it here stops the renderer from also feeding the
  // focused-renderable fallback.
  for (const panel of [helpBox, orgBox, readmeBox, compareBox, notifsBox]) {
    attachClickOutside(panel, () => {
      showOverlay("none");
      renderer.requestRender();
    });
  }
  for (const scroller of [helpScroll, orgScroll, readmeScroll, updateScroll]) {
    scroller.onMouseScroll = (event) => {
      event.stopPropagation();
    };
  }

  // Leader menu: the list activates like Enter, but the dim layer behind the
  // floating menu is the click-outside target (the menu box itself is nested
  // inside it and stops propagation).
  attachClickToSelect(renderer, leaderSelect, {
    onOpen: () => {
      const entry = leaderSelect.getSelectedOption()?.value as
        MenuEntry | undefined;
      if (!entry) return;
      if (entry.type === "category") {
        pushMenuLevel(`  Menu > ${entry.name}`, entry.name, entry.children, 0);
      } else {
        resetMenu();
        showOverlay("none");
        entry.action();
      }
      renderer.requestRender();
    },
    onClickMiss: () => {
      showOverlay("none");
      renderer.requestRender();
    },
  });
  attachClickOutside(leaderDim, () => {
    showOverlay("none");
    renderer.requestRender();
  });

  // ── Global keyboard shortcuts ──────────────────────────────────────
  renderer.keyInput.on("keypress", (key) => {
    // ── Token prompt (own keyboard scope) ──────────────────────────
    if (tokenPromptBox.visible) {
      if (key.name === "escape") {
        hideTokenPrompt();
        setStatus("Token entry cancelled");
        renderer.requestRender();
        return;
      }
      if (key.name === "enter" || key.name === "return") return; // InputRenderable fires "enter"
      return; // let the input consume everything else (letters, paste, etc.)
    }

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

      // Org profile viewer: scrollable, Esc/q already handled above
      if (currentOverlay === "org") {
        return;
      }

      // README viewer: scrollable, Esc/q already handled above
      if (currentOverlay === "readme") {
        if (key.name === "i") {
          readmeView.setImagesEnabled(!readmeView.imagesEnabled);
          readmeFooter.content = readmeFooterText();
          setStatus(
            readmeView.imagesEnabled ? "README images on" : "README images off",
          );
          renderer.requestRender();
        }
        return;
      }

      // History overlay
      if (currentOverlay === "history") {
        if (key.name === "d") {
          const sel = historySelect.getSelectedOption();
          if (sel?.value) {
            const idx = (sel.value as { index?: number }).index;
            if (idx !== undefined) deleteHistoryEntry(idx);
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
          activateOverlaySelection();
          return;
        }
        return;
      }

      // Bookmarks overlay
      if (currentOverlay === "bookmarks") {
        if (key.name === "d") {
          const sel = bookmarksSelect.getSelectedOption();
          if (sel?.value) {
            removeBookmark(
              (sel.value as { repo?: { fullName: string } }).repo?.fullName ??
                "",
            );
            refreshBookmarks();
            setStatus("Bookmark removed");
          }
          renderer.requestRender();
          return;
        }
        if (key.name === "enter" || key.name === "return") {
          activateOverlaySelection();
          return;
        }
        return;
      }

      // Saved searches overlay
      if (currentOverlay === "saved") {
        if (key.name === "d") {
          const sel = savedSelect.getSelectedOption();
          if (sel?.value) {
            deleteSavedSearch((sel.value as { name?: string }).name ?? "");
            refreshSavedSearches();
            setStatus("Saved search deleted");
          }
          renderer.requestRender();
          return;
        }
        if (key.name === "enter" || key.name === "return") {
          activateOverlaySelection();
          return;
        }
        return;
      }

      // Topics explorer overlay
      if (currentOverlay === "topics") {
        if (key.name === "enter" || key.name === "return") {
          activateOverlaySelection();
          return;
        }
        return;
      }

      // Export overlay
      if (currentOverlay === "export") {
        if (key.name === "enter" || key.name === "return") {
          activateOverlaySelection();
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
          activateOverlaySelection();
          return;
        }
        return;
      }

      // Help overlay: any key closes
      if (currentOverlay === "help") {
        activateOverlaySelection();
        return;
      }

      // Update panel
      if (currentOverlay === "update") {
        if (key.name === "escape" || key.name === "q") {
          showOverlay("none");
          renderer.requestRender();
          return;
        }
        // Notes area is scrollable — ↑↓/jk move a fifth of a page,
        // PageUp/PageDown/Home/End jump, all via the ScrollBox's native
        // handler (same semantics as the readme/org viewers); ←/→ still
        // drive the button row, not the scrollbar.
        if (
          key.name === "pageup" ||
          key.name === "pagedown" ||
          key.name === "home" ||
          key.name === "end" ||
          key.name === "up" ||
          key.name === "down" ||
          key.name === "j" ||
          key.name === "k"
        ) {
          updateScroll.handleKeyPress(key);
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
          runUpdateOption(updateSelectedOption);
          return;
        }
        return;
      }

      return;
    }

    // ── Main view handling (no overlay active) ────────────────────────

    // The landing screen owns the keyboard: its handler above already
    // consumed its keys, and everything else must be ignored here so hidden
    // main-view bindings (search focus, leader menu, theme, compare, quit)
    // can't fire through the landing menu.
    if (currentMode === "landing") {
      return;
    }

    // q quits
    if (key.name === "q") {
      if (graphFullscreen) {
        toggleGraph();
        return;
      }
      saveSession(buildSessionState());
      cleanup();
      return;
    }

    // Esc exits graph mode
    if (key.name === "escape" && graphFullscreen) {
      toggleGraph();
      return;
    }

    // Esc toggles the leader menu — the only binding for it. Space used to open it
    // when the query input was not focused, which made the same key mean two
    // things depending on invisible state; it is now reserved for typing.
    if (key.name === "escape") {
      if (currentOverlay !== "none") {
        // Only reachable for the leader menu — every other overlay returned
        // above, and its own branch already closed it.
        showOverlay("none");
        setToolbar();
      } else {
        showLeaderMenu();
      }
      renderer.requestRender();
      return;
    }

    // Error-hint keys — active only while a status-bar error that advertises
    // them ([r]etry / [t]oken / [u]nset / [c]ycle) is on screen; the next
    // search clears the state, returning t/c to their normal roles.
    if (!searchInput.focused && errorHint) {
      if (key.name === "r") {
        errorHint = null;
        if (currentMode === "trending") loadTrending();
        else if (currentQueryInput) doSearch(currentQueryInput);
        renderer.requestRender();
        return;
      }
      if (
        key.name === "t" &&
        (errorHint === "auth" || errorHint === "forbidden")
      ) {
        fixTokenAction();
        return;
      }
      if (key.name === "u" && errorHint === "auth") {
        unsetTokenAction();
        return;
      }
      if (key.name === "c" && errorHint === "ratelimit") {
        fixTokenAction(); // TUI manages a single token — prompt for a different one
        return;
      }
    }

    // 't' toggles theme and persists to config
    if (key.name === "t" && !searchInput.focused) {
      const current = config.theme;
      const themes = listThemes();
      const idx = themes.indexOf(current);
      const next = themes[(idx + 1) % themes.length];
      const nextTheme = loadTheme(next);
      Object.assign(colors, nextTheme);
      // Keep the terminal-matched backdrop and blended layers across theme
      // switches (fall back to the new theme's own layers when no detection).
      if (terminalBg) {
        colors.bg = terminalBg;
        Object.assign(colors, deriveSurfaceLayers(terminalBg));
      }
      renderer.setBackgroundColor(colors.bg);
      config.theme = next;
      saveConfig(config);
      renderer.requestRender();
      return;
    }

    // 'c' toggles compare on selected repo (when not typing in search)
    if (key.name === "c" && !searchInput.focused) {
      toggleCompareOnSelected();
      refreshCompare();
      showOverlay("compare");
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
        const idx = parseInt(key.name, 10) - 1;
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
  const _currentVersion = getVersion();
  // ── Start ──────────────────────────────────────────────────────────
  // Always start on the landing menu. Saved sessions restore preferences
  // (sort/limit/trending tab) and pre-fill the query once a mode is picked,
  // but never auto-run a search — a stale or corrupted session (e.g. an MCP
  // handshake blob saved as a query) used to hijack startup and skip the
  // menu on every launch.
  showLanding(true);
  checkForUpdateAndShow();
  checkPostUpgradePanel();
  renderer.start();
  renderer.requestRender();
}

// ── Utilities ─────────────────────────────────────────────────────────

function formatResultLine(repo: Repo): string {
  const stars = `★ ${fmtStars(repo.stars)}`;
  const lang = (repo.language ?? "?").padEnd(12).slice(0, 12);
  const name = repo.fullName.padEnd(40).slice(0, 40);
  return `${name}  ${lang}  ${stars}`;
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
if (
  import.meta.main &&
  !process.env.GHFIND_BUNDLED &&
  !process.env.GHFIND_CLI_RUN
) {
  launchBrowser();
}
