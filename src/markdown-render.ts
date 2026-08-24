/**
 * Minimal markdown-to-terminal-text renderer.
 *
 * Renders headings, code blocks, lists, tables, blockquotes, horizontal rules,
 * bold/italic, and links into a plain-text representation suitable for a
 * TextRenderable in the TUI.
 */

interface RenderOptions {
  /** Terminal width for wrapping and table layout. Default: 80. */
  width?: number;
}

/** Render markdown text to terminal-friendly plain text. */
export function renderMarkdown(md: string, opts: RenderOptions = {}): string {
  const width = opts.width ?? 80;
  const lines = md.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  function flushCode() {
    if (codeLines.length === 0) return;
    const maxLen = Math.max(...codeLines.map((l) => l.length), codeLang.length);
    const barW = Math.min(maxLen + 4, width - 2);
    out.push("┌" + "─".repeat(barW) + "┐");
    if (codeLang) out.push("│ " + codeLang.padEnd(barW - 1) + "│");
    for (const cl of codeLines) {
      out.push("│ " + cl.padEnd(barW - 1) + "│");
    }
    out.push("└" + "─".repeat(barW) + "┘");
    out.push("");
    codeLines = [];
    codeLang = "";
  }

  function flushTable() {
    if (tableRows.length === 0) return;
    const dataRows = tableRows.filter(
      (r) => !r.every((c) => /^[\s\-:|]+$/.test(c)),
    );
    if (dataRows.length === 0) {
      tableRows = [];
      return;
    }
    const colCount = Math.max(...dataRows.map((r) => r.length));
    const colW: number[] = [];
    for (let ci = 0; ci < colCount; ci++) {
      colW.push(
        Math.max(
          3,
          ...dataRows.map((r) => (r[ci] ?? "").length),
        ),
      );
    }
    const totalW = colW.reduce((a, b) => a + b, 0) + colCount * 3 - 1;
    if (totalW > width) {
      for (const row of dataRows) {
        out.push("  " + row.map((c) => c.trim()).join(" │ "));
      }
    } else {
      const sep = "┌" + colW.map((w) => "─".repeat(w + 2)).join("┬") + "┐";
      const mid = "├" + colW.map((w) => "─".repeat(w + 2)).join("┼") + "┤";
      const end = "└" + colW.map((w) => "─".repeat(w + 2)).join("┴") + "┘";
      out.push(sep);
      dataRows.forEach((row, i) => {
        const cells = colW.map((w, ci) => (row[ci] ?? "").trim().padEnd(w));
        out.push("│ " + cells.map((c) => ` ${c} `).join("│") + "│");
        if (i === 0) out.push(mid);
      });
      out.push(end);
    }
    out.push("");
    tableRows = [];
  }

  function renderInline(line: string): string {
    // Bold
    line = line.replace(/\*\*(.+?)\*\*/g, "$1");
    // Italic (no asterisks)
    line = line.replace(/\*([^*]+?)\*/g, "$1");
    // Inline code
    line = line.replace(/`([^`]+)`/g, "⟨$1⟩");
    // Links [text](url)
    line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
    // Images
    line = line.replace(/!\[([^\]]*)\]\([^)]+\)/g, "🖼 $1");
    return line;
  }

  function wrapLine(line: string, maxW: number): string[] {
    if (line.length <= maxW) return [line];
    const parts: string[] = [];
    let remaining = line;
    while (remaining.length > maxW) {
      let breakAt = maxW;
      const spaceIdx = remaining.lastIndexOf(" ", maxW);
      if (spaceIdx > maxW / 2) breakAt = spaceIdx;
      parts.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).replace(/^ /, "");
    }
    if (remaining) parts.push(remaining);
    return parts;
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Code block boundaries
    if (/^```/.test(line)) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Table row
    if (line.includes("|")) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (cells.length >= 2) {
        inTable = true;
        tableRows.push(cells);
        continue;
      }
    } else if (inTable) {
      flushTable();
      inTable = false;
    }

    // Horizontal rule
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
      out.push("─".repeat(Math.min(width, 40)));
      out.push("");
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = renderInline(headingMatch[2]);
      const prefix = "█ ".repeat(level);
      out.push("");
      out.push(prefix + text);
      out.push("");
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      const inner = renderInline(bqMatch[1]);
      for (const wl of wrapLine(inner, width - 4)) {
        out.push("│ " + wl);
      }
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (ulMatch) {
      const indent = ulMatch[1].length;
      const depth = Math.floor(indent / 2);
      const prefix = "  ".repeat(depth) + "• ";
      const inner = renderInline(ulMatch[2]);
      for (const wl of wrapLine(inner, width - prefix.length)) {
        out.push(prefix + wl);
      }
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (olMatch) {
      const indent = olMatch[1].length;
      const depth = Math.floor(indent / 2);
      const prefix = "  ".repeat(depth) + "◦ ";
      const inner = renderInline(olMatch[2]);
      for (const wl of wrapLine(inner, width - prefix.length)) {
        out.push(prefix + wl);
      }
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      out.push("");
      continue;
    }

    // Paragraph
    const rendered = renderInline(line);
    for (const wl of wrapLine(rendered, width)) {
      out.push(wl);
    }
  }

  if (inCodeBlock) flushCode();
  if (inTable) flushTable();

  return out.join("\n");
}
