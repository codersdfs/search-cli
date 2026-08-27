/** Landing screen pieces that are worth testing in isolation. */
import { BoxRenderable, TextRenderable } from "@opentui/core";

export interface LandingButtonColors {
  accent: string;
  border: string;
  text: string;
}

/** Label for the landing-screen bookmarks button. */
export function bookmarksButtonLabel(count: number): string {
  if (count <= 0) return "\u{1F516}  Bookmarks  (none yet)";
  if (count === 1) return "\u{1F516}  Bookmarks  (1 saved)";
  return `\u{1F516}  Bookmarks  (${count} saved)`;
}

/**
 * Whether the landing screen should consume navigation keys.
 * False once another mode owns the screen (search, trending, packages,
 * or the bookmarks page) or an overlay (help, ...) is open on top.
 */
export function landingKeysActive(mode: string, overlay: string): boolean {
  return mode === "landing" && overlay === "none";
}

/** Keys the landing screen consumes; anything else falls through. */
const LANDING_KEYS = new Set([
  "up",
  "k",
  "down",
  "j",
  "enter",
  "return",
  "b",
  "?",
  "h",
  "q",
]);

/**
 * Whether the landing screen consumes this key. Callers must stop propagation
 * for these, or the *same* event reaches the global handler next — e.g.
 * Enter opening the bookmarks page and then immediately being re-read as
 * "open the selected bookmark in a browser".
 */
export function landingConsumesKey(name: string): boolean {
  return LANDING_KEYS.has(name);
}

/** Clamped selection movement for the landing menu (no wrap-around). */
export function moveSelection(
  current: number,
  delta: number,
  total: number,
): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, current + delta));
}

/**
 * Compact bordered button rendered under the landing mode cards.
 * Highlights like a card when selected; label carries the bookmark count.
 */
export function createBookmarksButton(
  renderer: ConstructorParameters<typeof BoxRenderable>[0],
  colors: LandingButtonColors,
) {
  const box = new BoxRenderable(renderer, {
    height: 3,
    width: "60%",
    marginTop: 1,
    border: true,
    borderColor: colors.border,
    paddingX: 1,
    alignItems: "center",
    justifyContent: "center",
    focusable: false,
  });
  const label = new TextRenderable(renderer, {
    content: bookmarksButtonLabel(0),
    color: colors.text,
    height: 1,
  });
  box.add(label);

  return {
    box,
    setCount(n: number): void {
      label.content = bookmarksButtonLabel(n);
    },
    setSelected(selected: boolean): void {
      box.borderColor = selected ? colors.accent : colors.border;
      label.color = selected ? colors.accent : colors.text;
    },
    get labelText(): string {
      return label.content as string;
    },
    get borderColor(): unknown {
      return box.borderColor;
    },
  };
}

export type BookmarksButton = ReturnType<typeof createBookmarksButton>;
