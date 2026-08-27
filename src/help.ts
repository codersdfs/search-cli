/** Help screen — structured sections rendered by OpenTUI components. */
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
      title: " Landing ",
      titleColor: "blue",
      rows: [
        { keys: "↑ ↓ / j k", action: "Navigate menu cards" },
        { keys: "Enter", action: "Select mode / open Bookmarks" },
        { keys: "b", action: "Jump straight to Bookmarks" },
        { keys: "? / h", action: "Toggle this help screen" },
        { keys: "q", action: "Quit" },
      ],
    },
    {
      title: " Navigation ",
      titleColor: "blue",
      rows: [
        { keys: "↑ ↓ / j k", action: "Move selection" },
        { keys: "Enter", action: "Open repo in browser" },
        { keys: "/", action: "Focus search input" },
        { keys: "Space", action: "Open command menu" },
        { keys: "? / Ctrl+H", action: "Toggle this help screen" },
        { keys: "q", action: "Quit" },
      ],
    },
    {
      title: " Main View ",
      titleColor: "green",
      rows: [
        { keys: "Tab", action: "Auto-complete qualifier" },
        { keys: "b", action: "Bookmark / unbookmark selected repo" },
        { keys: "c", action: "Compare selected repo" },
        { keys: "t", action: "Cycle theme" },
        { keys: "PageDown", action: "Next page of results" },
        { keys: "PageUp", action: "Scroll to top of results" },
      ],
    },
    {
      title: " Trending Mode ",
      titleColor: "yellow",
      rows: [
        { keys: "1-5", action: "Switch tab: Today → Week → Month → …" },
        { keys: "← → / h l", action: "Navigate tabs" },
      ],
    },
    {
      title: " Packages Mode ",
      titleColor: "cyan",
      rows: [
        { keys: "/", action: "Search npm packages" },
        { keys: "↑ ↓ / j k", action: "Move selection" },
        { keys: "Enter", action: "View package details" },
        { keys: "Space", action: "Open command menu" },
      ],
      note: "Search by name, description, or tags. Sort by downloads or score.",
    },
    {
      title: " Command Menu (Space)",
      titleColor: "purple",
      rows: [
        { keys: "Sort", action: "Cycle sort: best-match → stars → …" },
        { keys: "Limit", action: "Cycle limit: 10 → 25 → 50 → 100" },
        { keys: "Refresh", action: "Re-run current search" },
        { keys: "Graph", action: "Toggle commit activity chart" },
        { keys: "Readme", action: "Full README viewer" },
        { keys: "Deep-dive", action: "Languages + contributors + excerpt" },
        { keys: "Bookmark", action: "Save / unsave selected repo" },
        { keys: "Compare", action: "Add to / remove from comparison" },
        { keys: "Trending", action: "Switch to trending browser" },
        { keys: "Packages", action: "Switch to npm packages" },
        { keys: "Export", action: "Export results to file" },
        { keys: "Share", action: "Share repo as text" },
        { keys: "Topics", action: "Browse GitHub topics" },
        { keys: "Saved", action: "View saved searches" },
        { keys: "Notifs", action: "Check GitHub notifications" },
        { keys: "History", action: "View search history" },
        { keys: "Help", action: "Show this help screen" },
      ],
      note: "Navigate menu with ↑ ↓, select with Enter, back with ← / Esc",
    },
    {
      title: " Bookmarks Page ",
      titleColor: "green",
      rows: [
        { keys: "↑ ↓ / j k", action: "Move selection" },
        { keys: "Enter", action: "Open bookmark in browser" },
        { keys: "d", action: "Remove bookmark" },
        { keys: "Esc / ←", action: "Back to landing" },
      ],
      note: "A full page, not an overlay — Esc returns to the mode menu.",
    },
    {
      title: " Overlay Keys ",
      titleColor: "teal",
      rows: [
        { keys: "Esc / q", action: "Close any overlay" },
        { keys: "Enter", action: "Confirm selection / run action" },
        { keys: "d", action: "Delete entry (history, saved)" },
        { keys: "↑ ↓ / j k", action: "Navigate overlay list" },
        { keys: "← → / h l", action: "Navigate tabs / panels" },
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
        { keys: "language:TypeScript", action: "Filter by language" },
        { keys: "stars:>1000", action: "Minimum stars" },
        { keys: "fork:true", action: "Include forks" },
        { keys: "user:octocat", action: "User's repos" },
        { keys: "org:facebook", action: "Organization repos" },
        { keys: "repo:facebook/react", action: "Specific repo" },
        { keys: "topic:react", action: "Filter by topic" },
        { keys: "license:mit", action: "License type" },
        { keys: "pushed:>2024-01-01", action: "Last push date" },
        { keys: "archived:false", action: "Exclude archived" },
      ],
    },
    {
      title: " Utility Keys ",
      titleColor: "muted",
      rows: [
        { keys: "t", action: "Cycle theme (light / dark / solarized)" },
        { keys: "Ctrl+X", action: "Copy repo URL to clipboard" },
        { keys: "Ctrl+C", action: "Copy search query to clipboard" },
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
