#!/usr/bin/env node
/** package-browser.ts — "Packages" browse/list view for the ghfind CLI. */
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
import type { Package } from "./types";
import { openUrl } from "./open-url";
import { createPackageSearch } from "./package";
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
  nameText: "#c0caf5", // bright for package names
};
// ─── Number formatting ────────────────────────────────────────────────
const INT_FMT = new Intl.NumberFormat("en-US");
/** 523219736 → "523,219,736" (full downloads tally, no compaction) */
function fmtCount(n: number): string {
  return INT_FMT.format(Math.trunc(n));
}
// ─── Row formatting ───────────────────────────────────────────────────
/** Format one package as a 2-line StyledText (name line + description line). */
function formatPackageLine(pack: Package): StyledText {
  const nameStr = `${pack.name}@${pack.version}`.padEnd(28).slice(0, 28);
  const dlStr = `↓ ${fmtCount(pack.downloads)}`.padEnd(20).slice(0, 20);
  const scoreStr = `score ${pack.score.toFixed(2)}`.padEnd(12).slice(0, 12);
  const desc = (pack.description ?? "").length > 60
    ? (pack.description ?? "").slice(0, 57) + "..."
    : (pack.description ?? "");
  const line1 = t`${bold(fg(C.nameText)(nameStr))}${fg(C.cyan)(dlStr)}${fg(C.gold)(scoreStr)}`;
  const line2 = t`${dim(fg(C.descText)(`     ${desc}`))}`;
  const newline: TextChunk = { text: "\n", __isChunk: true as const };
  const chunks: TextChunk[] = [...line1.chunks, newline, ...line2.chunks];
  return new StyledText(chunks);
}
// ─── Main TUI entry ───────────────────────────────────────────────────
export async function launchPackageBrowser(): Promise<void> {
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
  let query = "";
  let dirty = false; // input edited since last search → Enter re-runs the search
  let packages: Package[] = [];
  let selectedIdx = 0;
  let isLoading = false;
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
    content: t`${bold(fg(C.purple)("⟠ tulipsearch"))}${fg(C.muted)(" — Packages")}`,
    fg: C.purple,
    bg: C.bg,
    height: 1,
  });
  headerBox.add(headerText);
  outerBox.add(headerBox);
  // ── Query input line ──
  const inputBox = new BoxRenderable(renderer, {
    height: 1,
    flexDirection: "row",
    backgroundColor: C.surface,
    paddingX: 1,
  });
  let inputText: TextRenderable | null = null;
  function renderInput() {
    if (inputText) inputBox.remove(inputText);
    const cursor = isLoading ? " " : "▊";
    inputText = new TextRenderable(renderer, {
      content: t`${fg(C.cyan)("❯ ")}${query}${dim(fg(C.muted)(cursor))}`,
      fg: C.text,
      bg: C.surface,
      height: 1,
    });
    inputBox.add(inputText);
  }
  // ── Status line (loading / error / result count) ──
  const statusBox = new BoxRenderable(renderer, {
    height: 1,
    backgroundColor: C.bg,
    paddingX: 1,
  });
  let statusText: TextRenderable | null = null;
  function setStatus(cfg: { content: StyledText; color?: string }) {
    if (statusText) statusBox.remove(statusText);
    statusText = new TextRenderable(renderer, {
      content: cfg.content,
      fg: cfg.color ?? C.text,
      bg: C.bg,
      height: 1,
    });
    statusBox.add(statusText);
  }
  // ── Package list (scrollable) ──
  const scrollBox = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    backgroundColor: C.bg,
    scrollY: true,
    scrollX: false,
    viewportCulling: true,
  });
  const rowBoxes: BoxRenderable[] = [];
  const rowTexts: TextRenderable[] = [];
  function clearRows() {
    for (const rb of rowBoxes) scrollBox.remove(rb);
    rowBoxes.length = 0;
    rowTexts.length = 0;
  }
  function rebuildList() {
    clearRows();
    packages.forEach((p, i) => {
      const isEven = i % 2 === 0;
      const isSelected = i === selectedIdx;
      const rowBg = isSelected ? C.selectionBg : (isEven ? C.bg : C.surface);
      const rowText = new TextRenderable(renderer, {
        content: formatPackageLine(p),
        bg: rowBg,
        height: 2,
      });
      const rowBox = new BoxRenderable(renderer, {
        flexDirection: "row",
        backgroundColor: rowBg,
      });
      rowBox.add(rowText);
      rowBoxes.push(rowBox);
      rowTexts.push(rowText);
      scrollBox.add(rowBox);
    });
  }
  // ── Footer bar ──
  const footerBox = new BoxRenderable(renderer, {
    height: 1,
    backgroundColor: C.bg,
    paddingX: 1,
  });
  const footerText = new TextRenderable(renderer, {
    content: " type query ↵ search   ↑↓ navigate   ↵ open   q/esc quit",
    fg: C.muted,
    bg: C.bg,
    height: 1,
  });
  footerBox.add(footerText);
  outerBox.add(footerBox);
  root.add(outerBox);
  outerBox.add(inputBox);
  outerBox.add(statusBox);
  const divider = new TextRenderable(renderer, {
    content: "─".repeat(80),
    fg: C.border,
    bg: C.bg,
    height: 1,
  });
  outerBox.add(divider);
  outerBox.add(scrollBox);
  // ── Fetch ──
  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    isLoading = true;
    dirty = false;
    clearRows();
    setStatus({ content: t`${dim(fg(C.muted)(`  Loading packages for "${q}"...`))}` });
    renderer.requestRender();
    try {
      const searcher = createPackageSearch();
      const res = await searcher.searchPackage(q, 25);
      packages = res.packages;
      selectedIdx = 0;
      rebuildList();
      setStatus({
        content: t`${fg(C.muted)(`  ${packages.length} of ${fmtCount(res.totalCount)} results for `)}${fg(C.cyan)(`"${q}"`)}`,
      });
    } catch (err) {
      packages = [];
      clearRows();
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({
        content: t`${fg(C.red)(`  Error: ${msg.slice(0, 70)} — press ↵ to retry`)}`,
      });
    }
    isLoading = false;
    renderInput();
    renderer.requestRender();
  }
  // ── Helpers ──
  function openSelectedPackage() {
    if (selectedIdx < 0 || selectedIdx >= packages.length) return;
    const p = packages[selectedIdx];
    openUrl(p.url);
  }
  function moveSelection(delta: number) {
    const oldIdx = selectedIdx;
    const newIdx = Math.max(0, Math.min(packages.length - 1, oldIdx + delta));
    if (newIdx === oldIdx) return;
    selectedIdx = newIdx;
    const setBg = (idx: number, selected: boolean) => {
      if (idx < 0 || idx >= rowBoxes.length) return;
      const bg = selected ? C.selectionBg : (idx % 2 === 0 ? C.bg : C.surface);
      rowBoxes[idx].backgroundColor = bg;
      if (rowTexts[idx]) rowTexts[idx].bg = bg;
    };
    setBg(oldIdx, false);
    setBg(newIdx, true);
    renderer.requestRender();
  }
  // ── Global key events ──
  renderer.keyInput.on("keypress", (key: import("@opentui/core").KeyEvent) => {
    const name = key.name || "";
    if (name === "q" || name === "escape") {
      process.exit(0);
      return;
    }
    if (name === "backspace") {
      query = query.slice(0, -1);
      dirty = true;
      renderInput();
      renderer.requestRender();
      return;
    }
    if (name === "space") {
      query += " ";
      dirty = true;
      renderInput();
      renderer.requestRender();
      return;
    }
    // Printable single-char inputs edit the query.
    if (name.length === 1) {
      query += name;
      dirty = true;
      renderInput();
      renderer.requestRender();
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
    if (name === "enter" || name === "return") {
      if (dirty || packages.length === 0) {
        runSearch();
      } else {
        openSelectedPackage();
      }
      return;
    }
  });
  // ── Start ──
  renderer.start();
  renderInput();
  setStatus({
    content: t`${fg(C.muted)("  Type a package query above and press ↵ to search")}`,
  });
  renderer.requestRender();
}
