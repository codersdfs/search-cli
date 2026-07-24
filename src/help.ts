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
      title: " Command Menu (Space)",
      titleColor: "purple",
      rows: [
        { keys: "Sort", action: "Cycle sort: best-match → stars → …" },
        { keys: "Limit", action: "Cycle limit: 10 → 25 → 50 → 100" },
        { keys: "Refresh", action: "Re-run current search" },
        { keys: "Readme", action: "Full README viewer" },
        { keys: "Deep-dive", action: "Languages + contributors + excerpt" },
        { keys: "Bookmark", action: "Save / unsave selected repo" },
        { keys: "Compare", action: "Add to / remove from comparison" },
        { keys: "Trending", action: "Switch to trending browser" },
      ],
      note: "Also: Open, History, Export, Share, Topics, Saved, Notifs, Help",
    },
    {
      title: " Overlay Keys ",
      titleColor: "teal",
      rows: [
        { keys: "Esc / q", action: "Close any overlay" },
        { keys: "Enter", action: "Confirm selection / run action" },
        { keys: "d", action: "Delete entry (history, bookmarks, saved)" },
        { keys: "↑ ↓ / j k", action: "Navigate overlay list" },
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
