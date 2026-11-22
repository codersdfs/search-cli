/**
 * view-state.ts — the TUI shell's screen, as an explicit state machine.
 *
 * The shell described its screen with two loose variables (`currentMode`,
 * `currentOverlay`) and re-derived the visibility of the five main panels by
 * hand in six places: showLanding, showOverlay("none"), showMainContent,
 * showSearchMode, showPackagesMode and loadTrending. Six copies of one matrix
 * is a state machine written as prose — the transitions are real, but nothing
 * names them, so the last copy to drift went unnoticed (`orgBox` could be
 * shown, never reset, and kept half the screen; see
 * tests/overlay-registry.test.ts, which now pins that class of bug).
 *
 * This module owns the states and their one projection (`panelsFor`). It is
 * pure — no renderer import — so the shell applies the result and tests can
 * drive any state without a terminal.
 *
 * Scope: the mode × overlay dimensions and the main-view panels they decide.
 * Overlay-owned subtrees (helpBox, historyBox, …) are still dispatched inside
 * src/tui.ts, where the show/reset pairing is pinned by tests.
 */

/** Top-level screens. `landing` is a mode, never an overlay. */
export const VIEW_MODES = [
  "landing",
  "search",
  "trending",
  "packages",
  "hn",
] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/**
 * Every overlay the shell can draw. `none` means "no overlay" — the main view
 * owns the content area.
 */
export const OVERLAY_IDS = [
  "none",
  "history",
  "bookmarks",
  "saved",
  "help",
  "topics",
  "export",
  "themes",
  "compare",
  "notifications",
  "share",
  "leader",
  "readme",
  "org",
  "update",
] as const;
export type OverlayId = (typeof OVERLAY_IDS)[number];

/**
 * Overlays that float above the main view instead of replacing it. The leader
 * menu is the only one: it dims the screen, but the results behind it must stay
 * readable (and the panels stay visible) while the user picks a command.
 */
export const FLOATING_OVERLAYS: readonly OverlayId[] = ["leader"];

export function isFloatingOverlay(overlay: OverlayId): boolean {
  return FLOATING_OVERLAYS.includes(overlay);
}

/** The two dimensions that decide what the shell shows. */
export interface ViewState {
  mode: ViewMode;
  overlay: OverlayId;
}

/** Visibility of the five panels that make up the main view. */
export interface MainPanels {
  /** The landing menu (mode cards + bookmarks button). */
  landing: boolean;
  /** The query input row. */
  search: boolean;
  /** The sort/limit/registry toolbar. */
  toolbar: boolean;
  /** The results + detail split. */
  body: boolean;
  /** The feed tab bar (trending periods, or Hacker News feeds). */
  trendingTabs: boolean;
}

const NO_PANELS: MainPanels = {
  landing: false,
  search: false,
  toolbar: false,
  body: false,
  trendingTabs: false,
};

/**
 * Project a view state onto the panels it shows.
 *
 * Rules, in order:
 *  - A full-screen overlay hides every main panel (it owns the content area).
 *  - A floating overlay leaves the panels beneath it visible, but the landing
 *    menu always steps aside for any overlay.
 *  - Otherwise the mode decides: landing shows only the menu; search,
 *    packages and HN share the body; search/packages also own the query row +
 *    toolbar; trending and HN swap the query row for their feed tab bar.
 */
export function panelsFor(state: ViewState): MainPanels {
  if (state.overlay !== "none" && !isFloatingOverlay(state.overlay)) {
    return { ...NO_PANELS };
  }
  const landing = state.mode === "landing" && state.overlay === "none";
  // Only the query-driven modes own the query row + toolbar; trending replaces
  // both with its period tabs.
  const queryRow = state.mode === "search" || state.mode === "packages";
  return {
    landing,
    search: queryRow,
    toolbar: queryRow,
    body: !landing,
    trendingTabs: state.mode === "trending" || state.mode === "hn",
  };
}

/**
 * Transition: switch mode. The overlay dimension belongs to Esc/the overlay
 * dispatch, so a mode change never opens or closes one.
 */
export function setMode(state: ViewState, mode: ViewMode): ViewState {
  return { ...state, mode };
}
