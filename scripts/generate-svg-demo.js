#!/usr/bin/env node
/**
 * Generate an SVG screenshot of search-cli matching the actual TUI layout.
 * Single frame with blinking cursor — honest and accurate.
 *
 * Usage: node scripts/generate-svg-demo.js > demo.svg
 */

const C = {
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
  selBg: "#2d5bcf",
  selText: "#ffffff",
  star: "#f9e2af",
};

const FW = 9.6, FH = 21, PX = 14, PY = 12, WIN_H = 36;
const W = 90, H = 35;
const SW = Math.round(W * FW + PX * 2 + 8);
const SH = Math.round(H * FH + PY * 2 + WIN_H + 8);

const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

const repos = [
  {fn:"shadcn/ui",s:78500,l:"TypeScript"},
  {fn:"vercel/next.js",s:129000,l:"TypeScript"},
  {fn:"tailwindlabs/tailwindcss",s:84200,l:"CSS"},
  {fn:"tauri-apps/tauri",s:84100,l:"Rust"},
  {fn:"oven-sh/bun",s:74500,l:"Zig"},
  {fn:"n8n-io/n8n",s:54400,l:"TypeScript"},
  {fn:"astral-sh/ruff",s:36100,l:"Rust"},
  {fn:"missive/emoji-mart",s:8800,l:"TypeScript"},
  {fn:"sharkdp/bat",s:50300,l:"Rust"},
  {fn:"BurntSushi/ripgrep",s:48800,l:"Rust"},
  {fn:"jdx/mise",s:14300,l:"Rust"},
  {fn:"nektos/act",s:56100,l:"Go"},
  {fn:"astral-sh/uv",s:40200,l:"Rust"},
  {fn:"zed-industries/zed",s:52000,l:"Rust"},
];

const f = n => n >= 1000 ? `★ ${(n/1000).toFixed(1).replace(/\.0$/,"")}k` : `★ ${n}`;
const num = n => n.toLocaleString();

function tx(x, y, text, fill, cls="") {
  const c = cls ? ` class="${cls}"` : "";
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="'JetBrains Mono','Fira Code','Cascadia Code',monospace" font-size="14"${c}>${esc(text)}</text>\n`;
}

function rx(x, y, w, h, fill, stroke="", r=0) {
  const s = stroke ? ` stroke="${stroke}" stroke-width="1"` : "";
  const rc = r ? ` rx="${r}"` : "";
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${s}${rc}/>\n`;
}

let svg = "";

// ─── Header ──
svg += tx(PX, PY+WIN_H+14, "search-cli — GitHub repo browser   [t]rending  [/]search  [g]raph  [r]efresh  [q]uit", C.muted);

// ─── Search box (blue border, 3 lines height) ──
const sbY = PY+WIN_H+1*FH;
svg += rx(PX, sbY, W*FW-4, FH*2.5+2, C.bg, C.blue, 3);
svg += tx(PX+8, sbY+FH-2, "> language:TypeScript stars:>1000", C.blue);

// ─── Toolbar ──
svg += tx(PX, PY+WIN_H+4.2*FH+14, "sort: stars   limit: 50   (s=cycle sort  l=cycle limit)", C.muted);

// ─── Body: Results (left) + Detail (right) ──
const bY = 5.5;
const paneW = (W*FW-8)/2;
const pH = 18;

// Left pane background
svg += rx(PX, PY+WIN_H+(bY-0.2)*FH, paneW+4, pH*FH, C.bg, C.border, 3);
svg += tx(PX+8, PY+WIN_H+(bY)*FH+14, " Results ", C.blue);

// Results list
repos.forEach((r, i) => {
  if (i >= 14) return;
  const ry = bY + 1 + i * 1.1;
  const isSel = i === 0;
  if (isSel) {
    svg += rx(PX+4, PY+WIN_H+(ry-0.3)*FH, paneW-4, FH-1, C.selBg, "", 3);
  }
  const fgc = isSel ? C.selText : C.text;
  const line = `${r.fn}  ${f(r.s)}`;
  svg += tx(PX+10, PY+WIN_H+ry*FH+14, line, fgc);
});

// Right pane background
svg += rx(PX+paneW+8, PY+WIN_H+(bY-0.2)*FH, paneW+4, pH*FH, C.bg, C.border, 3);
svg += tx(PX+paneW+14, PY+WIN_H+(bY)*FH+14, " Details ", C.green);

// Detail content (matches actual format from tui.ts line ~685)
const detail = [
  `Name     shadcn/ui`,
  `Stars    ${num(78500)}`,
  `Forks    ${num(4200)}`,
  `Lang     TypeScript`,
  `Updated  2026-07-12`,
  `Topics   react, ui, components, shadcn`,
  ``,
  `Beautifully designed components built with Radix UI and`,
  `Tailwind CSS.`,
  ``,
  `https://github.com/shadcn/ui`,
];

detail.forEach((line, i) => {
  if (line === "") return;
  const ry = bY + 1 + i * 1.1;
  let fgc = C.text;
  if (i <= 5) fgc = C.muted;
  if (line.startsWith("http")) fgc = C.blue;
  svg += tx(PX+paneW+16, PY+WIN_H+ry*FH+14, line, fgc);
});

// ─── Bottom status bar ──
svg += rx(PX, PY+WIN_H+21*FH, W*FW-4, FH+4, C.surface, "", 3);
svg += rx(PX, PY+WIN_H+21*FH, W*FW-4, 2, C.border);
svg += tx(PX+4, PY+WIN_H+21.9*FH+14, "15,842 results  (↑↓ nav  Enter open  o browser  Ctrl+R history)", C.muted);

// ─── Cursor blinking after query text ──
const queryText = "language:TypeScript stars:>1000";
const cursorX = PX + 8 + 2 * FW + queryText.length * FW;
svg += `<rect x="${cursorX}" y="${PY + WIN_H + 1 * FH + 1}" width="${FW * 0.6}" height="16" fill="${C.blue}" opacity="0.8">
  <animate attributeName="opacity" values="0.8;0.1;0.8" dur="1s" repeatCount="indefinite"/>
</rect>\n`;

// ─── Assemble ──
const output = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH}" width="${SW}" height="${SH}">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&amp;display=swap');
    </style>
    <filter id="shadow" x="-5%" y="-5%" width="115%" height="115%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.4"/>
    </filter>
  </defs>

  <rect width="100%" height="100%" fill="#0d0d1a"/>

  <!-- Window -->
  <rect x="${PX-2}" y="${PY-2}" width="${SW-PX*2+4}" height="${SH-PY*2+4}" fill="${C.bg}" rx="8" filter="url(#shadow)"/>
  <rect x="${PX-2}" y="${PY-2}" width="${SW-PX*2+4}" height="36" fill="${C.surface}" rx="8"/>
  <rect x="${PX-2}" y="${PY+34}" width="${SW-PX*2+4}" height="2" fill="#313244"/>

  <!-- Traffic lights -->
  <circle cx="${PX+10}" cy="${PY+16}" r="5" fill="#f38ba8"/>
  <circle cx="${PX+28}" cy="${PY+16}" r="5" fill="#f9e2af"/>
  <circle cx="${PX+46}" cy="${PY+16}" r="5" fill="#a6e3a1"/>
  <text x="${SW/2}" y="${PY+22}" fill="${C.muted}" font-family="'JetBrains Mono','Fira Code',monospace" font-size="13" text-anchor="middle">search-cli — terminal GitHub browser</text>

  <g font-family="'JetBrains Mono','Fira Code','Cascadia Code',monospace" font-size="14">
    ${svg}
  </g>
</svg>`;

process.stdout.write(output);
