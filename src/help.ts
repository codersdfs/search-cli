/**
 * Help screen — structured sections rendered by OpenTUI components.
 *
 * Each section has a title (with category color) and formatted rows.
 * The TUI builds these into Box + TextRenderable components inside a ScrollBox.
 */

export interface HelpRow {
  keys: string;
  action: string;
}

export interface HelpSection {
  title: string;
  /** Theme color key or hex — used for Box title color */
  titleColor: string;
  rows: HelpRow[];
  note?: string;
}

export function buildHelpSections(): HelpSection[] {
  return [
    {
      title: " Navigation ",
      titleColor: "blue",
      rows: [
        { keys: "↑ ↓ / j k", action: "Move selection" },
        { keys: "Enter / o", action: "Open repo in browser" },
        { keys: "/", action: "Focus search input" },
        { keys: "t", action: "Toggle search / trending" },
        { keys: "? / Ctrl+H", action: "Toggle this help screen" },
        { keys: "q", action: "Quit" },
      ],
    },
    {
      title: " Search Mode ",
      titleColor: "green",
      rows: [
        { keys: "s", action: "Cycle sort: best-match → stars → …" },
        { keys: "l", action: "Cycle limit: 10 → 25 → 50 → 100" },
        { keys: "r", action: "Refresh / re-run last search" },
        { keys: "g", action: "Toggle activity graph fullscreen" },
        { keys: "Tab", action: "Auto-complete qualifier" },
        { keys: "b", action: "Bookmark / unbookmark selected repo" },
      ],
    },
    {
      title: " Trending Mode ",
      titleColor: "yellow",
      rows: [
        { keys: "1-5", action: "Switch tab: Today → Week → Month → …" },
        { keys: "← → / h l", action: "Navigate tabs" },
        { keys: "r", action: "Refresh" },
      ],
    },
    {
      title: " Power Tools ",
      titleColor: "purple",
      rows: [
        { keys: "d", action: "Deep-dive: README + commit activity" },
        { keys: "c", action: "Add/remove repo from comparison" },
        { keys: "C (Shift+c)", action: "Show comparison view" },
        { keys: "E (Shift+e)", action: "Topic explorer" },
        { keys: "B (Shift+b)", action: "Bookmarks panel" },
        { keys: "PageDown / Ctrl+F", action: "Next page of results" },
        { keys: "PageUp / Ctrl+B", action: "Scroll to top of results" },
      ],
    },
    {
      title: " Overlays ",
      titleColor: "teal",
      rows: [
        { keys: "Ctrl+R", action: "Search history" },
        { keys: "Ctrl+O", action: "Saved searches" },
        { keys: "Ctrl+E", action: "Export results" },
        { keys: "Ctrl+N", action: "Notifications" },
        { keys: "Ctrl+S", action: "Save current search" },
        { keys: "Ctrl+P", action: "Share selected repo" },
      ],
    },
    {
      title: " Search Syntax ",
      titleColor: "teal",
      rows: [
        { keys: "keywords", action: "Free-text search" },
        { keys: "key:value", action: "Qualifier filter" },
        { keys: "-key:value", action: "Negated qualifier" },
        { keys: '"phrase"', action: "Exact phrase match" },
      ],
    },
    {
      title: " Qualifiers ",
      titleColor: "muted",
      rows: [
        { keys: "language:", action: "Filter by language" },
        { keys: "stars:>N", action: "Minimum stars" },
        { keys: "fork:true", action: "Include forks" },
        { keys: "user:", action: "User's repos" },
        { keys: "org:", action: "Organization repos" },
        { keys: "repo:", action: "Specific repo" },
        { keys: "topic:", action: "Filter by topic" },
        { keys: "license:", action: "License type" },
        { keys: "pushed:>YYYY-MM-DD", action: "Last push date" },
        { keys: "archived:false", action: "Exclude archived" },
      ],
    },
    {
      title: " Rate Limits ",
      titleColor: "orange",
      rows: [
        { keys: "No token", action: "10 req / min" },
        { keys: "GITHUB_TOKEN", action: "30 req / min (or your plan limit)" },
      ],
      note: "Set GITHUB_TOKEN in your environment or add to config.",
    },
  ];
}

/** Column at which the action description starts (right-aligns keys). */
export const HELP_KEYS_COLUMN = 24;
