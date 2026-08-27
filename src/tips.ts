/**
 * Startup tips — rotate through helpful hints.
 */

/** Rotates tips without repeating the same one twice in a row. */
export class TipRotator {
  private tips: string[];
  private lastIndex = -1;

  constructor(tips?: string[]) {
    this.tips = tips ?? TIPS;
  }

  next(): string {
    let idx: number;
    do {
      idx = Math.floor(Math.random() * this.tips.length);
    } while (idx === this.lastIndex && this.tips.length > 1);
    this.lastIndex = idx;
    return this.tips[idx];
  }
}

const TIPS = [
  "💡 Tip: Press ? to see all keyboard shortcuts",
  "💡 Tip: Use Ctrl+R to recall past searches",
  "💡 Tip: Press b to bookmark a repository",
  "💡 Tip: Tab auto-completes qualifiers like language: and stars:",
  "💡 Tip: Press Ctrl+E to export results as CSV or Markdown",
  "💡 Tip: Set GITHUB_TOKEN for higher API rate limits",
  "💡 Tip: Press c to compare up to 5 repos side-by-side",
  "💡 Tip: Press d for a deep-dive into any repo",
  "💡 Tip: Press E to browse popular GitHub topics",
  "💡 Tip: Press Ctrl+P to copy a repo link to clipboard",
];

export const defaultRotator = new TipRotator();

/** Get the next tip (never repeats the same tip twice in a row). */
export function nextTip(): string {
  return defaultRotator.next();
}
