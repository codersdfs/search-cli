#!/usr/bin/env node
/** hn-browser.ts — interactive Hacker News feed viewer (`ghfind hn`). */
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
import type { TextChunk, CliRenderer } from "@opentui/core";
import { openUrl } from "./open-url";
import {
  HN_FEEDS,
  HN_FEED_LABELS,
  fetchHnStories,
  relativeTime,
  type HnFeed,
  type HnStory,
} from "./hn";
import { detectTerminalBackground, deriveSurfaceLayers } from "./themes";

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
  selectionBg: "#3b6ce8",
  border: "#363b54",
  titleText: "#c0caf5",
  descText: "#6c7086",
};

const TITLE_WIDTH = Math.min(
  Math.max((process.stdout.columns ?? 100) - 10, 40),
  100,
);

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

/** Two lines per story: title + domain, then the metadata row. */
function formatStoryLine(story: HnStory, rank: number): StyledText {
  const rankStr = `${String(rank).padStart(2)}.`;
  const domain = story.domain ? ` (${story.domain})` : "";
  const title = truncate(`${story.title}${domain}`, TITLE_WIDTH);
  const meta = [
    `${story.score} pts`,
    `by ${story.author ?? "unknown"}`,
    relativeTime(story.createdAt),
    `${story.comments} comments`,
  ].join(" · ");
  const line1 = t`${fg(C.muted)(rankStr)} ${bold(fg(C.titleText)(title))}`;
  const line2 = t`    ${dim(fg(C.descText)(meta))}`;
  const newline: TextChunk = { text: "\n", __isChunk: true as const };
  return new StyledText([...line1.chunks, newline, ...line2.chunks]);
}

export interface HnBrowserOptions {
  /** Stories to load per feed (default 30). */
  limit?: number;
}

/** Open the interactive viewer on `initialFeed` (default: top). */
export async function launchHnBrowser(
  initialFeed: HnFeed = "top",
  options: HnBrowserOptions = {},
): Promise<void> {
  const limit = options.limit ?? 30;
  const terminalBg = await detectTerminalBackground();
  if (terminalBg) {
    C.bg = terminalBg;
    Object.assign(C, deriveSurfaceLayers(terminalBg));
  }

  let renderer: CliRenderer;
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

  // ── State ──
  let feed: HnFeed = initialFeed;
  let stories: HnStory[] = [];
  let selectedIdx = 0;
  let requestSeq = 0;

  // ── Outer frame ──
  const outerBox = new BoxRenderable(renderer, {
    flexGrow: 1,
    flexDirection: "column",
    backgroundColor: C.bg,
    border: true,
    borderColor: C.border,
    borderStyle: "rounded",
  });

  // ── Header ──
  const headerBox = new BoxRenderable(renderer, {
    height: 1,
    backgroundColor: C.bg,
    paddingX: 1,
  });
  headerBox.add(
    new TextRenderable(renderer, {
      content: t`${bold(fg(C.orange)("Hacker News"))}${fg(C.muted)(" — stories for the terminal")}`,
      fg: C.orange,
      bg: C.bg,
      height: 1,
    }),
  );
  outerBox.add(headerBox);

  // ── Feed tabs ──
  const tabBox = new BoxRenderable(renderer, {
    height: 1,
    backgroundColor: C.bg,
    paddingX: 1,
  });
  const tabText = new TextRenderable(renderer, {
    content: "",
    fg: C.muted,
    bg: C.bg,
    height: 1,
  });
  tabBox.add(tabText);
  outerBox.add(tabBox);

  function renderFeedTabs(): void {
    const chunks: TextChunk[] = [];
    HN_FEEDS.forEach((id, i) => {
      const label = ` ${HN_FEED_LABELS[id]} `;
      const styled =
        id === feed ? t`${bold(fg(C.cyan)(label))}` : t`${fg(C.muted)(label)}`;
      chunks.push(...styled.chunks);
      if (i < HN_FEEDS.length - 1) {
        chunks.push({ text: " ", __isChunk: true as const });
      }
    });
    tabText.content = new StyledText(chunks);
  }

  // ── Status line ──
  const statusBox = new BoxRenderable(renderer, {
    height: 1,
    backgroundColor: C.bg,
    paddingX: 1,
  });
  let statusText: TextRenderable | null = null;
  function setStatus(content: StyledText, color: string = C.text): void {
    if (statusText) statusBox.remove(statusText);
    statusText = new TextRenderable(renderer, {
      content,
      fg: color,
      bg: C.bg,
      height: 1,
    });
    statusBox.add(statusText);
  }
  outerBox.add(statusBox);

  const divider = new TextRenderable(renderer, {
    content: "─".repeat(80),
    fg: C.border,
    bg: C.bg,
    height: 1,
  });
  outerBox.add(divider);

  // ── Story list ──
  const scrollBox = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    backgroundColor: C.bg,
    scrollY: true,
    scrollX: false,
    viewportCulling: true,
  });
  const rowBoxes: BoxRenderable[] = [];
  const rowTexts: TextRenderable[] = [];

  function clearRows(): void {
    for (const row of rowBoxes) scrollBox.remove(row);
    rowBoxes.length = 0;
    rowTexts.length = 0;
  }

  function rebuildList(): void {
    clearRows();
    stories.forEach((story, i) => {
      const isSelected = i === selectedIdx;
      const rowBg = isSelected ? C.selectionBg : i % 2 === 0 ? C.bg : C.surface;
      const rowText = new TextRenderable(renderer, {
        content: formatStoryLine(story, i + 1),
        bg: rowBg,
        height: 2,
      });
      const rowBox = new BoxRenderable(renderer, {
        id: `hn-row-${i}`,
        flexDirection: "row",
        backgroundColor: rowBg,
      });
      rowBox.add(rowText);
      rowBoxes.push(rowBox);
      rowTexts.push(rowText);
      scrollBox.add(rowBox);
    });
    scrollBox.scrollTop = 0;
  }
  outerBox.add(scrollBox);

  // ── Footer ──
  const footerBox = new BoxRenderable(renderer, {
    height: 1,
    backgroundColor: C.bg,
    paddingX: 1,
  });
  footerBox.add(
    new TextRenderable(renderer, {
      content:
        " ↑↓/jk navigate   ↵ story   c comments   1-6 feed   r refresh   q quit",
      fg: C.muted,
      bg: C.bg,
      height: 1,
    }),
  );
  outerBox.add(footerBox);

  root.add(outerBox);

  // ── Fetch ──
  async function loadFeed(target: HnFeed): Promise<void> {
    feed = target;
    selectedIdx = 0;
    const seq = ++requestSeq;
    renderFeedTabs();
    clearRows();
    setStatus(
      t`${dim(fg(C.muted)(`  Loading ${HN_FEED_LABELS[target]} stories...`))}`,
    );
    renderer.requestRender();
    try {
      const loaded = await fetchHnStories(target, { limit });
      if (seq !== requestSeq) return; // a newer feed switch won
      stories = loaded;
      selectedIdx = 0;
      rebuildList();
      const now = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus(
        t`${fg(C.muted)(`  ${stories.length} stories · updated ${now} · r to refresh`)}`,
      );
    } catch (err) {
      if (seq !== requestSeq) return;
      stories = [];
      clearRows();
      const message = err instanceof Error ? err.message : String(err);
      setStatus(
        t`${fg(C.red)(`  Error: ${message.slice(0, 90)} — r to retry`)}`,
        C.red,
      );
    }
    renderer.requestRender();
  }

  function moveSelection(delta: number): void {
    const next = Math.max(0, Math.min(stories.length - 1, selectedIdx + delta));
    if (next === selectedIdx) return;
    const oldIdx = selectedIdx;
    selectedIdx = next;
    const setBg = (idx: number, selected: boolean): void => {
      if (idx < 0 || idx >= rowBoxes.length) return;
      const bg = selected ? C.selectionBg : idx % 2 === 0 ? C.bg : C.surface;
      rowBoxes[idx].backgroundColor = bg;
      if (rowTexts[idx]) rowTexts[idx].bg = bg;
    };
    setBg(oldIdx, false);
    setBg(selectedIdx, true);
    scrollBox.scrollChildIntoView(`hn-row-${selectedIdx}`);
    renderer.requestRender();
  }

  function openSelected(mode: "story" | "comments"): void {
    const story = stories[selectedIdx];
    if (!story) return;
    openUrl(mode === "comments" ? story.hnUrl : (story.url ?? story.hnUrl));
  }

  function switchFeed(target: HnFeed): void {
    if (target === feed) return;
    void loadFeed(target);
  }

  // ── Keys ──
  renderer.keyInput.on("keypress", (key: import("@opentui/core").KeyEvent) => {
    const name = key.name || "";
    const ctrl = (key as { ctrl?: boolean }).ctrl === true;
    if (name === "q" || name === "escape" || (name === "c" && ctrl)) {
      renderer.destroy();
      process.exit(0);
      return;
    }
    if (/^[1-6]$/.test(name)) {
      switchFeed(HN_FEEDS[Number(name) - 1]);
      return;
    }
    if (name === "left" || name === "h") {
      const i = HN_FEEDS.indexOf(feed);
      switchFeed(HN_FEEDS[(i - 1 + HN_FEEDS.length) % HN_FEEDS.length]);
      return;
    }
    if (name === "right" || name === "l") {
      const i = HN_FEEDS.indexOf(feed);
      switchFeed(HN_FEEDS[(i + 1) % HN_FEEDS.length]);
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
      openSelected("story");
      return;
    }
    if (name === "c") {
      openSelected("comments");
      return;
    }
    if (name === "r") {
      void loadFeed(feed);
    }
  });

  // ── Start ──
  renderer.start();
  renderFeedTabs();
  renderer.requestRender();
  await loadFeed(feed);
}
